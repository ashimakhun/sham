-- ARU-66: Accountant payments. Rules under test: supabase/migrations/0039_accountant_payments.sql.
-- Fixture: teacher T; mentors M (owns A, Accountant off), N and M2 (Accountant on); students S1, S2, S3.
-- A is a paid course (days 1-5) with listeners S1, S2 and N. H is a hidden paid course owned by M with listener S3
-- (M2 and N aren't in it). F is a free course with listener S1. P is a pending student, listener of A.
select t.seed();
create function pg_temp.id(name text) returns uuid language sql immutable as $$ select md5('aru66-' || name)::uuid $$;

update profiles set is_accountant = true where id in (t.id('N'), t.id('M2'));
insert into courses (id, title, created_by, hidden) values (pg_temp.id('H'), 'Hidden', t.id('M'), true);
insert into courses (id, title, created_by) values (pg_temp.id('F'), 'Free', t.id('M'));
insert into auth.users (id, email, raw_user_meta_data) values (pg_temp.id('P'), 'p66@x.test', '{"full_name":"Pending Pat"}');
update profiles set access_status = 'pending' where id = pg_temp.id('P');
insert into course_members (course_id, user_id, added_by) values
  (t.id('A'), t.id('S1'), t.id('M')),
  (t.id('A'), t.id('S2'), t.id('M')),
  (t.id('A'), t.id('N'), t.id('M')),
  (t.id('A'), pg_temp.id('P'), t.id('M')),
  (pg_temp.id('H'), t.id('S3'), t.id('M')),
  (pg_temp.id('F'), t.id('S1'), t.id('M'));
insert into course_billing (course_id, start_day, end_day, selected_by) values
  (t.id('A'), 1, 5, t.id('N')),
  (pg_temp.id('H'), 1, 5, t.id('T'));

create function pg_temp.pay(course uuid, member uuid, month text default '2026-11-01') returns text language sql as $$
  select format('insert into course_payments (course_id, user_id, month) values (%L, %L, %L)', course, member, month)
$$;
create function pg_temp.exempt(course uuid, member uuid) returns text language sql as $$
  select format('insert into course_payment_exemptions (course_id, user_id) values (%L, %L)', course, member)
$$;
create function pg_temp.dues(today text) returns text language sql as $$
  select coalesce(string_agg(c.title || '@' || d.deadline, ',' order by c.title), '')
  from my_payment_dues(today::date) d join courses c on c.id = d.course_id
$$;

-- Data
select t.ok(exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'course_payments'),
  'data: course_payments is in the realtime publication');
select t.ok(exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'course_payment_exemptions'),
  'data: course_payment_exemptions is in the realtime publication');

-- AC 1: an accountant marks Paid; retries change nothing; who and when come from the server.
select t.login('N');
select t.eq(pg_temp.dues('2026-11-03'), 'Algebra@2026-11-05', 'edge: an accountant who is a listener sees their own deadline');
select t.lives(pg_temp.pay(t.id('A'), t.id('S1')), 'AC1 N marks S1 Paid for November');
select t.lives(pg_temp.pay(t.id('A'), t.id('S1')) || ' on conflict do nothing', 'edge: marking Paid again is a no-op');
select t.throws(pg_temp.pay(t.id('A'), t.id('S1')), '23505', 'edge: a plain duplicate is refused by the primary key (the app ignores it)');
select t.throws(pg_temp.pay(t.id('A'), t.id('S2'), '2026-11-15'), '23514', 'data: month must be the first day of a month');
select t.throws(format('insert into course_payments (course_id, user_id, month, marked_by) values (%L, %L, %L, %L)',
  t.id('A'), t.id('S2'), '2026-11-01', t.id('T')), '42501', 'data: marked_by can''t be chosen by the client');
select t.throws(format('update course_payments set month = %L', '2026-10-01'), '42501', 'data: marks are never edited');
select t.throws(pg_temp.pay(t.id('A'), t.id('S3')), '42501', 'AC1 someone who isn''t a listener can''t be marked');
select t.throws(pg_temp.pay(pg_temp.id('F'), t.id('S1')), '42501', 'AC1 a free course''s listener can''t be marked');
select t.eq((select count(*) from course_payments), 1::bigint, 'AC1 N sees the one mark');
select t.eq((select marked_by from course_payments), t.id('N'), 'AC1 marked_by is the caller');
reset role;

