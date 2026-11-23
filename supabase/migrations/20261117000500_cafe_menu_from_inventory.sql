-- The public café menu comes from Inventory. Each for-sale category has a
-- "Show on the café menu" switch (admins); visitors read only the name and
-- price of active items in active, shown categories — never stock or cost.
-- Additive: the old site keeps working if a deploy is rolled back.

alter table public.inventory_categories add column if not exists show_on_menu boolean not null default true;

-- Miscellaneous holds things like tournament balls, not café food.
do $$
begin
  perform set_config('app.audit_reason', 'Café menu: Miscellaneous is not shown', true);
  update public.inventory_categories set show_on_menu = false where name = 'Miscellaneous';
end $$;

-- Admins: show or hide a category on the café menu.
create or replace function public.admin_set_category_on_menu(_id uuid, _show boolean, _reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _why text;
begin
  perform private.require_admin();
  _why := private.require_reason(_reason);
  if _show is null then
    raise exception 'Say whether the category shows on the café menu.' using errcode = '22023';
  end if;
  perform set_config('app.audit_reason', _why, true);
  update public.inventory_categories set show_on_menu = _show where id = _id;
  if not found then
    raise exception 'That category no longer exists.' using errcode = 'P0002';
  end if;
end;
$$;

-- Anyone: the café menu.
create or replace function public.get_cafe_menu()
returns table (category_id uuid, category_name text, category_sort int, item_id uuid, item_name text, price_centavos int)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.name, c.sort_order, i.id, i.name, i.price_centavos
  from public.inventory_categories c
  join public.inventory_items i on i.category_id = c.id
  where c.kind = 'sale' and c.is_active and c.show_on_menu and i.is_active
  order by c.sort_order, c.name, i.sort_order, i.name;
$$;

revoke all on function public.admin_set_category_on_menu(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.admin_set_category_on_menu(uuid, boolean, text) to authenticated;
revoke all on function public.get_cafe_menu() from public, anon, authenticated;
grant execute on function public.get_cafe_menu() to anon, authenticated;
