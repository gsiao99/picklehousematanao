-- Shared TEST FIXTURES, included by test files inside their rolled-back
-- transaction (\ir _fixtures.sql). Not venue data.
--
-- The baseline seeds only confirmed facts (hours, two rates without a basis,
-- no courts). Tests that exercise bookings set their own hours and rates, so
-- the seeded ones (and the seeded payment methods) are cleared here, and
-- three test courts are added.
delete from public.rate_rules;
delete from public.operating_hours;
delete from public.payment_methods;
insert into public.courts (number, name, environment, sort_order) values
  (1, 'Court 1', 'indoor', 1),
  (2, 'Court 2', 'indoor', 2),
  (3, 'Court 3', 'indoor', 3);
