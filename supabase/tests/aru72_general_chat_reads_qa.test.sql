-- QA ARU-72: gaps in aru72_general_chat_reads.test.sql: an empty chat, a message from a declined author still counts,
-- a role switch keeps the position, reading a course chat never moves the general position (and the reverse), a
-- declined then re-accepted account gets its old position back, and deleting an account removes its position.
select t.seed();
insert into course_members (course_id, user_id, added_by) values (t.id('A'), t.id('S1'), t.id('M'));
insert into auth.users (id, email, raw_user_meta_data) values ('00000000-0000-0000-0000-0000000072b1', 'x@x.test', '{"full_name":"Xena"}');
update profiles set access_status = 'approved' where id = '00000000-0000-0000-0000-0000000072b1';
select seed_general_chat_reads();
-- Start everyone two hours back, so messages can be placed in between (as the admin, past the guard trigger).
set session_replication_role = replica;
update general_chat_reads set last_read_at = now() - interval '2 hours';
set session_replication_role = origin;

-- Empty chat: 0.
select t.login('S1');
select t.eq(general_chat_unread_count(), 0::bigint, 'edge: an empty general chat counts 0');
reset role;

-- X posts, then is declined: the message still counts for others.
insert into general_messages (id, author_id, body, created_at) values
  ('00000000-0000-0000-0000-0000000072e1', '00000000-0000-0000-0000-0000000072b1', 'from X', now() - interval '60 minutes');
update profiles set access_status = 'rejected' where id = '00000000-0000-0000-0000-0000000072b1';
select t.login('S1');
select t.eq(general_chat_unread_count(), 1::bigint, 'edge: a message from a since-declined author still counts');

-- Reading a course chat doesn't touch the general position, and the reverse.
reset role;
insert into course_messages (id, course_id, author_id, body, created_at) values
  ('00000000-0000-0000-0000-0000000072c1', t.id('A'), t.id('M'), 'course', now() - interval '50 minutes');
select t.login('S1');
select t.lives(format('select mark_chat_read(%L, %L)', t.id('A'), '00000000-0000-0000-0000-0000000072c1'), 'S1 reads course A''s chat');
select t.eq(general_chat_unread_count(), 1::bigint, 'AC11 reading a course chat leaves the general count');
select t.lives($$select mark_general_chat_read('00000000-0000-0000-0000-0000000072e1')$$, 'S1 reads the general chat');
select t.eq(general_chat_unread_count(), 0::bigint, 'AC4 general count cleared');
select t.ok(not exists (select 1 from chat_unread_counts() where course_id = t.id('A')), 'AC11 course A still read');
reset role;
insert into course_messages (id, course_id, author_id, body) values ('00000000-0000-0000-0000-0000000072c2', t.id('A'), t.id('M'), 'new course msg');
select t.login('S1');
select t.eq(general_chat_unread_count(), 0::bigint, 'AC11 a course message never changes the general count');

-- A role switch keeps the position.
select t.login('T');
select t.lives(format('select set_user_role(%L, %L)', t.id('S1'), 'mentor'), 'S1 becomes a mentor');
select t.login('S1');
select t.eq(general_chat_unread_count(), 0::bigint, 'edge: the role switch keeps the position');
reset role;

-- S2 is declined after reading, then accepted again: the old position comes back.
select t.login('S2');
select t.lives($$select mark_general_chat_read('00000000-0000-0000-0000-0000000072e1')$$, 'S2 reads');
reset role;
update profiles set access_status = 'rejected' where id = t.id('S2');
insert into general_messages (id, author_id, body, created_at) values
  ('00000000-0000-0000-0000-0000000072e2', t.id('M'), 'while S2 was declined', now() - interval '10 minutes');
update profiles set access_status = 'approved' where id = t.id('S2');
select t.login('S2');
select t.eq(general_chat_unread_count(), 1::bigint, 'edge: re-accepted, S2 keeps the old position (only the later message counts)');
reset role;

-- Deleting an account removes its position.
delete from auth.users where id = t.id('S3');
select t.eq((select count(*) from general_chat_reads where user_id = t.id('S3')), 0::bigint, 'data: a deleted account''s position goes too');
