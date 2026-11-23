-- A player's own level pick is confirmed automatically; staff changes stick.
begin;
select plan(6);

insert into public.event_categories (name, slug, sort_order) values ('Novice', 'novice', 1) on conflict (slug) do nothing;
insert into public.event_categories (name, slug, sort_order) values ('Rookie Test', 'rookie-test', 0);
insert into public.event_categories (name, slug, sort_order, is_active) values ('Retired Test', 'retired-test', 998, false);

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-4111-8111-111111111111', 'ana@test.local', '{"full_name":"Ana Reyes","self_rated_level":"rookie_test"}'),
  ('22222222-2222-4222-8222-222222222222', 'ben@test.local', '{"full_name":"Ben Cruz"}'),
  ('33333333-3333-4333-8333-333333333333', 'cara@test.local', '{"full_name":"Cara Lim","self_rated_level":"retired_test"}');

select is((select level::text from public.profiles where id = '11111111-1111-4111-8111-111111111111'),
  'rookie_test', 'the level picked at sign-up is confirmed straight away, for any active category');
select ok((select level is null and self_rated_level is null from public.profiles where id = '22222222-2222-4222-8222-222222222222'),
  'a player who picked no level has none');
select ok((select level is null and self_rated_level is null from public.profiles where id = '33333333-3333-4333-8333-333333333333'),
  'a level that is no longer offered is dropped at sign-up');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}', true);
update public.profiles set self_rated_level = 'novice' where id = '22222222-2222-4222-8222-222222222222';
select is((select level::text from public.profiles where id = '22222222-2222-4222-8222-222222222222'),
  'novice', 'picking a level for the first time on the profile confirms it');
select throws_ok($$ update public.profiles set level = 'rookie_test' where id = '22222222-2222-4222-8222-222222222222' $$,
  '42501', null, 'a player still cannot write the confirmed level directly');

reset role;
select set_config('app.audit_reason', 'Assessed at open play', true);
update public.profiles set level = 'rookie_test' where id = '22222222-2222-4222-8222-222222222222';
set local role authenticated;
update public.profiles set self_rated_level = 'novice' where id = '22222222-2222-4222-8222-222222222222';
select is((select level::text from public.profiles where id = '22222222-2222-4222-8222-222222222222'),
  'rookie_test', 'a level set by staff is not overwritten when the player changes their pick');

select * from finish();
rollback;
