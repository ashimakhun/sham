-- ARU-31: new message counts for course chats. Rules under test: supabase/migrations/0016_chat_read_positions.sql.
-- Course A is owned by M with listeners S1 (student) and M2 (mentor); teacher T is in every chat. N (mentor, owns B)
-- and S2 (student) are not in A.
select t.seed();
insert into course_members (course_id, user_id, added_by) values
  (t.id('A'), t.id('S1'), t.id('M')),
  (t.id('A'), t.id('M2'), t.id('M'));

-- Messages before release, posted as the admin with times in the past.
insert into course_messages (id, course_id, author_id, body, created_at) values
  ('00000000-0000-0000-0000-00000000f001', t.id('A'), t.id('M'),  'old 1', now() - interval '3 hours'),
  ('00000000-0000-0000-0000-00000000f002', t.id('A'), t.id('S1'), 'old 2', now() - interval '2 hours');

-- AC 10 exception: the release seed sets everyone already in a chat to "read up to now".
select seed_course_chat_reads();
select t.eq((select count(*) from course_chat_reads where course_id = t.id('A')), 4::bigint,
  'seed: owner, both listeners and the teacher have a position for A');
select t.eq((select count(*) from course_chat_reads where course_id = t.id('B')), 2::bigint,
  'seed: owner and teacher have a position for B');
select t.ok(not exists (select 1 from course_chat_reads where user_id = t.id('S2')), 'seed: nobody outside a chat gets a row');
select t.ok((select bool_and(last_read_at > now() - interval '1 minute' and last_read_at <= now()) from course_chat_reads), 'seed: positions are the release time');
reset role; select t.login('S1');
select t.eq((select count(*) from chat_unread_counts()), 0::bigint, 'seed: existing chats show no count on release');

-- Move the release back 90 minutes (as the admin, past the guard trigger) so later messages can have past times.
reset role;
set session_replication_role = replica;
update course_chat_reads set last_read_at = now() - interval '90 minutes';
set session_replication_role = origin;
insert into course_messages (id, course_id, author_id, body, created_at) values
  ('00000000-0000-0000-0000-00000000f003', t.id('A'), t.id('M'),  'new 1', now() - interval '60 minutes'),
  ('00000000-0000-0000-0000-00000000f004', t.id('A'), t.id('M2'), 'new 2', now() - interval '50 minutes'),
  ('00000000-0000-0000-0000-00000000f005', t.id('A'), t.id('S1'), 'mine',  now() - interval '40 minutes');

-- AC 1 / AC 8: others' messages count, own messages never do.
select t.login('S1');
select t.eq((select unread from chat_unread_counts() where course_id = t.id('A')), 2::bigint,
  'AC8 S1: two new from others, own message not counted');
reset role; select t.login('M');
select t.eq((select unread from chat_unread_counts() where course_id = t.id('A')), 2::bigint, 'AC1 owner M: new 2 and mine count');
reset role; select t.login('T');
select t.eq((select unread from chat_unread_counts() where course_id = t.id('A')), 3::bigint, 'AC1 teacher: all three new count');

-- Access: non-participants get no counts and can't write positions.
reset role; select t.login('N');
select t.eq((select count(*) from chat_unread_counts() where course_id = t.id('A')), 0::bigint, 'roles: N (not in A) gets no count for A');
select t.throws($$select mark_chat_read('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-00000000f003')$$, '42501',
  'roles: N cannot mark A read');
select t.throws($$insert into course_chat_reads (course_id, user_id, last_read_at) values ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000b2', now())$$, '42501',
  'roles: N cannot insert a position for A');
reset role; select t.login('S2');
select t.eq((select count(*) from chat_unread_counts()), 0::bigint, 'roles: S2 (not in any chat) gets no counts');
select t.eq((select count(*) from course_chat_reads), 0::bigint, 'roles: S2 reads no positions');
reset role; select t.login(null);
select t.throws($$select * from chat_unread_counts()$$, '42501', 'roles: anon cannot get counts');
select t.throws($$select mark_chat_read('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-00000000f003')$$, '42501',
  'roles: anon cannot mark read');
select t.eq((select count(*) from course_chat_reads), 0::bigint, 'roles: anon reads no positions');

