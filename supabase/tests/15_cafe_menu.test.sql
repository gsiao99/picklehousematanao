-- The café menu comes from Inventory: active items in active, for-sale
-- categories that are switched on for the menu. Items and prices below are
-- TEST FIXTURES inside this rolled-back transaction.
begin;
select plan(9);

insert into auth.users (id, email, raw_user_meta_data) values
  ('e0000000-0000-4000-8000-000000000001', 'menuadmin@test.local', '{"full_name":"Mae Admin"}'),
  ('e0000000-0000-4000-8000-000000000002', 'menustaff@test.local', '{"full_name":"Sol Staff"}');
insert into public.user_roles (user_id, role) values
  ('e0000000-0000-4000-8000-000000000001', 'admin'),
  ('e0000000-0000-4000-8000-000000000002', 'staff');

select set_config('app.audit_reason', 'Test fixtures', true);
insert into public.inventory_categories (id, name, kind, sort_order, is_active, show_on_menu) values
  ('e1000000-0000-4000-8000-000000000001', 'Menu Test Meals', 'sale', 1, true, true),
  ('e1000000-0000-4000-8000-000000000002', 'Menu Test Misc', 'sale', 2, true, false),
  ('e1000000-0000-4000-8000-000000000003', 'Menu Test Rentals', 'rental', 3, true, true),
  ('e1000000-0000-4000-8000-000000000004', 'Menu Test Hidden', 'sale', 4, false, true);
insert into public.inventory_items (category_id, name, price_centavos, cost_centavos, stock, is_active) values
  ('e1000000-0000-4000-8000-000000000001', 'Test Tapa', 11900, 6000, 5, true),
  ('e1000000-0000-4000-8000-000000000001', 'Test Retired Dish', 9900, 5000, 0, false),
  ('e1000000-0000-4000-8000-000000000002', 'Test Ball', 20000, 15000, 4, true),
  ('e1000000-0000-4000-8000-000000000003', 'Test Paddle', 5000, null, 2, true),
  ('e1000000-0000-4000-8000-000000000004', 'Test Old Drink', 3000, 1000, 1, true);

select ok((select show_on_menu from public.inventory_categories where name = 'Menu Test Meals'), 'new categories show on the menu by default');

set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select is((select string_agg(item_name, ',' order by item_name) from public.get_cafe_menu() where item_name like 'Test %'),
  'Test Tapa', 'visitors see only active items in active, shown, for-sale categories');
select is((select price_centavos from public.get_cafe_menu() where item_name = 'Test Tapa'), 11900, 'with the price from Inventory');
select throws_ok($$ select * from public.inventory_items $$, '42501', null, 'visitors still cannot read Inventory itself');
select throws_ok($$ select public.admin_set_category_on_menu('e1000000-0000-4000-8000-000000000002', true, 'x') $$,
  '42501', null, 'visitors cannot change the menu');

reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"e0000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select throws_ok($$ select public.admin_set_category_on_menu('e1000000-0000-4000-8000-000000000002', true, 'x') $$,
  '42501', null, 'staff cannot change the menu');

select set_config('request.jwt.claims', '{"sub":"e0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select throws_ok($$ select public.admin_set_category_on_menu('e1000000-0000-4000-8000-000000000002', true, '  ') $$,
  null, null, 'a reason is required');
select lives_ok($$ select public.admin_set_category_on_menu('e1000000-0000-4000-8000-000000000002', true, 'Balls go on the menu') $$,
  'an admin can show a category on the menu');
select is((select string_agg(item_name, ',' order by item_name) from public.get_cafe_menu() where item_name like 'Test %'),
  'Test Ball,Test Tapa', 'its items then show on the menu');

select * from finish();
rollback;
