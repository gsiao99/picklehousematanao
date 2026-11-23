#!/usr/bin/env python3
"""
LOCAL TEST ONLY — a tiny stand-in for Supabase's API gateway, for running the
real app against the local test database when Docker / the Supabase CLI are
not available. Never deploy this.

  /auth/v1/token, /auth/v1/user, /auth/v1/logout, /auth/v1/signup (test-only, see signup())
      Signs in any user in auth.users whose password is TEST_PASSWORD and
      issues an UNSIGNED JWT with their id. No real authentication.
  /rest/v1/rpc/<function>           POST → select public.<function>(…)
  /rest/v1/<table>                  GET / POST (upsert) / PATCH / DELETE with
                                    eq, neq, gt, lt, gte, lte, in, order, limit
  /storage/v1/object/<bucket>/<path>        POST upload: inserts the storage.objects
                                    row AS THE CALLER (so storage RLS decides), checks the
                                    bucket's size and type limits, keeps bytes on local disk
  /storage/v1/object/sign/<bucket>/<path>   POST: signed link, only if the caller can
                                    SELECT the object under RLS; GET serves it (HMAC token)
Every query runs inside a transaction as role anon or authenticated with
request.jwt.claims set, exactly as PostgREST does, so Row Level Security,
grants and SECURITY DEFINER functions behave as they will on Supabase.
Realtime is not emulated.

Usage: python3 scripts/local-db/rest-shim.py   (listens on 127.0.0.1:54321)
"""
import base64
import hashlib
import hmac
import json
import os
import uuid
from email.parser import BytesParser
from email.policy import default as email_policy
import re
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qsl, urlparse

import psycopg
from psycopg import sql

DSN = os.environ.get("TEST_DSN", "host=127.0.0.1 port=54322 user=postgres dbname=dd_test")
PORT = int(os.environ.get("SHIM_PORT", "54321"))
TEST_PASSWORD = os.environ.get("TEST_PASSWORD", "courts2026")
PENDING_CONFIRMATION: set[str] = set()
STORAGE_DIR = os.environ.get("SHIM_STORAGE_DIR", "/tmp/dd-shim-storage")
SIGN_SECRET = os.urandom(32)


def b64(obj) -> str:
    return base64.urlsafe_b64encode(json.dumps(obj).encode()).decode().rstrip("=")


def make_jwt(user_id: str, email: str) -> str:
    exp = int(time.time()) + 3600
    return ".".join([b64({"alg": "none", "typ": "JWT"}),
                     b64({"sub": user_id, "role": "authenticated", "email": email, "exp": exp,
                          "aud": "authenticated", "session_id": "local"}), "unsigned"])


def read_jwt(header: str | None):
    if not header or not header.lower().startswith("bearer "):
        return None
    token = header.split(" ", 1)[1]
    parts = token.split(".")
    if len(parts) != 3:
        return None
    try:
        payload = json.loads(base64.urlsafe_b64decode(parts[1] + "=" * (-len(parts[1]) % 4)))
    except Exception:
        return None
    if payload.get("role") == "service_role":
        return payload  # test-only stand-in for the server-side secret key (backup scripts)
    return payload if payload.get("role") == "authenticated" and payload.get("sub") else None


IDENT = re.compile(r"^[a-z_][a-z0-9_]*$")


