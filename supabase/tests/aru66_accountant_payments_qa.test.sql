-- QA ARU-66: gaps in aru66_accountant_payments.test.sql: spoofed set_by, exemptions never edited, deadlines across
-- year end and February, dues are always the caller's own, an accountant who is a participant of a hidden course,
-- a rejected accountant, the course owner who is also an accountant, and anon on the helper.
-- Fixture: teacher T; mentors M (owns A), N and M2 (Accountant on); students S1, S2, S3. A is paid (days 1-28) with
-- listeners S1, S2. H is a hidden paid course owned by M with listeners S3 and M2 (N isn't in it).
select t.seed();
create function pg_temp.id(name text) returns uuid language sql immutable as $$ select md5('aru66qa-' || name)::uuid $$;

update profiles set is_accountant = true where id in (t.id('N'), t.id('M2'));
insert into courses (id, title, created_by, hidden) values (pg_temp.id('H'), 'Hidden', t.id('M'), true);
insert into course_members (course_id, user_id, added_by) values
  (t.id('A'), t.id('S1'), t.id('M')),
  (t.id('A'), t.id('S2'), t.id('M')),
  (pg_temp.id('H'), t.id('S3'), t.id('M')),
  (pg_temp.id('H'), t.id('M2'), t.id('M'));
insert into course_billing (course_id, start_day, end_day, selected_by) values
  (t.id('A'), 1, 28, t.id('N')),
  (pg_temp.id('H'), 1, 5, t.id('T'));

create function pg_temp.pay(course uuid, member uuid, month text default '2026-11-01') returns text language sql as $$
  select format('insert into course_payments (course_id, user_id, month) values (%L, %L, %L)', course, member, month)
$$;
create function pg_temp.dues(today text) returns text language sql as $$
  select coalesce(string_agg(c.title || '@' || d.deadline, ',' order by c.title), '')
  from my_payment_dues(today::date) d join courses c on c.id = d.course_id
$$;
grant execute on all functions in schema pg_temp to authenticated, anon;

-- Who and when can't be faked, and exemptions are never edited.
select t.login('N');
select t.throws(format('insert into course_payment_exemptions (course_id, user_id, set_by) values (%L, %L, %L)',
  t.id('A'), t.id('S1'), t.id('T')), '42501', 'data: set_by can''t be sent by the app');
select t.throws(format('insert into course_payments (course_id, user_id, month, marked_at) values (%L, %L, %L, %L)',
  t.id('A'), t.id('S1'), '2026-11-01', '2020-01-01'), '42501', 'data: marked_at can''t be sent by the app');
select t.lives(format('insert into course_payment_exemptions (course_id, user_id) values (%L, %L)', t.id('A'), t.id('S2')),
  'AC1 N sets S2 Exempt');
select t.throws(format('update course_payment_exemptions set user_id = %L', t.id('S1')), '42501',
  'data: exemptions are never edited');
select t.eq((select set_by from course_payment_exemptions), t.id('N'), 'data: set_by is the caller');
reset role;

-- Deadlines are built from the device-local date: year end, February, end day 28.
select t.login('S1');
-- ARU-148 changed the after-the-period rule: still unpaid after day 28 in the same month is overdue, not nothing.
select t.eq(pg_temp.dues('2026-12-31'), 'Algebra@2026-12-28', 'AC7 / ARU-148 31 Dec is after day 28: overdue, deadline 28 Dec');
select t.eq(pg_temp.dues('2027-01-01'), 'Algebra@2027-01-28', 'AC7 new year: the deadline is 28 Jan 2027');
select t.eq(pg_temp.dues('2027-02-28'), 'Algebra@2027-02-28', 'AC7 February: due on the 28th');
select t.eq(pg_temp.dues('2028-02-29'), 'Algebra@2028-02-28', 'AC7 / ARU-148 29 Feb (leap year) is after the period: overdue, deadline 28 Feb');
reset role;

-- AC 9: dues are always the caller's own. S2 is exempt; S1 owes. Neither sees the other's.
select t.login('S2');
select t.eq(pg_temp.dues('2026-11-03'), '', 'AC9 S2 (exempt) gets nothing, not S1''s due');
reset role;
select t.login('N');
select t.lives(pg_temp.pay(t.id('A'), t.id('S1')), 'AC1 N marks S1 Paid');
reset role;
select t.login('S2');
reset role;
delete from course_payment_exemptions;
select t.login('S2');
select t.eq(pg_temp.dues('2026-11-03'), 'Algebra@2026-11-28', 'AC9 S2 owes after the exemption is cleared; S1''s mark doesn''t count for S2');
reset role;
select t.login('S1');
select t.eq(pg_temp.dues('2026-11-03'), '', 'AC9 S1 (paid) owes nothing');
reset role;

-- Hidden course H: M2 is a listener there (a participant), so as an accountant M2 manages H; N can't.
select t.login('M2');
select t.lives(pg_temp.pay(pg_temp.id('H'), t.id('S3')), 'ARU-40 an accountant who is a participant of H marks on H');
select t.eq((select count(*) from course_payments where course_id = pg_temp.id('H')), 1::bigint, 'ARU-40 and sees the mark');
select t.eq(pg_temp.dues('2026-11-03'), 'Hidden@2026-11-05', 'edge: M2 (accountant and listener of H) sees their own deadline');
reset role;
select t.login('N');
select t.eq((select count(*) from course_payments where course_id = pg_temp.id('H')), 0::bigint, 'ARU-40 N doesn''t see H''s marks');
reset role;

-- The course owner who is also an accountant sees the marks as an accountant (ANALYSIS note 4).
update profiles set is_accountant = true where id = t.id('M');
select t.login('M');
select t.eq((select count(*) from course_payments where course_id = t.id('A')), 1::bigint, 'AC4 the owner who is an accountant sees marks');
reset role;
update profiles set is_accountant = false where id = t.id('M');
select t.login('M');
select t.eq((select count(*) from course_payments), 0::bigint, 'AC4 the owner who isn''t an accountant sees nothing');
reset role;

-- A rejected accountant sees and changes nothing. (The teacher is always Approved: 0021 trigger.)
update profiles set access_status = 'rejected' where id = t.id('N');
select t.login('N');
select t.eq((select count(*) from course_payments) + (select count(*) from course_payment_exemptions), 0::bigint,
  'access: a rejected accountant reads nothing');
select t.throws(pg_temp.pay(t.id('A'), t.id('S2')), '42501', 'access: a rejected accountant can''t mark');
reset role;
update profiles set access_status = 'approved' where id = t.id('N');

-- anon can't call the helper.
select t.login(null);
select t.throws(format('select can_manage_payment(%L, %L)', t.id('A'), t.id('S1')), '42501', 'anon can''t call can_manage_payment');
reset role;
