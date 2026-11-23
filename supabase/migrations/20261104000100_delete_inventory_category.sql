-- ============================================================================
-- Admins can delete an inventory category.
--
-- History must stay intact: a category can be deleted only when none of its
-- items has ever been sold, rented or had stock moved. Its unused items are
-- deleted with it. Otherwise the admin is told to hide the category instead
-- (is_active = false), which keeps past sales and reports correct.
-- Audited with the admin's reason.
-- ============================================================================

create or replace function public.admin_delete_inventory_category(_id uuid, _reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _why text;
  _name text;
begin
  perform private.require_admin();
  _why := private.require_reason(_reason);
  select name into _name from public.inventory_categories where id = _id for update;
  if not found then
    raise exception 'That category no longer exists.' using errcode = 'P0002';
  end if;
  if exists (
    select 1 from public.inventory_items i
    where i.category_id = _id
      and (exists (select 1 from public.sale_lines l where l.item_id = i.id)
           or exists (select 1 from public.rentals r where r.item_id = i.id)
           or exists (select 1 from public.inventory_movements m where m.item_id = i.id))
  ) then
    raise exception '% has items with sales or stock history, so it cannot be deleted. Hide it instead (untick “Shown at the desk”).', _name
      using errcode = '22023';
  end if;
  perform set_config('app.audit_reason', _why, true);
  delete from public.inventory_items where category_id = _id;
  delete from public.inventory_categories where id = _id;
end;
$$;

revoke all on function public.admin_delete_inventory_category(uuid, text) from public, anon, authenticated;
grant execute on function public.admin_delete_inventory_category(uuid, text) to authenticated;
