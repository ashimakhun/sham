-- ARU-171: Telegram removed completely. Rules under test: supabase/migrations/0071_remove_telegram.sql.
-- The tables, their policies and triggers and the five Telegram functions are gone (AC 1, AC 2); no function in public
-- mentions the tables (AC 2's pg_proc scan); nobody can call the removed functions; and, run in order on links made
-- here, 0069's switch copy and then 0071 leave every account's switches exactly as they were (AC 3).
-- Fixture (t.seed): approved T, M, N, M2, S1, S2, S3; courses A (owner M) and B (owner N).
select t.seed();

-- AC 1: the tables are gone, with their policies and triggers.
select t.ok(to_regclass('public.telegram_links') is null, 'AC1 telegram_links is gone');
select t.ok(to_regclass('public.telegram_link_codes') is null, 'AC1 telegram_link_codes is gone');
select t.ok(not exists (select 1 from pg_policies where tablename in ('telegram_links', 'telegram_link_codes')),
  'AC1 no policy of either table is left');
select t.ok(not exists (select 1 from information_schema.triggers
  where event_object_table in ('telegram_links', 'telegram_link_codes')), 'AC1 no trigger of either table is left');
select t.ok(not exists (select 1 from pg_class where relname ilike '%telegram%'), 'AC1 no index or sequence is left');

-- AC 2: the five functions are gone, and no function in public mentions either table.
select t.ok(to_regprocedure(f) is null, 'AC2 ' || f || ' is gone')
from unnest(array['public.create_telegram_link_code()', 'public.set_telegram_notification(text, boolean)',
  'public.disconnect_telegram()', 'public.link_telegram_chat(text, bigint)', 'public.unlink_telegram_chat(bigint)']) f;
select t.ok(not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname ilike '%telegram%'), 'AC2 no function has Telegram in its name');
select t.eq((select string_agg(p.proname, ', ' order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and (p.prosrc ilike '%telegram_links%' or p.prosrc ilike '%telegram_link_codes%')), null::text,
  'AC2 no function in public mentions telegram_links or telegram_link_codes');

-- Access: signed-out visitors and signed-in users alike get "function does not exist".
select t.login(null);
select t.throws('select disconnect_telegram()', '42883', 'anon: disconnect_telegram() does not exist');
select t.throws('select create_telegram_link_code()', '42883', 'anon: create_telegram_link_code() does not exist');
reset role;
select t.login('S1');
select t.throws('select create_telegram_link_code()', '42883', 'authenticated: create_telegram_link_code() does not exist');
select t.throws($$select set_telegram_notification('chat_message', false)$$, '42883',
  'authenticated: set_telegram_notification() does not exist');
select t.throws('select disconnect_telegram()', '42883', 'authenticated: disconnect_telegram() does not exist');
select t.throws($$select link_telegram_chat('code', 1)$$, '42883', 'authenticated: link_telegram_chat() does not exist');
select t.throws('select unlink_telegram_chat(1)', '42883', 'authenticated: unlink_telegram_chat() does not exist');
reset role;

-- Push is unchanged: switches still save, and each account reads only its own row.
select t.login('S1');
select t.lives($$select set_notification('chat_message', false)$$, 'S1 still saves a switch');
reset role;
select t.login('S2');
select t.eq((select count(*) from notification_settings), 0::bigint, 'RLS: S2 doesn''t see S1''s switches');
reset role;
select t.login('S1');
select t.eq((select count(*) from notification_settings where not notify_chat_message), 1::bigint,
  'RLS: S1 sees their own switch off');
reset role;

-- AC 3: on a database that still has Telegram links (here a stand-in with the old columns, a temp table found first
-- by name), 0069's copy and then 0071 run in order. The switches are exactly what the links had, every other table
-- keeps its rows, and the links and codes are gone.
delete from notification_settings;
create temp table telegram_links (
  user_id uuid primary key, chat_id bigint not null,
  notify_meeting_started boolean not null default true, notify_new_homework boolean not null default true,
  notify_homework_reviewed boolean not null default true, notify_photo_deletion boolean not null default true,
  notify_homework_submitted boolean not null default true, notify_chat_message boolean not null default true,
  notify_general_chat boolean not null default true, notify_new_material boolean not null default true,
  notify_meeting_notes boolean not null default true, notify_new_account boolean not null default true
);
create temp table telegram_link_codes (code text primary key, user_id uuid not null);
insert into telegram_links (user_id, chat_id, notify_chat_message, notify_photo_deletion) values (t.id('S1'), 101, false, false);
insert into telegram_links (user_id, chat_id, notify_new_account, notify_meeting_notes) values (t.id('T'), 102, false, false);
insert into telegram_links (user_id, chat_id) values (t.id('M'), 103);
insert into telegram_link_codes (code, user_id) values ('aru171code', t.id('S2'));
\set copy_sql `sed -n '/^insert into notification_settings (/,/^on conflict (user_id) do nothing;/p' supabase/migrations/0069_push_notifications.sql`
:copy_sql
create temp table before_settings as select * from notification_settings;
create temp table before_counts as
  select (select count(*) from profiles) profiles, (select count(*) from courses) courses,
    (select count(*) from course_members) members, (select count(*) from push_devices) devices;
\i supabase/migrations/0071_remove_telegram.sql
select t.ok(to_regclass('telegram_links') is null and to_regclass('telegram_link_codes') is null,
  'AC3 the links and link codes are deleted');
select t.eq((select count(*) from notification_settings), 3::bigint, 'AC3 one settings row per account that had Telegram');
select t.ok(not exists ((select * from before_settings) except (select * from notification_settings))
  and not exists ((select * from notification_settings) except (select * from before_settings)),
  'AC3 notification_settings is exactly as before');
select t.ok((select not notify_chat_message and not notify_photo_deletion and notify_meeting_started and notify_general_chat
  from notification_settings where user_id = t.id('S1')), 'AC3 S1''s switches as on the link');
select t.ok((select not notify_new_account and not notify_meeting_notes and notify_chat_message
  from notification_settings where user_id = t.id('T')), 'AC3 T''s switches as on the link');
select t.ok((select (select count(*) from profiles) = profiles and (select count(*) from courses) = courses
  and (select count(*) from course_members) = members and (select count(*) from push_devices) = devices from before_counts),
  'AC3 no other table loses rows');

-- Deleting an account still works, with no reference to telegram_links.
select t.lives(format('delete from auth.users where id = %L', t.id('S1')), 'delete account still works');
select t.ok(not exists (select 1 from notification_settings where user_id = t.id('S1')), 'its switches go with it');
