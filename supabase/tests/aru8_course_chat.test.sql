-- ARU-8: course chat for the owner, listeners and the teacher. Rules under test: supabase/migrations/0006_course_chat.sql.
-- TEST DESIGN users mapped onto the shared seed: owner M of course A; N is a mentor not in A (owns B);
-- listeners S1 (student) and M2 (mentor) of A; S2 a student not in A; teacher T.
select t.seed();
insert into course_members (course_id, user_id, added_by) values
  (t.id('A'), t.id('S1'), t.id('M')),
  (t.id('A'), t.id('M2'), t.id('M'));

-- AC 1 / roles: owner, listeners and teacher post and read.
select t.login('M');
select t.lives($$insert into course_messages (id, course_id, author_id, body) values ('00000000-0000-0000-0000-00000000f001', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000b1', 'Welcome')$$,
  'AC1 owner posts');
reset role; select t.login('S1');
select t.lives($$insert into course_messages (course_id, author_id, body) values ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000c1', 'Hi')$$,
  'AC1 student listener posts');
reset role; select t.login('M2');
select t.lives($$insert into course_messages (course_id, author_id, body) values ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000b3', 'Mentor listener here')$$,
  'AC1 mentor listener posts');
reset role; select t.login('T');
select t.lives($$insert into course_messages (course_id, author_id, body) values ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000a1', 'Teacher here')$$,
  'AC1 teacher posts in a course they neither own nor attend');
select t.eq((select count(*) from course_messages where course_id = t.id('A')), 4::bigint, 'AC1 teacher reads the chat');
reset role; select t.login('S1');
select t.eq((select count(*) from course_messages where course_id = t.id('A')), 4::bigint, 'AC1 listener reads the chat');

-- AC 2: outsiders can neither read nor post; listeners of A can't use B's chat.
reset role; select t.login('N');
select t.eq((select count(*) from course_messages where course_id = t.id('A')), 0::bigint, 'AC2 mentor not in the course reads nothing');
select t.throws($$insert into course_messages (course_id, author_id, body) values ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000b2', 'let me in')$$, '42501',
  'AC2 mentor not in the course cannot post');
reset role; select t.login('S2');
select t.eq((select count(*) from course_messages), 0::bigint, 'AC2 student not in the course reads nothing');
select t.throws($$insert into course_messages (course_id, author_id, body) values ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000c2', 'let me in')$$, '42501',
  'AC2 student not in the course cannot post');
reset role; select t.login('S1');
select t.throws($$insert into course_messages (course_id, author_id, body) values ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000c1', 'wrong course')$$, '42501',
  'AC2 a listener of A cannot post in B');
reset role; select t.login(null);
select t.eq((select count(*) from course_messages), 0::bigint, 'roles: anon reads nothing');
select t.throws($$select in_course_chat('00000000-0000-0000-0000-0000000000d1')$$, '42501', 'roles: anon cannot execute in_course_chat');

-- Everyone: no impersonation, no edit, no delete.
reset role; select t.login('S1');
select t.throws($$insert into course_messages (course_id, author_id, body) values ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000b1', 'I am M')$$, '42501',
  'roles: cannot post as someone else');
select t.eq(t.affected($$update course_messages set body = 'edited'$$), 0::bigint, 'roles: messages cannot be edited');
reset role; select t.login('M');
select t.eq(t.affected($$delete from course_messages$$), 0::bigint, 'roles: even the owner cannot delete messages');

-- AC 5: blank and too-long messages are rejected; exactly 2000 characters is fine.
select t.throws($$insert into course_messages (course_id, author_id, body) values ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000b1', '   ')$$, '23514',
  'AC5 spaces-only message is rejected');
select t.throws($$insert into course_messages (course_id, author_id, body) values ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000b1', repeat('x', 2001))$$, '23514',
  'AC5 2001 characters are rejected');
select t.lives($$insert into course_messages (course_id, author_id, body) values ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000b1', repeat('x', 2000))$$,
  'AC5 exactly 2000 characters are accepted');

-- AC 6: retrying with the same client id cannot post twice.
select t.throws($$insert into course_messages (id, course_id, author_id, body) values ('00000000-0000-0000-0000-00000000f001', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000b1', 'Welcome')$$, '23505',
  'AC6 a retry with the same id is rejected as a duplicate');

-- AC 8 / AC 11: a removed listener loses access at once; their messages stay for the others.
select t.lives($$select remove_listener('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000c1')$$, 'AC8 owner removes S1');
reset role; select t.login('S1');
select t.eq((select count(*) from course_messages where course_id = t.id('A')), 0::bigint, 'AC8 removed listener reads nothing');
select t.throws($$insert into course_messages (course_id, author_id, body) values ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000c1', 'still here?')$$, '42501',
  'AC8 removed listener cannot post');
reset role; select t.login('M2');
select t.ok(exists (select 1 from course_messages where author_id = t.id('S1')), 'AC11 the removed listener''s message is still shown to others');

-- AC 9: a newly added listener sees the full history.
reset role; select t.login('M');
select t.lives($$insert into course_members (course_id, user_id, added_by) values ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000b1')$$,
  'AC9 add S2 to A');
reset role; select t.login('S2');
select t.eq((select count(*) from course_messages where course_id = t.id('A')), 5::bigint, 'AC9 new listener sees all earlier messages');

-- AC 10: chat follows the current owner (simulates ARU-9's owner change as the admin).
reset role;
update courses set created_by = t.id('N') where id = t.id('A');
select t.login('N');
select t.eq((select count(*) from course_messages where course_id = t.id('A')), 5::bigint, 'AC10 new owner reads the chat');
reset role; select t.login('M');
select t.eq((select count(*) from course_messages where course_id = t.id('A')), 0::bigint, 'AC10 former owner (not a listener) loses access');
reset role;
update courses set created_by = t.id('M') where id = t.id('A');

-- AC 7: paging newest-first with a stable (created_at, id) cursor.
insert into course_messages (course_id, author_id, body, created_at)
  select t.id('A'), t.id('M'), 'bulk ' || g, now() + g * interval '1 second' from generate_series(1, 120) g;
select t.login('M');
select t.eq((select count(*) from (select 1 from course_messages where course_id = t.id('A') order by created_at desc, id desc limit 50) x), 50::bigint,
  'AC7 the first page has 50 messages');

-- Data checks.
reset role;
select t.ok((select relrowsecurity from pg_class where oid = 'public.course_messages'::regclass), 'data: RLS is on');
select t.ok(exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'course_messages'), 'data: course_messages is published for realtime');
select t.ok(not exists (select 1 from pg_policies where tablename = 'course_messages' and cmd in ('UPDATE', 'DELETE', 'ALL')), 'data: no update or delete policy');
select t.ok(exists (select 1 from pg_indexes where tablename = 'course_messages' and indexname = 'course_messages_course_idx'), 'data: (course_id, created_at desc) index exists');
insert into courses (id, title, created_by) values ('00000000-0000-0000-0000-0000000000d4', 'Temp', t.id('M'));
insert into course_messages (course_id, author_id, body) values ('00000000-0000-0000-0000-0000000000d4', t.id('M'), 'bye');
delete from courses where id = '00000000-0000-0000-0000-0000000000d4';
select t.ok(not exists (select 1 from course_messages where course_id = '00000000-0000-0000-0000-0000000000d4'), 'data: deleting a course deletes its chat');