-- Own rows only.
reset role; select t.login('S1');
select t.eq((select count(*) from course_chat_reads), 1::bigint, 'roles: S1 sees only their own position');
select t.eq((select user_id from course_chat_reads), t.id('S1'), 'roles: and it is theirs');
select t.throws($$insert into course_chat_reads (course_id, user_id, last_read_at) values ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000c1', now())$$, '42501',
  'roles: S1 cannot insert a position for B (not in that chat)');
select t.eq(t.affected($$update course_chat_reads set last_read_at = now() + interval '1 hour' where user_id = '00000000-0000-0000-0000-0000000000b3'$$), 0::bigint,
  'roles: S1 cannot update M2''s position');
reset role; select t.login('M2');
select t.throws($$insert into course_chat_reads (course_id, user_id, last_read_at) values ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000c1', now())$$, '42501',
  'roles: M2 cannot insert a position for S1');

-- AC 5: marking read up to the newest shown message clears the count.
reset role; select t.login('S1');
select t.lives($$select mark_chat_read('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-00000000f005')$$, 'AC5 S1 opens the chat');
select t.eq((select count(*) from chat_unread_counts() where course_id = t.id('A')), 0::bigint, 'AC5 no new messages after reading');
select t.eq((select last_read_at from course_chat_reads where course_id = t.id('A')),
  (select created_at from course_messages where id = '00000000-0000-0000-0000-00000000f005'),
  'AC5 the position is the message''s server time');

-- Never moves backwards.
select t.lives($$select mark_chat_read('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-00000000f001')$$, 'marking an older message is accepted');
select t.eq((select last_read_at from course_chat_reads where course_id = t.id('A')),
  (select created_at from course_messages where id = '00000000-0000-0000-0000-00000000f005'),
  'the position did not move backwards');
select t.lives($$update course_chat_reads set last_read_at = now() - interval '1 day' where course_id = '00000000-0000-0000-0000-0000000000d1'$$,
  'a direct update to an older time');
select t.eq((select last_read_at from course_chat_reads where course_id = t.id('A')),
  (select created_at from course_messages where id = '00000000-0000-0000-0000-00000000f005'),
  'a direct update cannot move it backwards either');

-- Device clock: a time in the future is cut to the server's now().
select t.lives($$update course_chat_reads set last_read_at = now() + interval '1 year' where course_id = '00000000-0000-0000-0000-0000000000d1'$$,
  'a direct update to a future time');
select t.ok((select last_read_at <= now() from course_chat_reads where course_id = t.id('A')), 'a future time is never stored');
select t.throws($$select mark_chat_read('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000ff')$$, 'P0002',
  'an unknown message id is rejected');
reset role; select t.login('S1');
select t.throws($$select mark_chat_read('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-00000000f003')$$, '42501',
  'a message of A cannot be used to mark B');

-- AC 10: someone added after release has no position, so every message from others counts.
reset role; select t.login('M');
select t.lives($$insert into course_members (course_id, user_id, added_by) values ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000b1')$$,
  'AC10 add S2 to A');
reset role; select t.login('S2');
select t.eq((select unread from chat_unread_counts() where course_id = t.id('A')), 5::bigint, 'AC10 new listener: every message from others is new');

-- Removed and added back: the earlier position is kept.
reset role; select t.login('S2');
select t.lives($$select mark_chat_read('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-00000000f004')$$, 'S2 reads up to new 2');
reset role; select t.login('M');
select t.lives($$select remove_listener('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000c2')$$, 'remove S2');
reset role; select t.login('S2');
select t.eq((select count(*) from course_chat_reads), 0::bigint, 'removed: S2 can no longer see the position');
select t.eq((select count(*) from chat_unread_counts()), 0::bigint, 'removed: no counts');
reset role; select t.login('M');
select t.lives($$insert into course_members (course_id, user_id, added_by) values ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000b1')$$,
  'add S2 back');
reset role; select t.login('S2');
select t.eq((select unread from chat_unread_counts() where course_id = t.id('A')), 1::bigint, 'added back: only messages after the kept position count');

-- Course deleted: its positions go with it.
reset role;
delete from homework where course_id = t.id('A');
delete from courses where id = t.id('A');
select t.eq((select count(*) from course_chat_reads where course_id = t.id('A')), 0::bigint, 'deleting a course deletes its positions');
