-- Player levels follow the event categories: a new category adds a level in
-- the right place, its key never changes, and level names come from the
-- category names. (Enum values added here are rolled back with the test.)
begin;
select plan(7);

create function pg_temp.level_pos(_key text) returns real language sql stable as
  $$ select enumsortorder from pg_enum where enumtypid = 'public.player_level'::regtype and enumlabel = _key $$;

insert into public.event_categories (name, slug, sort_order) values ('Novice', 'novice', 1) on conflict (slug) do nothing;
insert into public.event_categories (name, slug, sort_order) values ('Rookie Test', 'rookie-test', 0);
insert into public.event_categories (name, slug, sort_order) values ('Pro Test', 'pro-test', 999);

select is((select level_key from public.event_categories where slug = 'rookie-test'), 'rookie_test',
  'a category gets a level key from its slug');
select ok(pg_temp.level_pos('rookie_test') is not null, 'adding a category adds a matching player level');
select ok(pg_temp.level_pos('rookie_test') < pg_temp.level_pos('novice'),
  'the new level sits below the next category in order (Rookie below Novice)');
select ok(pg_temp.level_pos('pro_test') > pg_temp.level_pos('advanced'),
  'a category ordered last becomes the highest level');

update public.event_categories set slug = 'rookie-renamed' where slug = 'rookie-test';
select is((select level_key from public.event_categories where slug = 'rookie-renamed'), 'rookie_test',
  'the level key never changes after the category is created');

update public.event_categories set name = 'Beginner' where level_key = 'novice';
select is(private.level_label('novice'), 'Beginner', 'level names come from the category names');
select is(private.skill_text('novice', null), 'Beginner and up', 'event level text uses the category names');

select * from finish();
rollback;
