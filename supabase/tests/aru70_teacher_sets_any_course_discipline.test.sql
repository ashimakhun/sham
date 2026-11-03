-- ARU-70: the teacher sets, changes or clears the discipline of any course; mentors only of the courses they own.
-- Rules under test: supabase/migrations/0033_teacher_sets_any_course_discipline.sql.
-- Fixture: teacher T; mentors M (owns A), N (owns B); student S1 (listener of A); P is a pending mentor.
-- D1 is visible, D2 hidden; H is a hidden course owned by M.
select t.seed();
insert into course_members (course_id, user_id, added_by) values (t.id('A'), t.id('S1'), t.id('M'));
insert into courses (id, title, created_by, hidden) values ('00000000-0000-0000-0000-0000000070c1', 'Hidden one', t.id('M'), true);
insert into disciplines (id, name, hidden, created_by) values
  ('00000000-0000-0000-0000-0000000070d1', 'Math', false, t.id('T')),
  ('00000000-0000-0000-0000-0000000070d2', 'Secret', true, t.id('T'));
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000070a1', 'p@x.test', '{"full_name":"Pending Pat"}');
update profiles set role = 'mentor' where id = '00000000-0000-0000-0000-0000000070a1'; -- still pending (only one teacher exists)

create function pg_temp.as_pending() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000070a1","role":"authenticated"}', false);
  execute 'set role authenticated';
end $$;
create function pg_temp.discipline_of(course uuid) returns uuid language sql as $$
  select discipline_id from courses where id = course
$$;

-- Data: still only authenticated can run it.
select t.ok(not has_function_privilege('anon', 'set_course_discipline(uuid, uuid)', 'execute'), 'data: anon cannot run it');
select t.ok(has_function_privilege('authenticated', 'set_course_discipline(uuid, uuid)', 'execute'), 'data: authenticated can');

-- AC 2 / AC 4: the teacher on a mentor's course: set, change to a hidden discipline (AC 3), clear.
select t.login('T');
select t.lives(format('select set_course_discipline(%L, %L)', t.id('A'), '00000000-0000-0000-0000-0000000070d1'),
  'AC4 the teacher sets Math on M''s course');
select t.eq(pg_temp.discipline_of(t.id('A')), '00000000-0000-0000-0000-0000000070d1'::uuid, 'AC2 saved');
select t.lives(format('select set_course_discipline(%L, %L)', t.id('A'), '00000000-0000-0000-0000-0000000070d1'),
  'unchanged value: a no-op for the teacher too');
select t.lives(format('select set_course_discipline(%L, %L)', t.id('B'), '00000000-0000-0000-0000-0000000070d2'),
  'AC3 the teacher puts N''s course in a hidden discipline');
select t.eq(pg_temp.discipline_of(t.id('B')), '00000000-0000-0000-0000-0000000070d2'::uuid, 'AC3 saved');
select t.lives(format('select set_course_discipline(%L, null)', t.id('B')), 'AC2 the teacher clears it');
select t.ok(pg_temp.discipline_of(t.id('B')) is null, 'AC2 cleared');
-- Edge ARU-40: a hidden course the teacher doesn't own.
select t.lives(format('select set_course_discipline(%L, %L)', '00000000-0000-0000-0000-0000000070c1', '00000000-0000-0000-0000-0000000070d1'),
  'edge the teacher changes a hidden course they don''t own');
select t.throws(format('select set_course_discipline(%L, null)', '00000000-0000-0000-0000-0000000070ee'), 'P0002',
  'an unknown course: Course not found');
select t.throws(format('select set_course_discipline(%L, %L)', t.id('A'), '00000000-0000-0000-0000-0000000070ff'), 'P0002',
  'an unknown discipline: Discipline not found');
reset role;

-- AC 4 / AC 11: mentors only on their own courses; the message is unchanged.
select t.login('N');
select t.throws(format('select set_course_discipline(%L, null)', t.id('A')), '42501', 'AC4 a mentor can''t change a course they don''t own');
do $$
begin
  perform set_course_discipline(t.id('A'), null);
exception when insufficient_privilege then
  perform t.eq(sqlerrm, 'Only the course owner can change its discipline.', 'AC4 the 42501 message is word for word');
end $$;
select t.lives(format('select set_course_discipline(%L, null)', t.id('B')), 'AC11 a mentor still changes their own course');
select t.throws(format('select set_course_discipline(%L, %L)', t.id('B'), '00000000-0000-0000-0000-0000000070d2'), 'P0002',
  'a mentor can''t pick a hidden discipline');
select t.login('M');
-- The teacher put M's hidden course in Math; M can keep it or clear it.
select t.lives(format('select set_course_discipline(%L, null)', '00000000-0000-0000-0000-0000000070c1'), 'AC11 the owner clears what the teacher set');
reset role;

-- A student and an unapproved account are refused.
select t.login('S1');
select t.throws(format('select set_course_discipline(%L, null)', t.id('A')), '42501', 'AC4 a student can''t');
reset role;
select pg_temp.as_pending();
select t.throws(format('select set_course_discipline(%L, null)', t.id('A')), '42501', 'AC4 an unapproved account can''t');
reset role;
select t.eq(pg_temp.discipline_of(t.id('A')), '00000000-0000-0000-0000-0000000070d1'::uuid, 'refused calls changed nothing');
