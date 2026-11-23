-- One-off correction asked for by the owner: sale S-261117-0005 (2 x Tournament
-- Ball) was rung up from the Rentals category, but the balls were sold.
--
-- The receipt, amount and payment stay as they are. The line moves to the
-- for-sale Tournament Ball (Miscellaneous), the open rental is removed, 2 come
-- off the for-sale stock, and the rental Tournament Ball is hidden so it cannot
-- be picked at the desk again. Does nothing where that sale does not exist.

do $$
declare
  _sale uuid;
  _line uuid;
  _qty int;
  _rental_item uuid;
  _sale_item uuid;
begin
  select s.id, l.id, l.quantity, l.item_id into _sale, _line, _qty, _rental_item
  from public.sales s
  join public.sale_lines l on l.sale_id = s.id
  where s.reference = 'S-261117-0005' and s.voided_at is null and l.is_rental and l.item_name = 'Tournament Ball';
  if not found then
    return;
  end if;
  select i.id into strict _sale_item
  from public.inventory_items i
  join public.inventory_categories c on c.id = i.category_id
  where i.name = 'Tournament Ball' and c.kind = 'sale';

  perform set_config('app.audit_reason', 'Sale S-261117-0005 corrected from rental to sale', true);
  delete from public.rentals where sale_line_id = _line;
  update public.sale_lines set item_id = _sale_item, is_rental = false, hours = null where id = _line;
  perform private.record_movement(_sale_item, 'sale', -_qty, 'Sale S-261117-0005 corrected from rental to sale', _sale);
  update public.inventory_items set is_active = false where id = _rental_item and is_active;
end;
$$;
