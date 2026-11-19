-- ARU-162: block a person. Rules under test: supabase/migrations/0066_user_blocks.sql.
-- Course A (owner M): listeners S1, S2. T is the teacher. W2: another workspace with student XS. P: a waiting account.
select t.seed();
create function t.r(n text) returns uuid language sql immutable as $$ select md5('aru162' || n)::uuid $$;
grant execute on function t.r(text) to anon, authenticated;

create function pg_temp.err(stmt text) returns text language plpgsql as $$
declare code text;
begin
  execute stmt;
  return 'no error';
exception when others then
  get stacked diagnostics code = returned_sqlstate;
  return code;
end $$;
-- All blocks, as the admin sees them (without RLS).
create function pg_temp.blocks() returns text language sql security definer as $$
  select coalesce(string_agg(blocker_id::text || '>' || blocked_id::text, ',' order by blocker_id, blocked_id), '')
  from public.user_blocks $$;
create function pg_temp.pair(a text, b text) returns text language sql immutable as $$
  select t.id(a)::text || '>' || t.id(b)::text $$;
grant execute on all functions in schema pg_temp to authenticated, anon;

insert into course_members (course_id, user_id, added_by) values
  (t.id('A'), t.id('S1'), t.id('M')),
  (t.id('A'), t.id('S2'), t.id('M'));

-- Another workspace's student, and a waiting account in this workspace.
insert into workspaces (id, name, created_at) values (t.r('W2'), 'Other school', now());
insert into auth.users (id, email, raw_user_meta_data) values
  (t.r('XS'), 'xs162@x.test', '{"full_name":"Xia Student"}'),
  (t.r('P'), 'p162@x.test', '{"full_name":"Pat Pending"}');
update profiles set workspace_id = t.r('W2'), access_status = 'approved' where id = t.r('XS');

-- Content, made as the admin without triggers (no notifications).
set session_replication_role = replica;
insert into course_messages (id, course_id, author_id, body, created_at) values
  (t.r('mS2'), t.id('A'), t.id('S2'), 'From Sue', now() - interval '3 minutes'),
  (t.r('mM'), t.id('A'), t.id('M'), 'From Max', now() - interval '2 minutes'),
  (t.r('mGone'), t.id('A'), null, 'From a deleted account', now() - interval '1 minute');
insert into general_messages (id, author_id, body, created_at) values
  (t.r('gS2'), t.id('S2'), 'General from Sue', now() - interval '2 minutes'),
  (t.r('gT'), t.id('T'), 'General from the teacher', now() - interval '1 minute');
insert into course_meetings (id, course_id, starts_at, status, created_by) values
  (t.r('meet'), t.id('A'), now() - interval '1 day', 'completed', t.id('M'));
insert into meeting_listener_notes (id, meeting_id, course_id, author_id, body, is_public) values
  (t.r('nS2'), t.r('meet'), t.id('A'), t.id('S2'), 'Sue''s notes', true);
insert into materials (id, teacher_id, title, body) values (t.r('blog'), t.id('M'), 'Blog title', 'Blog body');
insert into material_files (id, author_id, name, storage_path, size_bytes) values
  (t.r('pdf'), t.id('M'), 'Guide.pdf', t.id('M') || '/' || t.r('pdf') || '.pdf', 100);
set session_replication_role = origin;
insert into telegram_links (user_id, chat_id) values (t.id('S1'), 9001), (t.id('T'), 9002), (t.id('M'), 9003), (t.id('S2'), 9004);

-- Data.
select t.ok((select relrowsecurity from pg_class where oid = 'user_blocks'::regclass), 'data: RLS is on');
select t.ok(not exists (select 1 from pg_publication_tables where tablename = 'user_blocks'),
  'data: user_blocks is not in the realtime publication');
select t.ok(not has_table_privilege('anon', 'user_blocks', 'select')
  and not has_table_privilege('anon', 'user_blocks', 'insert'), 'data: signed out has no access');
