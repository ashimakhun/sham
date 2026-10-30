-- ARU-31 QA additions to aru31_chat_read_positions.test.sql (post-merge, PR #36): an owner change moves the counts
-- with the chat (ARU-9), a message from another course can't move a read position, and the functions' security
-- settings. Rules under test: supabase/migrations/0016_chat_read_positions.sql.
select t.seed();
insert into course_members (course_id, user_id, added_by) values (t.id('A'), t.id('S1'), t.id('M'));
insert into course_messages (id, course_id, author_id, body, created_at) values
  ('00000000-0000-0000-0000-00000000f101', t.id('A'), t.id('S1'), 'hello A', now() - interval '30 minutes'),
  ('00000000-0000-0000-0000-00000000f102', t.id('A'), t.id('T'),  'teacher in A', now() - interval '20 minutes'),
  ('00000000-0000-0000-0000-00000000f201', t.id('B'), t.id('N'),  'hello B', now() - interval '10 minutes');

-- M (owner of A) reads A; N (owner of B) has never opened A.
select t.login('M');
select t.lives($$select mark_chat_read('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-00000000f102')$$, 'M reads A');
select t.eq((select count(*) from chat_unread_counts() where course_id = t.id('A')), 0::bigint, 'M: nothing new in A');

-- A message id from another course can't be used to set a position in A.
select t.throws($$select mark_chat_read('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-00000000f201')$$, 'P0002',
  'a message from course B cannot mark course A read');

-- Owner change A: M -> N (ARU-9). M is not a listener of A, so M leaves the chat and its count; N joins it.
reset role; select t.login('T');
select t.lives($$select change_course_owner('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000b2')$$,
  'teacher hands A to N');
reset role; select t.login('M');
select t.eq((select count(*) from chat_unread_counts() where course_id = t.id('A')), 0::bigint,
  'owner change: former owner M gets no count for A');
select t.eq((select count(*) from course_chat_reads where course_id = t.id('A')), 0::bigint,
  'owner change: former owner M cannot see their old position');
select t.throws($$select mark_chat_read('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-00000000f102')$$, '42501',
  'owner change: former owner M cannot mark A read');
reset role; select t.login('N');
select t.eq((select unread from chat_unread_counts() where course_id = t.id('A')), 2::bigint,
  'owner change: new owner N, who never opened A, sees every message from others as new (AC 10)');

-- Back to M: the earlier position is kept, so nothing old lights up again.
reset role; select t.login('T');
select t.lives($$select change_course_owner('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000b1')$$,
  'teacher hands A back to M');
reset role; select t.login('M');
select t.eq((select count(*) from chat_unread_counts() where course_id = t.id('A')), 0::bigint,
  'owner change back: M keeps the earlier position (no count)');

-- A position can't be handed to someone else or moved to another course by a direct update.
select t.eq(t.affected($$update course_chat_reads set user_id = '00000000-0000-0000-0000-0000000000c1' where course_id = '00000000-0000-0000-0000-0000000000d1'$$), 1::bigint,
  'direct update of own row runs');
reset role;
select t.ok(exists (select 1 from course_chat_reads where course_id = t.id('A') and user_id = t.id('M')),
  'the guard keeps the row on its own user (no takeover of another user''s position)');

-- Security settings.
select t.ok(not (select prosecdef from pg_proc where proname = 'mark_chat_read'), 'mark_chat_read is security invoker (RLS applies)');
select t.ok(not (select prosecdef from pg_proc where proname = 'chat_unread_counts'), 'chat_unread_counts is security invoker (RLS applies)');
select t.ok((select bool_and('search_path=public' = any(proconfig)) from pg_proc
  where proname in ('mark_chat_read', 'chat_unread_counts', 'seed_course_chat_reads', 'course_chat_reads_guard')),
  'all four functions pin search_path = public');
select t.ok(not has_function_privilege('authenticated', 'seed_course_chat_reads()', 'execute'), 'signed-in users cannot run the release seed');
select t.ok(not has_function_privilege('anon', 'seed_course_chat_reads()', 'execute'), 'anon cannot run the release seed');
select t.ok(not exists (select 1 from pg_policies where tablename = 'course_chat_reads' and cmd in ('DELETE', 'ALL')),
  'no delete policy on read positions');
select t.ok(exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'course_messages'),
  'course_messages is still published, so counts can refresh live (AC 7)');