def ident(name: str) -> sql.Identifier:
    if not IDENT.match(name):
        raise ValueError(f"bad identifier {name}")
    return sql.Identifier(name)


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):  # quiet
        pass

    # -- helpers ------------------------------------------------------------
    def send(self, status: int, body=None, extra_headers=None):
        payload = b"" if body is None else (body if isinstance(body, bytes) else json.dumps(body).encode())
        self.send_response(status)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
        self.send_header("Access-Control-Expose-Headers", "*")
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        for k, v in (extra_headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if payload:
            self.wfile.write(payload)

    def body(self):
        n = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(n) if n else b""
        return json.loads(raw) if raw else None

    def run(self, build):
        """Run build(cur) as the caller's role; return its JSON value."""
        claims = read_jwt(self.headers.get("Authorization"))
        role = claims.get("role", "authenticated") if claims else "anon"
        claims_json = json.dumps(claims or {"role": "anon"})
        with psycopg.connect(DSN, autocommit=False) as conn:
            with conn.cursor() as cur:
                cur.execute("set local timezone = 'UTC'")
                cur.execute(sql.SQL("set local role {}").format(sql.Identifier(role)))
                cur.execute("select set_config('request.jwt.claims', %s, true)", (claims_json,))
                result = build(cur)
            conn.commit()
        return result

    def fail(self, e: Exception):
        if isinstance(e, psycopg.Error) and e.diag and e.diag.sqlstate:
            code = e.diag.sqlstate
            status = 403 if code == "42501" else 404 if code == "P0002" else 409 if code in ("23505", "23P01") else 400
            return self.send(status, {"code": code, "message": e.diag.message_primary, "details": e.diag.message_detail,
                                      "hint": e.diag.message_hint})
        return self.send(500, {"code": "SHIM", "message": str(e)})

    # -- filters ------------------------------------------------------------
    def where(self, params):
        clauses, values = [], []
        ops = {"eq": "=", "neq": "<>", "gt": ">", "lt": "<", "gte": ">=", "lte": "<="}
        for key, raw in params:
            if key in ("select", "order", "limit", "offset", "on_conflict", "columns"):
                continue
            op, _, value = raw.partition(".")
            if op == "in":
                items = [v.strip('"') for v in value.strip("()").split(",") if v]
                clauses.append(sql.SQL("{}::text = any(%s)").format(ident(key)))
                values.append(items)
            elif op == "is":
                clauses.append(sql.SQL("{} is null").format(ident(key)) if value == "null" else sql.SQL("{} is not null").format(ident(key)))
            elif op in ops:
                clauses.append(sql.SQL("{}::text " + ops[op] + " %s").format(ident(key)) if op in ("eq", "neq")
                               else sql.SQL("{} " + ops[op] + " %s").format(ident(key)))
                values.append(value)
        if not clauses:
            return sql.SQL(""), values
        return sql.SQL(" where ") + sql.SQL(" and ").join(clauses), values

    # -- routes -------------------------------------------------------------
    def do_OPTIONS(self):
        self.send(204)

    def do_GET(self):
        url = urlparse(self.path)
        if url.path == "/auth/v1/user":
            claims = read_jwt(self.headers.get("Authorization"))
            if not claims:
                return self.send(401, {"code": "bad_jwt", "msg": "invalid JWT"})
            return self.send(200, self.user_json(claims["sub"]))
        if url.path.startswith("/rest/v1/"):
            return self.table_read(url.path[len("/rest/v1/"):], parse_qsl(url.query, keep_blank_values=True))
        if url.path.startswith("/storage/v1/object/sign/"):
            return self.storage_serve(url.path[len("/storage/v1/object/sign/"):], dict(parse_qsl(url.query)))
        if url.path.startswith("/storage/v1/object/authenticated/") or (url.path.startswith("/storage/v1/object/")
                                                                       and not url.path.startswith("/storage/v1/object/public/")):
            rest = url.path.split("/storage/v1/object/", 1)[1].removeprefix("authenticated/")
            return self.storage_download(rest)
        self.send(404, {"message": "not found"})

    def do_POST(self):
        url = urlparse(self.path)
        params = dict(parse_qsl(url.query))
        if url.path == "/auth/v1/token":
            return self.token(params.get("grant_type"))
        if url.path == "/auth/v1/logout":
            return self.send(204)
        if url.path == "/auth/v1/signup":
            return self.signup()
        if url.path.startswith("/rest/v1/rpc/"):
            return self.rpc(url.path[len("/rest/v1/rpc/"):])
        if url.path.startswith("/rest/v1/"):
            return self.table_write("POST", url.path[len("/rest/v1/"):], parse_qsl(url.query, keep_blank_values=True))
        if url.path.startswith("/storage/v1/object/sign/"):
            return self.storage_sign(url.path[len("/storage/v1/object/sign/"):])
        if url.path.startswith("/storage/v1/object/list/"):
            return self.storage_list(url.path[len("/storage/v1/object/list/"):])
        if url.path.startswith("/storage/v1/object/"):
            return self.storage_upload(url.path[len("/storage/v1/object/"):])
        self.send(404, {"message": "not found"})

    def do_PATCH(self):
        url = urlparse(self.path)
        self.table_write("PATCH", url.path[len("/rest/v1/"):], parse_qsl(url.query, keep_blank_values=True))

    def do_DELETE(self):
        url = urlparse(self.path)
        self.table_write("DELETE", url.path[len("/rest/v1/"):], parse_qsl(url.query, keep_blank_values=True))

    # -- auth ---------------------------------------------------------------
    def user_json(self, user_id):
        with psycopg.connect(DSN) as conn:
            row = conn.execute("select id::text, email from auth.users where id = %s", (user_id,)).fetchone()
        return {"id": row[0], "email": row[1], "aud": "authenticated", "role": "authenticated",
                "app_metadata": {"provider": "email"}, "user_metadata": {}, "created_at": "2026-10-11T00:00:00Z"}

    def signup(self):
        """Test-only sign-up. Emails at @confirm.test behave like a project with email
        confirmation on (no session until the link is opened; the link's code is
        'confirm-<user id>'); other emails behave like auto-confirm (session at once).
        Like Supabase, a repeated sign-up for an existing email creates nothing and
        reveals nothing. The password must be the shared test password."""
        body = self.body() or {}
        email = str(body.get("email", "")).strip().lower()
        meta = body.get("data") or {}
        if body.get("password") != TEST_PASSWORD:
            return self.send(422, {"code": "weak_password", "error_code": "weak_password", "msg": "Use the test password"})
        with psycopg.connect(DSN, autocommit=True) as conn:
            row = conn.execute("select id::text from auth.users where lower(email) = %s", (email,)).fetchone()
            if row:
                return self.send(200, {"id": str(uuid.uuid4()), "email": email, "aud": "authenticated", "role": "",
                                       "identities": [], "user_metadata": {}, "app_metadata": {}})
            user_id = str(uuid.uuid4())
            conn.execute("insert into auth.users (id, email, raw_user_meta_data) values (%s, %s, %s::jsonb)",
                         (user_id, email, json.dumps(meta)))
        if email.endswith("@confirm.test"):
            PENDING_CONFIRMATION.add(user_id)
            user = self.user_json(user_id)
            return self.send(200, {**user, "confirmation_sent_at": "2026-10-12T00:00:00Z"})
        user = self.user_json(user_id)
        return self.send(200, {"access_token": make_jwt(user_id, user["email"]), "token_type": "bearer", "expires_in": 3600,
                               "expires_at": int(time.time()) + 3600, "refresh_token": f"local-{user_id}", "user": user})

    def token(self, grant):
        body = self.body() or {}
        if grant == "refresh_token":
            user_id = body.get("refresh_token", "").removeprefix("local-")
        elif grant == "pkce":
            # Confirmation link opened: the stand-in accepts its own codes (real Auth also checks the verifier).
            code = str(body.get("auth_code", ""))
            user_id = code.removeprefix("confirm-")
            if not code.startswith("confirm-") or user_id not in PENDING_CONFIRMATION:
                return self.send(400, {"code": "flow_state_not_found", "error_code": "flow_state_not_found",
                                       "msg": "invalid flow state, no valid flow state found"})
            PENDING_CONFIRMATION.discard(user_id)
        else:
            with psycopg.connect(DSN) as conn:
                row = conn.execute("select id::text from auth.users where lower(email) = lower(%s)",
                                   (body.get("email", ""),)).fetchone()
            if not row or body.get("password") != TEST_PASSWORD:
                return self.send(400, {"code": "invalid_credentials", "error_code": "invalid_credentials",
                                       "msg": "Invalid login credentials"})
            user_id = row[0]
            if user_id in PENDING_CONFIRMATION:
                return self.send(400, {"code": "email_not_confirmed", "error_code": "email_not_confirmed",
                                       "msg": "Email not confirmed"})
        user = self.user_json(user_id)
        self.send(200, {"access_token": make_jwt(user_id, user["email"]), "token_type": "bearer", "expires_in": 3600,
                        "expires_at": int(time.time()) + 3600, "refresh_token": f"local-{user_id}", "user": user})

    # -- rpc ----------------------------------------------------------------
    def rpc(self, fn):
        args = self.body() or {}
        try:
            with psycopg.connect(DSN) as conn:
                meta = conn.execute("""
                  select p.proretset, format_type(p.prorettype, null),
                         coalesce(p.proargnames[1:p.pronargs], '{}'),
                         coalesce(array(select format_type(t, null) from unnest(p.proargtypes::oid[]) t), '{}')
                  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = %s""", (fn,)).fetchone()
            if not meta:
                return self.send(404, {"code": "PGRST202", "message": f"function {fn} not found"})
            retset, rettype, names, types = meta
            parts, values = [], []
            for name, typ in zip(names, types):
                if name in args:
                    v = args[name]
                    parts.append(sql.SQL("{} => %s::" + typ).format(sql.Identifier(name)))
                    values.append(json.dumps(v) if typ in ("jsonb", "json") else v)
            call = sql.SQL("public.{}({})").format(ident(fn), sql.SQL(", ").join(parts))
            if retset:
                q = sql.SQL("select coalesce(json_agg(t), '[]'::json) from {} t").format(call)
            else:
                q = sql.SQL("select to_json({})").format(call)

            def build(cur):
                cur.execute(q, values)
                return cur.fetchone()[0]

            result = self.run(build)
            if rettype == "void":
                return self.send(204)
            self.send(200, result)
        except Exception as e:  # noqa: BLE001
            self.fail(e)

    # -- tables ---------------------------------------------------------------
    def select_list(self, params):
        cols = dict(params).get("select", "*")
        if cols == "*":
            return sql.SQL("*")
        return sql.SQL(", ").join(ident(c.strip()) for c in cols.split(","))

    def table_read(self, table, params):
        try:
            where, values = self.where(params)
            q = sql.SQL("select {} from public.{}").format(self.select_list(params), ident(table)) + where
            p = dict(params)
            if "order" in p:
                orders = []
                for o in p["order"].split(","):
                    col, *mods = o.split(".")
                    orders.append(ident(col) + sql.SQL(" desc" if "desc" in mods else " asc"))
                q += sql.SQL(" order by ") + sql.SQL(", ").join(orders)
            if "limit" in p:
                q += sql.SQL(" limit {}").format(sql.Literal(int(p["limit"])))
            full = sql.SQL("select coalesce(json_agg(t), '[]'::json) from ({}) t").format(q)

            def build(cur):
                cur.execute(full, values)
                return cur.fetchone()[0]

            rows = self.run(build)
            self.reply_rows(rows)
        except Exception as e:  # noqa: BLE001
            self.fail(e)

    def reply_rows(self, rows):
        if "vnd.pgrst.object" in (self.headers.get("Accept") or ""):
            if len(rows) != 1:
                return self.send(406, {"code": "PGRST116", "message": "JSON object requested, multiple (or no) rows returned"})
            return self.send(200, rows[0])
        self.send(200, rows)

    def table_write(self, method, table, params):
        try:
            body = self.body()
            prefer = self.headers.get("Prefer") or ""
            returning = "return=representation" in prefer
            where, values = self.where(params)
            if method == "POST":
                rows = body if isinstance(body, list) else [body]
                cols = list(rows[0].keys())
                q = sql.SQL("insert into public.{} ({}) select {} from json_populate_recordset(null::public.{}, %s)").format(
                    ident(table), sql.SQL(", ").join(ident(c) for c in cols),
                    sql.SQL(", ").join(ident(c) for c in cols), ident(table))
                values = [json.dumps(rows)]
                conflict = dict(params).get("on_conflict")
                if "resolution=merge-duplicates" in prefer and conflict:
                    keys = [c.strip() for c in conflict.split(",")]
                    updates = [c for c in cols if c not in keys]
                    q += sql.SQL(" on conflict ({}) do update set {}").format(
                        sql.SQL(", ").join(ident(k) for k in keys),
                        sql.SQL(", ").join(sql.SQL("{} = excluded.{}").format(ident(c), ident(c)) for c in updates))
            elif method == "PATCH":
                sets = [sql.SQL("{} = (json_populate_record(null::public.{}, %s)).{}").format(ident(c), ident(table), ident(c))
                        for c in body.keys()]
                q = sql.SQL("update public.{} set {}").format(ident(table), sql.SQL(", ").join(sets)) + where
                values = [json.dumps(body)] * len(body) + values
            else:
                q = sql.SQL("delete from public.{}").format(ident(table)) + where
            q += sql.SQL(" returning *")
            full = sql.SQL("with w as ({}) select coalesce(json_agg(w), '[]'::json) from w").format(q)

            def build(cur):
                cur.execute(full, values)
                return cur.fetchone()[0]

            rows = self.run(build)
            if returning:
                return self.reply_rows(rows)
            self.send(201 if method == "POST" else 204)
        except Exception as e:  # noqa: BLE001
            self.fail(e)

    # -- storage --------------------------------------------------------------
    def storage_error(self, status: int, code: str, message: str):
        self.send(400 if status != 404 else 404, {"statusCode": str(status), "error": code, "message": message})

    def split_object(self, rest: str):
        bucket, _, name = rest.partition("/")
        if not bucket or not name or ".." in name.split("/"):
            raise ValueError("bad object path")
        return bucket, name

    def read_upload(self):
        n = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(n) if n else b""
        ctype = self.headers.get("Content-Type") or "application/octet-stream"
        if ctype.startswith("multipart/form-data"):
            msg = BytesParser(policy=email_policy).parsebytes(
                b"Content-Type: " + ctype.encode() + b"\r\n\r\n" + raw)
            for part in msg.iter_parts():
                if part.get_filename() is not None or part.get_param("name", header="content-disposition") == "":
                    return part.get_payload(decode=True) or b"", part.get_content_type()
            raise ValueError("no file in upload")
        return raw, ctype.split(";")[0].strip()

    def storage_upload(self, rest):
        try:
            bucket, name = self.split_object(rest)
            data, mimetype = self.read_upload()
            with psycopg.connect(DSN) as conn:
                limits = conn.execute("select file_size_limit, allowed_mime_types from storage.buckets where id = %s",
                                      (bucket,)).fetchone()
            if not limits:
                return self.storage_error(404, "not_found", "Bucket not found")
            size_limit, mimes = limits
            if size_limit and len(data) > size_limit:
                return self.storage_error(413, "Payload too large", "The object exceeded the maximum allowed size")
            if mimes and mimetype not in mimes:
                return self.storage_error(415, "invalid_mime_type", f"mime type {mimetype} is not supported")
            claims = read_jwt(self.headers.get("Authorization"))
            owner = claims["sub"] if claims else None
            meta = json.dumps({"mimetype": mimetype, "size": len(data)})
            object_id = str(uuid.uuid4())

            def build(cur):
                cur.execute("insert into storage.objects (id, bucket_id, name, owner, owner_id, metadata) "
                            "values (%s, %s, %s, %s, %s, %s::jsonb)", (object_id, bucket, name, owner, owner, meta))
                return object_id

            try:
                self.run(build)
            except psycopg.Error as e:
                code = e.diag.sqlstate if e.diag else None
                if code == "23505":
                    return self.storage_error(409, "Duplicate", "The resource already exists")
                if code == "42501":
                    return self.storage_error(403, "Unauthorized", "new row violates row-level security policy")
                raise
            path = os.path.join(STORAGE_DIR, bucket, name)
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, "wb") as f:
                f.write(data)
            self.send(200, {"Key": f"{bucket}/{name}", "Id": object_id})
        except Exception as e:  # noqa: BLE001
            self.fail(e)

    def sign_token(self, bucket, name, exp):
        msg = f"{bucket}/{name}:{exp}".encode()
        return f"{exp}.{hmac.new(SIGN_SECRET, msg, hashlib.sha256).hexdigest()}"

    def storage_sign(self, rest):
        try:
            bucket, name = self.split_object(rest)
            expires_in = int((self.body() or {}).get("expiresIn") or 60)

            def build(cur):
                cur.execute("select 1 from storage.objects where bucket_id = %s and name = %s", (bucket, name))
                return cur.fetchone() is not None

            if not self.run(build):  # missing, or hidden from this caller by RLS
                return self.storage_error(404, "not_found", "Object not found")
            exp = int(time.time()) + min(max(expires_in, 1), 3600)
            self.send(200, {"signedURL": f"/object/sign/{bucket}/{name}?token={self.sign_token(bucket, name, exp)}"})
        except Exception as e:  # noqa: BLE001
            self.fail(e)

    def storage_list(self, bucket):
        """Immediate children of a prefix, visible to the caller under RLS (folders have id null)."""
        try:
            body = self.body() or {}
            prefix = (body.get("prefix") or "").strip("/")
            limit, offset = int(body.get("limit") or 100), int(body.get("offset") or 0)

            def build(cur):
                cur.execute("select name, id::text, metadata, created_at::text from storage.objects where bucket_id = %s "
                            "and (%s = '' or name like %s) order by name", (bucket, prefix, prefix + "/%"))
                return cur.fetchall()

            rows = self.run(build)
            children, seen = [], set()
            for name, oid, meta, created in rows:
                rest = name[len(prefix) + 1:] if prefix else name
                head, sep, _ = rest.partition("/")
                if sep:
                    if head not in seen:
                        seen.add(head)
                        children.append({"name": head, "id": None, "metadata": None})
                else:
                    children.append({"name": rest, "id": oid, "metadata": meta, "created_at": created})
            self.send(200, children[offset:offset + limit])
        except Exception as e:  # noqa: BLE001
            self.fail(e)

    def storage_download(self, rest):
        try:
            bucket, name = self.split_object(rest)

            def build(cur):
                cur.execute("select metadata ->> 'mimetype' from storage.objects where bucket_id = %s and name = %s", (bucket, name))
                return cur.fetchone()

            row = self.run(build)
            path = os.path.join(STORAGE_DIR, bucket, name)
            if not row or not os.path.exists(path):
                return self.storage_error(404, "not_found", "Object not found")
            data = open(path, "rb").read()
            self.send_response(200)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Content-Type", row[0] or "application/octet-stream")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
        except Exception as e:  # noqa: BLE001
            self.fail(e)

    def storage_serve(self, rest, params):
        try:
            bucket, name = self.split_object(rest)
            token = params.get("token", "")
            exp = int(token.split(".", 1)[0]) if "." in token else 0
            if exp < time.time() or not hmac.compare_digest(token, self.sign_token(bucket, name, exp)):
                return self.storage_error(400, "InvalidSignature", "The signature is invalid or has expired")
            with psycopg.connect(DSN) as conn:
                row = conn.execute("select metadata ->> 'mimetype' from storage.objects where bucket_id = %s and name = %s",
                                   (bucket, name)).fetchone()
            path = os.path.join(STORAGE_DIR, bucket, name)
            if not row or not os.path.exists(path):
                return self.storage_error(404, "not_found", "Object not found")
            with open(path, "rb") as f:
                data = f.read()
            self.send_response(200)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Content-Type", row[0] or "application/octet-stream")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "private, no-store")
            self.end_headers()
            self.wfile.write(data)
        except Exception as e:  # noqa: BLE001
            self.fail(e)


if __name__ == "__main__":
    print(f"rest-shim on http://127.0.0.1:{PORT} → {DSN}", flush=True)
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