select t.ok(not has_table_privilege('authenticated', 'user_blocks', 'update'), 'data: blocks are never updated');
select t.eq((select string_agg(a.attname || '=' || c.confdeltype::text, ',' order by a.attname) from pg_constraint c
  join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
  where c.conrelid = 'user_blocks'::regclass and c.contype = 'f'),
  'blocked_id=c,blocker_id=c', 'data: rows go with either account (cascade, ARU-75)');

-- Counts and recipients before any block.
select t.login('S1');
select t.eq((select unread from chat_unread_counts() where course_id = t.id('A')), 3::bigint, 'before: 3 new course messages');
select t.eq(general_chat_unread_count(), 2::bigint, 'before: 2 new general messages');
reset role;
select t.ok(t.id('S1') = any ((select recipient_ids from chat_message_recipients(t.r('mS2')))::uuid[]),
  'before: S1 gets Telegram for S2''s course message');

-- AC 6: blocking.
select t.login('S1');
select t.eq(pg_temp.err(format('insert into user_blocks (blocker_id, blocked_id) values (%L, %L)', t.id('S1'), t.id('S1'))),
  '42501', 'AC 6: I can''t block myself');
select t.eq(pg_temp.err(format('insert into user_blocks (blocker_id, blocked_id) values (%L, %L)', t.id('S2'), t.id('S1'))),
  '42501', 'AC 6: I can''t block on behalf of someone else');
select t.eq(pg_temp.err(format('insert into user_blocks (blocker_id, blocked_id) values (%L, %L)', t.id('S1'), t.r('XS'))),
  '42501', 'AC 6: I can''t block someone of another workspace');
select t.eq(pg_temp.err(format('insert into user_blocks (blocker_id, blocked_id) values (%L, %L)', t.id('S1'), t.id('S2'))),
  'no error', 'AC 2: S1 blocks S2');
select t.eq(pg_temp.err(format('insert into user_blocks (blocker_id, blocked_id) values (%L, %L) on conflict do nothing',
  t.id('S1'), t.id('S2'))), 'no error', 'AC 6: blocking again does nothing (as the app sends it)');
select t.eq(pg_temp.err(format('insert into user_blocks (blocker_id, blocked_id) values (%L, %L)', t.id('S1'), t.id('S2'))),
  '23505', 'AC 6: a plain duplicate is refused by the key');
select t.eq((select count(*) from user_blocks), 1::bigint, 'AC 5: S1 reads their one block');
reset role;
select t.eq(pg_temp.blocks(), pg_temp.pair('S1', 'S2'), 'one row');
-- The database check, for writes that skip RLS (SQL Editor).
select t.throws(format('insert into user_blocks (blocker_id, blocked_id) values (%L, %L)', t.id('T'), t.id('T')), '23514',
  'AC 6: the check refuses a self-block outside the app too');

-- A waiting account can't block.
select t.login('P');
select t.eq(pg_temp.err(format('insert into user_blocks (blocker_id, blocked_id) values (%L, %L)', t.r('P'), t.id('S2'))),
  '42501', 'roles: a waiting account can''t block');
reset role;

-- AC 6: private. Nobody else, the teacher included, reads or removes S1's block; signed out has no access.
select t.login('T');
select t.eq((select count(*) from user_blocks), 0::bigint, 'AC 6: the teacher doesn''t see S1''s block');
select t.eq(t.affected(format('delete from user_blocks where blocker_id = %L', t.id('S1'))), 0::bigint,
  'AC 6: the teacher can''t remove S1''s block');
reset role;
select t.login('S2');
select t.eq((select count(*) from user_blocks), 0::bigint, 'AC 3: the blocked person sees nothing');
reset role;
select t.login(null);
select t.eq(pg_temp.err('select count(*) from user_blocks'), '42501', 'AC 6: signed out can''t read blocks');
reset role;

-- AC 4: counts skip the blocked author; a deleted author still counts.
select t.login('S1');
select t.eq((select unread from chat_unread_counts() where course_id = t.id('A')), 2::bigint,
  'AC 4: S2''s course message no longer counts (Max''s and the deleted account''s do)');
