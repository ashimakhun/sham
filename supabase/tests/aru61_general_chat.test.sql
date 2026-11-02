-- ARU-61: the general chat. Rules under test: supabase/migrations/0029_general_chat.sql.
-- Fixture: teacher T, mentors M / N / M2, students S1 / S2 / S3 (all approved). P signs up later and stays pending
-- until the teacher accepts them; D is declined.
select t.seed();
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000061a1', 'p@x.test', '{"full_name":"Pending Pat"}'),
  ('00000000-0000-0000-0000-0000000061a2', 'd@x.test', '{"full_name":"Declined Dee"}');
update profiles set access_status = 'rejected' where id = '00000000-0000-0000-0000-0000000061a2';

create function pg_temp.as_user(id text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', id, 'role', 'authenticated')::text, false);
  execute 'set role authenticated';
end $$;
create function pg_temp.post(id text, author text, body text) returns text language sql as $$
  select format('insert into general_messages (id, author_id, body) values (%L, %L, %L)', id, author, body)
$$;

-- Data: the table, its body rule, index, RLS and realtime.
select t.ok(exists (select 1 from pg_class where relname = 'general_messages' and relrowsecurity), 'data: table exists with RLS on');
select t.ok(exists (select 1 from pg_indexes where indexname = 'general_messages_created_idx'), 'data: index on (created_at desc, id desc)');
select t.ok(exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'general_messages'),
  'data: in the realtime publication');
select t.eq((select count(*) from pg_policies where tablename = 'general_messages' and cmd in ('UPDATE', 'DELETE', 'ALL')), 0::bigint,
  'data: no update or delete policy');

-- AC 2 / AC 3: every approved role posts as themselves and reads everyone's messages.
select t.login('S1');
select t.lives(pg_temp.post('00000000-0000-0000-0000-0000000061f1', t.id('S1')::text, 'Hi from Sam'), 'AC3 student posts');
select t.login('M');
select t.lives(pg_temp.post('00000000-0000-0000-0000-0000000061f2', t.id('M')::text, 'Hi from Max'), 'AC3 mentor posts');
select t.login('T');
select t.lives(pg_temp.post('00000000-0000-0000-0000-0000000061f3', t.id('T')::text, 'Hi from Tess'), 'AC3 teacher posts');
select t.login('S2');
select t.eq((select count(*) from general_messages), 3::bigint, 'AC2 a student in no course reads every message');
select t.login('N');
select t.eq((select count(*) from general_messages), 3::bigint, 'AC2 a mentor reads every message');

-- AC 3: as somebody else, blank and too long are refused.
select t.login('S1');
select t.throws(pg_temp.post('00000000-0000-0000-0000-0000000061f4', t.id('M')::text, 'I am Max'), '42501', 'posting as another user is refused');
select t.throws(pg_temp.post('00000000-0000-0000-0000-0000000061f4', t.id('S1')::text, '   '), '23514', 'AC3 blank text refused');
select t.throws(pg_temp.post('00000000-0000-0000-0000-0000000061f4', t.id('S1')::text, repeat('x', 2001)), '23514', 'AC3 2001 characters refused');
select t.lives(pg_temp.post('00000000-0000-0000-0000-0000000061f5', t.id('S1')::text, repeat('x', 2000)), 'AC3 exactly 2000 characters posts');

-- AC 4: a retry with the same id doesn't post twice.
select t.throws(pg_temp.post('00000000-0000-0000-0000-0000000061f1', t.id('S1')::text, 'Hi from Sam'), '23505', 'AC4 a retry with the same id is refused');
reset role;
select t.eq((select count(*) from general_messages where id = '00000000-0000-0000-0000-0000000061f1'), 1::bigint, 'AC4 one row');

-- AC 6: nobody edits or deletes, the teacher included.
select t.login('S1');
select t.eq(t.affected($$update general_messages set body = 'edited'$$), 0::bigint, 'AC6 the author cannot edit');
select t.eq(t.affected($$delete from general_messages$$), 0::bigint, 'AC6 the author cannot delete');
select t.login('T');
select t.eq(t.affected($$update general_messages set body = 'edited'$$), 0::bigint, 'AC6 the teacher cannot edit');
select t.eq(t.affected($$delete from general_messages$$), 0::bigint, 'AC6 the teacher cannot delete');
reset role;
select t.eq((select count(*) from general_messages where body = 'edited'), 0::bigint, 'AC6 nothing changed');

