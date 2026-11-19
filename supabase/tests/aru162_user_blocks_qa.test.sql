-- QA ARU-162: gaps in aru162_user_blocks.test.sql. A declined account can't block; another workspace's student can't
-- block into this one, and a guessed id gets the same refusal as a real id of another workspace (no existence leak);
-- the upsert the app sends (on conflict (blocker_id, blocked_id) do nothing) is a no-op on a repeat; blocking the
-- course owner or the teacher hides their messages from counts and Telegram but nobody else's; a blocked author's
-- content can still be reported (ARU-158); the recipient functions stay service-only and no security definer
-- function is callable signed out (ARU-154).
-- Course A (owner M): listeners S1, S2. T is the teacher. W2: another workspace with student XS. P: waiting; D: declined.
select t.seed();
create function t.r(n text) returns uuid language sql immutable as $$ select md5('aru162qa' || n)::uuid $$;
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
create function pg_temp.nblocks() returns bigint language sql security definer as $$
  select count(*) from public.user_blocks $$;
-- t.login() only knows the fixture names; these accounts have md5 ids.
create function t.login_as(who uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', who, 'role', 'authenticated')::text, false);
  set role authenticated;
end $$;
grant execute on function t.login_as(uuid) to anon, authenticated;
grant execute on all functions in schema pg_temp to authenticated, anon;

insert into course_members (course_id, user_id, added_by) values
  (t.id('A'), t.id('S1'), t.id('M')),
  (t.id('A'), t.id('S2'), t.id('M'));

insert into workspaces (id, name, created_at) values (t.r('W2'), 'Other school', now());
insert into auth.users (id, email, raw_user_meta_data) values
  (t.r('XS'), 'xs162qa@x.test', '{"full_name":"Xia Student"}'),
  (t.r('D'), 'd162qa@x.test', '{"full_name":"Dee Declined"}'),
  (t.r('P'), 'p162qa@x.test', '{"full_name":"Pat Pending"}');
update profiles set workspace_id = t.r('W2'), access_status = 'approved' where id = t.r('XS');
update profiles set access_status = 'rejected' where id = t.r('D');

set session_replication_role = replica;
insert into course_messages (id, course_id, author_id, body, created_at) values
  (t.r('mM'), t.id('A'), t.id('M'), 'From Max', now() - interval '3 minutes'),
  (t.r('mT'), t.id('A'), t.id('T'), 'From the teacher', now() - interval '2 minutes'),
  (t.r('mS2'), t.id('A'), t.id('S2'), 'From Sue', now() - interval '1 minute');
insert into general_messages (id, author_id, body, created_at) values
  (t.r('gT'), t.id('T'), 'General from the teacher', now() - interval '1 minute');
set session_replication_role = origin;

-- Roles: a waiting and a declined account can't block (signed in with their own id, so is_approved() decides).
select t.login_as(t.r('P'));
select t.eq(pg_temp.err(format('insert into user_blocks (blocker_id, blocked_id) values (%L, %L)', t.r('P'), t.id('S2'))),
  '42501', 'roles: a waiting account can''t block');
reset role;
select t.login_as(t.r('D'));
select t.eq(pg_temp.err(format('insert into user_blocks (blocker_id, blocked_id) values (%L, %L)', t.r('D'), t.id('S2'))),
  '42501', 'roles: a declined account can''t block');
reset role;

-- Workspaces: W2's student can't block into this workspace; a guessed id is refused the same way (no leak).
select t.login_as(t.r('XS'));
select t.eq(pg_temp.err(format('insert into user_blocks (blocker_id, blocked_id) values (%L, %L)', t.r('XS'), t.id('S1'))),
  '42501', 'ARU-145: another workspace''s student can''t block S1');
select t.eq(pg_temp.err(format('insert into user_blocks (blocker_id, blocked_id) values (%L, %L)', t.r('XS'), t.r('nobody'))),
  '42501', 'ARU-145: a guessed id gets the same refusal (nothing tells whether the id exists)');
reset role;
select t.eq(pg_temp.nblocks(), 0::bigint, 'no block was stored');

-- AC 6: the app's upsert (on conflict on the key, do nothing) is a no-op on a repeat.
select t.login('S1');
select t.eq(pg_temp.err(format(
  'insert into user_blocks (blocker_id, blocked_id) values (%L, %L) on conflict (blocker_id, blocked_id) do nothing',
  t.id('S1'), t.id('M'))), 'no error', 'AC 6: S1 blocks the course owner');
select t.eq(pg_temp.err(format(
  'insert into user_blocks (blocker_id, blocked_id) values (%L, %L) on conflict (blocker_id, blocked_id) do nothing',
  t.id('S1'), t.id('M'))), 'no error', 'AC 6: the same upsert again: no error');
select t.eq((select count(*) from user_blocks), 1::bigint, 'AC 6: still one row');
-- Blocking the teacher is allowed too (edge case: their content is hidden, nothing else).
select t.eq(pg_temp.err(format('insert into user_blocks (blocker_id, blocked_id) values (%L, %L)', t.id('S1'), t.id('T'))),
  'no error', 'edge case: S1 can block the teacher');

-- AC 4: S1's counts drop the owner's and the teacher's messages, but still count Sue's.
select t.eq((select unread from chat_unread_counts() where course_id = t.id('A')), 1::bigint,
  'AC 4: only Sue''s course message counts for S1');
select t.eq(general_chat_unread_count(), 0::bigint, 'AC 4: the teacher''s general message no longer counts');

-- ARU-158 still works: S1 can report a blocked author's message.
select t.eq(pg_temp.err(format('select report_content(%L, %L, %L)', 'course_message', t.r('mM'), 'harassment')),
  'no error', 'ARU-158: a blocked author''s message can still be reported');
reset role;

-- AC 3: S2's counts are unchanged by S1's blocks.
select t.login('S2');
select t.eq((select unread from chat_unread_counts() where course_id = t.id('A')), 2::bigint,
  'AC 3: S2 still counts the owner''s and the teacher''s messages');
reset role;

-- AC 4: Telegram leaves out only S1, for the owner's and the teacher's messages.
select t.ok(not t.id('S1') = any ((select recipient_ids from chat_message_recipients(t.r('mM')))::uuid[])
  and t.id('S2') = any ((select recipient_ids from chat_message_recipients(t.r('mM')))::uuid[])
  and t.id('T') = any ((select recipient_ids from chat_message_recipients(t.r('mM')))::uuid[]),
  'AC 4: the owner''s message: S1 left out, S2 and the teacher not');
select t.ok(not t.id('S1') = any ((select recipient_ids from general_message_recipients(t.r('gT')))::uuid[])
  and t.id('S2') = any ((select recipient_ids from general_message_recipients(t.r('gT')))::uuid[]),
  'AC 4: the teacher''s general message: S1 left out, S2 not');
select t.ok(t.id('S1') = any ((select recipient_ids from chat_message_recipients(t.r('mS2')))::uuid[]),
  'AC 4: Sue''s message still goes to S1');

-- Grants: the changed recipient functions stay service-only; nothing security definer is callable signed out.
select t.ok(not has_function_privilege('anon', 'chat_message_recipients(uuid)', 'execute')
  and not has_function_privilege('anon', 'general_message_recipients(uuid)', 'execute')
  and not has_function_privilege('anon', 'new_material_recipients(text,uuid)', 'execute')
  and not has_function_privilege('anon', 'meeting_notes_recipients(uuid)', 'execute'),
  'grants: signed out can''t call the recipient functions');
select t.ok(not has_function_privilege('authenticated', 'chat_message_recipients(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'general_message_recipients(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'new_material_recipients(text,uuid)', 'execute')
  and not has_function_privilege('authenticated', 'meeting_notes_recipients(uuid)', 'execute'),
  'grants: app users can''t call the recipient functions');
select t.eq((select coalesce(string_agg(p.proname, ',' order by p.proname), '') from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'execute')), '',
  'ARU-154: no security definer function in public is callable signed out');
select t.eq((select coalesce(string_agg(p.proname, ',' order by p.proname), '') from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in ('chat_message_recipients', 'general_message_recipients',
    'new_material_recipients', 'meeting_notes_recipients')
    and not (p.prosecdef and p.proconfig @> array['search_path=public'])), '',
  'the recipient functions keep security definer and search_path=public');
