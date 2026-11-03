-- QA ARU-89: gaps in aru89_homework_submitted_notifications.test.sql: empty Vault values skip the call, two homework
-- rows in one statement queue two calls, a refused submit (not a listener) queues nothing, a sender who is no longer
-- Approved still gets the owner notified while the homework exists, the sender who deleted the homework (via removal)
-- leaves nothing, and only one row ever comes back (one owner).
select t.seed();
select t.make_assignments(t.id('A'));
insert into course_members (course_id, user_id, added_by) values
  (t.id('A'), t.id('S1'), t.id('M')),
  (t.id('A'), t.id('S2'), t.id('M'));

create function t.hid(name text) returns uuid language sql immutable as $$ select md5('aru89qa-' || name)::uuid $$;
create function t.calls() returns bigint language sql security definer as $$ select count(*) from net.requests $$;
grant usage on schema t to service_role;
grant execute on all functions in schema t to anon, authenticated, service_role;
create function t.rows(hw uuid) returns bigint language plpgsql as $$
declare
  n bigint;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', false);
  set role service_role;
  select count(*) into n from homework_submitted_recipient(hw) r where r.user_id = t.id('M');
  reset role;
  return n;
end $$;
grant execute on function t.rows(uuid) to service_role;

-- Empty strings in Vault are treated as missing.
insert into vault.decrypted_secrets (name, decrypted_secret)
  values ('homework_submitted_notify_url', ''), ('homework_submitted_notify_secret', '');
select t.login('S1');
select t.lives(format('insert into homework (id, student_id, course_id, title, assignment_id) values (%L, %L, %L, %L, %L)',
  t.hid('e1'), t.id('S1'), t.id('A'), 'e1', t.assignment(t.id('A'), 1)), 'AC7 S1 submits with empty Vault values');
reset role;
select t.eq(t.calls(), 0::bigint, 'AC8 empty URL and secret: no call');
update vault.decrypted_secrets set decrypted_secret = 'https://x.supabase.co/functions/v1/homework-submitted-notifications'
  where name = 'homework_submitted_notify_url';
update vault.decrypted_secrets set decrypted_secret = 'k3y' where name = 'homework_submitted_notify_secret';

-- A refused submit (S3 isn't a listener of A) queues nothing.
select t.login('S3');
select t.throws(format('insert into homework (id, student_id, course_id, title, assignment_id) values (%L, %L, %L, %L, %L)',
  t.hid('x'), t.id('S3'), t.id('A'), 'x', t.assignment(t.id('A'), 2)), '42501', 'a non-listener can''t submit');
reset role;
select t.eq(t.calls(), 0::bigint, 'AC6 a refused submit queues nothing');

-- Two rows in one statement (as the admin): two calls, each with its own id.
insert into homework (id, student_id, course_id, title, assignment_id) values
  (t.hid('m1'), t.id('S1'), t.id('A'), 'm1', t.assignment(t.id('A'), 2)),
  (t.hid('m2'), t.id('S2'), t.id('A'), 'm2', t.assignment(t.id('A'), 2));
select t.eq(t.calls(), 2::bigint, 'AC3 two rows in one statement: two calls');
select t.eq((select array_agg(body ->> 'homework_id' order by body ->> 'homework_id') from net.requests),
  (select array_agg(x::text order by x::text) from unnest(array[t.hid('m1'), t.hid('m2')]) x), 'AC3 each call has its own id');
select t.ok((select bool_and(headers ->> 'Authorization' = 'Bearer k3y' and timeout_milliseconds = 5000) from net.requests),
  'AC8 each call: bearer secret and 5 s timeout');

-- One owner, one row.
select t.eq(t.rows(t.hid('m1')), 1::bigint, 'AC2 exactly one row: the owner');

-- The sender's account is declined after submitting: the owner is still told (the rule is about the owner).
update profiles set access_status = 'rejected' where id = t.id('S2');
select t.eq(t.rows(t.hid('m2')), 1::bigint, 'AC5 a sender declined after submitting: the owner still gets it');

-- The sender is removed from the course (remove_listener deletes their homework): nothing is left to send.
select t.login('M');
select t.lives(format('select remove_listener(%L, %L)', t.id('A'), t.id('S1')), 'the owner removes S1');
reset role;
select t.eq(t.rows(t.hid('m1')), 0::bigint, 'AC5 sender removed before processing: nothing');
