-- ARU-148: an unpaid course stays due after the payment period ends (overdue) until Paid / Exempt or the month ends.
-- Rules under test: supabase/migrations/0061_payment_overdue.sql (my_payment_dues with the `overdue` column).
-- Fixture: A is a paid course (days 1-5) with listeners S1, S2, N (accountant) and pending P; H is paid (days 10-28)
-- with listener S1; B is free with listener S1. Teacher T is in no course.
select t.seed();
create function pg_temp.id(name text) returns uuid language sql immutable as $$ select md5('aru148-' || name)::uuid $$;

update profiles set is_accountant = true where id = t.id('N');
insert into courses (id, title, created_by) values (pg_temp.id('H'), 'Late', t.id('M'));
insert into auth.users (id, email, raw_user_meta_data) values (pg_temp.id('P'), 'p148@x.test', '{"full_name":"Pending Pat"}');
update profiles set access_status = 'pending' where id = pg_temp.id('P');
insert into course_members (course_id, user_id, added_by) values
  (t.id('A'), t.id('S1'), t.id('M')),
  (t.id('A'), t.id('S2'), t.id('M')),
  (t.id('A'), t.id('N'), t.id('M')),
  (t.id('A'), pg_temp.id('P'), t.id('M')),
  (pg_temp.id('H'), t.id('S1'), t.id('M')),
  (t.id('B'), t.id('S1'), t.id('M'))
on conflict do nothing;
insert into course_billing (course_id, start_day, end_day, selected_by) values
  (t.id('A'), 1, 5, t.id('N')),
  (pg_temp.id('H'), 10, 28, t.id('T'));

-- "Title@deadline:due|overdue" for the caller, by title.
create function pg_temp.dues(today text) returns text language sql as $$
  select coalesce(string_agg(c.title || '@' || d.deadline || ':' || case when d.overdue then 'overdue' else 'due' end,
    ',' order by c.title), '')
  from my_payment_dues(today::date) d join courses c on c.id = d.course_id
$$;

-- Data: the function's shape and grants.
select t.ok(exists (select 1 from information_schema.routine_privileges
  where routine_name = 'my_payment_dues' and grantee = 'authenticated' and privilege_type = 'EXECUTE'),
  'data: authenticated may call my_payment_dues');
select t.ok(not has_function_privilege('anon', 'my_payment_dues(date)', 'execute'), 'data: anon may not');
select t.ok((select prosecdef from pg_proc where proname = 'my_payment_dues'), 'data: still security definer');

-- AC 1 / AC 3 / AC 4 / AC 6: before, in, after the period; the next month.
select t.login('S1');
select t.eq(pg_temp.dues('2026-11-01'), 'Algebra@2026-11-05:due', 'AC3 start day: due');
select t.eq(pg_temp.dues('2026-11-05'), 'Algebra@2026-11-05:due', 'AC3 end day: due, not overdue');
select t.eq(pg_temp.dues('2026-11-06'), 'Algebra@2026-11-05:overdue', 'AC1 the day after the end day: overdue');
select t.eq(pg_temp.dues('2026-11-09'), 'Algebra@2026-11-05:overdue', 'AC1 before H''s period: only A, overdue');
select t.eq(pg_temp.dues('2026-11-10'), 'Algebra@2026-11-05:overdue,Late@2026-11-28:due', 'AC1 / AC3 one overdue and one due');
select t.eq(pg_temp.dues('2026-11-30'), 'Algebra@2026-11-05:overdue,Late@2026-11-28:overdue', 'AC1 last day of the month');
select t.eq(pg_temp.dues('2026-12-01'), 'Algebra@2026-12-05:due', 'AC6 the 1st starts fresh: no carry-over');
select t.eq(pg_temp.dues('2027-02-28'), 'Algebra@2027-02-05:overdue,Late@2027-02-28:due', 'edge: end day 28 in February has no overdue day');
select t.eq(pg_temp.dues('2027-03-01'), 'Algebra@2027-03-05:due', 'edge: 1 March starts fresh');
select t.eq(pg_temp.dues(null), '', 'AC10 no date: nothing');

-- Roles: an accountant listener sees their own; the teacher, a pending account and anon get nothing.
select t.login('N');
select t.eq(pg_temp.dues('2026-11-20'), 'Algebra@2026-11-05:overdue', 'roles: an accountant who is a listener is overdue too');
select t.login('T');
select t.eq(pg_temp.dues('2026-11-20'), '', 'roles: the teacher isn''t billed');
reset role;
select set_config('request.jwt.claims', json_build_object('sub', pg_temp.id('P'), 'role', 'authenticated')::text, false);
set role authenticated;
select t.eq(pg_temp.dues('2026-11-20'), '', 'roles: a pending account gets nothing');
reset role;
select t.login(null);
select t.throws($$select * from my_payment_dues('2026-11-20')$$, '42501', 'roles: anon can''t call it');
reset role;

-- AC 7: Paid or Exempt ends overdue; undoing Paid brings it back.
insert into course_payments (course_id, user_id, month, marked_by) values (t.id('A'), t.id('S1'), '2026-11-01', t.id('N'));
insert into course_payment_exemptions (course_id, user_id, set_by) values (t.id('A'), t.id('S2'), t.id('N'));
select t.login('S1');
select t.eq(pg_temp.dues('2026-11-20'), 'Late@2026-11-28:due', 'AC7 Paid: no overdue row for A');
select t.login('S2');
select t.eq(pg_temp.dues('2026-11-20'), '', 'AC7 Exempt: nothing');
reset role;
delete from course_payments where course_id = t.id('A') and user_id = t.id('S1');
select t.login('S1');
select t.eq(pg_temp.dues('2026-11-20'), 'Algebra@2026-11-05:overdue,Late@2026-11-28:due', 'AC7 Paid undone: overdue again');
reset role;

-- Edge: the period changed mid-month follows the new days.
update course_billing set end_day = 15 where course_id = t.id('A');
select t.login('S1');
select t.eq(pg_temp.dues('2026-11-10'), 'Algebra@2026-11-15:due,Late@2026-11-28:due', 'edge: end day moved to 15 on the 10th: due again');
reset role;
update course_billing set start_day = 12, end_day = 15 where course_id = t.id('A');
select t.login('S1');
select t.eq(pg_temp.dues('2026-11-10'), 'Late@2026-11-28:due', 'edge: start day moved past today: nothing for A');
reset role;
update course_billing set start_day = 1, end_day = 5 where course_id = t.id('A');

-- AC 9: a waiting payment request doesn't change the row.
insert into course_payment_requests (course_id, user_id, month, proof_path, proof_type)
  values (t.id('A'), t.id('S1'), '2026-11-01', t.id('S1') || '/x.jpg', 'image');
select t.login('S1');
select t.eq(pg_temp.dues('2026-11-20'), 'Algebra@2026-11-05:overdue,Late@2026-11-28:due', 'AC9 a waiting request keeps overdue');
reset role;

-- Edge: a removed listener or an unselected course: nothing.
delete from course_members where course_id = pg_temp.id('H') and user_id = t.id('S1');
delete from course_billing where course_id = t.id('A');
select t.login('S1');
select t.eq(pg_temp.dues('2026-11-20'), '', 'edge: unselected course and removed listener: nothing');
reset role;
