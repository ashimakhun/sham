-- ARU-112: the daily job that deletes homework photos 6 months after checking (ARU-107's rule), warns their senders
-- on Telegram 30 and 7 days before, and removes leftover photos from failed sends (ARU-105 AC 12). A pg_cron job
-- calls the Edge Function photo-deletion once a day through pg_net (the ARU-41 pattern, 0035); the function uses the
-- functions below with the service role. SQL can't delete Storage files: the function deletes them through the
-- Storage API and then records the removal here.
--
-- Adds homework.photo_removed_at, the warnings table photo_deletion_warnings, telegram_links.notify_photo_deletion
-- (on for existing and new links), the kind 'photo_deletion' in set_telegram_notification(), five service-role
-- functions and the daily cron job. Deletes nothing itself. Needs 0050 (ARU-107).
--
-- BEFORE running it (Supabase dashboard): Database → Extensions → turn on pg_cron and pg_net (already on if 0035 ran).
-- Without them this migration stops with a message saying so. Then store the function's URL and secret in Vault
-- (README → Homework photos → Daily deletion job). Until both are in Vault the job's call goes nowhere: nothing is
-- deleted, no warning is sent and the deletion start date stays empty (AC 8).

do $$
begin
  if to_regprocedure('cron.schedule(text,text,text)') is null then
    raise exception 'Turn on the pg_cron extension first (Database -> Extensions -> pg_cron), then run this again.';
  end if;
  if to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is null then
    raise exception 'Turn on the pg_net extension first (Database -> Extensions -> pg_net), then run this again.';
  end if;
end $$;

-- AC 2 / AC 6: when the job removed the photo; null = never removed. Readable like the rest of the row. Not in the
-- client update grant (0005 grants only status, checked_by, checked_at and mentor_comment), and the trigger below
-- keeps clients from setting it on insert (AC 9).
alter table homework add column photo_removed_at timestamptz;

create function homework_keep_photo_removed_at() returns trigger
  language plpgsql set search_path = public
  as $$
  begin
    if current_user in ('anon', 'authenticated') then
      new.photo_removed_at := case when tg_op = 'UPDATE' then old.photo_removed_at end;
    end if;
    return new;
  end $$;
create trigger homework_keep_photo_removed_at before insert or update on homework
  for each row execute function homework_keep_photo_removed_at();

-- AC 4: each photo's 30-day and 7-day marks, recorded once per homework whether or not a message could be sent (a
-- sender who isn't linked, isn't approved or has the switch off gets no backfill later, AC 5). RLS on with no policy,
-- like photo_zip_links (0050): app users read nothing (an empty result) and can't write (AC 9); only the service role
-- uses it, through claim_photo_deletion_warnings().
create table photo_deletion_warnings (
  homework_id uuid not null references homework (id) on delete cascade,
  mark smallint not null check (mark in (30, 7)),
  user_id uuid not null references profiles (id) on delete cascade,
  deletion_date date not null,
  created_at timestamptz not null default now(),
  primary key (homework_id, mark)
);
alter table photo_deletion_warnings enable row level security;

-- AC 5: the Photo deletion switch, on for existing and new links.
alter table telegram_links add column notify_photo_deletion boolean not null default true;

-- Same as 0048, plus 'photo_deletion'. Every existing kind stays.
create or replace function set_telegram_notification(kind text, enabled boolean) returns void
  language plpgsql security definer set search_path = public
  as $$
  begin
    if auth.uid() is null then
      raise exception 'Please sign in again.' using errcode = '42501', hint = 'sham:sign_in_again';
    end if;
    if enabled is null then
      raise exception 'Choose on or off.' using errcode = '22023', hint = 'sham:choose_on_off';
    end if;
    case kind
      when 'meeting_started' then
        update telegram_links set notify_meeting_started = enabled where user_id = auth.uid();
      when 'new_homework' then
        update telegram_links set notify_new_homework = enabled where user_id = auth.uid();
      when 'homework_reviewed' then
        update telegram_links set notify_homework_reviewed = enabled where user_id = auth.uid();
      when 'chat_message' then
        update telegram_links set notify_chat_message = enabled where user_id = auth.uid();
      when 'new_account' then
        update telegram_links set notify_new_account = enabled where user_id = auth.uid();
      when 'homework_submitted' then
        update telegram_links set notify_homework_submitted = enabled where user_id = auth.uid();
      when 'general_chat' then
        update telegram_links set notify_general_chat = enabled where user_id = auth.uid();
      when 'new_material' then
        update telegram_links set notify_new_material = enabled where user_id = auth.uid();
      when 'photo_deletion' then
        update telegram_links set notify_photo_deletion = enabled where user_id = auth.uid();
      else
        raise exception 'Unknown notification type: %', kind using errcode = '22023';
    end case;
  end $$;

