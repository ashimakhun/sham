-- ARU-130: "Homework sent: x of y". Rules under test: supabase/migrations/0056_assignment_sent_counts.sql.
-- Course A (owner M): listeners S1, S3 (students) and M2 (mentor); five assignments. Course B (owner N) is hidden,
-- with listener S2 and five assignments. P is a Pending mentor. S1 and S3 sent homework for A's first assignment
-- (S3's is checked); S2, who isn't in A, has homework on it too (as if sent before leaving the course).
select t.seed();
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000130f1', 'p130@x.test', '{"full_name":"Pending Pat"}');
update profiles set role = 'mentor', access_status = 'pending' where id = '00000000-0000-0000-0000-0000000130f1';
insert into course_members (course_id, user_id, added_by) values
  (t.id('A'), t.id('S1'), t.id('M')),
  (t.id('A'), t.id('S3'), t.id('M')),
  (t.id('A'), t.id('M2'), t.id('M')),
  (t.id('B'), t.id('S2'), t.id('N'));
update courses set hidden = true where id = t.id('B');
select t.make_assignments(t.id('A'));
select t.make_assignments(t.id('B'));
-- As the admin, without triggers: the homework rows the counts read.
set session_replication_role = replica;
insert into homework (student_id, course_id, title, status, checked_by, assignment_id) values
  (t.id('S1'), t.id('A'), 'S1 on 1', 'submitted', null, t.assignment(t.id('A'), 1)),
  (t.id('S3'), t.id('A'), 'S3 on 1', 'checked', t.id('M'), t.assignment(t.id('A'), 1)),
  (t.id('S2'), t.id('A'), 'S2 on 1, not a listener', 'submitted', null, t.assignment(t.id('A'), 1));
set session_replication_role = origin;

create function pg_temp.login_id(who uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', who, 'role', 'authenticated')::text, false);
  set role authenticated;
end $$;
-- "sent of listeners" for one assignment, or 'none' when the caller gets no row for it.
create function pg_temp.of(course text, n int) returns text language sql as $$
  select coalesce((select c.sent || ' of ' || c.listeners from assignment_sent_counts(array[t.id(course)]) c
    where c.assignment_id = t.assignment(t.id(course), n)), 'none') $$;
create function pg_temp.rows(courses uuid[]) returns bigint language sql as $$
  select count(*) from assignment_sent_counts(courses) $$;
grant execute on all functions in schema pg_temp to authenticated, anon;

-- AC 4, data: read-only security definer with search_path, counts only, no anon execute.
select t.ok((select prosecdef and provolatile = 's' and 'search_path=public' = any(proconfig) from pg_proc
  where proname = 'assignment_sent_counts'), 'AC4 stable security definer with search_path = public');
select t.eq((select pg_get_function_result(oid) from pg_proc where proname = 'assignment_sent_counts'),
  'TABLE(assignment_id uuid, sent integer, listeners integer)', 'AC4 returns counts only (no ids of people or content)');
select t.ok(not has_function_privilege('anon', 'assignment_sent_counts(uuid[])', 'execute'), 'AC4 anon cannot execute');
select t.ok(has_function_privilege('authenticated', 'assignment_sent_counts(uuid[])', 'execute'), 'AC4 authenticated can execute');

-- AC 2-3: everyone who sees A's meetings gets the same numbers: 2 of 3 (S2 isn't a listener), and 0 of 3 for an
-- assignment nobody sent (a row, so the line shows "0 of 3" instead of hiding).
select t.login('S1');
select t.eq(pg_temp.of('A', 1), '2 of 3', 'AC2 a student listener: 2 of 3 (checked counts, a non-listener does not)');
select t.eq(pg_temp.of('A', 2), '0 of 3', 'AC2 an assignment nobody sent is 0 of 3');
select t.eq(pg_temp.rows(array[t.id('A')]), 5::bigint, 'AC4 one row per assignment of the course');
reset role;
select t.login('M2');
select t.eq(pg_temp.of('A', 1), '2 of 3', 'AC3 a mentor listener sees the same count');
reset role;
select t.login('M');
select t.eq(pg_temp.of('A', 1), '2 of 3', 'AC3 the owner sees the same count');
reset role;
select t.login('N');
select t.eq(pg_temp.of('A', 1), '2 of 3', 'AC3 a mentor outside the course sees it (not hidden)');
reset role;
select t.login('T');
select t.eq(pg_temp.of('A', 1), '2 of 3', 'AC3 the teacher sees the same count');
select t.eq(pg_temp.of('B', 1), '0 of 1', 'AC4 the teacher sees a hidden course');
-- One request for several courses: A's and B's rows together.
select t.eq(pg_temp.rows(array[t.id('A'), t.id('B')]), 10::bigint, 'AC4 several courses in one call');
reset role;

-- AC 3: a listener's access to homework doesn't change (still only their own).
select t.login('S1');
select t.eq((select count(*) from homework where assignment_id = t.assignment(t.id('A'), 1)), 1::bigint,
  'AC3 a student still reads only their own homework');
reset role;

-- AC 4, denied: empty result, no error.
select t.login('S2');
select t.eq(pg_temp.rows(array[t.id('A')]), 0::bigint, 'AC4 a student of another course gets nothing');
select t.eq(pg_temp.of('B', 1), '0 of 1', 'AC4 a listener of a hidden course sees it');
reset role;
select t.login('M2');
select t.eq(pg_temp.rows(array[t.id('B')]), 0::bigint, 'AC4 a mentor gets nothing for a hidden course they are not in');
reset role;
select t.login('N');
select t.eq(pg_temp.of('B', 1), '0 of 1', 'AC4 the owner of a hidden course sees it');
reset role;
select pg_temp.login_id('00000000-0000-0000-0000-0000000130f1');
select t.eq(pg_temp.rows(array[t.id('A'), t.id('B')]), 0::bigint, 'AC4 a Pending account gets nothing');
reset role;
select t.login(null);
select t.throws('select * from assignment_sent_counts(array[''' || t.id('A') || '''::uuid])', '42501',
  'AC4 a signed-out caller cannot call it');
reset role;
select t.eq((select count(*) from assignment_sent_counts(array[t.id('A')])), 0::bigint,
  'AC4 no signed-in user (admin session without a JWT): no rows');

-- AC 2 / edge cases: counts use current listeners. S3 leaves: 1 of 2. A new listener joins: 1 of 3.
delete from course_members where course_id = t.id('A') and user_id = t.id('S3');
select t.login('M');
select t.eq(pg_temp.of('A', 1), '1 of 2', 'AC2 a listener who left is not counted, sent or total');
reset role;
insert into course_members (course_id, user_id, added_by) values (t.id('A'), t.id('S2'), t.id('M'));
select t.login('M');
select t.eq(pg_temp.of('A', 1), '2 of 3', 'edge: S2 joins: their earlier homework counts again and the total goes up');
reset role;

-- AC 2: a course with no listeners shows 0 of 0.
delete from course_members where course_id = t.id('B');
select t.login('T');
select t.eq(pg_temp.of('B', 1), '0 of 0', 'AC2 no listeners: 0 of 0');
reset role;