-- AC 7: pending, declined and signed-out callers read nothing and can't post.
select pg_temp.as_user('00000000-0000-0000-0000-0000000061a1');
select t.eq((select count(*) from general_messages), 0::bigint, 'AC7 a pending account reads nothing');
select t.throws(pg_temp.post('00000000-0000-0000-0000-0000000061f6', '00000000-0000-0000-0000-0000000061a1', 'let me in'), '42501',
  'AC7 a pending account cannot post');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000061a2');
select t.eq((select count(*) from general_messages), 0::bigint, 'AC7 a declined account reads nothing');
select t.throws(pg_temp.post('00000000-0000-0000-0000-0000000061f6', '00000000-0000-0000-0000-0000000061a2', 'let me in'), '42501',
  'AC7 a declined account cannot post');
reset role;
select t.login(null);
select t.eq((select count(*) from general_messages), 0::bigint, 'AC7 signed out reads nothing');
select t.throws(pg_temp.post('00000000-0000-0000-0000-0000000061f6', t.id('S1')::text, 'anon'), '42501', 'AC7 signed out cannot post');
reset role;

-- AC 8: once accepted, P reads the whole history, including messages from before, and can post.
select t.login('T');
select t.lives($$select set_access_status('00000000-0000-0000-0000-0000000061a1', 'approved')$$, 'AC8 the teacher accepts P');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000061a1');
select t.eq((select count(*) from general_messages), 4::bigint, 'AC8 the accepted account reads the full history');
select t.lives(pg_temp.post('00000000-0000-0000-0000-0000000061f7', '00000000-0000-0000-0000-0000000061a1', 'Hello all'), 'AC8 and can post');
reset role;

-- AC 9: switching between student and mentor keeps access.
select t.login('T');
select t.lives($$select set_user_role('00000000-0000-0000-0000-0000000000c2', 'mentor')$$, 'AC9 S2 becomes a mentor');
select t.login('S2');
select t.eq((select count(*) from general_messages), 5::bigint, 'AC9 still reads after the switch');
select t.lives(pg_temp.post('00000000-0000-0000-0000-0000000061f8', t.id('S2')::text, 'Now a mentor'), 'AC9 still posts after the switch');
reset role;

-- The course chat is unaffected.
select t.eq((select count(*) from course_messages), 0::bigint, 'course_messages untouched by the general chat');

-- ARU-67 (0030): the server sets the time in both chats; naming created_at is refused, normal posts still work.
insert into course_members (course_id, user_id, added_by) values (t.id('A'), t.id('S1'), t.id('M'));
select t.login('S1');
select t.throws($$insert into general_messages (author_id, body, created_at) values (auth.uid(), 'pinned', '2099-01-01')$$, '42501',
  'ARU-67 general chat: a client-chosen time is refused');
select t.throws($$insert into general_messages (author_id, body, created_at) values (auth.uid(), 'hidden', '2000-01-01')$$, '42501',
  'ARU-67 general chat: a backdated time is refused');
select t.lives(pg_temp.post('00000000-0000-0000-0000-0000000061f9', t.id('S1')::text, 'Normal post'), 'ARU-67 general chat: a normal post still works');
select t.throws(format('insert into course_messages (course_id, author_id, body, created_at) values (%L, auth.uid(), %L, %L)',
  t.id('A'), 'pinned', '2099-01-01'), '42501', 'ARU-67 course chat: a client-chosen time is refused');
select t.lives(format('insert into course_messages (id, course_id, author_id, body) values (%L, %L, auth.uid(), %L)',
  '00000000-0000-0000-0000-0000000061fa', t.id('A'), 'Course post'), 'ARU-67 course chat: a normal post still works');
reset role;
select t.ok(not exists (select 1 from general_messages where created_at > now() + interval '1 minute' or created_at < now() - interval '1 day'),
  'ARU-67 every general message carries the server time');
select t.ok((select created_at > now() - interval '1 minute' from course_messages where id = '00000000-0000-0000-0000-0000000061fa'),
  'ARU-67 the course message carries the server time');