-- AC 1: sets the deletion start date to today (UTC) + 30 days if it is still empty, and says whether this call set
-- it. Later calls never change it. The row lock makes two runs at once agree on one first run.
create function start_photo_deletion() returns table (start_date date, first_run boolean)
  language plpgsql volatile security definer set search_path = public
  as $$
  declare
    s date;
  begin
    select photo_deletion_start into s from app_settings where id for update;
    if s is null then
      s := (now() at time zone 'utc')::date + 30;
      update app_settings set photo_deletion_start = s where id;
      return query select s, true;
    else
      return query select s, false;
    end if;
  end $$;

-- AC 7: files in the homework bucket that no homework points to, older than 24 hours (a send may still be in
-- progress). Only the homework bucket; at most `max_files`, oldest first.
create function leftover_homework_photos(max_files integer) returns table (name text)
  language sql stable security definer set search_path = public
  as $$
    select o.name
    from storage.objects o
    where o.bucket_id = 'homework'
      and o.created_at < now() - interval '24 hours'
      and not exists (select 1 from homework h where h.photo_path = o.name)
    order by o.created_at, o.name
    limit max_files
  $$;

-- AC 2: checked homework whose deletion date is today (UTC) or earlier and that still has a photo. Most overdue
-- first, so a run that stops at `max_photos` always takes the oldest (edge case: many due at once). Unchecked
-- homework has no checked_at (0050), so no deletion date; homework in hidden courses is included like any other.
create function due_homework_photos(max_photos integer) returns table (homework_id uuid, photo_path text)
  language sql stable security definer set search_path = public
  as $$
    select h.id, h.photo_path
    from homework h
    where h.photo_path is not null
      and photo_deletion_date(h.checked_at) <= (now() at time zone 'utc')::date
    order by photo_deletion_date(h.checked_at), h.checked_at, h.id
    limit max_photos
  $$;

-- AC 2 / AC 3: after the files were deleted from Storage (or were already missing), clears photo_path and stores the
-- removal time. Only rows that still point at the file that was deleted change, so a homework sent again in the
-- meantime keeps its new photo. Returns how many rows changed.
create function mark_homework_photos_removed(homework_ids uuid[], photo_paths text[]) returns integer
  language plpgsql volatile security definer set search_path = public
  as $$
  declare
    n integer;
  begin
    update homework h set photo_path = null, photo_removed_at = now()
    from unnest(homework_ids, photo_paths) as d(id, path)
    where h.id = d.id and h.photo_path = d.path;
    get diagnostics n = row_count;
    return n;
  end $$;

-- AC 4: records every 30-day and 7-day mark reached since the last run and returns, per Approved student or mentor
-- with at least one new mark, how many of their photos reached a mark in this call and the earliest of those photos'
-- deletion dates (one message per user per run). A photo first seen with 7 days or less left gets both marks at once.
-- Only photos still stored with a deletion date after today count; a second call the same day returns nothing new.
create function claim_photo_deletion_warnings()
  returns table (user_id uuid, photo_count integer, earliest date)
  language sql volatile security definer set search_path = public
  as $$
    with today as (select (now() at time zone 'utc')::date as d),
    candidates as (
      select h.id, h.student_id, photo_deletion_date(h.checked_at) as del
      from homework h
      where h.photo_path is not null and h.checked_at is not null
    ),
    reached as (
      select c.id, c.student_id, c.del, m.mark
      from candidates c, today, (values (30::smallint), (7::smallint)) as m (mark)
      where c.del is not null and c.del > today.d and c.del - today.d <= m.mark
    ),
    inserted as (
      insert into photo_deletion_warnings (homework_id, mark, user_id, deletion_date)
      select id, mark, student_id, del from reached
      on conflict (homework_id, mark) do nothing
      returning homework_id, user_id, deletion_date
    )
    select i.user_id, count(distinct i.homework_id)::integer, min(i.deletion_date)
    from inserted i
    join profiles p on p.id = i.user_id and p.access_status = 'approved' and p.role in ('student', 'mentor')
    group by i.user_id
  $$;

revoke execute on function start_photo_deletion() from public, anon, authenticated;
revoke execute on function leftover_homework_photos(integer) from public, anon, authenticated;
revoke execute on function due_homework_photos(integer) from public, anon, authenticated;
revoke execute on function mark_homework_photos_removed(uuid[], text[]) from public, anon, authenticated;
revoke execute on function claim_photo_deletion_warnings() from public, anon, authenticated;
grant execute on function start_photo_deletion() to service_role;
grant execute on function leftover_homework_photos(integer) to service_role;
grant execute on function due_homework_photos(integer) to service_role;
grant execute on function mark_homework_photos_removed(uuid[], text[]) to service_role;
grant execute on function claim_photo_deletion_warnings() to service_role;

-- AC 8: once a day at 03:17 UTC, POST to the function with its secret. The URL and the secret are read from Vault on
-- each run ('photo_deletion_url' / 'photo_deletion_secret'), so cron.job holds neither; with either missing, the
-- call goes nowhere and nothing happens. Up to about 2 minutes for a large first deletion day. Re-running replaces it.
select cron.schedule(
  'photo-deletion',
  '17 3 * * *',
  $job$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'photo_deletion_url'),
      headers := jsonb_build_object(
        'content-type', 'application/json',
        'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'photo_deletion_secret')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 120000
    )
  $job$
);