-- AC 1 / AC 6: any accountant or the teacher undoes any mark; exemptions are set and cleared.
select t.login('M2');
select t.eq((select count(*) from course_payments), 1::bigint, 'AC1 M2 sees N''s mark');
select t.eq(t.affected(format('delete from course_payments where course_id = %L and user_id = %L', t.id('A'), t.id('S1'))),
  1::bigint, 'AC1 M2 undoes N''s mark');
select t.lives(pg_temp.pay(t.id('A'), t.id('S1')), 'AC1 M2 marks S1 Paid again');
select t.lives(pg_temp.exempt(t.id('A'), t.id('S2')), 'AC1 M2 sets S2 Exempt');
select t.throws(pg_temp.exempt(t.id('A'), t.id('S2')), '23505', 'edge: setting Exempt twice is a duplicate (the app ignores it)');
select t.eq(t.affected(format('delete from course_payment_exemptions where user_id = %L', t.id('S2'))), 1::bigint, 'AC1 M2 clears Exempt');
select t.lives(pg_temp.exempt(t.id('A'), t.id('S2')), 'AC1 M2 sets S2 Exempt again');
reset role;
select t.login('T');
select t.eq(t.affected(format('delete from course_payments where user_id = %L', t.id('S1'))), 1::bigint, 'AC6 the teacher undoes M2''s mark');
select t.lives(pg_temp.pay(t.id('A'), t.id('S1')), 'AC6 the teacher marks S1 Paid');
select t.lives(pg_temp.pay(pg_temp.id('H'), t.id('S3')), 'AC6 the teacher marks on a hidden course');
select t.eq((select count(*) from course_payments), 2::bigint, 'AC6 the teacher sees every mark');
reset role;

-- Hidden courses (ARU-40): M2 can't see or set marks of H.
select t.login('M2');
select t.eq((select count(*) from course_payments where course_id = pg_temp.id('H')), 0::bigint, 'ARU-40 M2 doesn''t see H''s marks');
select t.throws(pg_temp.exempt(pg_temp.id('H'), t.id('S3')), '42501', 'ARU-40 M2 can''t set Exempt on H');
select t.eq(t.affected(format('delete from course_payments where course_id = %L', pg_temp.id('H'))), 0::bigint, 'ARU-40 M2 can''t undo H''s marks');
reset role;

-- AC 4: owners who aren't accountants, other mentors, listeners and pending accounts see and change nothing.
select t.login('M');
select t.eq((select count(*) from course_payments) + (select count(*) from course_payment_exemptions), 0::bigint, 'AC4 the owner M reads nothing');
select t.throws(pg_temp.pay(t.id('A'), t.id('S2')), '42501', 'AC4 M can''t mark');
select t.eq(t.affected('delete from course_payments'), 0::bigint, 'AC4 M can''t undo');
select t.eq(t.affected('delete from course_payment_exemptions'), 0::bigint, 'AC4 M can''t clear Exempt');
select t.login('S1');
select t.eq((select count(*) from course_payments) + (select count(*) from course_payment_exemptions), 0::bigint, 'AC4/AC9 S1 reads nothing');
select t.throws(pg_temp.pay(t.id('A'), t.id('S1')), '42501', 'AC4 S1 can''t mark themselves');
select t.throws(pg_temp.exempt(t.id('A'), t.id('S1')), '42501', 'AC4 S1 can''t exempt themselves');
select t.login('S2');
select t.eq((select count(*) from course_payment_exemptions), 0::bigint, 'AC4/AC9 S2 doesn''t see their own exemption');
select t.login('M2');
reset role;
update profiles set is_accountant = false where id = t.id('M2');
select t.login('M2');
select t.eq((select count(*) from course_payments), 0::bigint, 'access: an accountant switched off loses access');
reset role;
update profiles set is_accountant = true where id = t.id('M2');
select set_config('request.jwt.claims', json_build_object('sub', pg_temp.id('P'), 'role', 'authenticated')::text, false);
set role authenticated;
select t.eq((select count(*) from course_payments), 0::bigint, 'AC4 a pending account reads nothing');
select t.eq(pg_temp.dues('2026-11-03'), '', 'AC9 a pending listener gets no dues');
reset role;
select t.login(null);
select t.throws($$select * from my_payment_dues('2026-11-03')$$, '42501', 'AC9 anon can''t call my_payment_dues');
select t.throws('select count(*) from course_payments', '42501', 'AC4 anon can''t read marks');
reset role;

