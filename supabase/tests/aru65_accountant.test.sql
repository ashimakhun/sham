-- ARU-65: Accountant switch and paid courses. Rules under test: supabase/migrations/0032_accountant.sql.
-- Fixture: teacher T; mentors M (owns A), N (owns B), M2; students S1, S2. The teacher makes N and M2 accountants.
-- H is a hidden course owned by M with N as a listener, so N sees it and M2 doesn't. P is a pending mentor.
select t.seed();
insert into courses (id, title, created_by, hidden) values ('00000000-0000-0000-0000-0000000065c1', 'Hidden', t.id('M'), true);
insert into courses (id, title, created_by) values ('00000000-0000-0000-0000-0000000065c2', 'Free', t.id('T'));
insert into course_members (course_id, user_id, added_by) values ('00000000-0000-0000-0000-0000000065c1', t.id('N'), t.id('M'));
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000065a1', 'p@x.test', '{"full_name":"Pending Pat"}');
update profiles set role = 'mentor' where id = '00000000-0000-0000-0000-0000000065a1'; -- still pending

create function pg_temp.bill(course uuid, s int, e int) returns text language sql as $$
  select format('insert into course_billing (course_id, start_day, end_day) values (%L, %s, %s)', course, s, e)
$$;

-- Data: column, check, table, realtime; everyone starts as not an accountant.
select t.eq((select count(*) from profiles where is_accountant), 0::bigint, 'data: nobody is an accountant yet');
select t.ok(exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'course_billing'),
  'data: course_billing is in the realtime publication');
select t.throws(format('update profiles set is_accountant = true where id = %L', t.id('S1')), '23514', 'data: a student can''t be an accountant (check)');
select t.throws(format('update profiles set is_accountant = true where id = %L', t.id('T')), '23514', 'data: the teacher can''t be an accountant (check)');

-- AC 1: only the teacher switches Accountant, only for approved mentors; retries are no-ops.
select t.login('T');
select t.lives(format('select set_accountant(%L, true)', t.id('N')), 'AC1 teacher turns Accountant on for N');
select t.lives(format('select set_accountant(%L, true)', t.id('N')), 'AC1 turning it on again is no error');
select t.lives(format('select set_accountant(%L, true)', t.id('M2')), 'AC1 teacher turns Accountant on for M2');
select t.throws(format('select set_accountant(%L, true)', t.id('S1')), '23514', 'AC1 a student can''t be made an accountant');
select t.throws(format('select set_accountant(%L, true)', t.id('T')), '23514', 'AC1 the teacher can''t be made an accountant');
select t.throws($$select set_accountant('00000000-0000-0000-0000-0000000065a1', true)$$, '23514', 'AC1 a pending account is refused');
select t.throws($$select set_accountant('00000000-0000-0000-0000-0000000065ff', true)$$, 'P0002', 'AC1 an unknown user is refused');
-- Nobody sets the flag with a direct update, the teacher included.
select t.throws(format('update profiles set is_accountant = false where id = %L', t.id('N')), '42501', 'AC1 no direct update, even by the teacher');
select t.login('M');
select t.throws(format('select set_accountant(%L, true)', t.id('M')), '42501', 'AC1 a mentor can''t switch themselves on');
select t.throws(format('update profiles set is_accountant = true where id = %L', t.id('M')), '42501', 'AC1 nor by a direct update');
select t.login('N');
select t.throws(format('select set_accountant(%L, true)', t.id('M')), '42501', 'AC1 an accountant can''t switch others');
select t.login('S1');
select t.throws(format('select set_accountant(%L, true)', t.id('S1')), '42501', 'AC1 a student can''t');
reset role;
select t.eq((select string_agg(full_name, ',' order by full_name) from profiles where is_accountant), 'Mentor Mo,Mentor Nina', 'AC1 N and M2 are accountants');

-- AC 3: accountants select any course they can see; the first period saved wins; hidden courses as ARU-40.
select t.login('N');
select t.lives(pg_temp.bill(t.id('A'), 1, 5), 'AC3 N selects A (1-5)');
select t.lives(pg_temp.bill('00000000-0000-0000-0000-0000000065c1', 10, 12), 'AC3 N selects the hidden course they''re in');
select t.login('M2');
select t.throws(pg_temp.bill(t.id('A'), 3, 4), '23505', 'edge: a second select of the same course is a duplicate (the app ignores it)');
select t.throws(pg_temp.bill('00000000-0000-0000-0000-0000000065c1', 1, 5), '42501', 'AC3 M2 can''t select a hidden course they can''t see');
select t.lives(pg_temp.bill(t.id('B'), 1, 5), 'AC3 M2 selects B');
select t.eq((select count(*) from course_billing where course_id = '00000000-0000-0000-0000-0000000065c1'), 0::bigint,
  'ARU-40: M2 doesn''t see the hidden course''s billing');
select t.eq((select count(*) from course_billing), 2::bigint, 'AC2 M2 sees the paid courses they can see');
reset role;
select t.eq((select start_day || '-' || end_day from course_billing where course_id = t.id('A')), '1-5', 'edge: the first period saved wins');

-- AC 4: periods are 1-28 with start <= end; any accountant or the teacher changes them; only the days can change.
select t.login('M2');
select t.eq(t.affected(format('update course_billing set start_day = 10, end_day = 15 where course_id = %L', t.id('A'))), 1::bigint,
  'AC4 M2 changes the period N set');
