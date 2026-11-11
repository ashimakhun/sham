-- QA ARU-148: gaps in aru148_payment_overdue.test.sql: the function's settings and return shape, the device date only
-- (no server clock), a declined account, other months' Paid marks, an exemption cleared while overdue, a listener
-- added after the period, a hidden paid course, a period of one day (28-28) across month lengths, 31-day months, and
-- the listener reading only their own rows.
-- Fixture (t.seed): A is paid (days 1-5) with listeners S1, S2, S3; H is a hidden paid course owned by M (days 28-28)
-- with listener S1. N is the accountant.
select t.seed();
create function pg_temp.id(name text) returns uuid language sql immutable as $$ select md5('aru148qa-' || name)::uuid $$;

update profiles set is_accountant = true where id = t.id('N');
insert into courses (id, title, created_by, hidden) values (pg_temp.id('H'), 'Hidden', t.id('M'), true);
insert into course_members (course_id, user_id, added_by) values
  (t.id('A'), t.id('S1'), t.id('M')),
  (t.id('A'), t.id('S2'), t.id('M')),
  (pg_temp.id('H'), t.id('S1'), t.id('M'));
insert into course_billing (course_id, start_day, end_day, selected_by) values
  (t.id('A'), 1, 5, t.id('N')),
  (pg_temp.id('H'), 28, 28, t.id('N'));

create function pg_temp.dues(today text) returns text language sql as $$
  select coalesce(string_agg(c.title || '@' || d.deadline || ':' || case when d.overdue then 'overdue' else 'due' end,
    ',' order by c.title), '')
  from my_payment_dues(today::date) d join courses c on c.id = d.course_id
$$;
grant execute on all functions in schema pg_temp to authenticated, anon;

-- Function settings: one overload, security definer, fixed search_path, stable, the three columns, and it never reads
-- the server's clock (days follow the device date passed in).
select t.eq((select count(*) from pg_proc where proname = 'my_payment_dues'), 1::bigint, 'data: one my_payment_dues');
select t.ok((select prosecdef and proconfig @> array['search_path=public'] and provolatile = 's'
  from pg_proc where oid = 'my_payment_dues(date)'::regprocedure), 'data: security definer, search_path=public, stable');
select t.eq((select string_agg(p.parameter_name || ' ' || p.data_type, ', ' order by p.ordinal_position)
  from information_schema.parameters p join information_schema.routines r on r.specific_name = p.specific_name
  where r.routine_name = 'my_payment_dues' and p.parameter_mode = 'OUT'),
  'course_id uuid, deadline date, overdue boolean', 'data: returns course_id, deadline, overdue');
select t.ok((select prosrc !~* '(now\(\)|current_date|current_timestamp|localtimestamp)'
  from pg_proc where oid = 'my_payment_dues(date)'::regprocedure), 'edge: uses only the date passed in, not the server clock');

-- 31-day month and a one-day period (28-28) in months of 28, 29, 30 and 31 days; the hidden course works the same.
select t.login('S1');
select t.eq(pg_temp.dues('2027-01-31'), 'Algebra@2027-01-05:overdue,Hidden@2027-01-28:overdue', 'AC1 31 Jan: both overdue');
select t.eq(pg_temp.dues('2026-11-27'), 'Algebra@2026-11-05:overdue', 'AC4 the day before a 28-28 period: nothing for H');
select t.eq(pg_temp.dues('2026-11-28'), 'Algebra@2026-11-05:overdue,Hidden@2026-11-28:due', 'AC3 the single period day: due');
select t.eq(pg_temp.dues('2026-11-29'), 'Algebra@2026-11-05:overdue,Hidden@2026-11-28:overdue', 'AC1 the day after: overdue');
select t.eq(pg_temp.dues('2026-11-30'), 'Algebra@2026-11-05:overdue,Hidden@2026-11-28:overdue', 'AC1 30-day month, last day');
select t.eq(pg_temp.dues('2027-02-28'), 'Algebra@2027-02-05:overdue,Hidden@2027-02-28:due', 'edge: 28 Feb (non-leap): due, never overdue');
select t.eq(pg_temp.dues('2028-02-29'), 'Algebra@2028-02-05:overdue,Hidden@2028-02-28:overdue', 'edge: 29 Feb (leap): overdue');
select t.eq(pg_temp.dues('2028-03-01'), 'Algebra@2028-03-05:due', 'AC6 1 Mar after a leap February: fresh');
reset role;

-- Paid marks count only for today's month: last month's or next month's mark doesn't end this month's overdue.
insert into course_payments (course_id, user_id, month, marked_by) values
  (t.id('A'), t.id('S1'), '2026-10-01', t.id('N')),
  (t.id('A'), t.id('S1'), '2026-12-01', t.id('N'));
select t.login('S1');
select t.eq(pg_temp.dues('2026-11-20'), 'Algebra@2026-11-05:overdue', 'AC7 October''s and December''s marks don''t pay November');
select t.eq(pg_temp.dues('2026-12-20'), '', 'AC7 December''s mark ends December''s overdue');
reset role;

-- An exemption set and cleared while overdue: gone, then overdue again.
insert into course_payment_exemptions (course_id, user_id, set_by) values (t.id('A'), t.id('S2'), t.id('N'));
select t.login('S2');
select t.eq(pg_temp.dues('2026-11-20'), '', 'AC7 Exempt while overdue: nothing');
reset role;
delete from course_payment_exemptions where course_id = t.id('A') and user_id = t.id('S2');
select t.login('S2');
select t.eq(pg_temp.dues('2026-11-20'), 'Algebra@2026-11-05:overdue', 'AC7 exemption cleared: overdue again');
reset role;

-- A listener added after this month's period ended is overdue at once.
select t.login('S3');
select t.eq(pg_temp.dues('2026-11-20'), '', 'edge: not a listener yet: nothing');
reset role;
insert into course_members (course_id, user_id, added_by) values (t.id('A'), t.id('S3'), t.id('M'));
select t.login('S3');
select t.eq(pg_temp.dues('2026-11-20'), 'Algebra@2026-11-05:overdue', 'edge: added on the 20th: overdue at once');
reset role;

-- AC 10: the caller's own rows only; S2 and S3 owe, S1's other rows never show for them; listeners still read no marks.
insert into course_payments (course_id, user_id, month, marked_by) values (t.id('A'), t.id('S2'), '2026-11-01', t.id('N'));
select t.login('S2');
select t.eq(pg_temp.dues('2026-11-20'), '', 'AC10 S2 paid: nothing, not S1''s or S3''s overdue');
select t.eq((select count(*) from course_payments), 0::bigint, 'AC10 a listener reads no Paid marks');
select t.eq((select count(*) from course_payment_exemptions), 0::bigint, 'AC10 a listener reads no exemptions');
reset role;

-- A declined account and a mentor who owns the course (not a listener) get nothing.
update profiles set access_status = 'rejected' where id = t.id('S3');
select t.login('S3');
select t.eq(pg_temp.dues('2026-11-20'), '', 'roles: a declined listener gets nothing');
reset role;
select t.login('M');
select t.eq(pg_temp.dues('2026-11-20'), '', 'roles: the owner isn''t billed');
reset role;
