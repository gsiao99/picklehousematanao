#!/usr/bin/env python3
"""
LOCAL TEST ONLY — serve a built app with the exact headers from vercel.json
(Content-Security-Policy and friends) and the same SPA fallback, so browser
tests catch anything the production headers would block. The Supabase origin
in the CSP is swapped for the local API stand-in (http://127.0.0.1:54321).

  python3 scripts/e2e/serve_with_headers.py <dist-dir> <port>
"""
import json
import os
import re
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DIST, PORT = os.path.abspath(sys.argv[1]), int(sys.argv[2])
config = json.load(open(os.path.join(ROOT, "vercel.json")))


def headers_for(path):
    out = {}
    for rule in config["headers"]:
        pattern = "^" + re.sub(r"\(\.\*\)", "(.*)", rule["source"]) + "$"
        if re.match(pattern, path):
            for h in rule["headers"]:
                value = h["value"]
                if h["key"] == "Content-Security-Policy":
                    value = (value.replace("https://*.supabase.co", "http://127.0.0.1:54321")
                                  .replace("wss://*.supabase.co", "ws://127.0.0.1:54321")
                                  .replace("; upgrade-insecure-requests", ""))
                if h["key"] == "Strict-Transport-Security":
                    continue  # meaningless over local http
                out[h["key"]] = value
    return out


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=DIST, **k)

    def log_message(self, *a):
        pass

    def send_head(self):
        path = self.path.split("?")[0]
        if not path.startswith("/assets/") and not os.path.isfile(os.path.join(DIST, path.lstrip("/"))):
            self.path = "/index.html"
        self._extra = headers_for(path if path != "/" else "/index.html")
        return super().send_head()

    def end_headers(self):
        for k, v in getattr(self, "_extra", {}).items():
            self.send_header(k, v)
        super().end_headers()


ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
