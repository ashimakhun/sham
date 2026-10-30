-- ARU-13: the teacher switches users between student and mentor (set_user_role, teacher lock, one-teacher index).
-- Fixture (t.seed): teacher T; mentors M (owns A), N (owns B), M2 (no course); students S1, S2, S3.
select t.seed();
select t.make_assignments(t.id('A')); -- ARU-32: homework is sent for an assignment
-- TEST DESIGN extras: M2 and S1 are listeners of A.
insert into course_members (course_id, user_id, added_by) values
  (t.id('A'), t.id('M2'), t.id('M')),
  (t.id('A'), t.id('S1'), t.id('M'));

create function t.role_of(who text) returns user_role language sql stable security definer set search_path = public as $$
  select role from profiles where id = t.id(who)
$$;
grant execute on function t.role_of(text) to anon, authenticated;

-- AC 8: only the teacher may call set_user_role.
select t.login('M');
select t.throws($$select set_user_role(t.id('S2'), 'mentor')$$, '42501', 'AC8: a mentor cannot change roles');
select t.login('S1');
select t.throws($$select set_user_role(t.id('S2'), 'mentor')$$, '42501', 'AC8: a student cannot change roles');
select t.throws($$select set_user_role(t.id('S1'), 'mentor')$$, '42501', 'AC8: a student cannot promote themselves');
select t.login(null);
select t.throws($$select set_user_role(t.id('S2'), 'mentor')$$, '42501', 'AC8: anon cannot execute set_user_role');
reset role;
select t.eq(t.role_of('S2'), 'student'::user_role, 'AC8: rejected calls changed nothing');

-- AC 3: student -> mentor.
select t.login('T');
select t.lives($$select set_user_role(t.id('S2'), 'mentor')$$, 'AC3: the teacher makes S2 a mentor');
select t.eq(t.role_of('S2'), 'mentor'::user_role, 'AC3: S2 is now a mentor');
select t.lives($$select set_user_role(t.id('S2'), 'mentor')$$, 'AC8: same role again is a no-op (safe retry)');
select t.eq(t.role_of('S2'), 'mentor'::user_role, 'AC8: still a mentor after the retry');

-- AC 3 / decision 8: the new mentor sees and checks homework in every course, never their own.
select t.login('S2');
select t.eq((select count(*) from homework), 3::bigint, 'AC3: new mentor S2 sees all homework');
select t.eq(t.affected($$update homework set status = 'checked', checked_by = t.id('S2'), checked_at = now()
  where id = t.id('HW_B1')$$), 1::bigint, 'AC3: new mentor S2 checks homework in a course they are not in');

-- AC 4 / AC 7: mentor M2 (owns nothing, listener of A) -> student keeps the membership and can submit.
select t.login('T');
select t.lives($$select set_user_role(t.id('M2'), 'student')$$, 'AC4: the teacher makes M2 a student');
select t.eq(t.role_of('M2'), 'student'::user_role, 'AC4: M2 is now a student');
select t.login('M2');
select t.ok(is_member(t.id('A')), 'AC7: M2 is still a listener of A');
select t.lives($$insert into homework (student_id, course_id, title, assignment_id) values (t.id('M2'), t.id('A'), 'mine', t.assignment(t.id('A'), 1))$$,
  'AC7: M2 made student still submits homework to A');
select t.eq((select count(*) from homework where student_id <> t.id('M2')), 0::bigint,
  'AC4: M2 made student sees only their own homework');
select t.eq(t.affected($$update homework set status = 'checked', checked_by = t.id('M2'), checked_at = now()
  where id = t.id('HW_A1')$$), 0::bigint, 'AC4: M2 made student cannot check homework');

-- AC 7: S1 (listener of A) made mentor stays a listener and can still submit there.
select t.login('T');
select t.lives($$select set_user_role(t.id('S1'), 'mentor')$$, 'AC7: the teacher makes S1 a mentor');
select t.login('S1');
select t.ok(is_member(t.id('A')), 'AC7: S1 made mentor is still a listener of A');
select t.lives($$insert into homework (student_id, course_id, title, assignment_id) values (t.id('S1'), t.id('A'), 'as mentor', t.assignment(t.id('A'), 2))$$,
  'AC7: S1 made mentor still submits homework to A');

-- AC 5: a mentor who owns courses can't become a student.
reset role;
insert into courses (title, created_by) values ('Zoology', t.id('N'));
select t.login('T');
select t.throws($$select set_user_role(t.id('M'), 'student')$$, '23514', 'AC5: M owns A, refused');
select t.eq(t.role_of('M'), 'mentor'::user_role, 'AC5: M is still a mentor');
do $$
begin
  perform set_user_role(t.id('N'), 'student');
  raise exception 'FAIL: AC5 expected a refusal';
