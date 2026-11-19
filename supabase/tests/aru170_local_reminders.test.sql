-- ARU-170: the Homework due soon switch and what the server stops doing. Rules under test:
-- supabase/migrations/0072_local_reminders.sql. Fixture (t.seed): approved T, M, N, M2, S1, S2, S3. Here also P (waiting).
select t.seed();
insert into auth.users (id, email, raw_user_meta_data) values
  (md5('aru170P')::uuid, 'p170@x.test', '{"full_name":"Pat Pending"}');
update profiles set access_status = 'pending' where id = md5('aru170P')::uuid;

create function t.as(who uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', who, 'role', 'authenticated')::text, false);
  set role authenticated;
end $$;
grant execute on function t.as(uuid) to anon, authenticated;
create function t.hint(stmt text) returns text language plpgsql as $$
declare h text;
begin
  execute stmt;
  return 'no error';
exception when others then
  get stacked diagnostics h = pg_exception_hint;
  return h;
end $$;
grant execute on function t.hint(text) to anon, authenticated;

-- AC 9: the column, on by default (no row, and every row from before this story).
insert into notification_settings (user_id, notify_chat_message) values (t.id('S2'), false);
select t.eq((select column_default from information_schema.columns
  where table_name = 'notification_settings' and column_name = 'notify_homework_due'), 'true',
  'AC9 notify_homework_due defaults to on');
select t.eq((select is_nullable from information_schema.columns
  where table_name = 'notification_settings' and column_name = 'notify_homework_due'), 'NO', 'AC9 never null');
select t.ok((select notify_homework_due from notification_settings where user_id = t.id('S2')),
  'AC9 a row saved without it reads on');

-- AC 9: saving works like the other switches (the first call creates the row, every other switch on).
select t.as(t.id('S1'));
select t.lives($$select set_notification('homework_due', false)$$, 'AC9 a student turns Homework due soon off');
select t.eq((select notify_homework_due::text || ',' || notify_new_homework::text || ',' || notify_meeting_started::text
  from notification_settings where user_id = t.id('S1')), 'false,true,true', 'AC9 only that switch changed');
select t.lives($$select set_notification('homework_due', true)$$, 'AC9 and back on');
select t.ok((select notify_homework_due from notification_settings where user_id = t.id('S1')), 'AC9 saved on');
select t.as(t.id('M2'));
select t.lives($$select set_notification('homework_due', false)$$, 'AC9 a mentor turns it off');
-- Every earlier kind still works, unknown ones are still refused.
select t.lives($$select set_notification('meeting_started', false)$$, 'AC9 meeting_started still accepted');
select t.lives($$select set_notification('photo_deletion', false)$$, 'AC9 photo_deletion still accepted');
select t.lives($$select set_notification('new_account', true)$$, 'AC9 new_account still accepted');
select t.eq(t.hint($$select set_notification('homework_due_soon', false)$$), 'sham:notification_kind_unknown',
  'AC9 an unknown kind is refused');
select t.eq(t.hint($$select set_notification('homework_due', null)$$), 'sham:choose_on_off', 'AC9 null is refused');
reset role;
select t.as(md5('aru170P')::uuid);
select t.eq(t.hint($$select set_notification('homework_due', false)$$), 'sham:notifications_not_accepted',
  'AC9 a waiting account can''t save it');
reset role;
select t.ok(not has_function_privilege('anon', 'set_notification(text, boolean)', 'execute'), 'access: anon can''t run it');
-- Access: still readable by its owner only.
select t.as(t.id('S1'));
select t.eq((select count(*) from notification_settings), 1::bigint, 'access: a student reads only their own row');
select t.throws($$update notification_settings set notify_homework_due = false$$, '42501', 'access: no direct update');
reset role;

-- AC 12: the server no longer sends meeting started.
select t.ok(not exists (select 1 from cron.job where jobname = 'meeting-start-notifications'),
  'AC12 the meeting-start-notifications cron job is gone');
select t.ok(to_regprocedure('public.claim_started_meetings()') is null, 'AC12 claim_started_meetings() is dropped');
select t.ok(exists (select 1 from information_schema.columns where table_name = 'course_meetings'
  and column_name = 'start_notified_at'), 'AC12 course_meetings.start_notified_at stays (no data change)');
-- The daily photo job is still scheduled; the warnings table and its function stay (Out of scope).
select t.ok(exists (select 1 from cron.job where jobname <> 'meeting-start-notifications'), 'AC13 other cron jobs stay');
select t.ok(to_regclass('public.photo_deletion_warnings') is not null, 'AC13 photo_deletion_warnings stays');
select t.ok(to_regprocedure('public.claim_photo_deletion_warnings()') is not null, 'AC13 claim_photo_deletion_warnings() stays');

-- AC 12: the unschedule step is safe to run when the job doesn't exist (a project that never scheduled it).
select t.lives($q$do $x$ begin
  if exists (select 1 from cron.job where jobname = 'meeting-start-notifications') then
    perform cron.unschedule('meeting-start-notifications');
  end if;
end $x$$q$, 'AC12 no error when the job doesn''t exist');
