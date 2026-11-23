-- ============================================================================
-- Sales and inventory
--
-- The front desk sells food and drinks and rents out paddles and balls.
--
--   * Categories group items; a category is either 'sale' (stock goes down
--     when sold) or 'rental' (the club owns a number of units; a rental is
--     out until staff mark it returned, then the unit is available again).
--   * Prices and stock live only in the database. A sale sends item ids and
--     quantities; the price (and cost, for profit) is copied from the item.
--   * Staff record sales, rentals, returns and stock in/out (with a reason).
--     Only admins add or edit categories and items, set prices and costs,
--     correct stock counts and void sales (with a reason).
--   * Cost prices are visible to admins only: the cost columns are not
--     granted to the API, and the read functions return them only to admins.
--   * When a sale or stock-out takes an item to its minimum or below, a
--     "Low stock" team alert goes to the staff area.
-- Money is integer centavos. Days are Asia/Manila operating dates.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------
create table public.inventory_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 60),
  kind text not null check (kind in ('sale', 'rental')),
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index inventory_categories_name_key on public.inventory_categories (lower(btrim(name)));

create table public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.inventory_categories (id),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  unit text check (unit is null or char_length(unit) <= 20),
  description text check (description is null or char_length(description) <= 200),
  -- Selling price, or the rental fee per rental.
  price_centavos int not null check (price_centavos >= 0),
  -- What the item costs the club (admins only); NULL when not entered.
  cost_centavos int check (cost_centavos is null or cost_centavos >= 0),
  -- Sale items: units on hand. Rental items: units the club owns.
  stock int not null default 0 check (stock >= 0),
  -- Low-stock alert at or below this many on hand (sale items) or available (rentals).
  low_stock_at int check (low_stock_at is null or low_stock_at >= 0),
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index inventory_items_name_key on public.inventory_items (category_id, lower(btrim(name)));
create index inventory_items_category_idx on public.inventory_items (category_id);

create sequence public.sale_reference_seq;

create table public.sales (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,
  operating_date date not null,
  method public.payment_method_kind not null,
  customer_name text check (customer_name is null or char_length(customer_name) <= 80),
  booking_id uuid references public.bookings (id) on delete set null,
  total_centavos bigint not null check (total_centavos >= 0),
  staff_id uuid references public.profiles (id) on delete set null,
  voided_at timestamptz,
  voided_by uuid references public.profiles (id) on delete set null,
  void_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((voided_at is null) = (void_reason is null))
);
create index sales_operating_date_idx on public.sales (operating_date);
create index sales_booking_idx on public.sales (booking_id);
create index sales_staff_idx on public.sales (staff_id);
create index sales_voided_by_idx on public.sales (voided_by);

create table public.sale_lines (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales (id) on delete cascade,
  item_id uuid not null references public.inventory_items (id),
  item_name text not null,
  is_rental boolean not null,
  quantity int not null check (quantity between 1 and 999),
  unit_price_centavos int not null check (unit_price_centavos >= 0),
  -- Cost at the time of sale (admins only); NULL when the item had no cost.
  unit_cost_centavos int check (unit_cost_centavos is null or unit_cost_centavos >= 0),
  line_total_centavos bigint not null check (line_total_centavos >= 0)
);
create index sale_lines_sale_idx on public.sale_lines (sale_id);
create index sale_lines_item_idx on public.sale_lines (item_id);

create table public.rentals (
  id uuid primary key default gen_random_uuid(),
  sale_line_id uuid not null references public.sale_lines (id) on delete cascade,
  item_id uuid not null references public.inventory_items (id),
  quantity int not null check (quantity >= 1),
  renter_name text not null check (char_length(btrim(renter_name)) between 1 and 80),
  out_at timestamptz not null default now(),
  returned_at timestamptz,
  returned_by uuid references public.profiles (id) on delete set null,
  -- Set when the sale was voided while the rental was still out.
  cancelled boolean not null default false
);
create index rentals_open_idx on public.rentals (item_id) where returned_at is null;
create index rentals_sale_line_idx on public.rentals (sale_line_id);
create index rentals_returned_by_idx on public.rentals (returned_by);

