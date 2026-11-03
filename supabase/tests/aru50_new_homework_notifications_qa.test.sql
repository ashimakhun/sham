-- QA ARU-50: gaps in aru50_new_homework_notifications.test.sql: the teacher assigning on a mentor's course (owner and
-- teacher left out), two assignments in one statement (one call per row), an update queuing nothing, a rolled-back
-- insert queuing nothing, empty Vault values, a secret with quotes kept exact in the header, the Content-Type header,
-- a renamed course (title at processing time) and a deleted course (nothing found).
-- Fixture (t.seed): course A owned by mentor M, B by mentor N; teacher T. Listeners of A here: S1 (student), M2 (mentor).
select t.seed();

create function t.x(name text) returns uuid language sql immutable as $$ select md5('aru50qa-' || name)::uuid $$;
insert into course_members (course_id, user_id, added_by) values
  (t.id('A'), t.id('S1'), t.id('M')),
  (t.id('A'), t.id('M2'), t.id('M'));
insert into courses (id, title, created_by) values (t.x('Z'), 'Doomed', t.id('N'));
insert into course_members (course_id, user_id, added_by) values (t.x('Z'), t.id('S2'), t.id('N'));
insert into course_meetings (id, course_id, starts_at, topic, status, created_by)
  select t.x(m), c, now() - interval '1 day', 'Topic ' || m, 'completed', o
  from (values ('C1', t.id('A'), t.id('M')), ('C2', t.id('A'), t.id('M')), ('C3', t.id('A'), t.id('M')),
               ('C4', t.id('A'), t.id('M')), ('C5', t.id('A'), t.id('M')), ('Z1', t.x('Z'), t.id('N'))) v (m, c, o);

create function t.bot() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', false);
  set role service_role;
end $$;
grant usage on schema t to service_role;
create function t.assign(hw text, meeting text, course uuid, who text) returns text language sql as $$
  select format($f$insert into homework_assignments (id, meeting_id, course_id, title, created_by)
    values (%L, %L, %L, 'Exercises', %L)$f$, t.x(hw), t.x(meeting), course, t.id(who))
$$;
create function t.recipients(hw text) returns text language sql as $$
  select coalesce(max(x.course_title), '') || ':' || coalesce(string_agg(x.k, ',' order by x.k), '')
  from (
    select r.course_title,
      coalesce((select k from unnest(array['S1','S2','S3','M','M2','N','T']) k where t.id(k) = r.user_id), '?') as k
    from new_homework_recipients(t.x(hw)) r
  ) x
$$;
create function t.calls() returns bigint language sql security definer as $$ select count(*) from net.requests $$;
grant execute on all functions in schema t to anon, authenticated, service_role;

-- Empty Vault values count as missing.
insert into vault.decrypted_secrets values ('new_homework_notify_url', ''), ('new_homework_notify_secret', 's');
select t.login('M');
select t.lives(t.assign('E1', 'C1', t.id('A'), 'M'), 'AC7 assigns with an empty URL in Vault');
reset role;
select t.eq(t.calls(), 0::bigint, 'AC8 empty URL → no call');
update vault.decrypted_secrets set decrypted_secret = 'https://fn.test/x' where name = 'new_homework_notify_url';
update vault.decrypted_secrets set decrypted_secret = '' where name = 'new_homework_notify_secret';
select t.login('M');
select t.lives(t.assign('E2', 'C2', t.id('A'), 'M'), 'AC7 assigns with an empty secret in Vault');
reset role;
select t.eq(t.calls(), 0::bigint, 'AC8 empty secret → no call');

-- A secret with quotes and a backslash is sent exactly; Content-Type is JSON.
update vault.decrypted_secrets set decrypted_secret = $s$a"b\c'd$s$ where name = 'new_homework_notify_secret';
select t.login('T');
select t.lives(t.assign('HT', 'C3', t.id('A'), 'T'), 'AC1 the teacher assigns on mentor M''s course');
reset role;
select t.eq(t.calls(), 1::bigint, 'AC8 one call for the teacher''s assignment');
select t.eq((select headers ->> 'Authorization' from net.requests), $s$Bearer a"b\c'd$s$, 'AC8 secret with quotes sent exactly');
select t.eq((select headers ->> 'Content-Type' from net.requests), 'application/json', 'AC8 Content-Type is application/json');

-- AC 2: teacher-assigned on A → A's listeners only; not the owner M, not the teacher.
select t.bot();
select t.eq(t.recipients('HT'), 'Algebra:M2,S1', 'AC2 teacher assigns on A: owner M and teacher T left out');
reset role;

-- AC 4: an update queues nothing (only inserts fire).
update homework_assignments set title = 'Renamed' where id = t.x('HT');
select t.eq(t.calls(), 1::bigint, 'AC4 an update of the row queues no call');

-- AC 4: an insert rolled back with its transaction queues nothing.
select t.login('M');
do $$
begin
  insert into homework_assignments (id, meeting_id, course_id, title, created_by)
    values (t.x('RB'), t.x('C4'), t.id('A'), 'Exercises', t.id('M'));
  raise exception 'roll back';
exception when others then null;
end $$;
reset role;
select t.ok(not exists (select 1 from homework_assignments where id = t.x('RB')), 'AC4 rolled-back assignment not saved');
select t.eq(t.calls(), 1::bigint, 'AC4 rolled-back insert queues no call');

-- AC 10 / AC 8 "for each row": two assignments in one statement → two calls, each with its own id.
select t.login('T');
select t.lives(format($f$insert into homework_assignments (id, meeting_id, course_id, title, created_by) values
  (%L, %L, %L, 'One', %L), (%L, %L, %L, 'Two', %L)$f$,
  t.x('M1'), t.x('C4'), t.id('A'), t.id('T'), t.x('M2'), t.x('C5'), t.id('A'), t.id('T')),
  'AC10 two assignments in one statement');
reset role;
select t.eq(t.calls(), 3::bigint, 'AC10 one call per inserted row');
select t.eq((select array_agg(body ->> 'assignment_id' order by id) from net.requests where id > 1),
  array[t.x('M1')::text, t.x('M2')::text], 'AC10 each call carries its own assignment id');

-- Edge: the course renamed before processing → the new title.
update courses set title = 'Algebra II *_<b>' where id = t.id('A');
select t.bot();
select t.eq(t.recipients('M1'), 'Algebra II *_<b>:M2,S1', 'edge course renamed → title at processing time, as typed');
reset role;

-- Edge: the course deleted before processing → the assignment is gone, nothing found.
select t.login('N');
select t.lives(t.assign('HZ', 'Z1', t.x('Z'), 'N'), 'AC1 owner N assigns on Z');
reset role;
select t.bot();
select t.eq(t.recipients('HZ'), 'Doomed:S2', 'AC2 Z''s listener before deletion');
reset role;
delete from courses where id = t.x('Z');
select t.bot();
select t.eq(t.recipients('HZ'), ':', 'edge course deleted → nothing found');
reset role;
