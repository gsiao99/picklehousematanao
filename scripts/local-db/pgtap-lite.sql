-- ============================================================================
-- LOCAL TEST ONLY. A small pgTAP-compatible subset, used when the real pgTAP
-- extension is not installed. Test files in supabase/tests use standard pgTAP
-- calls and run unchanged with `supabase test db` (which ships real pgTAP).
--
-- Supported: plan, ok, is, isnt, throws_ok (4-arg), lives_ok, is_empty,
-- isnt_empty, finish.
-- ============================================================================

create schema if not exists tap;
grant usage on schema tap to public;

create or replace function tap._next() returns int language plpgsql as $$
declare n int;
begin
  n := coalesce(nullif(current_setting('tap.count', true), ''), '0')::int + 1;
  perform set_config('tap.count', n::text, false);
  return n;
end $$;

create or replace function tap._fail() returns void language plpgsql as $$
begin
  perform set_config('tap.failed',
    (coalesce(nullif(current_setting('tap.failed', true), ''), '0')::int + 1)::text, false);
end $$;

create or replace function tap._result(passed boolean, description text, diag text default null)
returns text language plpgsql as $$
declare n int := tap._next(); line text;
begin
  if passed then
    return format('ok %s - %s', n, coalesce(description, ''));
  end if;
  perform tap._fail();
  line := format('not ok %s - %s', n, coalesce(description, ''));
  if diag is not null then line := line || E'\n# ' || replace(diag, E'\n', E'\n# '); end if;
  return line;
end $$;

create or replace function public.plan(n int) returns text language plpgsql as $$
begin
  perform set_config('tap.plan', n::text, false);
  perform set_config('tap.count', '0', false);
  perform set_config('tap.failed', '0', false);
  return '1..' || n;
end $$;

create or replace function public.ok(passed boolean, description text default null)
returns text language sql as $$ select tap._result(coalesce(passed, false), description) $$;

create or replace function public.is(have anyelement, want anyelement, description text default null)
returns text language plpgsql as $$
begin
  return tap._result(have is not distinct from want, description,
    case when have is distinct from want then format('have: %s  want: %s', have, want) end);
end $$;

create or replace function public.isnt(have anyelement, dontwant anyelement, description text default null)
returns text language plpgsql as $$
begin
  return tap._result(have is distinct from dontwant, description,
    case when have is not distinct from dontwant then format('have: %s  (should differ)', have) end);
end $$;

create or replace function public.throws_ok(sql text, errcode char(5), errmsg text, description text)
returns text language plpgsql as $$
begin
  execute sql;
  return tap._result(false, description, 'no exception was raised');
exception when others then
  return tap._result(
    (errcode is null or sqlstate = errcode) and (errmsg is null or sqlerrm = errmsg),
    description,
    case when not ((errcode is null or sqlstate = errcode) and (errmsg is null or sqlerrm = errmsg))
      then format('caught: %s %s  wanted: %s %s', sqlstate, sqlerrm, errcode, coalesce(errmsg, '')) end);
end $$;

create or replace function public.lives_ok(sql text, description text default null)
returns text language plpgsql as $$
begin
  execute sql;
  return tap._result(true, description);
exception when others then
  return tap._result(false, description, format('died: %s %s', sqlstate, sqlerrm));
end $$;

create or replace function public.is_empty(sql text, description text default null)
returns text language plpgsql as $$
declare rec record; found_any boolean := false;
begin
  for rec in execute sql loop found_any := true; exit; end loop;
  return tap._result(not found_any, description, case when found_any then 'query returned rows' end);
exception when others then
  return tap._result(false, description, format('died: %s %s', sqlstate, sqlerrm));
end $$;

create or replace function public.isnt_empty(sql text, description text default null)
returns text language plpgsql as $$
declare rec record; found_any boolean := false;
begin
  for rec in execute sql loop found_any := true; exit; end loop;
  return tap._result(found_any, description, case when not found_any then 'query returned no rows' end);
exception when others then
  return tap._result(false, description, format('died: %s %s', sqlstate, sqlerrm));
end $$;

create or replace function public.finish() returns setof text language plpgsql as $$
declare planned int := nullif(current_setting('tap.plan', true), '')::int;
        ran int := coalesce(nullif(current_setting('tap.count', true), ''), '0')::int;
        failed int := coalesce(nullif(current_setting('tap.failed', true), ''), '0')::int;
begin
  if planned is not null and planned <> ran then
    return next format('# Looks like you planned %s tests but ran %s.', planned, ran);
    return next 'not ok - plan mismatch';
  end if;
  if failed > 0 then
    return next format('# Looks like you failed %s test(s) of %s.', failed, ran);
  end if;
  return;
end $$;

grant execute on all functions in schema tap to public;
grant execute on function public.plan(int), public.ok(boolean, text), public.is(anyelement, anyelement, text),
  public.isnt(anyelement, anyelement, text), public.throws_ok(text, char, text, text), public.lives_ok(text, text),
  public.is_empty(text, text), public.isnt_empty(text, text), public.finish() to public;
