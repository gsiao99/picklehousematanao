-- ============================================================================
-- Admins can delete a single inventory item.
--
-- Same rule as deleting a category: history must stay intact, so an item can
-- be deleted only when it has never been sold, rented or had stock moved.
-- Otherwise the admin is told to hide it instead (is_active = false), which
-- keeps past sales and reports correct. Audited with the admin's reason.
-- ============================================================================

create or replace function public.admin_delete_inventory_item(_id uuid, _reason text)
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
  select name into _name from public.inventory_items where id = _id for update;
  if not found then
    raise exception 'That item no longer exists.' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.sale_lines l where l.item_id = _id)
     or exists (select 1 from public.rentals r where r.item_id = _id)
     or exists (select 1 from public.inventory_movements m where m.item_id = _id) then
    raise exception '% has sales or stock history, so it cannot be deleted. Hide it instead (untick “Available to sell”).', _name
      using errcode = '22023';
  end if;
  perform set_config('app.audit_reason', _why, true);
  delete from public.inventory_items where id = _id;
end;
$$;

revoke all on function public.admin_delete_inventory_item(uuid, text) from public, anon, authenticated;
grant execute on function public.admin_delete_inventory_item(uuid, text) to authenticated;
