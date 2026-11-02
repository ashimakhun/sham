-- QA ARU-67: gaps in aru61_general_chat.test.sql: every role (teacher and mentor too), anon, a post without an id,
-- the time can't be changed afterwards (update or upsert), and the ARU-31 unread counts still work with server times.
select t.seed();
insert into course_members (course_id, user_id, added_by) values (t.id('A'), t.id('S1'), t.id('M'));

-- Every role is held to the server time, in both chats.
select t.login('T');
select t.throws($$insert into general_messages (author_id, body, created_at) values (auth.uid(), 'x', '2099-01-01')$$, '42501',
  'teacher: a chosen time is refused in the general chat');
select t.throws(format('insert into course_messages (course_id, author_id, body, created_at) values (%L, auth.uid(), %L, %L)',
  t.id('A'), 'x', '2099-01-01'), '42501', 'teacher: a chosen time is refused in the course chat');
select t.login('M');
select t.throws(format('insert into course_messages (course_id, author_id, body, created_at) values (%L, auth.uid(), %L, now())',
  t.id('A'), 'x'), '42501', 'owner mentor: naming created_at at all (even now()) is refused');

-- Anon still can't post.
reset role;
set role anon;
select t.throws($$insert into general_messages (author_id, body) values ('00000000-0000-0000-0000-000000000000', 'x')$$, '42501',
  'anon can''t post in the general chat');
reset role;

-- A post without an id still gets one (id keeps its default).
select t.login('S1');
select t.lives($$insert into general_messages (author_id, body) values (auth.uid(), 'no id')$$, 'a post without an id works');
select t.lives(format('insert into course_messages (id, course_id, author_id, body) values (%L, %L, auth.uid(), %L)',
  '00000000-0000-0000-0000-0000000067a1', t.id('A'), 'from S1'), 'S1 posts in course A the app''s way');

-- The time can't be changed afterwards, by update or by an upsert on the same id.
select t.eq(t.affected($$update general_messages set created_at = '2099-01-01' where author_id = auth.uid()$$), 0::bigint,
  'an own general message can''t be re-dated');
select t.eq(t.affected($$update course_messages set created_at = '2099-01-01' where author_id = auth.uid()$$), 0::bigint,
  'an own course message can''t be re-dated');
select t.throws(format('insert into course_messages (id, course_id, author_id, body) values (%L, %L, auth.uid(), %L)
  on conflict (id) do update set body = excluded.body', '00000000-0000-0000-0000-0000000067a1', t.id('A'), 'edited'), '42501',
  'an upsert on an existing message is refused (no edit)');
reset role;
select t.ok(not exists (select 1 from general_messages where created_at > now() + interval '1 minute')
  and not exists (select 1 from course_messages where created_at > now() + interval '1 minute'), 'no message is dated in the future');
select t.eq((select body from course_messages where id = '00000000-0000-0000-0000-0000000067a1'), 'from S1', 'the message is unchanged');

-- ARU-31 counts still work: the owner sees 1 new message, marks it read, then sees none.
select t.login('M');
select t.eq((select unread from chat_unread_counts() where course_id = t.id('A')), 1::bigint, 'ARU-31 the owner sees 1 new message');
select t.lives(format('select mark_chat_read(%L, %L)', t.id('A'), '00000000-0000-0000-0000-0000000067a1'), 'ARU-31 marks it read');
select t.ok(not exists (select 1 from chat_unread_counts() where course_id = t.id('A')), 'ARU-31 and then has none');
reset role;
