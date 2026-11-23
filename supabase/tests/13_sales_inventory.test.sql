-- Sales and inventory: staff sell, rent and move stock; admins manage items,
-- costs, counts and voids; cost prices stay hidden from staff. Items, prices
-- and stock below are TEST FIXTURES inside this rolled-back transaction.
begin;
select plan(51);

create function pg_temp.as_user(_id text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', _id, 'role', 'authenticated')::text, true);
end $$;
create table pg_temp.ids (name text primary key, id uuid);
grant all on pg_temp.ids to public;
create function pg_temp.id(_name text) returns uuid language sql stable as $$ select id from pg_temp.ids where name = _name $$;
create function pg_temp.keep(_name text, _id uuid) returns uuid language sql as
  $$ insert into pg_temp.ids values (_name, _id) on conflict (name) do update set id = excluded.id returning id $$;
create function pg_temp.cat(_name text) returns uuid language sql stable security definer as
  $$ select id from public.inventory_categories where name = _name $$;
create function pg_temp.stock(_id uuid) returns int language sql stable security definer as
  $$ select stock from public.inventory_items where id = _id $$;
create function pg_temp.alerts(_user uuid) returns int language sql stable security definer as
  $$ select count(*)::int from public.notifications where user_id = _user and kind = 'staff_activity' and title = 'Low stock' $$;
create function pg_temp.today() returns date language sql stable security definer as $$ select private.operating_date_of(now()) $$;
grant execute on function pg_temp.today(), pg_temp.as_user(text), pg_temp.id(text), pg_temp.keep(text, uuid), pg_temp.cat(text),
  pg_temp.stock(uuid), pg_temp.alerts(uuid) to public;

insert into auth.users (id, email, raw_user_meta_data) values
  ('d0000000-0000-4000-8000-000000000001', 'invadmin@test.local', '{"full_name":"Ada Admin"}'),
  ('d0000000-0000-4000-8000-000000000002', 'invstaff@test.local', '{"full_name":"Sam Staff"}'),
  ('d0000000-0000-4000-8000-000000000003', 'invreports@test.local', '{"full_name":"Rae Reports"}'),
  ('d0000000-0000-4000-8000-000000000004', 'invplayer@test.local', '{"full_name":"Pia Player"}');
insert into public.user_roles (user_id, role) values
  ('d0000000-0000-4000-8000-000000000001', 'admin'),
  ('d0000000-0000-4000-8000-000000000002', 'staff'),
  ('d0000000-0000-4000-8000-000000000003', 'staff');
insert into public.staff_permissions (user_id, permission) values ('d0000000-0000-4000-8000-000000000003', 'reports.view');

select is((select count(*)::int from public.inventory_categories), 4, 'four starting categories');
select is((select count(*)::int from public.inventory_items), 0, 'no items, prices or stock are invented');

-- ---------------------------------------------------------------------------
-- Admin sets up items
-- ---------------------------------------------------------------------------
set local role authenticated;
select pg_temp.as_user('d0000000-0000-4000-8000-000000000001');
select pg_temp.keep('water', public.admin_save_inventory_item(null, pg_temp.cat('Beverages'), 'Bottled water 500 ml', 'bottle', null,
  2500, 1200, 3, 1, true, 'New item'));
select pg_temp.keep('paddle', public.admin_save_inventory_item(null, pg_temp.cat('Paddle rentals'), 'Paddle', 'paddle', null,
  10000, null, 1, 1, true, 'New item'));
select is(pg_temp.stock(pg_temp.id('water')), 0, 'new items start with no stock');
select lives_ok($$ select public.admin_set_stock(pg_temp.id('paddle'), 4, 'Stock take') $$, 'admin sets how many paddles the club owns');
select throws_ok($$ select public.admin_save_inventory_item(null, pg_temp.cat('Beverages'), 'bottled water 500 ml ', null, null,
  2500, null, null, 1, true, 'Duplicate') $$, '23505', null, 'item names are unique within a category');
select throws_ok($$ select public.admin_save_inventory_item(null, pg_temp.cat('Food'), 'Sandwich', null, null, 9000, null, null, 1, true, '') $$,
  '22023', null, 'changes need a reason');
select lives_ok($$ select public.admin_save_inventory_category(null, 'Merchandise', 'sale', 5, true, 'New category') $$,
  'admin adds a category');

-- ---------------------------------------------------------------------------
-- Staff: stock in, sell, rent, return
-- ---------------------------------------------------------------------------
select pg_temp.as_user('d0000000-0000-4000-8000-000000000002');
select throws_ok($$ select public.admin_save_inventory_item(null, pg_temp.cat('Food'), 'Chips', null, null, 3000, null, null, 1, true, 'x') $$,
  '42501', null, 'staff cannot add items');
select throws_ok($$ select public.admin_set_stock(pg_temp.id('water'), 50, 'x') $$, '42501', null, 'staff cannot correct counts');
select throws_ok($$ select cost_centavos from public.inventory_items $$, '42501', null, 'staff cannot read cost prices');
select is((select cost_centavos from public.staff_list_inventory() where item_id = pg_temp.id('water')), null,
  'the item list hides cost from staff');
select throws_ok($$ select public.staff_stock_move(pg_temp.id('water'), 'in', 10, '') $$, '22023', null, 'stock in needs a reason');
select is(public.staff_stock_move(pg_temp.id('water'), 'in', 10, 'Delivery'), 10, 'staff record a delivery');
select throws_ok($$ insert into public.sales (reference, operating_date, method, total_centavos) values ('X', current_date, 'cash', 0) $$,
  '42501', null, 'sales cannot be written directly');

select pg_temp.keep('sale1', public.staff_record_sale(
  jsonb_build_array(jsonb_build_object('item_id', pg_temp.id('water'), 'quantity', 6)), 'cash', null, null));
select is((select total_centavos from public.sales where id = pg_temp.id('sale1')), 15000::bigint, 'the price comes from the item, not the client');
select is(pg_temp.stock(pg_temp.id('water')), 4, 'selling takes stock off');
select is(pg_temp.alerts('d0000000-0000-4000-8000-000000000002'::uuid), 0, 'no alert while above the minimum');

select pg_temp.keep('sale2', public.staff_record_sale(
  jsonb_build_array(jsonb_build_object('item_id', pg_temp.id('water'), 'quantity', 1)), 'gcash', 'Walk-in', null));
select is(pg_temp.alerts('d0000000-0000-4000-8000-000000000002'::uuid), 1, 'reaching the minimum alerts the team, the seller included');
select is(pg_temp.alerts('d0000000-0000-4000-8000-000000000001'::uuid), 1, 'the admin gets the low-stock alert too');
select throws_ok($$ select public.staff_record_sale(jsonb_build_array(jsonb_build_object('item_id', pg_temp.id('water'), 'quantity', 4)),
  'cash', null, null) $$, '22023', 'Only 3 of Bottled water 500 ml left.', 'cannot sell more than is on hand');

select throws_ok($$ select public.staff_record_sale(jsonb_build_array(jsonb_build_object('item_id', pg_temp.id('paddle'), 'quantity', 1)),
  'cash', null, null) $$, '22023', null, 'a rental needs the renter''s name');
select pg_temp.keep('rent', public.staff_record_sale(
  jsonb_build_array(jsonb_build_object('item_id', pg_temp.id('paddle'), 'quantity', 3)), 'cash', 'Juan Dela Cruz', null));
select is((select available from public.staff_list_inventory() where item_id = pg_temp.id('paddle')), 1,
  'rented paddles are out until returned');
select is(pg_temp.stock(pg_temp.id('paddle')), 4, 'renting does not change how many paddles the club owns');
select throws_ok($$ select public.staff_record_sale(jsonb_build_array(jsonb_build_object('item_id', pg_temp.id('paddle'), 'quantity', 2)),
  'cash', 'Ana', null) $$, '22023', null, 'cannot rent out more than are available');
select lives_ok($$ select public.staff_return_rental((select r.id from public.rentals r join public.sale_lines l on l.id = r.sale_line_id
  where l.sale_id = pg_temp.id('rent'))) $$, 'staff mark the paddles returned');
select is((select available from public.staff_list_inventory() where item_id = pg_temp.id('paddle')), 4, 'returned paddles are available again');

select throws_ok($$ select public.admin_void_sale(pg_temp.id('sale1'), 'Mistake') $$, '42501', null, 'staff cannot void sales');

-- Closing summary for staff: totals per method, no cost.
select is((public.staff_sales_day(pg_temp.today()) ->> 'total_centavos')::bigint, 47500::bigint,
  'the day total adds every sale');
select is((public.staff_sales_day(pg_temp.today()) ->> 'cost_centavos'), null, 'the day summary hides cost from staff');

-- ---------------------------------------------------------------------------
-- Reports: staff with reports.view see sales but not profit; admins see both
-- ---------------------------------------------------------------------------
select pg_temp.as_user('d0000000-0000-4000-8000-000000000003');
select is((select total_centavos from public.report_sales_daily(pg_temp.today(), pg_temp.today())),
  47500::bigint, 'reports include sales');
select is((select profit_centavos from public.report_sales_items(pg_temp.today(), pg_temp.today())
           where item = 'Bottled water 500 ml'), null, 'profit is hidden from non-admin staff');

select pg_temp.as_user('d0000000-0000-4000-8000-000000000001');
select is((select profit_centavos from public.report_sales_items(pg_temp.today(), pg_temp.today())
           where item = 'Bottled water 500 ml'), 9100::bigint, 'admins see profit (7 x (25.00 - 12.00))');
select lives_ok($$ select public.admin_void_sale(pg_temp.id('sale1'), 'Rang up twice') $$, 'admin voids a sale');
select is(pg_temp.stock(pg_temp.id('water')), 9, 'voiding puts the stock back');

-- Per-hour rentals: hours paid, a due time, extending, and voiding an extension.
create function pg_temp.due(_sale uuid) returns timestamptz language sql stable security definer as
  $$ select r.due_at from public.rentals r join public.sale_lines l on l.id = r.sale_line_id where l.sale_id = _sale $$;
grant execute on function pg_temp.due(uuid) to public;
select pg_temp.keep('rent2', public.staff_record_sale(
  jsonb_build_array(jsonb_build_object('item_id', pg_temp.id('paddle'), 'quantity', 1, 'hours', 2)), 'cash', 'Ana', null));
select is((select total_centavos from public.sales where id = pg_temp.id('rent2')), 20000::bigint, 'two hours cost twice the hourly fee');
select ok(pg_temp.due(pg_temp.id('rent2')) between now() + interval '119 minutes' and now() + interval '121 minutes',
  'the rental is due when the paid hours end');
select throws_ok($$ select public.staff_record_sale(jsonb_build_array(jsonb_build_object('item_id', pg_temp.id('paddle'), 'quantity', 1, 'hours', 13)),
  'cash', 'Ana', null) $$, '22023', null, 'rentals are 1 to 12 hours');
select pg_temp.keep('ext', public.staff_extend_rental(
  (select r.id from public.rentals r join public.sale_lines l on l.id = r.sale_line_id where l.sale_id = pg_temp.id('rent2')), 1, 'gcash'));
select is((select total_centavos from public.sales where id = pg_temp.id('ext')), 10000::bigint, 'an extra hour is charged as a new sale');
select ok(pg_temp.due(pg_temp.id('rent2')) between now() + interval '179 minutes' and now() + interval '181 minutes',
  'extending moves the due time');
select public.admin_void_sale(pg_temp.id('ext'), 'Changed their mind');
select ok(pg_temp.due(pg_temp.id('rent2')) between now() + interval '119 minutes' and now() + interval '121 minutes',
  'voiding the extension moves the due time back');

-- Deleting items: only without history, admins only.
create function pg_temp.item(_name text) returns uuid language sql stable security definer as
  $$ select id from public.inventory_items where name = _name $$;
select pg_temp.as_user('d0000000-0000-4000-8000-000000000001');
select public.admin_save_inventory_item(null, pg_temp.cat('Beverages'), 'Test straw', null, null, 500, null, null, 1, true, 'New item');
select public.admin_save_inventory_item(null, pg_temp.cat('Beverages'), 'Test cup', null, null, 500, null, null, 1, true, 'New item');
select public.staff_stock_move(pg_temp.item('Test cup'), 'in', 5, 'Delivery');
select pg_temp.as_user('d0000000-0000-4000-8000-000000000002');
select throws_ok($$ select public.admin_delete_inventory_item(pg_temp.item('Test straw'), 'Item deleted') $$, '42501', null,
  'staff cannot delete items');
select pg_temp.as_user('d0000000-0000-4000-8000-000000000001');
select throws_ok($$ select public.admin_delete_inventory_item(pg_temp.item('Test cup'), 'Item deleted') $$, '22023', null,
  'an item with stock history cannot be deleted');
select lives_ok($$ select public.admin_delete_inventory_item(pg_temp.item('Test straw'), 'Item deleted') $$,
  'an unused item is deleted');
select is((select count(*)::int from public.staff_list_inventory() where name in ('Test straw', 'Test cup')), 1,
  'only the unused item is gone');

-- Deleting categories: only without history, admins only, with a reason.
select pg_temp.as_user('d0000000-0000-4000-8000-000000000002');
select throws_ok($$ select public.admin_delete_inventory_category(pg_temp.cat('Merchandise'), 'Not needed') $$, '42501', null,
  'staff cannot delete categories');
select pg_temp.as_user('d0000000-0000-4000-8000-000000000001');
select throws_ok($$ select public.admin_delete_inventory_category(pg_temp.cat('Beverages'), 'Tidy up') $$, '22023', null,
  'a category whose items have sales history cannot be deleted');
select public.admin_save_inventory_item(null, pg_temp.cat('Merchandise'), 'Grip tape', null, null, 15000, null, null, 1, true, 'New item');
select lives_ok($$ select public.admin_delete_inventory_category(pg_temp.cat('Merchandise'), 'Not selling merchandise') $$,
  'an unused category is deleted with its unused items');
select is((select count(*)::int from public.staff_list_inventory() where name = 'Grip tape'), 0, 'its items are gone too');

-- ---------------------------------------------------------------------------
-- Players and visitors
-- ---------------------------------------------------------------------------
select pg_temp.as_user('d0000000-0000-4000-8000-000000000004');
select throws_ok($$ select public.staff_list_inventory() $$, '42501', null, 'players cannot see the inventory');
select is((select count(*)::int from public.sales), 0, 'players cannot read sales');

reset role;
select ok(not has_function_privilege('anon', 'public.staff_record_sale(jsonb, public.payment_method_kind, text, text)', 'execute'),
  'visitors cannot record sales');

select * from finish();
rollback;