exception when check_violation then
  perform t.eq(sqlerrm, 'Mentor Nina owns 2 course(s): Biology, Zoology. Reassign them first', 'AC5: message names count and titles');
end $$;

-- AC 6 / AC 8: nothing makes anyone a teacher, and the teacher stays the teacher.
select t.throws($$select set_user_role(t.id('S3'), 'teacher')$$, '42501', 'AC6: set_user_role cannot make a teacher');
select t.throws($$select set_user_role(t.id('T'), 'mentor')$$, '42501', 'AC6: set_user_role cannot demote the teacher');
select t.throws($$select set_user_role(t.id('T'), 'student')$$, '42501', 'AC6: set_user_role cannot make the teacher a student');
select t.throws($$select set_user_role(gen_random_uuid(), 'mentor')$$, 'P0002', 'edge: unknown user');

-- AC 8: the existing "edit own profile" policy still stops changing your own role.
select t.login('S3');
select t.throws($$update profiles set role = 'mentor' where id = t.id('S3')$$, '42501', 'AC8: a student cannot change their own role');
select t.throws($$update profiles set role = 'teacher' where id = t.id('S3')$$, '42501', 'AC8: a student cannot make themselves teacher');
select t.lives($$update profiles set full_name = 'Sid S.' where id = t.id('S3')$$, 'regression: editing own name still works');
select t.login('T');
select t.throws($$update profiles set role = 'mentor' where id = t.id('T')$$, '42501', 'AC8: the teacher cannot demote themselves via the API');
reset role;

-- AC 8: the trigger blocks changes to or from teacher even from the SQL editor (superuser).
select t.throws($$update profiles set role = 'teacher' where id = t.id('S3')$$, '42501', 'AC8: SQL editor cannot make a second teacher');
select t.throws($$update profiles set role = 'mentor' where id = t.id('T')$$, '42501', 'AC8: SQL editor cannot demote the teacher');
select t.lives($$update profiles set role = 'teacher' where id = t.id('T')$$, 'AC8: setting the teacher to teacher again is harmless');
select t.lives($$update profiles set role = 'mentor' where id = t.id('S3')$$, 'AC8: SQL editor can still switch student <-> mentor');
select t.throws($$insert into auth.users (id, email) values (gen_random_uuid(), 'x@x.test');
  update profiles set role = 'teacher' where id = (select id from auth.users where email = 'x@x.test')$$,
  '42501', 'AC8: a new user cannot be made teacher');
select t.throws($$insert into profiles (id, full_name, role) values (gen_random_uuid(), 'Second', 'teacher')$$,
  '42501', 'AC8: inserting a second teacher is rejected by the trigger');
select t.lives($$insert into auth.users (id, email) values (gen_random_uuid(), 'new@x.test')$$, 'regression: sign-up still creates a profile');
select t.eq((select role from profiles p join auth.users u on u.id = p.id where u.email = 'new@x.test'), 'student'::user_role,
  'regression: sign-up creates a student');

-- AC 8: partial unique index exists; profiles not in realtime.
select t.ok(exists (select 1 from pg_indexes where indexname = 'profiles_one_teacher'), 'AC8: one-teacher unique index exists');
select t.ok(not exists (select 1 from pg_publication_tables where tablename = 'profiles'), 'decision 7: profiles is not in realtime');
select t.ok(not has_function_privilege('anon', 'set_user_role(uuid, user_role)', 'execute'), 'AC8: anon has no execute');
select t.ok(has_function_privilege('authenticated', 'set_user_role(uuid, user_role)', 'execute'), 'AC8: authenticated has execute');

-- One-time setup: with no teacher, the first teacher can be made once; then it is locked.
alter table profiles disable trigger profiles_teacher_locked;
update profiles set role = 'mentor' where id = t.id('T');
alter table profiles enable trigger profiles_teacher_locked;
select t.lives($$update profiles set role = 'teacher' where id = t.id('S2')$$, 'setup: the first teacher can be made while none exists');
select t.throws($$update profiles set role = 'teacher' where id = t.id('T')$$, '42501', 'setup: a second teacher is then rejected');
alter table profiles disable trigger profiles_teacher_locked;
select t.throws($$update profiles set role = 'teacher' where id = t.id('T')$$, '23505', 'AC8: the unique index alone also allows only one teacher');
alter table profiles enable trigger profiles_teacher_locked;
