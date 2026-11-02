-- ARU-63: disciplines. Rules under test: supabase/migrations/0031_disciplines.sql.
-- Fixture: teacher T; mentors M (owns A), N (owns B), M2; students S1 (listener of A), S2. P is a pending account.
-- D1 visible and D2 hidden are created by the teacher below; H is a hidden course owned by M.
select t.seed();
insert into course_members (course_id, user_id, added_by) values (t.id('A'), t.id('S1'), t.id('M'));
insert into courses (id, title, created_by, hidden) values ('00000000-0000-0000-0000-0000000063c1', 'Hidden one', t.id('M'), true);
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000063a1', 'p@x.test', '{"full_name":"Pending Pat"}');
update profiles set role = 'mentor' where id = '00000000-0000-0000-0000-0000000063a1'; -- still pending

create function pg_temp.as_pending() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000063a1","role":"authenticated"}', false);
  execute 'set role authenticated';
end $$;

-- Data: table, unique name index, nullable course column, realtime; existing courses have no discipline.
select t.ok(exists (select 1 from pg_class where relname = 'disciplines' and relrowsecurity), 'data: disciplines table with RLS');
select t.ok(exists (select 1 from pg_indexes where indexname = 'disciplines_name_key'), 'data: unique name index');
select t.ok(exists (select 1 from information_schema.columns where table_name = 'courses' and column_name = 'discipline_id'
  and is_nullable = 'YES'), 'data: courses.discipline_id is nullable');
select t.eq((select count(*) from courses where discipline_id is not null), 0::bigint, 'data: existing courses have no discipline');
select t.ok(exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'disciplines'),
  'data: disciplines are in the realtime publication');
select t.ok(not has_function_privilege('anon', 'set_course_discipline(uuid, uuid)', 'execute'), 'data: anon cannot run set_course_discipline');

-- AC 1: the teacher creates; the name is trimmed; blank, too long and duplicate names are refused.
select t.login('T');
select t.lives($$insert into disciplines (id, name) values ('00000000-0000-0000-0000-0000000063d1', '  Math  ')$$, 'AC1 teacher creates a discipline');
select t.eq((select name from disciplines where id = '00000000-0000-0000-0000-0000000063d1'), 'Math', 'AC1 the name is stored trimmed');
select t.throws($$insert into disciplines (name) values ('   ')$$, '23514', 'AC1 a blank name is refused');
select t.throws($$insert into disciplines (name) values ('')$$, '23514', 'AC1 an empty name is refused');
select t.throws(format('insert into disciplines (name) values (%L)', repeat('x', 101)), '23514', 'AC1 101 characters are refused');
select t.lives(format('insert into disciplines (name) values (%L)', repeat('y', 100)), 'AC1 100 characters are allowed');
select t.throws($$insert into disciplines (name) values ('math')$$, '23505', 'AC1 the same name in another case is refused');
select t.throws($$insert into disciplines (name) values (' MATH ')$$, '23505', 'AC1 the same name with spaces is refused');
select t.lives($$insert into disciplines (id, name) values ('00000000-0000-0000-0000-0000000063d2', 'Physics')$$, 'teacher creates D2');
-- AC 2: the teacher hides D2.
select t.eq(t.affected($$update disciplines set hidden = true where id = '00000000-0000-0000-0000-0000000063d2'$$), 1::bigint, 'AC2 teacher hides a discipline');
select t.eq((select count(*) from disciplines), 3::bigint, 'AC2 the teacher reads hidden disciplines too');
-- Renaming is out of scope; created_by can't be faked.
select t.throws($$update disciplines set name = 'Algebra' where id = '00000000-0000-0000-0000-0000000063d1'$$, '42501', 'renaming is refused');
select t.throws(format('insert into disciplines (name, created_by) values (%L, %L)', 'Chem', t.id('M')), '42501', 'created_by can''t be given');
select t.eq(t.affected($$delete from disciplines where id = '00000000-0000-0000-0000-0000000063d1'$$), 0::bigint, 'nobody deletes disciplines');
reset role;

-- AC 2 / AC 3: students and mentors read only visible disciplines and change nothing.
select t.login('S1');
select t.eq((select string_agg(name, ',' order by name) from disciplines where name in ('Math', 'Physics')), 'Math', 'AC2 a student doesn''t see the hidden one');
select t.throws($$insert into disciplines (name) values ('Chemistry')$$, '42501', 'AC3 a student can''t create');
select t.eq(t.affected($$update disciplines set hidden = true where id = '00000000-0000-0000-0000-0000000063d1'$$), 0::bigint, 'AC3 a student can''t hide');
select t.login('M');
select t.eq((select count(*) from disciplines where id = '00000000-0000-0000-0000-0000000063d2'), 0::bigint, 'AC2 a mentor doesn''t see the hidden one');
select t.throws($$insert into disciplines (name) values ('Chemistry')$$, '42501', 'AC3 a mentor can''t create');
select t.eq(t.affected($$update disciplines set hidden = false where id = '00000000-0000-0000-0000-0000000063d2'$$), 0::bigint, 'AC3 a mentor can''t unhide');
reset role;
select pg_temp.as_pending();
select t.eq((select count(*) from disciplines), 0::bigint, 'pending accounts read no disciplines');
select t.throws($$insert into disciplines (name) values ('Chemistry')$$, '42501', 'pending accounts can''t create');
reset role;
select t.login(null);
select t.eq((select count(*) from disciplines), 0::bigint, 'anon reads nothing');
reset role;

