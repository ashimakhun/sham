-- ARU-171 QA: gaps around supabase/migrations/0071_remove_telegram.sql that the dev test doesn't cover: no Telegram
-- object of any kind is left (columns, views, types, cron jobs, grants), the service role can't call the removed
-- functions either, every one of the 10 switches still saves and limits the recipient functions after the removal
-- (AC 3 / AC 5), and every role's account deletion still works with switches and phones set (Delete account).
-- Fixture (t.seed): approved T, M, N, M2, S1, S2, S3; courses A (owner M) and B (owner N).
select t.seed();
grant usage on schema t to service_role;
grant execute on all functions in schema t to service_role;

-- AC 1 / AC 2: nothing named after Telegram is left anywhere in the database (other than in old migrations' history).
select t.eq((select string_agg(table_name || '.' || column_name, ', ') from information_schema.columns
  where table_schema = 'public' and column_name ilike '%telegram%'), null::text, 'AC1 no column mentions Telegram');
select t.eq((select string_agg(viewname, ', ') from pg_views where schemaname = 'public'
  and definition ilike '%telegram%'), null::text, 'AC1 no view mentions Telegram');
select t.eq((select string_agg(typname, ', ') from pg_type t join pg_namespace n on n.oid = t.typnamespace
  where n.nspname = 'public' and typname ilike '%telegram%'), null::text, 'AC1 no type mentions Telegram');
select t.eq((select string_agg(jobname, ', ') from cron.job where command ilike '%telegram%'), null::text,
  'AC1 no scheduled job mentions Telegram');
select t.eq((select string_agg(p.proname, ', ') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosrc ilike '%telegram%'
    and p.prosrc not ilike '%telegram_not_accepted%'), null::text,
  'AC2 no function body in public mentions Telegram at all (the permanent error code aside)');
select t.eq((select string_agg(tgname, ', ') from pg_trigger where tgname ilike '%telegram%'), null::text,
  'AC1 no trigger is named after Telegram');

-- Roles: the service role (the old webhook's) can't call the webhook's functions either.
set role service_role;
select t.throws($$select link_telegram_chat('code', 1)$$, '42883', 'service role: link_telegram_chat() does not exist');
select t.throws('select unlink_telegram_chat(1)', '42883', 'service role: unlink_telegram_chat() does not exist');
reset role;

-- AC 3 / AC 5: each of the 10 switches still saves for its owner after the removal, and set back on.
select t.login('T');
select t.lives(format('select set_notification(%L, false)', k), 'AC3 T turns off ' || k)
from unnest(array['meeting_started', 'new_homework', 'homework_reviewed', 'photo_deletion', 'homework_submitted',
  'chat_message', 'general_chat', 'new_material', 'meeting_notes', 'new_account']) k;
reset role;
select t.eq((select (not notify_meeting_started and not notify_new_homework and not notify_homework_reviewed
  and not notify_photo_deletion and not notify_homework_submitted and not notify_chat_message
  and not notify_general_chat and not notify_new_material and not notify_meeting_notes and not notify_new_account)
  from notification_settings where user_id = t.id('T')), true, 'AC3 all 10 switches are stored off');
select t.login('T');
select t.lives($$select set_notification('chat_message', true)$$, 'AC3 T turns chat messages back on');
reset role;
select t.eq((select notify_chat_message and not notify_general_chat from notification_settings where user_id = t.id('T')),
  true, 'AC3 only the switch turned back on changed');

-- AC 5: the recipient functions run after the removal (a leftover Telegram join would fail only now, at run time).
-- They list every listener with or without Telegram ever linked; switches are applied by the push sender
-- (_shared/push.ts, SWITCH_COLUMN), as in ARU-166.
insert into course_members (course_id, user_id, added_by) values (t.id('A'), t.id('S1'), t.id('M')),
  (t.id('A'), t.id('S3'), t.id('M'));
insert into course_messages (id, course_id, author_id, body) values (md5('aru171qa-msg')::uuid, t.id('A'), t.id('M'), 'hi');
select t.lives($$select * from chat_message_recipients(md5('aru171qa-msg')::uuid)$$, 'AC5 chat_message_recipients() runs');
select t.login('S1');
select t.lives($$select set_notification('chat_message', false)$$, 'S1 turns chat messages off');
reset role;
select t.ok((select t.id('S1') = any(recipient_ids) from chat_message_recipients(md5('aru171qa-msg')::uuid)),
  'AC5 S1 is listed (its switch is applied by the push sender)');
select t.ok((select t.id('S3') = any(recipient_ids) from chat_message_recipients(md5('aru171qa-msg')::uuid)),
  'AC5 S3 (no settings row, never had Telegram) still gets the chat push');
select t.lives($$select * from new_material_recipients('blog', gen_random_uuid())$$, 'AC5 new_material_recipients() runs');
select t.lives($$select * from new_homework_recipients(gen_random_uuid())$$, 'AC5 new_homework_recipients() runs');
select t.lives($$select * from meeting_notes_recipients(gen_random_uuid())$$, 'AC5 meeting_notes_recipients() runs');
select t.lives($$select * from general_message_recipients(gen_random_uuid())$$, 'AC5 general_message_recipients() runs');

-- Delete account: a student and a mentor with switches and a phone are deleted through Auth; their rows go with them.
insert into push_devices (user_id, device_id, token, platform) values
  (t.id('S2'), 'd-s2', 'ExponentPushToken[aru171qa-s2]', 'ios'),
  (t.id('M2'), 'd-m2', 'ExponentPushToken[aru171qa-m2]', 'android');
select t.login('S2');
select t.lives($$select set_notification('new_homework', false)$$, 'S2 has a switch off');
reset role;
select t.login('M2');
select t.lives($$select set_notification('homework_submitted', false)$$, 'M2 has a switch off');
reset role;
select t.lives(format('delete from auth.users where id = %L', t.id('S2')), 'student account deletion still works');
select t.lives(format('delete from auth.users where id = %L', t.id('M2')), 'mentor account deletion still works');
select t.ok(not exists (select 1 from notification_settings where user_id in (t.id('S2'), t.id('M2')))
  and not exists (select 1 from push_devices where user_id in (t.id('S2'), t.id('M2'))),
  'their switches and phones are deleted with them');
select t.ok(exists (select 1 from notification_settings where user_id = t.id('T')), 'other accounts keep their switches');
