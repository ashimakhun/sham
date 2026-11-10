-- QA ARU-130: gaps in aru130_assignment_sent_counts.test.sql. A Rejected account gets nothing; a mixed request
-- returns only the courses the caller may see (a student asking for A and the hidden B gets A's rows only); an owner
-- mentor asking for another mentor's hidden course gets nothing; an empty array, a null array and an unknown course id
-- give no rows and no error; a deleted account is no longer counted, sent or total; two current listeners' homework on
-- one assignment counts each once and a listener's homework on another assignment doesn't count here; the counts
-- are integers.
-- Fixture (t.seed): course A owned by M, B by N; teacher T; students S1–S3; mentor M2.
select t.seed();
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000130a1', 'r130@x.test', '{"full_name":"Rejected Rita"}');
update profiles set role = 'student', access_status = 'rejected' where id = '00000000-0000-0000-0000-0000000130a1';
insert into course_members (course_id, user_id, added_by) values
  (t.id('A'), t.id('S1'), t.id('M')),
  (t.id('A'), t.id('S2'), t.id('M')),
  (t.id('A'), t.id('S3'), t.id('M')),
  (t.id('A'), '00000000-0000-0000-0000-0000000130a1', t.id('M')),
  (t.id('B'), t.id('S1'), t.id('N'));
update courses set hidden = true where id = t.id('B');
select t.make_assignments(t.id('A'));
select t.make_assignments(t.id('B'));
set session_replication_role = replica;
insert into homework (student_id, course_id, title, status, checked_by, assignment_id) values
  (t.id('S1'), t.id('A'), 'S1 on 1', 'checked', t.id('M'), t.assignment(t.id('A'), 1)),
  (t.id('S2'), t.id('A'), 'S2 on 1', 'submitted', null, t.assignment(t.id('A'), 1)),
  (t.id('S3'), t.id('A'), 'S3 on 2', 'submitted', null, t.assignment(t.id('A'), 2));
set session_replication_role = origin;

create function pg_temp.login_id(who uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', who, 'role', 'authenticated')::text, false);
  set role authenticated;
end $$;
create function pg_temp.of(course text, n int) returns text language sql as $$
  select coalesce((select c.sent || ' of ' || c.listeners from assignment_sent_counts(array[t.id(course)]) c
    where c.assignment_id = t.assignment(t.id(course), n)), 'none') $$;
create function pg_temp.rows(courses uuid[]) returns bigint language sql as $$
  select count(*) from assignment_sent_counts(courses) $$;
grant execute on all functions in schema pg_temp to authenticated, anon;

-- Shape: integers, and nothing but the assignment id and the two counts.
select t.eq((select string_agg(format_type(t, null), ',') from unnest((select proallargtypes from pg_proc
  where proname = 'assignment_sent_counts')) t), 'uuid[],uuid,integer,integer', 'shape: uuid[] in; uuid, int, int out');
select t.eq((select count(*) from pg_proc where proname = 'assignment_sent_counts'), 1::bigint,
  'one function only (no per-course overload left callable)');

-- AC 2: each current listener who sent counts once, checked or not; homework on another assignment doesn't count.
select t.login('M');
select t.eq(pg_temp.of('A', 1), '2 of 4', 'AC2 S1 (checked) and S2 (sent) of 4 listeners; S3''s homework on 2 doesn''t count on 1');
select t.eq(pg_temp.of('A', 2), '1 of 4', 'AC2 S3 on assignment 2');
reset role;

-- AC 4, denied: a Rejected account gets nothing, even as a listener of A.
select pg_temp.login_id('00000000-0000-0000-0000-0000000130a1');
select t.eq(pg_temp.rows(array[t.id('A')]), 0::bigint, 'AC4 a Rejected account gets nothing');
reset role;

-- AC 4: a mixed request gives only what the caller may see.
select t.login('S2');
select t.eq(pg_temp.rows(array[t.id('A'), t.id('B')]), 5::bigint,
  'AC4 S2 (listener of A, not of hidden B) asking for A and B gets only A''s 5 rows');
reset role;
select t.login('M');
select t.eq(pg_temp.rows(array[t.id('B')]), 0::bigint, 'AC4 the owner of A gets nothing for N''s hidden course B');
reset role;
select t.login('S1');
select t.eq(pg_temp.rows(array[t.id('A'), t.id('B')]), 10::bigint, 'AC4 S1, a listener of A and of hidden B, gets both');
reset role;

-- Odd input: no rows, no error.
select t.login('T');
select t.eq(pg_temp.rows(array[]::uuid[]), 0::bigint, 'empty array: no rows');
select t.eq(pg_temp.rows(null), 0::bigint, 'null array: no rows');
select t.eq(pg_temp.rows(array['00000000-0000-0000-0000-00000000dead'::uuid]), 0::bigint, 'unknown course id: no rows');
reset role;

-- Edge: a deleted account is no longer counted, sent or total.
delete from auth.users where id = t.id('S2');
select t.login('M');
select t.eq(pg_temp.of('A', 1), '1 of 3', 'edge: S2''s account deleted: 1 of 3');
reset role;
