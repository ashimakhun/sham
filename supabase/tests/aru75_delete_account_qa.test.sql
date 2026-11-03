-- QA ARU-75: gaps in aru75_delete_account.test.sql, with ARU-66's 0039 (now on main) applied before 0040:
-- a listener with Paid marks and an exemption is deleted (their rows go), an accountant who marked and exempted is
-- deleted (the rows stay with no marker), the deleted listener no longer owes anything and others' dues are
-- unchanged, a deleted accountant's paid-course selection stays, and the 0039 foreign keys have the right actions.
-- Fails on the ARU-75 branch alone (no 0039 there) until main is merged in (ARU-92).
-- Fixture: teacher T; mentor M owns A (paid, days 1-28); M2 (owns nothing) is an accountant; S1 and S2 are listeners of A.
select t.seed();

-- The foreign key on tbl.col to profiles: its on-delete action ('n' set null, 'c' cascade, 'a' no action).
create function pg_temp.fk(tbl text, col text) returns text language sql as $$
  select c.confdeltype::text
  from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
  where c.contype = 'f' and c.conrelid = ('public.' || tbl)::regclass and c.confrelid = 'public.profiles'::regclass
    and a.attname = col
$$;

select t.eq(pg_temp.fk('course_payments', 'user_id'), 'c', 'ARU-66 a listener''s Paid marks are deleted with them');
select t.eq(pg_temp.fk('course_payments', 'marked_by'), 'n', 'ARU-66 the marker becomes no one');
select t.eq(pg_temp.fk('course_payment_exemptions', 'user_id'), 'c', 'ARU-66 a listener''s exemption is deleted with them');
select t.eq(pg_temp.fk('course_payment_exemptions', 'set_by'), 'n', 'ARU-66 the one who exempted becomes no one');
select t.ok((select attnotnull = false from pg_attribute where attrelid = 'course_payments'::regclass and attname = 'marked_by'),
  'ARU-66 marked_by can be empty');

update profiles set is_accountant = true where id = t.id('M2');
insert into course_members (course_id, user_id, added_by) values
  (t.id('A'), t.id('S1'), t.id('M')),
  (t.id('A'), t.id('S2'), t.id('M'));
insert into course_billing (course_id, start_day, end_day, selected_by) values (t.id('A'), 1, 28, t.id('M2'));
insert into course_payments (course_id, user_id, month, marked_by) values
  (t.id('A'), t.id('S1'), '2026-11-01', t.id('M2')),
  (t.id('A'), t.id('S2'), '2026-11-01', t.id('M2')),
  (t.id('A'), t.id('S1'), '2026-10-01', t.id('T'));
insert into course_payment_exemptions (course_id, user_id, set_by) values (t.id('A'), t.id('S1'), t.id('M2'));

-- The accountant M2 is deleted: every mark and exemption stays, pointing to no one; the paid course stays selected.
select t.lives(format('delete from auth.users where id = %L', t.id('M2')), 'AC4 the accountant M2 is deleted');
select t.eq((select count(*) from course_payments), 3::bigint, 'AC8 marks M2 made stay');
select t.eq((select count(*) from course_payments where marked_by is null), 2::bigint, 'AC8 their marker is no one');
select t.eq((select set_by from course_payment_exemptions where user_id = t.id('S1')), null::uuid, 'AC8 the exemption stays, set by no one');
select t.eq((select selected_by from course_billing where course_id = t.id('A')), null::uuid, 'AC8 the paid course stays, selected by no one');

-- S2 still has November's mark: owes nothing. S1 is deleted: their marks and exemption go, S2's stay.
select t.login('S2');
select t.eq((select count(*) from my_payment_dues('2026-11-03')), 0::bigint, 'ARU-66 S2 (paid by the deleted accountant) owes nothing');
select t.eq((select count(*) from my_payment_dues('2026-12-03')), 1::bigint, 'ARU-66 S2 owes next month as usual');
reset role;
select t.lives(format('delete from auth.users where id = %L', t.id('S1')), 'AC4 the listener S1 is deleted');
select t.eq((select count(*) from course_payments where user_id = t.id('S1')), 0::bigint, 'AC7 S1''s Paid marks are gone');
select t.eq((select count(*) from course_payment_exemptions), 0::bigint, 'AC7 S1''s exemption is gone');
select t.eq((select count(*) from course_payments where user_id = t.id('S2')), 1::bigint, 'AC7 S2''s mark is untouched');

-- The teacher still sees and manages the remaining mark (the marker being no one changes nothing).
select t.login('T');
select t.eq((select count(*) from course_payments), 1::bigint, 'ARU-66 the teacher sees the mark with no marker');
select t.eq(t.affected(format('delete from course_payments where user_id = %L', t.id('S2'))), 1::bigint,
  'ARU-66 the teacher can undo it');
reset role;
