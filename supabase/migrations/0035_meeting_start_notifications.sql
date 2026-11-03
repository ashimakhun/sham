-- ARU-41: a Telegram message to a course's listeners when one of its meetings starts ("<course title> meeting has
-- started"), sent through the Sham bot (ARU-48). A pg_cron job calls the Edge Function meeting-start-notifications
-- every minute through pg_net; the function claims the meetings that just started with claim_started_meetings() and
-- only then sends, so a meeting is announced at most once.
--
-- Run after 0023_telegram_links.sql and 0034. Adds a column, two functions and a cron job; replaces update_meeting()
-- (0021) only to clear the claim when a meeting is moved. Deletes nothing; existing meetings start unclaimed, and
-- meetings that started more than 2 minutes ago are never announced.
--
-- BEFORE running it (Supabase dashboard): Database → Extensions → turn on pg_cron and pg_net. Without them this
-- migration stops with a message saying so. Then store the function's URL and secret in Vault (README → Telegram
-- notifications → Meeting started); the job reads them on every run, so they never appear in cron.job.

do $$
begin
  if to_regprocedure('cron.schedule(text,text,text)') is null then
    raise exception 'Turn on the pg_cron extension first (Database -> Extensions -> pg_cron), then run this again.';
  end if;
  if to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is null then
    raise exception 'Turn on the pg_net extension first (Database -> Extensions -> pg_net), then run this again.';
  end if;
end $$;

-- When the start was announced (claimed); null = not yet. Nobody writes it directly: course_meetings has no update
-- policy, only the functions below change it.
alter table course_meetings add column start_notified_at timestamptz;

-- Same as 0021, plus: moving the start time clears the claim, so the new start is announced too (AC 4). Editing only
-- the topic or location keeps it.
create or replace function update_meeting(meeting uuid, new_starts_at timestamptz, new_topic text, new_location text)
  returns void
  language plpgsql security definer set search_path = public
  as $$
  declare
    m course_meetings%rowtype;
    moved boolean;
  begin
    select * into m from course_meetings where id = meeting for update;
    if not found or course_hidden_from_me(m.course_id) then
      raise exception 'Meeting not found.' using errcode = 'P0002';
    end if;
    if not (owns_course(m.course_id) or coalesce(my_role() = 'teacher', false)) then
      raise exception 'Only the course owner or the teacher can edit a meeting.' using errcode = '42501';
    end if;
    if m.status <> 'scheduled' then
      raise exception 'This meeting is already %; it can''t be edited.', m.status using errcode = '23514';
    end if;
    if new_starts_at is null then
      raise exception 'Pick a date and start time.' using errcode = '22023';
    end if;
    moved := new_starts_at is distinct from m.starts_at;
    if moved and new_starts_at <= now() then
      raise exception 'Pick a time in the future.' using errcode = '23514';
    end if;
    update course_meetings set
      starts_at = new_starts_at,
      topic = coalesce(nullif(trim(new_topic), ''), 'Meeting'),
      location = nullif(trim(new_location), ''),
      rescheduled_at = case when moved then now() else m.rescheduled_at end,
      start_notified_at = case when moved then null else m.start_notified_at end
    where id = meeting;
  end $$;

-- The Edge Function (service role only, AC 10): in one statement, claims every Scheduled, unclaimed meeting that
-- started within the last 2 minutes (database clock) and returns, per claimed meeting, the course title now and the
-- current Approved listeners. A second call (or a run in parallel) gets nothing for the same meetings: the update only
-- takes rows whose start_notified_at is still null. The owner and the teacher are never listeners (0004, 0009).
create function claim_started_meetings()
  returns table (meeting_id uuid, course_title text, listener_ids uuid[])
  language sql volatile security definer set search_path = public
  as $$
    with claimed as (
      update course_meetings m set start_notified_at = now()
      where m.status = 'scheduled'
        and m.start_notified_at is null
        and m.starts_at <= now()
        and m.starts_at >= now() - interval '2 minutes'
      returning m.id, m.course_id
    )
    select
      c.id,
      co.title,
      array(
        select cm.user_id
        from course_members cm
        join profiles p on p.id = cm.user_id
        where cm.course_id = c.course_id and p.access_status = 'approved'
        order by cm.user_id
      )
    from claimed c
    join courses co on co.id = c.course_id
  $$;
revoke execute on function claim_started_meetings() from public, anon, authenticated;
grant execute on function claim_started_meetings() to service_role;

-- AC 9: every minute, POST to the function with its secret. Both the URL and the secret are read from Vault on each
-- run (vault.create_secret(..., 'meeting_notify_url') / 'meeting_notify_secret'), so cron.job holds neither. The
-- function may take up to about 50 s when Telegram rate-limits, hence the 60 s timeout. Re-running replaces the job.
select cron.schedule(
  'meeting-start-notifications',
  '* * * * *',
  $job$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'meeting_notify_url'),
      headers := jsonb_build_object(
        'content-type', 'application/json',
        'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'meeting_notify_secret')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 60000
    )
  $job$
);