-- AC 7 / AC 9: a listener's own dues, by the device-local date.
select t.login('S1');
select t.eq(pg_temp.dues('2026-11-03'), '', 'AC9 S1 marked Paid in November: nothing due');
select t.eq(pg_temp.dues('2026-12-01'), 'Algebra@2026-12-05', 'AC2 next month S1 is Unpaid again (first day of the period)');
select t.eq(pg_temp.dues('2026-12-05'), 'Algebra@2026-12-05', 'AC7 due on the deadline day');
select t.eq(pg_temp.dues('2026-12-06'), '', 'AC8 nothing after the period');
select t.eq(pg_temp.dues(null), '', 'AC9 no date: nothing');
select t.login('S2');
select t.eq(pg_temp.dues('2026-12-03'), '', 'AC2 Exempt lasts into the next month');
select t.login('S3');
select t.eq(pg_temp.dues('2026-11-03'), '', 'AC9 S3 (marked on H) owes nothing');
select t.eq(pg_temp.dues('2026-12-02'), 'Hidden@2026-12-05', 'AC9 S3 owes H next month');
reset role;
update course_billing set start_day = 10, end_day = 12 where course_id = t.id('A');
select t.login('N');
select t.eq(pg_temp.dues('2026-11-03'), '', 'AC8 before the period starts nothing is due');
select t.eq(pg_temp.dues('2026-11-11'), 'Algebra@2026-11-12', 'AC7 the deadline follows the new end day');
reset role;

-- AC 5 / edge: rows are kept when a course is unselected or a listener is removed, and come back with them.
select t.login('N');
select t.eq(t.affected(format('delete from course_billing where course_id = %L', t.id('A'))), 1::bigint, 'AC5 N unselects A');
select t.eq((select count(*) from course_payments where course_id = t.id('A')), 0::bigint, 'AC5 an unselected course''s marks aren''t shown');
select t.throws(pg_temp.pay(t.id('A'), t.id('S2')), '42501', 'AC5 nor can they be set');
select t.lives(format('insert into course_billing (course_id, start_day, end_day) values (%L, 1, 5)', t.id('A')), 'AC5 N selects A again');
select t.eq((select count(*) from course_payments where course_id = t.id('A')), 1::bigint, 'AC5 the Paid mark is back');
select t.eq((select count(*) from course_payment_exemptions where course_id = t.id('A')), 1::bigint, 'AC5 the exemption is back');
reset role;
delete from course_members where course_id = t.id('A') and user_id in (t.id('S1'), t.id('S2'));
select t.login('N');
select t.eq((select count(*) from course_payments) + (select count(*) from course_payment_exemptions), 0::bigint,
  'edge: a removed listener''s rows aren''t shown');
select t.throws(pg_temp.pay(t.id('A'), t.id('S2')), '42501', 'edge: a removed listener can''t be marked');
reset role;
select t.eq((select count(*) from course_payments where course_id = t.id('A')), 1::bigint, 'edge: the removed listener''s mark is kept');
insert into course_members (course_id, user_id, added_by) values (t.id('A'), t.id('S1'), t.id('M')), (t.id('A'), t.id('S2'), t.id('M'));
select t.login('N');
select t.eq((select count(*) from course_payments) + (select count(*) from course_payment_exemptions), 2::bigint,
  'edge: re-added listeners keep their mark and exemption');
reset role;

-- Data: deleting a course deletes its marks and exemptions.
insert into course_payment_exemptions (course_id, user_id, set_by) values (pg_temp.id('H'), t.id('S3'), t.id('T'));
delete from courses where id = pg_temp.id('H');
select t.eq((select count(*) from course_payments where course_id = pg_temp.id('H'))
  + (select count(*) from course_payment_exemptions where course_id = pg_temp.id('H')), 0::bigint, 'data: course delete cascades');
