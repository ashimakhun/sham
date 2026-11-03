-- ARU-89: a Telegram message to a course's owner when a listener submits homework ("New homework to check from
-- <sender name> in <course title>: <assignment title>"), sent through the Sham bot (ARU-48). An after-insert trigger on
-- homework queues one pg_net POST to the Edge Function homework-submitted-notifications with {"homework_id": "<id>"};
-- the function asks homework_submitted_recipient() who (if anyone) gets the message at that moment, then sends.
--
-- Run after 0023_telegram_links.sql, 0014 and 0044 (it keeps 0044's 'new_account' kind in set_telegram_notification()).
-- Adds the column telegram_links.notify_homework_submitted (default true, existing links get true), the kind
-- 'homework_submitted', two functions and a trigger. No RLS policy changes; existing homework never sends anything.
--
-- Submitting never fails because of this: if pg_net is missing, the Vault secrets aren't set or the call raises, the
-- trigger only raises a warning. Setup (Vault secrets, function secret, deploy): README -> Telegram notifications ->
-- Homework submitted.

-- pg_net, only where the server offers it and it isn't there yet (without it the trigger just logs a warning).
do $$
begin
  if to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is null
     and exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net;
  end if;
exception when others then
  raise warning 'pg_net could not be enabled (%); homework submitted notifications stay off until it is.', sqlerrm;
end $$;

-- AC 4: the owner's switch, on by default (existing links get true).
alter table telegram_links add column notify_homework_submitted boolean not null default true;

-- AC 4: set_telegram_notification() learns 'homework_submitted'; every earlier kind is kept (0023, 0044). Grants are
-- kept by create or replace (authenticated only).
create or replace function set_telegram_notification(kind text, enabled boolean) returns void
  language plpgsql security definer set search_path = public
  as $$
  begin
    if auth.uid() is null then
      raise exception 'Please sign in again.' using errcode = '42501';
    end if;
    if enabled is null then
      raise exception 'Choose on or off.' using errcode = '22023';
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
      else
        raise exception 'Unknown notification type: %', kind using errcode = '22023';
    end case;
  end $$;

-- AC 2 / AC 5 / AC 8: who gets the message for one homework, computed when called (by the Edge Function, service role
-- only): the course's current owner, if Approved and still a teacher or mentor, never the sender. Returns the course
-- title, the assignment title and the sender's name (current values). Deleted homework or course, unknown id, owner
-- not Approved or made a student: no row.
create function homework_submitted_recipient(homework uuid)
  returns table (course_title text, assignment_title text, sender_name text, user_id uuid)
  language sql stable security definer set search_path = public
  as $$
    select c.title, a.title, s.full_name, o.id
    from homework h
    join homework_assignments a on a.id = h.assignment_id
    join courses c on c.id = h.course_id
    join profiles s on s.id = h.student_id
    join profiles o on o.id = c.created_by
    where h.id = homework_submitted_recipient.homework
      and o.access_status = 'approved'
      and o.role in ('teacher', 'mentor')
      and o.id <> h.student_id
  $$;
revoke execute on function homework_submitted_recipient(uuid) from public, anon, authenticated;
grant execute on function homework_submitted_recipient(uuid) to service_role;

-- AC 7 / AC 8: after each inserted homework, queue one POST {"homework_id": "<id>"} with "Authorization: Bearer
-- <secret>" and a 5 s timeout. Both the URL and the secret come from Vault; if either is missing nothing is queued.
-- Everything is inside its own exception block, so no failure here can make the insert fail. pg_net sends once and
-- never retries (at most once). A retried submit with the same id is refused by the primary key (the app treats that
-- as success) and never reaches this trigger (AC 3).
create function notify_homework_submitted() returns trigger
  language plpgsql security definer set search_path = public
  as $$
  declare
    v_url text;
    v_secret text;
  begin
    begin
      select decrypted_secret into v_url from vault.decrypted_secrets where name = 'homework_submitted_notify_url' limit 1;
      select decrypted_secret into v_secret
        from vault.decrypted_secrets where name = 'homework_submitted_notify_secret' limit 1;
      if coalesce(v_url, '') <> '' and coalesce(v_secret, '') <> '' then
        perform net.http_post(
          url := v_url,
          body := jsonb_build_object('homework_id', new.id),
          params := '{}'::jsonb,
          headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_secret),
          timeout_milliseconds := 5000
        );
      end if;
    exception when others then
      raise warning 'homework submitted notification for % not queued: % %', new.id, sqlstate, sqlerrm;
    end;
    return null;
  end $$;
revoke execute on function notify_homework_submitted() from public, anon, authenticated;

-- AC 6: inserts only; status, comment or any other update never fires it.
create trigger homework_notify_submitted after insert on homework
  for each row execute function notify_homework_submitted();
