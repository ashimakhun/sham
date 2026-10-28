-- ARU-12: "My courses" needs no database change; it filters what each role can already read.
-- These checks pin the data the Courses tab relies on (existing 0003/0004 policies).
select t.seed();
insert into course_members (course_id, user_id, added_by) values
  (t.id('A'), t.id('S1'), t.id('M')),
  (t.id('B'), t.id('S1'), t.id('N')),
  (t.id('B'), t.id('M'), t.id('N'));

-- AC3/AC6: a student reads their own memberships, so "Courses I'm in" = A and B.
select t.login('S1');
select t.eq((select string_agg(c.title, ',' order by c.created_at desc) from courses c
  where exists (select 1 from course_members m where m.course_id = c.id and m.user_id = auth.uid())),
  'Biology,Algebra', 'AC3 student: own memberships give "Courses I''m in" newest first');
select t.eq((select count(*) from courses), 2::bigint, 'AC2/AC6 student still reads all courses for "All courses"');

-- A student in no course reads no memberships at all (empty "My courses").
reset role; select t.login('S2');
select t.eq((select count(*) from course_members), 0::bigint, 'AC12 student in no course: no membership rows');

-- Mentors read every membership row, so the app must filter by its own user id (analysis note 1).
reset role; select t.login('M2');
select t.eq((select count(*) from course_members), 3::bigint, 'access: a mentor reads all rows (app filters by user_id)');
select t.eq((select count(*) from course_members where user_id = auth.uid()), 0::bigint, 'AC6 mentor M2: none of the rows are theirs');

-- AC4/AC5: ownership comes from courses.created_by; M owns A and is a listener of B only.
reset role; select t.login('M');
select t.eq((select string_agg(title, ',') from courses where created_by = auth.uid()), 'Algebra', 'AC4 M owns A');
select t.eq((select string_agg(c.title, ',') from courses c join course_members m on m.course_id = c.id
  where m.user_id = auth.uid()), 'Biology', 'AC5 M is a listener of B only');

-- AC8/AC10: both tables are published for live updates.
reset role;
select t.ok((select count(*) from pg_publication_tables where pubname = 'supabase_realtime'
  and tablename in ('courses', 'course_members')) = 2, 'AC8/AC10 courses and course_members are in supabase_realtime');