-- AC 4: a course is created with a visible discipline or none; a hidden one is refused for non-teachers.
select t.login('M');
select t.lives(format('insert into courses (id, title, created_by, discipline_id) values (%L, %L, %L, %L)',
  '00000000-0000-0000-0000-0000000063c2', 'Algebra 2', t.id('M'), '00000000-0000-0000-0000-0000000063d1'), 'AC4 mentor creates a course in Math');
select t.lives(format('insert into courses (id, title, created_by) values (%L, %L, %L)',
  '00000000-0000-0000-0000-0000000063c3', 'Free course', t.id('M')), 'AC4 mentor creates a course with no discipline');
select t.throws(format('insert into courses (title, created_by, discipline_id) values (%L, %L, %L)',
  'Sneaky', t.id('M'), '00000000-0000-0000-0000-0000000063d2'), '42501', 'AC4 a mentor can''t create a course in a hidden discipline');
select t.login('T');
select t.lives(format('insert into courses (id, title, created_by, discipline_id) values (%L, %L, %L, %L)',
  '00000000-0000-0000-0000-0000000063c4', 'Teacher physics', t.id('T'), '00000000-0000-0000-0000-0000000063d2'),
  'AC4 the teacher may use a hidden discipline (they can see it)');
reset role;

-- AC 5: the current owner changes, clears and re-sets the discipline; nobody else can.
select t.login('M');
select t.lives(format('select set_course_discipline(%L, %L)', t.id('A'), '00000000-0000-0000-0000-0000000063d1'), 'AC5 owner sets Math on A');
select t.lives(format('select set_course_discipline(%L, null)', t.id('A')), 'AC5 owner clears it');
select t.lives(format('select set_course_discipline(%L, %L)', t.id('A'), '00000000-0000-0000-0000-0000000063d1'), 'AC5 owner sets it again');
select t.throws(format('select set_course_discipline(%L, %L)', t.id('A'), '00000000-0000-0000-0000-0000000063d2'), 'P0002',
  'AC5 owner can''t pick a hidden discipline');
select t.throws(format('select set_course_discipline(%L, %L)', t.id('A'), '00000000-0000-0000-0000-0000000063ff'), 'P0002',
  'AC5 an unknown discipline is refused');
select t.login('T');
select t.throws(format('select set_course_discipline(%L, null)', t.id('A')), '42501', 'AC5 the teacher can''t change a course they don''t own');
select t.login('N');
select t.throws(format('select set_course_discipline(%L, null)', t.id('A')), '42501', 'AC5 another mentor can''t');
select t.login('S1');
select t.throws(format('select set_course_discipline(%L, null)', t.id('A')), '42501', 'AC5 a listener can''t');
select t.login('N');
select t.throws(format('select set_course_discipline(%L, null)', '00000000-0000-0000-0000-0000000063c1'), 'P0002',
  'a hidden course someone can''t see: Course not found');
select t.throws(format('select set_course_discipline(%L, null)', '00000000-0000-0000-0000-0000000063ee'), 'P0002', 'unknown course: Course not found');
reset role;
select pg_temp.as_pending();
select t.throws(format('select set_course_discipline(%L, null)', t.id('A')), '42501', 'AC5 a pending account can''t');
reset role;
select t.eq((select discipline_id from courses where id = t.id('A')), '00000000-0000-0000-0000-0000000063d1'::uuid, 'AC5 refused calls changed nothing');
-- No direct update of courses.
select t.login('M');
select t.eq(t.affected(format('update courses set discipline_id = null where id = %L', t.id('A'))), 0::bigint, 'a direct update changes nothing');
reset role;

-- AC 5: the teacher hides Math; the owner keeps the hidden value or moves off it.
select t.login('T');
select t.lives($$update disciplines set hidden = true where id = '00000000-0000-0000-0000-0000000063d1'$$, 'teacher hides Math');
select t.login('M');
select t.eq((select discipline_id from courses where id = t.id('A')), '00000000-0000-0000-0000-0000000063d1'::uuid,
  'AC5 the owner still reads the course''s discipline id (shown as Hidden discipline)');
select t.eq((select count(*) from disciplines where id = '00000000-0000-0000-0000-0000000063d1'), 0::bigint, 'but not its name');
select t.lives(format('select set_course_discipline(%L, %L)', t.id('A'), '00000000-0000-0000-0000-0000000063d1'),
  'AC5 saving the unchanged hidden value succeeds');
select t.lives(format('select set_course_discipline(%L, null)', t.id('A')), 'AC5 moving off it to No discipline succeeds');
select t.throws(format('select set_course_discipline(%L, %L)', t.id('A'), '00000000-0000-0000-0000-0000000063d1'), 'P0002',
  'AC5 and it can''t be picked again while hidden');
reset role;

-- Course read access is unchanged: a student not in a course still reads it (the app decides what to list).
select t.login('S2');
select t.eq((select count(*) from courses where id = '00000000-0000-0000-0000-0000000063c2'), 1::bigint, 'course read access unchanged');
reset role;