create table public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.inventory_items (id),
  kind text not null check (kind in ('stock_in', 'stock_out', 'sale', 'sale_void', 'adjustment')),
  -- Change to stock on hand (negative when it goes down).
  change int not null,
  stock_after int not null,
  reason text,
  sale_id uuid references public.sales (id) on delete set null,
  actor_id uuid references public.profiles (id) on delete set null,
  operating_date date not null,
  created_at timestamptz not null default now()
);
create index inventory_movements_item_idx on public.inventory_movements (item_id, created_at desc);
create index inventory_movements_date_idx on public.inventory_movements (operating_date);
create index inventory_movements_sale_idx on public.inventory_movements (sale_id);
create index inventory_movements_actor_idx on public.inventory_movements (actor_id);

create trigger inventory_categories_set_updated_at before update on public.inventory_categories
for each row execute function private.set_updated_at();
create trigger inventory_items_set_updated_at before update on public.inventory_items
for each row execute function private.set_updated_at();
create trigger sales_set_updated_at before update on public.sales
for each row execute function private.set_updated_at();

create trigger inventory_categories_audit after insert or update or delete on public.inventory_categories
for each row execute function private.write_audit();
create trigger inventory_items_audit after insert or update or delete on public.inventory_items
for each row execute function private.write_audit();
create trigger sales_audit after insert or update or delete on public.sales
for each row execute function private.write_audit();
create trigger rentals_audit after insert or update or delete on public.rentals
for each row execute function private.write_audit();

-- ---------------------------------------------------------------------------
-- 2. Access: staff read (never cost columns); every write goes through the
--    functions below.
-- ---------------------------------------------------------------------------
alter table public.inventory_categories enable row level security;
alter table public.inventory_items enable row level security;
alter table public.sales enable row level security;
alter table public.sale_lines enable row level security;
alter table public.rentals enable row level security;
alter table public.inventory_movements enable row level security;

create policy "Staff read inventory categories" on public.inventory_categories for select to authenticated using (private.is_staff());
create policy "Staff read inventory items" on public.inventory_items for select to authenticated using (private.is_staff());
create policy "Staff read sales" on public.sales for select to authenticated using (private.is_staff());
create policy "Staff read sale lines" on public.sale_lines for select to authenticated using (private.is_staff());
create policy "Staff read rentals" on public.rentals for select to authenticated using (private.is_staff());
create policy "Staff read stock movements" on public.inventory_movements for select to authenticated using (private.is_staff());

revoke all on public.inventory_categories, public.inventory_items, public.sales, public.sale_lines,
  public.rentals, public.inventory_movements from anon, authenticated;
revoke all on sequence public.sale_reference_seq from anon, authenticated;
grant select on public.inventory_categories, public.sales, public.rentals, public.inventory_movements to authenticated;
-- Cost columns are left out on purpose: staff must not see what the club pays.
grant select (id, category_id, name, unit, description, price_centavos, stock, low_stock_at, sort_order, is_active,
              created_at, updated_at) on public.inventory_items to authenticated;
grant select (id, sale_id, item_id, item_name, is_rental, quantity, unit_price_centavos, line_total_centavos)
  on public.sale_lines to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Starting categories (names only; no items, prices or stock are invented)
-- ---------------------------------------------------------------------------
insert into public.inventory_categories (name, kind, sort_order) values
  ('Paddle rentals', 'rental', 1),
  ('Ball rentals', 'rental', 2),
  ('Food', 'sale', 3),
  ('Beverages', 'sale', 4);

-- ---------------------------------------------------------------------------
-- 4. Helpers
-- ---------------------------------------------------------------------------
create or replace function private.require_staff()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_staff() then
    raise exception 'Only club staff can do this.' using errcode = '42501';
  end if;
  return auth.uid();