select t.throws(format('update course_billing set start_day = 16, end_day = 15 where course_id = %L', t.id('A')), '23514', 'AC4 start after end is refused');
select t.throws(format('update course_billing set start_day = 0 where course_id = %L', t.id('A')), '23514', 'AC4 day 0 is refused');
select t.throws(format('update course_billing set end_day = 29 where course_id = %L', t.id('A')), '23514', 'AC4 day 29 is refused');
select t.throws(format('update course_billing set course_id = %L where course_id = %L', t.id('B'), t.id('A')), '42501', 'AC4 course_id can''t change');
select t.throws(format('update course_billing set selected_by = %L where course_id = %L', t.id('M2'), t.id('A')), '42501', 'AC4 selected_by can''t change');
select t.throws(pg_temp.bill(t.id('B'), 5, 1), '23514', 'AC4 a new paid course with start after end is refused');
select t.eq(t.affected($$update course_billing set start_day = 1 where course_id = '00000000-0000-0000-0000-0000000065c1'$$), 0::bigint,
  'ARU-40: M2 can''t change the hidden course''s period');
select t.login('T');
select t.eq(t.affected(format('update course_billing set start_day = 2, end_day = 6 where course_id = %L', t.id('A'))), 1::bigint,
  'AC6 the teacher changes any period');
select t.eq((select count(*) from course_billing), 3::bigint, 'AC6 the teacher reads every paid course, the hidden one too');
-- AC 6: the teacher doesn't select or unselect.
select t.throws(pg_temp.bill('00000000-0000-0000-0000-0000000065c2', 1, 5), '42501', 'AC6 the teacher can''t select courses');
select t.eq(t.affected(format('delete from course_billing where course_id = %L', t.id('A'))), 0::bigint, 'AC6 the teacher can''t unselect');
reset role;

-- Others read and change nothing.
select t.login('M');
select t.eq((select count(*) from course_billing), 0::bigint, 'a mentor without Accountant reads nothing');
select t.throws(pg_temp.bill(t.id('A'), 1, 5), '42501', 'a mentor without Accountant can''t select');
select t.eq(t.affected(format('update course_billing set start_day = 3 where course_id = %L', t.id('A'))), 0::bigint, 'nor change a period');
select t.login('S1');
select t.eq((select count(*) from course_billing), 0::bigint, 'AC8 a student reads nothing');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000065a1","role":"authenticated"}', false);
set role authenticated;
select t.eq((select count(*) from course_billing), 0::bigint, 'a pending account reads nothing');
reset role;
select t.login(null);
select t.eq((select count(*) from course_billing), 0::bigint, 'anon reads nothing');
reset role;

-- AC 5: any accountant unselects; it can be selected again.
select t.login('M2');
select t.eq(t.affected(format('delete from course_billing where course_id = %L', t.id('A'))), 1::bigint, 'AC5 M2 unselects the course N selected');
select t.login('N');
select t.lives(pg_temp.bill(t.id('A'), 1, 5), 'AC5 N selects it again');
reset role;

-- AC 2: switching an accountant off (or to student) leaves the rows; they lose access at once.
select t.login('T');
select t.lives(format('select set_accountant(%L, false)', t.id('M2')), 'AC2 teacher turns M2 off');
select t.login('M2');
select t.eq((select count(*) from course_billing), 0::bigint, 'AC2 M2 no longer reads paid courses');
select t.eq(t.affected(format('update course_billing set start_day = 4 where course_id = %L', t.id('B'))), 0::bigint, 'AC2 nor changes them');
reset role;
select t.eq((select count(*) from course_billing), 3::bigint, 'AC2 the rows are unchanged');
-- N owns B, so first reassign it; then a mentor who becomes a student stops being an accountant.
update courses set created_by = t.id('M') where id = t.id('B');
select t.login('T');
select t.lives(format('select set_user_role(%L, ''student'')', t.id('N')), 'AC2 teacher switches N to student');
reset role;
select t.ok((select not is_accountant and role = 'student' from profiles where id = t.id('N')), 'AC2 N is a student and no longer an accountant');
select t.eq((select count(*) from course_billing), 3::bigint, 'AC2 the rows are still unchanged');
select t.login('T');
select t.lives(format('select set_user_role(%L, ''mentor'')', t.id('N')), 'N back to mentor');
reset role;
select t.ok((select not is_accountant from profiles where id = t.id('N')), 'AC2 coming back as a mentor doesn''t restore Accountant');

-- ARU-13 regression: role switching still refuses a course owner becoming a student.
select t.login('T');
select t.throws(format('select set_user_role(%L, ''student'')', t.id('M')), '23514', 'ARU-13 an owner can''t become a student');
reset role;

-- Deleting a course removes its billing.
insert into course_billing (course_id, start_day, end_day, selected_by) values ('00000000-0000-0000-0000-0000000065c2', 1, 5, t.id('M2'));
delete from courses where id = '00000000-0000-0000-0000-0000000065c2';
select t.eq((select count(*) from course_billing where course_id = '00000000-0000-0000-0000-0000000065c2'), 0::bigint,
  'deleting a course removes its billing');
