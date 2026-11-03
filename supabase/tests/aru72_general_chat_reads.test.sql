-- ARU-72: new message count for the general chat. Rules under test: supabase/migrations/0034_general_chat_reads.sql.
-- Fixture: teacher T, mentors M / N / M2, students S1 / S2 / S3 (all approved). P is waiting for approval, D declined.
select t.seed();
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000072a1', 'p72@x.test', '{"full_name":"Pending Pat"}'),
  ('00000000-0000-0000-0000-0000000072a2', 'd72@x.test', '{"full_name":"Declined Dee"}');
update profiles set access_status = 'rejected' where id = '00000000-0000-0000-0000-0000000072a2';

create function pg_temp.as_user(id text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', id, 'role', 'authenticated')::text, false);
  execute 'set role authenticated';
end $$;

-- Data: table with RLS, no delete policy.
select t.ok(exists (select 1 from pg_class where relname = 'general_chat_reads' and relrowsecurity), 'data: table exists with RLS on');
select t.eq((select count(*) from pg_policies where tablename = 'general_chat_reads' and cmd in ('DELETE', 'ALL')), 0::bigint,
  'data: no delete policy');

-- Messages before release, posted as the admin with past times.
insert into general_messages (id, author_id, body, created_at) values
  ('00000000-0000-0000-0000-0000000072f1', t.id('M'),  'old 1', now() - interval '3 hours'),
  ('00000000-0000-0000-0000-0000000072f2', t.id('S1'), 'old 2', now() - interval '2 hours');

-- AC 9: the release seed gives every approved account (only them) "read up to now".
select seed_general_chat_reads();
select t.eq((select count(*) from general_chat_reads), 7::bigint, 'AC9 seed: one row per approved account');
select t.ok(not exists (select 1 from general_chat_reads where user_id in
  ('00000000-0000-0000-0000-0000000072a1', '00000000-0000-0000-0000-0000000072a2')), 'AC9 seed: waiting / declined get no row');
select t.ok((select bool_and(last_read_at > now() - interval '1 minute' and last_read_at <= now()) from general_chat_reads),
  'AC9 seed: positions are the release time');
select seed_general_chat_reads();
select t.eq((select count(*) from general_chat_reads), 7::bigint, 'AC9 seed: running it again changes nothing');
select t.login('S1');
select t.eq(general_chat_unread_count(), 0::bigint, 'AC9 no count on release');

-- Move the release back 90 minutes (as the admin, past the guard trigger) so later messages can have past times.
reset role;
set session_replication_role = replica;
update general_chat_reads set last_read_at = now() - interval '90 minutes';
set session_replication_role = origin;
insert into general_messages (id, author_id, body, created_at) values
  ('00000000-0000-0000-0000-0000000072f3', t.id('M'),  'new 1', now() - interval '60 minutes'),
  ('00000000-0000-0000-0000-0000000072f4', t.id('T'),  'new 2', now() - interval '50 minutes'),
  ('00000000-0000-0000-0000-0000000072f5', t.id('S1'), 'mine',  now() - interval '40 minutes'),
  ('00000000-0000-0000-0000-0000000072f6', '00000000-0000-0000-0000-0000000072a2', 'from declined', now() - interval '30 minutes');

-- AC 1 / AC 7: others' messages count (a declined author's too), own messages never do.
select t.login('S1');
select t.eq(general_chat_unread_count(), 3::bigint, 'AC7 S1: three from others, own message not counted');
select t.login('M');
select t.eq(general_chat_unread_count(), 3::bigint, 'AC1 mentor: own message not counted');
select t.login('T');
select t.eq(general_chat_unread_count(), 3::bigint, 'AC1 teacher: own message not counted');
select t.login('S2');
select t.eq(general_chat_unread_count(), 4::bigint, 'AC1 student S2: all four new count');

-- AC 11: course chat counts are separate.
select t.eq((select count(*) from chat_unread_counts()), 0::bigint, 'AC11 general messages never make a course count');

-- Access: own row only.
select t.login('S1');
select t.eq((select count(*) from general_chat_reads), 1::bigint, 'roles: S1 sees only their own position');
select t.eq((select user_id from general_chat_reads), t.id('S1'), 'roles: and it is theirs');
select t.eq(t.affected($$update general_chat_reads set last_read_at = now() where user_id = '00000000-0000-0000-0000-0000000000c2'$$), 0::bigint,
  'roles: S1 cannot update S2''s position');
select t.eq(t.affected($$delete from general_chat_reads$$), 0::bigint, 'roles: no one can delete a position');
reset role;
select t.eq((select count(*) from general_chat_reads), 7::bigint, 'roles: nothing was deleted');
select t.login('S1');
select t.lives($$update general_chat_reads set user_id = '00000000-0000-0000-0000-0000000000c3'$$, 'an update naming another user');
reset role;
select t.ok(exists (select 1 from general_chat_reads where user_id = t.id('S1')), 'roles: user_id cannot be changed');

