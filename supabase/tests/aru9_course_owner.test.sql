-- ARU-9: course owner. Rules under test: supabase/migrations/0007_course_owner.sql.
-- Shared seed: teacher T; mentors M (owns A), N (owns B), M2; students S1, S2, S3. Here M2 and S1 are listeners of A
-- (M2 plays the TEST DESIGN's listener-mentor L).
select t.seed();
insert into course_members (course_id, user_id, added_by) values
  (t.id('A'), t.id('M2'), t.id('M')),
  (t.id('A'), t.id('S1'), t.id('M'));
-- One checked homework in A to prove an owner change touches no homework (AC 10).
update homework set checked_at = '2026-10-01T10:00:00Z', mentor_comment = 'Good' where id = t.id('HW_A2');

-- AC 1: the creator is the owner; the column says so.
select t.eq((select created_by from courses where id = t.id('A')), t.id('M'), 'AC1 the creator owns the course');
select t.ok(col_description('public.courses'::regclass, (select attnum from pg_attribute where attrelid = 'public.courses'::regclass and attname = 'created_by')) ilike '%current owner%',
  'data: courses.created_by is documented as the current owner');

-- AC 3 / decision 8: the owner, an unrelated mentor, a listener-mentor and the teacher can change the owner.
select t.login('M');
select t.lives($$select change_course_owner('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000b2')$$, 'AC3 owner M hands A to N');
reset role;
select t.eq((select created_by from courses where id = t.id('A')), t.id('N'), 'AC5 A is now owned by N');
select t.login('M2');
select t.lives($$select change_course_owner('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000b1')$$, 'AC3 listener-mentor M2 hands A back to M');
reset role; select t.login('T');
select t.lives($$select change_course_owner('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000a1')$$, 'AC3 teacher takes over B (teacher can own)');
select t.lives($$select change_course_owner('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000b2')$$, 'AC3 teacher gives B back to N');
reset role;
select t.eq((select created_by from courses where id = t.id('B')), t.id('N'), 'AC3 B owned by N again');

-- Idempotent: same owner again is a no-op, no error.
select t.login('N');
select t.lives($$select change_course_owner('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000b2')$$, 'edge: setting the current owner again succeeds (safe retry)');

-- AC 3 / AC 7: a student can't change the owner; anon can't call the function.
reset role; select t.login('S1');
select t.throws($$select change_course_owner('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000b2')$$, '42501', 'AC3 a student cannot change the owner');
reset role; select t.login(null);
select t.throws($$select change_course_owner('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000b2')$$, '42501', 'roles: anon cannot execute change_course_owner');

-- AC 6: a listener of the course can't become its owner (M2 is a listener of A).
reset role; select t.login('T');
select t.throws($$select change_course_owner('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000b3')$$, '23514', 'AC6 a listener of the course cannot become owner');
-- AC 7: a student or an unknown user can't become owner.
select t.throws($$select change_course_owner('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000c2')$$, '23514', 'AC7 a student cannot become owner');
select t.throws($$select change_course_owner('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-00000000ffff')$$, 'P0002', 'AC7 an unknown user cannot become owner');
select t.throws($$select change_course_owner('00000000-0000-0000-0000-00000000ffff', '00000000-0000-0000-0000-0000000000b2')$$, 'P0002', 'edge: an unknown course is rejected');
reset role;
select t.eq((select created_by from courses where id = t.id('A')), t.id('M'), 'AC7 rejected changes leave the owner unchanged');

-- No general update policy on courses: a mentor can't edit the title or owner directly.
select t.login('M');
select t.eq(t.affected($$update courses set title = 'Hacked', created_by = '00000000-0000-0000-0000-0000000000b2' where id = '00000000-0000-0000-0000-0000000000d1'$$), 0::bigint,
  'data: no direct update of courses (title or owner)');

-- AC 8 / AC 10 / AC 12: the owner change touches no homework; every mentor and the teacher still see it all.
reset role;
select t.ok((select checked_by = t.id('M') and checked_at = '2026-10-01T10:00:00Z' and mentor_comment = 'Good' from homework where id = t.id('HW_A2')),
  'AC10 checked homework keeps checker, time and comment after owner changes');
select t.login('N');
select t.eq((select count(*) from homework where course_id = t.id('A')), 2::bigint, 'AC8 a mentor who is not the owner still sees the course homework');
reset role; select t.login('M');
select t.eq((select count(*) from homework where course_id = t.id('A')), 2::bigint, 'AC8 the owner sees it too');

-- AC 14: no student owner by any path.
reset role;
select t.throws($$insert into courses (title, created_by) values ('Student-owned', '00000000-0000-0000-0000-0000000000c1')$$, '23514',
  'AC14 SQL editor: creating a course owned by a student is rejected');
select t.throws($$update courses set created_by = '00000000-0000-0000-0000-0000000000c1' where id = '00000000-0000-0000-0000-0000000000d1'$$, '23514',
  'AC14 SQL editor: moving a course to a student is rejected');
select t.throws($$update courses set created_by = '00000000-0000-0000-0000-00000000ffff' where id = '00000000-0000-0000-0000-0000000000d1'$$, '23514',
  'AC14 SQL editor: moving a course to an unknown user is rejected');
select t.throws($$update profiles set role = 'student' where id = '00000000-0000-0000-0000-0000000000b1'$$, '23514',
  'AC14 a course owner cannot be made a student');
do $$ begin
  update profiles set role = 'student' where id = t.id('M');
exception when others then
  perform t.ok(sqlerrm = 'Mentor Max owns 1 course(s). Reassign them first', 'AC14 message names the owner and the number of courses');
end $$;
select t.lives($$update profiles set role = 'student' where id = '00000000-0000-0000-0000-0000000000b3'$$,
  'AC14 a mentor who owns nothing can still be made a student');
select t.lives($$update profiles set role = 'mentor' where id = '00000000-0000-0000-0000-0000000000b3'$$, 'cleanup: M2 back to mentor');
select t.login('M2');
select t.throws($$insert into courses (title, created_by) values ('Spoof', '00000000-0000-0000-0000-0000000000c1')$$, '23514',
  'AC14 app: a mentor cannot create a course owned by a student');

-- AC 13: after N owns A, the add-listener rules exclude N and allow M (a mentor, not a listener).
reset role; select t.login('T');
select t.lives($$select change_course_owner('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000b2')$$, 'AC13 setup: A to N');
select t.throws($$insert into course_members (course_id, user_id, added_by) values ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000a1')$$, '42501',
  'AC13 the new owner cannot be added as a listener');
select t.lives($$insert into course_members (course_id, user_id, added_by) values ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1')$$,
  'AC13 the former owner (a mentor) can be added as a listener');

-- Data checks.
reset role;
select t.ok((select prosecdef and 'search_path=public' = any(proconfig) from pg_proc where proname = 'change_course_owner'),
  'data: change_course_owner is security definer with search_path = public');
select t.ok(not exists (select 1 from pg_policies where tablename = 'courses' and cmd in ('UPDATE', 'ALL')), 'data: no update policy on courses');
