-- ARU-170: notifications on the phone, part 2. Meeting started and photo deletion become local reminders that the app
-- schedules on the phone from data it already reads (no server), and a new Homework due soon reminder is added.
--   * notification_settings.notify_homework_due: the Homework due soon switch, on for every existing and new row (AC 9).
--   * set_notification() also accepts 'homework_due'; every other kind and refusal is kept (latest: 0069).
--   * The meeting-start-notifications cron job is unscheduled and claim_started_meetings() is dropped (AC 12): nobody
--     gets a meeting-started push any more. course_meetings.start_notified_at and its clearing in update_meeting() stay
--     (unused, no data change).
--   * photo_deletion_warnings and claim_photo_deletion_warnings() stay but are no longer called: the daily photo-deletion
--     function stops warning (AC 13; dropping them is a later clean-up).
-- Reads and RLS are unchanged: reminders use only rows the app already gets. Deletes no data.

-- 1. AC 9: the switch. No row, or a row from before this migration, reads as on.
alter table notification_settings add column notify_homework_due boolean not null default true;

-- 2. AC 9: set_notification() with the new kind (same as 0069 otherwise).
create or replace function set_notification(kind text, enabled boolean) returns void
  language plpgsql security definer set search_path = public
  as $$
  declare
    me uuid := auth.uid();
  begin
    if me is null then
      raise exception 'Please sign in again.' using errcode = '42501', hint = 'sham:sign_in_again';
    end if;
    if not exists (select 1 from profiles where id = me and access_status = 'approved') then
      raise exception 'Only accepted accounts can get notifications.' using errcode = '42501',
        hint = 'sham:notifications_not_accepted';
    end if;
    if enabled is null then
      raise exception 'Choose on or off.' using errcode = '22023', hint = 'sham:choose_on_off';
    end if;
    if kind is null or kind not in ('meeting_started', 'new_homework', 'homework_due', 'homework_reviewed',
        'photo_deletion', 'homework_submitted', 'chat_message', 'general_chat', 'new_material', 'meeting_notes',
        'new_account') then
      raise exception 'Unknown notification type.' using errcode = '22023', hint = 'sham:notification_kind_unknown';
    end if;
    insert into notification_settings (user_id) values (me) on conflict (user_id) do nothing;
    execute format('update notification_settings set %I = $1, updated_at = now() where user_id = $2', 'notify_' || kind)
      using enabled, me;
  end $$;
revoke execute on function set_notification(text, boolean) from public, anon;
grant execute on function set_notification(text, boolean) to authenticated;

-- 3. AC 12: the server no longer sends meeting started. No error when the job was never scheduled.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'meeting-start-notifications') then
    perform cron.unschedule('meeting-start-notifications');
  end if;
end $$;
drop function if exists claim_started_meetings();