select t.eq(general_chat_unread_count(), 1::bigint, 'AC 4: S2''s general message no longer counts');
reset role;
select t.login('M');
select t.eq((select unread from chat_unread_counts() where course_id = t.id('A')), 2::bigint,
  'AC 3: other people''s counts are unchanged (Max: Sue''s and the deleted account''s)');
reset role;

-- AC 4: Telegram leaves out people who blocked the author, and nobody else.
select t.ok(not t.id('S1') = any ((select recipient_ids from chat_message_recipients(t.r('mS2')))::uuid[]),
  'AC 4: S1 gets no Telegram for S2''s course message');
select t.ok(t.id('T') = any ((select recipient_ids from chat_message_recipients(t.r('mS2')))::uuid[])
  and t.id('M') = any ((select recipient_ids from chat_message_recipients(t.r('mS2')))::uuid[]),
  'AC 4: the teacher and the owner still get it');
select t.ok(t.id('S1') = any ((select recipient_ids from chat_message_recipients(t.r('mM')))::uuid[]),
  'AC 4: S1 still gets Max''s course message');
select t.ok(not t.id('S1') = any ((select recipient_ids from general_message_recipients(t.r('gS2')))::uuid[])
  and t.id('T') = any ((select recipient_ids from general_message_recipients(t.r('gS2')))::uuid[]),
  'AC 4: general chat: S1 left out, the teacher not');
select t.ok(t.id('S1') = any ((select recipient_ids from general_message_recipients(t.r('gT')))::uuid[]),
  'AC 4: S1 still gets the teacher''s general message');
select t.ok(not exists (select 1 from meeting_notes_recipients(t.r('nS2')) where user_id = t.id('S1'))
  and exists (select 1 from meeting_notes_recipients(t.r('nS2')) where user_id = t.id('M')),
  'AC 4: meeting notes: S1 left out, the owner not');
select t.ok(exists (select 1 from new_material_recipients('blog', t.r('blog')) where user_id = t.id('S1')),
  'AC 4: S1 still gets Max''s Blog post (Max isn''t blocked)');
insert into user_blocks (blocker_id, blocked_id) values (t.id('S1'), t.id('M'));
select t.ok(not exists (select 1 from new_material_recipients('blog', t.r('blog')) where user_id = t.id('S1'))
  and not exists (select 1 from new_material_recipients('file', t.r('pdf')) where user_id = t.id('S1')),
  'AC 4: after blocking Max: no Blog post or PDF notification for S1');
select t.ok(exists (select 1 from new_material_recipients('blog', t.r('blog')) where user_id = t.id('S2')),
  'AC 4: S2 still gets Max''s Blog post');

-- AC 5: unblocking brings everything back.
select t.login('S1');
select t.eq(t.affected(format('delete from user_blocks where blocked_id in (%L, %L)', t.id('S2'), t.id('M'))), 2::bigint,
  'AC 5: S1 unblocks S2 and Max');
select t.eq((select unread from chat_unread_counts() where course_id = t.id('A')), 3::bigint, 'AC 5: counts again');
select t.eq(general_chat_unread_count(), 2::bigint, 'AC 5: general counts again');
reset role;
select t.ok(t.id('S1') = any ((select recipient_ids from chat_message_recipients(t.r('mS2')))::uuid[]),
  'AC 5: Telegram again after unblocking');

-- Deleting either account removes the block (ARU-75).
insert into user_blocks (blocker_id, blocked_id) values (t.id('S1'), t.id('S2')), (t.id('S1'), t.id('S3'));
delete from auth.users where id = t.id('S2');
select t.eq(pg_temp.blocks(), pg_temp.pair('S1', 'S3'), 'ARU-75: deleting the blocked account removes the block');
delete from auth.users where id = t.id('S1');
select t.eq(pg_temp.blocks(), '', 'ARU-75: deleting the blocker''s account removes their blocks');