end;
$$;

-- Rental units out right now.
create or replace function private.rental_units_out(_item_id uuid)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(r.quantity), 0)::int from public.rentals r where r.item_id = _item_id and r.returned_at is null;
$$;

-- What can be sold or rented now: on hand (sale items) or owned minus out (rentals).
create or replace function private.inventory_available(_item public.inventory_items)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select case when c.kind = 'rental' then _item.stock - private.rental_units_out(_item.id) else _item.stock end
  from public.inventory_categories c where c.id = _item.category_id;
$$;

-- Team alert when an item has just reached its minimum (it was above it before).
create or replace function private.alert_low_stock(_item_id uuid, _before int)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _i public.inventory_items;
  _now int;
begin
  select * into _i from public.inventory_items where id = _item_id;
  if _i.low_stock_at is null then
    return;
  end if;
  _now := private.inventory_available(_i);
  if _before > _i.low_stock_at and _now <= _i.low_stock_at then
    -- No actor: the person who made the sale sees it too.
    perform private.notify_staff('Low stock', _i.name || ' · ' || _now || ' left', '/admin/inventory', null);
  end if;
exception when others then
  raise warning 'low stock alert skipped for %: %', _item_id, sqlerrm;
end;
$$;

create or replace function private.record_movement(
  _item_id uuid, _kind text, _change int, _reason text, _sale_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _after int;
begin
  update public.inventory_items set stock = stock + _change where id = _item_id returning stock into _after;
  insert into public.inventory_movements (item_id, kind, change, stock_after, reason, sale_id, actor_id, operating_date)
  values (_item_id, _kind, _change, _after, _reason, _sale_id, auth.uid(), private.operating_date_of(now()));
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Reading: items with availability (cost for admins only)
-- ---------------------------------------------------------------------------
create or replace function public.staff_list_inventory()
returns table (
  item_id uuid, category_id uuid, category_name text, category_kind text, category_sort int, category_active boolean,
  name text, unit text, description text, price_centavos int, cost_centavos int, stock int, units_out int,
  available int, low_stock_at int, is_low boolean, sort_order int, is_active boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  _admin boolean := private.is_admin();
begin
  perform private.require_staff();
  return query
  select i.id, c.id, c.name, c.kind, c.sort_order, c.is_active,
         i.name, i.unit, i.description, i.price_centavos,
         case when _admin then i.cost_centavos end,
         i.stock,
         case when c.kind = 'rental' then private.rental_units_out(i.id) else 0 end,
         private.inventory_available(i),
         i.low_stock_at,
         i.low_stock_at is not null and private.inventory_available(i) <= i.low_stock_at,
         i.sort_order, i.is_active
  from public.inventory_items i
  join public.inventory_categories c on c.id = i.category_id
  order by c.sort_order, c.name, i.sort_order, i.name;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Selling and renting (staff)
--    _lines: [{"item_id": "...", "quantity": 2}, ...]
-- ---------------------------------------------------------------------------
create or replace function public.staff_record_sale(
  _lines jsonb,
  _method public.payment_method_kind,
  _customer_name text default null,
  _booking_reference text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  _uid uuid := private.require_staff();
  _sale_id uuid;
  _booking_id uuid;
  _customer text := nullif(btrim(coalesce(_customer_name, '')), '');
  _line jsonb;
  _qty int;
  _item public.inventory_items;
  _kind text;
  _before int;
  _line_id uuid;
  _total bigint := 0;
  _touched uuid[] := '{}';
  _befores int[] := '{}';
  _n int;
begin
  if _method is null then
    raise exception 'Choose how the customer paid.' using errcode = '22023';
  end if;
  if _lines is null or jsonb_typeof(_lines) <> 'array' or jsonb_array_length(_lines) = 0 then
    raise exception 'Add at least one item.' using errcode = '22023';
  end if;
  if jsonb_array_length(_lines) > 50 then
    raise exception 'A sale can have at most 50 lines.' using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(_booking_reference, '')), '') is not null then
    select b.id into _booking_id from public.bookings b where upper(b.reference) = upper(btrim(_booking_reference));
    if not found then
      raise exception 'No booking has the reference %.', btrim(_booking_reference) using errcode = 'P0002';
    end if;
  end if;

  insert into public.sales (reference, operating_date, method, customer_name, booking_id, total_centavos, staff_id)
  values ('S-' || to_char(now() at time zone 'Asia/Manila', 'YYMMDD') || '-' || lpad(nextval('public.sale_reference_seq')::text, 4, '0'),
          private.operating_date_of(now()), _method, _customer, _booking_id, 0, _uid)
  returning id into _sale_id;

  for _line in select value from jsonb_array_elements(_lines) loop
    begin
      _qty := (_line ->> 'quantity')::int;
    exception when others then
      raise exception 'Each line needs a whole-number quantity.' using errcode = '22023';
    end;
    if _qty is null or _qty < 1 or _qty > 999 then
      raise exception 'Quantities must be between 1 and 999.' using errcode = '22023';
    end if;

    -- Lock the item so two desks cannot sell the last one twice.
    select i.* into _item from public.inventory_items i where i.id = (_line ->> 'item_id')::uuid for update;
    if not found then
      raise exception 'That item no longer exists.' using errcode = 'P0002';
    end if;
    select c.kind into _kind from public.inventory_categories c where c.id = _item.category_id;
    if not _item.is_active then
      raise exception '% is not for sale right now.', _item.name using errcode = '22023';
    end if;

    _before := private.inventory_available(_item);
    if _qty > _before then
      raise exception 'Only % of % left.', greatest(_before, 0), _item.name using errcode = '22023';
    end if;
    if _kind = 'rental' and _customer is null then
      raise exception 'Enter who is renting the %.', _item.name using errcode = '22023';
    end if;

    insert into public.sale_lines (sale_id, item_id, item_name, is_rental, quantity, unit_price_centavos, unit_cost_centavos,
                                   line_total_centavos)
    values (_sale_id, _item.id, _item.name, _kind = 'rental', _qty, _item.price_centavos, _item.cost_centavos,
            _qty::bigint * _item.price_centavos)
    returning id into _line_id;
    _total := _total + _qty::bigint * _item.price_centavos;

    if _kind = 'rental' then
      insert into public.rentals (sale_line_id, item_id, quantity, renter_name) values (_line_id, _item.id, _qty, _customer);
    else
      perform private.record_movement(_item.id, 'sale', -_qty, null, _sale_id);
    end if;

    _n := array_position(_touched, _item.id);
    if _n is null then
      _touched := _touched || _item.id;
      _befores := _befores || _before;
    end if;
  end loop;

  update public.sales set total_centavos = _total where id = _sale_id;

  for _n in 1 .. coalesce(array_length(_touched, 1), 0) loop
    perform private.alert_low_stock(_touched[_n], _befores[_n]);
  end loop;
  return _sale_id;
end;
$$;

create or replace function public.staff_return_rental(_rental_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _uid uuid := private.require_staff();
begin
  update public.rentals set returned_at = now(), returned_by = _uid
  where id = _rental_id and returned_at is null;
  if not found then
    raise exception 'That rental is already returned or does not exist.' using errcode = 'P0002';
  end if;
end;
$$;

-- Deliveries in, and stock taken out for other reasons (spoiled, staff use).
create or replace function public.staff_stock_move(_item_id uuid, _direction text, _quantity int, _reason text)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  _why text;
  _item public.inventory_items;
  _kind text;
  _before int;
begin
  perform private.require_staff();
  _why := private.require_reason(_reason);
  if _direction not in ('in', 'out') then
    raise exception 'Choose stock in or stock out.' using errcode = '22023';
  end if;
  if _quantity is null or _quantity < 1 or _quantity > 10000 then
    raise exception 'Enter a quantity between 1 and 10,000.' using errcode = '22023';
  end if;
  select i.* into _item from public.inventory_items i where i.id = _item_id for update;
  if not found then
    raise exception 'That item no longer exists.' using errcode = 'P0002';
  end if;
  select c.kind into _kind from public.inventory_categories c where c.id = _item.category_id;
  _before := private.inventory_available(_item);
  if _direction = 'out' and _quantity > _before then
    raise exception 'Only % of % available to take out.', greatest(_before, 0), _item.name using errcode = '22023';
  end if;
  perform private.record_movement(_item.id, case _direction when 'in' then 'stock_in' else 'stock_out' end,
                                  case _direction when 'in' then _quantity else -_quantity end, _why, null);
  if _direction = 'out' then
    perform private.alert_low_stock(_item.id, _before);
  end if;
  return (select stock from public.inventory_items where id = _item.id);
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Managing (admins)
-- ---------------------------------------------------------------------------
create or replace function public.admin_save_inventory_category(
  _id uuid, _name text, _kind text, _sort_order int, _is_active boolean, _reason text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  _why text;
  _out uuid;
begin
  perform private.require_admin();
  _why := private.require_reason(_reason);
  if _kind not in ('sale', 'rental') then
    raise exception 'A category is either for sale items or for rentals.' using errcode = '22023';
  end if;
  perform set_config('app.audit_reason', _why, true);
  if _id is null then
    insert into public.inventory_categories (name, kind, sort_order, is_active)
    values (btrim(_name), _kind, coalesce(_sort_order, 0), coalesce(_is_active, true))
    returning id into _out;
  else
    if exists (select 1 from public.inventory_categories c where c.id = _id and c.kind <> _kind)
       and exists (select 1 from public.inventory_items i where i.category_id = _id) then
      raise exception 'Move or remove its items before changing a category between sale and rental.' using errcode = '22023';
    end if;
    update public.inventory_categories
    set name = btrim(_name), kind = _kind, sort_order = coalesce(_sort_order, sort_order), is_active = coalesce(_is_active, is_active)
    where id = _id
    returning id into _out;
    if _out is null then
      raise exception 'That category no longer exists.' using errcode = 'P0002';
    end if;
  end if;
  return _out;
exception when unique_violation then
  raise exception 'There is already a category with that name.' using errcode = '23505';
end;
$$;

-- New items start with no stock; stock is added with stock in (or a correction).
create or replace function public.admin_save_inventory_item(
  _id uuid,
  _category_id uuid,
  _name text,
  _unit text,
  _description text,
  _price_centavos int,
  _cost_centavos int,
  _low_stock_at int,
  _sort_order int,
  _is_active boolean,
  _reason text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  _why text;
  _out uuid;
begin
  perform private.require_admin();
  _why := private.require_reason(_reason);
  if not exists (select 1 from public.inventory_categories where id = _category_id) then
    raise exception 'Choose a category.' using errcode = '22023';
  end if;
  if _price_centavos is null or _price_centavos < 0 then
    raise exception 'Enter a price of zero or more.' using errcode = '22023';
  end if;
  perform set_config('app.audit_reason', _why, true);
  if _id is null then
    insert into public.inventory_items (category_id, name, unit, description, price_centavos, cost_centavos, low_stock_at,
                                        sort_order, is_active)
    values (_category_id, btrim(_name), nullif(btrim(coalesce(_unit, '')), ''), nullif(btrim(coalesce(_description, '')), ''),
            _price_centavos, _cost_centavos, _low_stock_at, coalesce(_sort_order, 0), coalesce(_is_active, true))
    returning id into _out;
  else
    if exists (select 1 from public.inventory_items i join public.inventory_categories c on c.id = i.category_id
               where i.id = _id and c.kind <> (select kind from public.inventory_categories where id = _category_id)) then
      raise exception 'An item cannot move between a sale category and a rental category.' using errcode = '22023';
    end if;
    update public.inventory_items
    set category_id = _category_id, name = btrim(_name), unit = nullif(btrim(coalesce(_unit, '')), ''),
        description = nullif(btrim(coalesce(_description, '')), ''), price_centavos = _price_centavos,
        cost_centavos = _cost_centavos, low_stock_at = _low_stock_at, sort_order = coalesce(_sort_order, sort_order),
        is_active = coalesce(_is_active, is_active)
    where id = _id
    returning id into _out;
    if _out is null then
      raise exception 'That item no longer exists.' using errcode = 'P0002';
    end if;
  end if;
  return _out;
exception when unique_violation then
  raise exception 'There is already an item with that name in this category.' using errcode = '23505';
end;
$$;

-- Correct the count after a stock take (sale items: on hand; rentals: units owned).
create or replace function public.admin_set_stock(_item_id uuid, _count int, _reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _why text;
  _item public.inventory_items;
  _out int;
begin
  perform private.require_admin();
  _why := private.require_reason(_reason);
  if _count is null or _count < 0 or _count > 100000 then
    raise exception 'Enter a count between 0 and 100,000.' using errcode = '22023';
  end if;
  select i.* into _item from public.inventory_items i where i.id = _item_id for update;
  if not found then
    raise exception 'That item no longer exists.' using errcode = 'P0002';
  end if;
  _out := private.rental_units_out(_item.id);
  if _count < _out then
    raise exception '% are rented out right now; the count cannot be lower than that.', _out using errcode = '22023';
  end if;
  if _count <> _item.stock then
    perform set_config('app.audit_reason', _why, true);
    perform private.record_movement(_item.id, 'adjustment', _count - _item.stock, _why, null);
  end if;
end;
$$;

-- Void a sale: stock comes back, rentals still out are closed. The sale stays on record.
create or replace function public.admin_void_sale(_sale_id uuid, _reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _uid uuid := auth.uid();
  _why text;
  _s public.sales;
  _l record;
begin
  perform private.require_admin();
  _why := private.require_reason(_reason);
  select * into _s from public.sales where id = _sale_id for update;
  if not found then
    raise exception 'That sale does not exist.' using errcode = 'P0002';
  end if;
  if _s.voided_at is not null then
    raise exception 'This sale is already voided.' using errcode = '22023';
  end if;
  perform set_config('app.audit_reason', _why, true);
  for _l in select * from public.sale_lines where sale_id = _sale_id loop
    if _l.is_rental then
      update public.rentals set returned_at = now(), returned_by = _uid, cancelled = true
      where sale_line_id = _l.id and returned_at is null;
    else
      perform private.record_movement(_l.item_id, 'sale_void', _l.quantity, _why, _sale_id);
    end if;
  end loop;
  update public.sales set voided_at = now(), voided_by = _uid, void_reason = _why where id = _sale_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. A day at the desk (closing summary). Cost and profit for admins only.
-- ---------------------------------------------------------------------------
create or replace function public.staff_sales_day(_date date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  _admin boolean := private.is_admin();
begin
  perform private.require_staff();
  if _date is null then
    raise exception 'Choose a day.' using errcode = '22023';
  end if;
  return jsonb_build_object(
    'date', _date,
    'is_admin', _admin,
    'sales', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'reference', s.reference, 'created_at', s.created_at, 'method', s.method,
        'customer_name', s.customer_name, 'booking_reference', b.reference, 'total_centavos', s.total_centavos,
        'staff_name', p.full_name, 'voided_at', s.voided_at, 'void_reason', s.void_reason,
        'lines', (select jsonb_agg(jsonb_build_object('item_name', l.item_name, 'quantity', l.quantity,
                                                       'unit_price_centavos', l.unit_price_centavos,
                                                       'line_total_centavos', l.line_total_centavos, 'is_rental', l.is_rental)
                                   order by l.item_name)
                  from public.sale_lines l where l.sale_id = s.id)
      ) order by s.created_at desc)
      from public.sales s
      left join public.bookings b on b.id = s.booking_id
      left join public.profiles p on p.id = s.staff_id
      where s.operating_date = _date), '[]'::jsonb),
    'by_method', coalesce((
      select jsonb_agg(jsonb_build_object('method', m.method, 'sales', m.n, 'total_centavos', m.total) order by m.method)
      from (select s.method, count(*)::int as n, sum(s.total_centavos)::bigint as total
            from public.sales s where s.operating_date = _date and s.voided_at is null group by s.method) m), '[]'::jsonb),
    'by_item', coalesce((
      select jsonb_agg(jsonb_build_object(
        'item_name', x.item_name, 'is_rental', x.is_rental, 'quantity', x.qty, 'total_centavos', x.total,
        'cost_centavos', case when _admin then x.cost end,
        'profit_centavos', case when _admin and x.cost is not null then x.total - x.cost end
      ) order by x.total desc, x.item_name)
      from (select l.item_name, l.is_rental, sum(l.quantity)::int as qty, sum(l.line_total_centavos)::bigint as total,
                   case when bool_and(l.unit_cost_centavos is not null)
                        then sum(l.quantity::bigint * l.unit_cost_centavos)::bigint end as cost
            from public.sale_lines l join public.sales s on s.id = l.sale_id
            where s.operating_date = _date and s.voided_at is null
            group by l.item_name, l.is_rental) x), '[]'::jsonb),
    'total_centavos', (select coalesce(sum(s.total_centavos), 0) from public.sales s
                       where s.operating_date = _date and s.voided_at is null),
    'cost_centavos', case when _admin then (
                       select sum(l.quantity::bigint * l.unit_cost_centavos) from public.sale_lines l
                       join public.sales s on s.id = l.sale_id
                       where s.operating_date = _date and s.voided_at is null) end,
    'open_rentals', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'item_name', i.name, 'quantity', r.quantity, 'renter_name', r.renter_name,
                                          'out_at', r.out_at, 'sale_reference', s.reference) order by r.out_at)
      from public.rentals r
      join public.inventory_items i on i.id = r.item_id
      join public.sale_lines l on l.id = r.sale_line_id
      join public.sales s on s.id = l.sale_id
      where r.returned_at is null and s.operating_date <= _date), '[]'::jsonb),
    'movements', coalesce((
      select jsonb_agg(jsonb_build_object('item_name', i.name, 'kind', m.kind, 'change', m.change, 'stock_after', m.stock_after,
                                          'reason', m.reason, 'created_at', m.created_at, 'staff_name', p.full_name)
                       order by m.created_at desc)
      from public.inventory_movements m
      join public.inventory_items i on i.id = m.item_id
      left join public.profiles p on p.id = m.actor_id
      where m.operating_date = _date and m.kind in ('stock_in', 'stock_out', 'adjustment')), '[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. Reports (reports.view). Cost and profit are NULL unless an admin asks.
-- ---------------------------------------------------------------------------
create or replace function public.report_sales_daily(_from date, _to date)
returns table (
  day date, sales int, total_centavos bigint, cash_centavos bigint, online_centavos bigint,
  rentals_centavos bigint, items_centavos bigint, cost_centavos bigint, profit_centavos bigint, voided int
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  _admin boolean := private.is_admin();
begin
  perform private.require_report_access(_from, _to);
  return query
  with s as (
    select x.operating_date as d, x.id, x.method, x.total_centavos as total, x.voided_at is not null as voided
    from public.sales x where x.operating_date between _from and _to
  ),
  l as (
    select s.d, sum(y.line_total_centavos) filter (where y.is_rental) as rentals,
           sum(y.line_total_centavos) filter (where not y.is_rental) as items,
           case when bool_and(y.unit_cost_centavos is not null) then sum(y.quantity::bigint * y.unit_cost_centavos) end as cost
    from s join public.sale_lines y on y.sale_id = s.id
    where not s.voided
    group by s.d
  )
  select g.d::date,
         count(s.id) filter (where not s.voided)::int,
         coalesce(sum(s.total) filter (where not s.voided), 0)::bigint,
         coalesce(sum(s.total) filter (where not s.voided and s.method = 'cash'), 0)::bigint,
         coalesce(sum(s.total) filter (where not s.voided and s.method <> 'cash'), 0)::bigint,
         coalesce(max(l.rentals), 0)::bigint,
         coalesce(max(l.items), 0)::bigint,
         case when _admin then max(l.cost)::bigint end,
         case when _admin and max(l.cost) is not null
              then (coalesce(sum(s.total) filter (where not s.voided), 0) - max(l.cost))::bigint end,
         count(s.id) filter (where s.voided)::int
  from generate_series(_from, _to, interval '1 day') g(d)
  left join s on s.d = g.d::date
  left join l on l.d = g.d::date
  group by g.d
  order by g.d;
end;
$$;

create or replace function public.report_sales_items(_from date, _to date)
returns table (
  category text, item text, rental boolean, quantity int, total_centavos bigint, cost_centavos bigint, profit_centavos bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  _admin boolean := private.is_admin();
begin
  perform private.require_report_access(_from, _to);
  return query
  select c.name, l.item_name, l.is_rental, sum(l.quantity)::int, sum(l.line_total_centavos)::bigint,
         case when _admin and bool_and(l.unit_cost_centavos is not null)
              then sum(l.quantity::bigint * l.unit_cost_centavos)::bigint end,
         case when _admin and bool_and(l.unit_cost_centavos is not null)
              then (sum(l.line_total_centavos) - sum(l.quantity::bigint * l.unit_cost_centavos))::bigint end
  from public.sale_lines l
  join public.sales s on s.id = l.sale_id
  join public.inventory_items i on i.id = l.item_id
  join public.inventory_categories c on c.id = i.category_id
  where s.voided_at is null and s.operating_date between _from and _to
  group by c.name, c.sort_order, l.item_name, l.is_rental
  order by c.sort_order, c.name, sum(l.line_total_centavos) desc, l.item_name;
end;
$$;

-- ---------------------------------------------------------------------------
-- 10. Grants (Postgres gives EXECUTE to PUBLIC by default)
-- ---------------------------------------------------------------------------
revoke all on function
  private.require_staff(), private.rental_units_out(uuid),
  private.inventory_available(public.inventory_items), private.alert_low_stock(uuid, int),
  private.record_movement(uuid, text, int, text, uuid)
  from public, anon, authenticated;

revoke all on function
  public.staff_list_inventory(),
  public.staff_record_sale(jsonb, public.payment_method_kind, text, text),
  public.staff_return_rental(uuid),
  public.staff_stock_move(uuid, text, int, text),
  public.admin_save_inventory_category(uuid, text, text, int, boolean, text),
  public.admin_save_inventory_item(uuid, uuid, text, text, text, int, int, int, int, boolean, text),
  public.admin_set_stock(uuid, int, text),
  public.admin_void_sale(uuid, text),
  public.staff_sales_day(date),
  public.report_sales_daily(date, date),
  public.report_sales_items(date, date)
  from public, anon, authenticated;
grant execute on function
  public.staff_list_inventory(),
  public.staff_record_sale(jsonb, public.payment_method_kind, text, text),
  public.staff_return_rental(uuid),
  public.staff_stock_move(uuid, text, int, text),
  public.admin_save_inventory_category(uuid, text, text, int, boolean, text),
  public.admin_save_inventory_item(uuid, uuid, text, text, text, int, int, int, int, boolean, text),
  public.admin_set_stock(uuid, int, text),
  public.admin_void_sale(uuid, text),
  public.staff_sales_day(date),
  public.report_sales_daily(date, date),
  public.report_sales_items(date, date)
  to authenticated;
