-- ============================================================================
-- Paddle and ball rentals are charged per hour.
--
--   * A rental line carries how many hours were paid (1-12); the line total is
--     quantity x hours x the item's hourly fee. Sale items have no hours.
--   * Each rental has a due time (out time + hours paid). Rentals past it show
--     as overdue; staff decide whether to extend or just mark them returned.
--   * Extending a rental records a new sale for the extra hours (same hourly
--     fee, chosen payment method) and moves the due time. Voiding that sale
--     moves the due time back.
--   * Counts in summaries and reports use units: quantity x hours for rentals
--     (paddle-hours), quantity for sale items. Cost and profit use units too.
-- ============================================================================

alter table public.sale_lines
  add column hours int check (hours is null or hours between 1 and 12),
  add column extends_rental_id uuid references public.rentals (id) on delete set null,
  add column units int generated always as (quantity * coalesce(hours, 1)) stored;
create index sale_lines_extends_rental_idx on public.sale_lines (extends_rental_id);
comment on column public.sale_lines.hours is 'Rentals: hours paid on this line. NULL for sale items.';
comment on column public.sale_lines.extends_rental_id is 'Set when this line pays extra hours on an existing rental.';
grant select (hours, extends_rental_id, units) on public.sale_lines to authenticated;

alter table public.rentals add column due_at timestamptz;
-- Rentals recorded before this change were one charge each: due an hour after they went out.
update public.rentals set due_at = out_at + interval '1 hour' where due_at is null;
alter table public.rentals alter column due_at set not null;

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
  _hours int;
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
    _hours := null;
    if _kind = 'rental' then
      begin
        _hours := coalesce((_line ->> 'hours')::int, 1);
      exception when others then
        raise exception 'Rental hours must be a whole number.' using errcode = '22023';
      end;
      if _hours < 1 or _hours > 12 then
        raise exception 'Rent for 1 to 12 hours.' using errcode = '22023';
      end if;
    end if;

    insert into public.sale_lines (sale_id, item_id, item_name, is_rental, quantity, hours, unit_price_centavos, unit_cost_centavos,
                                   line_total_centavos)
    values (_sale_id, _item.id, _item.name, _kind = 'rental', _qty, _hours, _item.price_centavos, _item.cost_centavos,
            _qty::bigint * coalesce(_hours, 1) * _item.price_centavos)
    returning id into _line_id;
    _total := _total + _qty::bigint * coalesce(_hours, 1) * _item.price_centavos;

    if _kind = 'rental' then
      insert into public.rentals (sale_line_id, item_id, quantity, renter_name, due_at)
      values (_line_id, _item.id, _qty, _customer, now() + make_interval(hours => _hours));
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

-- Extra hours on a rental that is still out: a new sale at the item's hourly fee.
create or replace function public.staff_extend_rental(_rental_id uuid, _hours int, _method public.payment_method_kind)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  _uid uuid := private.require_staff();
  _r public.rentals;
  _item public.inventory_items;
  _sale_id uuid;
  _total bigint;
begin
  if _method is null then
    raise exception 'Choose how the customer paid.' using errcode = '22023';
  end if;
  if _hours is null or _hours < 1 or _hours > 12 then
    raise exception 'Extend by 1 to 12 hours.' using errcode = '22023';
  end if;
  select * into _r from public.rentals where id = _rental_id for update;
  if not found or _r.returned_at is not null then
    raise exception 'That rental is already returned or does not exist.' using errcode = 'P0002';
  end if;
  select * into _item from public.inventory_items where id = _r.item_id;
  _total := _r.quantity::bigint * _hours * _item.price_centavos;

  insert into public.sales (reference, operating_date, method, customer_name, total_centavos, staff_id)
  values ('S-' || to_char(now() at time zone 'Asia/Manila', 'YYMMDD') || '-' || lpad(nextval('public.sale_reference_seq')::text, 4, '0'),
          private.operating_date_of(now()), _method, _r.renter_name, _total, _uid)
  returning id into _sale_id;
  insert into public.sale_lines (sale_id, item_id, item_name, is_rental, quantity, hours, unit_price_centavos, unit_cost_centavos,
                                 line_total_centavos, extends_rental_id)
  values (_sale_id, _item.id, _item.name, true, _r.quantity, _hours, _item.price_centavos, _item.cost_centavos, _total, _r.id);
  -- Extra time counts from when it was due, or from now if it is already late.
  update public.rentals set due_at = greatest(due_at, now()) + make_interval(hours => _hours) where id = _r.id;
  return _sale_id;
end;
$$;

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
    if _l.is_rental and _l.extends_rental_id is not null then
      update public.rentals set due_at = due_at - make_interval(hours => _l.hours)
      where id = _l.extends_rental_id and returned_at is null;
    elsif _l.is_rental then
      update public.rentals set returned_at = now(), returned_by = _uid, cancelled = true
      where sale_line_id = _l.id and returned_at is null;
    else
      perform private.record_movement(_l.item_id, 'sale_void', _l.quantity, _why, _sale_id);
    end if;
  end loop;
  update public.sales set voided_at = now(), voided_by = _uid, void_reason = _why where id = _sale_id;
end;
$$;

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
                                                       'line_total_centavos', l.line_total_centavos, 'is_rental', l.is_rental,
                                                       'hours', l.hours)
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
      from (select l.item_name, l.is_rental, sum(l.units)::int as qty, sum(l.line_total_centavos)::bigint as total,
                   case when bool_and(l.unit_cost_centavos is not null)
                        then sum(l.units::bigint * l.unit_cost_centavos)::bigint end as cost
            from public.sale_lines l join public.sales s on s.id = l.sale_id
            where s.operating_date = _date and s.voided_at is null
            group by l.item_name, l.is_rental) x), '[]'::jsonb),
    'total_centavos', (select coalesce(sum(s.total_centavos), 0) from public.sales s
                       where s.operating_date = _date and s.voided_at is null),
    'cost_centavos', case when _admin then (
                       select sum(l.units::bigint * l.unit_cost_centavos) from public.sale_lines l
                       join public.sales s on s.id = l.sale_id
                       where s.operating_date = _date and s.voided_at is null) end,
    'open_rentals', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'item_name', i.name, 'quantity', r.quantity, 'renter_name', r.renter_name,
                                          'out_at', r.out_at, 'due_at', r.due_at,
                                          'sale_reference', s.reference) order by r.out_at)
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
           case when bool_and(y.unit_cost_centavos is not null) then sum(y.units::bigint * y.unit_cost_centavos) end as cost
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
  select c.name, l.item_name, l.is_rental, sum(l.units)::int, sum(l.line_total_centavos)::bigint,
         case when _admin and bool_and(l.unit_cost_centavos is not null)
              then sum(l.units::bigint * l.unit_cost_centavos)::bigint end,
         case when _admin and bool_and(l.unit_cost_centavos is not null)
              then (sum(l.line_total_centavos) - sum(l.units::bigint * l.unit_cost_centavos))::bigint end
  from public.sale_lines l
  join public.sales s on s.id = l.sale_id
  join public.inventory_items i on i.id = l.item_id
  join public.inventory_categories c on c.id = i.category_id
  where s.voided_at is null and s.operating_date between _from and _to
  group by c.name, c.sort_order, l.item_name, l.is_rental
  order by c.sort_order, c.name, sum(l.line_total_centavos) desc, l.item_name;
end;
$$;

revoke all on function public.staff_extend_rental(uuid, int, public.payment_method_kind) from public, anon, authenticated;
grant execute on function public.staff_extend_rental(uuid, int, public.payment_method_kind) to authenticated;