-- A new account approved later, without a row: inserting someone else's row is refused.
update profiles set access_status = 'approved' where id = '00000000-0000-0000-0000-0000000072a1';
select pg_temp.as_user('00000000-0000-0000-0000-0000000072a1');
select t.eq(general_chat_unread_count(), 6::bigint, 'AC9 approved after release: every message from others counts');
select t.throws($$insert into general_chat_reads (user_id, last_read_at) values ('00000000-0000-0000-0000-0000000000c1', now())$$, '42501',
  'roles: cannot insert a position for someone else');
select t.lives($$insert into general_chat_reads (user_id, last_read_at) values ('00000000-0000-0000-0000-0000000072a1', now() - interval '45 minutes')$$,
  'roles: an approved user can insert their own position');
select t.eq(general_chat_unread_count(), 2::bigint, 'own inserted position counts only later messages');
reset role;
update profiles set access_status = 'pending' where id = '00000000-0000-0000-0000-0000000072a1';

-- Waiting and declined accounts: no data, can't mark read or write a position.
select pg_temp.as_user('00000000-0000-0000-0000-0000000072a1');
select t.eq(general_chat_unread_count(), 0::bigint, 'roles: waiting account gets 0');
select t.eq((select count(*) from general_chat_reads), 0::bigint, 'roles: waiting account reads no position (even its own)');
select t.throws($$select mark_general_chat_read('00000000-0000-0000-0000-0000000072f3')$$, '42501', 'roles: waiting account cannot mark read');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000072a2');
select t.eq(general_chat_unread_count(), 0::bigint, 'roles: declined account gets 0');
select t.throws($$select mark_general_chat_read('00000000-0000-0000-0000-0000000072f3')$$, '42501', 'roles: declined account cannot mark read');
select t.throws($$insert into general_chat_reads (user_id, last_read_at) values ('00000000-0000-0000-0000-0000000072a2', now())$$, '42501',
  'roles: declined account cannot insert a position');
reset role;

-- Signed out.
select t.login(null);
select t.throws($$select general_chat_unread_count()$$, '42501', 'roles: anon cannot get the count');
select t.throws($$select mark_general_chat_read('00000000-0000-0000-0000-0000000072f3')$$, '42501', 'roles: anon cannot mark read');
select t.eq((select count(*) from general_chat_reads), 0::bigint, 'roles: anon reads no positions');
reset role;

-- AC 4: marking read up to the newest shown message clears the count, at that message's server time.
select t.login('S2');
select t.lives($$select mark_general_chat_read('00000000-0000-0000-0000-0000000072f6')$$, 'AC4 S2 opens the chat');
select t.eq(general_chat_unread_count(), 0::bigint, 'AC4 no new messages after reading');
select t.eq((select last_read_at from general_chat_reads),
  (select created_at from general_messages where id = '00000000-0000-0000-0000-0000000072f6'), 'AC4 the position is the message''s server time');

-- Never moves backwards, never in the future.
select t.lives($$select mark_general_chat_read('00000000-0000-0000-0000-0000000072f1')$$, 'marking an older message is accepted');
select t.eq((select last_read_at from general_chat_reads),
  (select created_at from general_messages where id = '00000000-0000-0000-0000-0000000072f6'), 'the position did not move backwards');
select t.lives($$update general_chat_reads set last_read_at = now() - interval '1 day'$$, 'a direct update to an older time');
select t.eq((select last_read_at from general_chat_reads),
  (select created_at from general_messages where id = '00000000-0000-0000-0000-0000000072f6'), 'a direct update cannot move it backwards');
select t.lives($$update general_chat_reads set last_read_at = now() + interval '1 year'$$, 'a direct update to a future time');
select t.ok((select last_read_at <= now() from general_chat_reads), 'a future time is never stored');
select t.throws($$select mark_general_chat_read('00000000-0000-0000-0000-0000000072ff')$$, 'P0002', 'an unknown message id is rejected');
reset role;

-- A first position from mark_general_chat_read (no row yet) is created. S3's seeded row is removed by the admin.
delete from general_chat_reads where user_id = t.id('S3');
select t.login('S3');
select t.eq(general_chat_unread_count(), 6::bigint, 'no row: every message from others counts');
select t.lives($$select mark_general_chat_read('00000000-0000-0000-0000-0000000072f4')$$, 'S3 reads up to new 2');
select t.eq(general_chat_unread_count(), 2::bigint, 'S3: only the two later messages count');
reset role;

-- AC 11: a course chat message never changes the general count.
insert into course_messages (id, course_id, author_id, body) values
  ('00000000-0000-0000-0000-0000000072c1', t.id('A'), t.id('M'), 'course msg');
select t.login('S2');
select t.eq(general_chat_unread_count(), 0::bigint, 'AC11 a course message does not change the general count');
reset role;
