-- ARU-49: a Telegram message to the sender of a homework when it is checked ("Your homework for <course title> was
-- reviewed"), sent through the Sham bot (ARU-48). When a homework's status goes submitted -> checked, an after-update
-- trigger queues one pg_net POST to the Edge Function homework-reviewed-notifications with {"homework_id": "<id>"}
-- and the shared secret; the function asks homework_reviewed_recipient() who (if anyone) gets the message, then sends.
--
-- Run after 0023_telegram_links.sql. Adds two functions and a trigger; no table, column or RLS policy changes, and no
-- data is changed. Existing (already checked) homework never sends anything.
--
-- Checking homework never fails because of this: if pg_net is missing, the Vault secrets aren't set or the call raises,
-- the trigger only raises a warning. Setup (Vault secrets, function secret, deploy): README -> Telegram notifications
-- -> Homework reviewed.

-- pg_net, only where the server offers it (Supabase does; a plain Postgres doesn't, and the trigger then skips).
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net;
  end if;
end $$;

-- AC 8: who gets the message for one homework, computed when called (by the Edge Function, service role only).
-- Returns the course title (current) and the sender when: the homework is checked; the sender is Approved; the sender
-- can still see the course (not hidden, or they own it or are a listener). Otherwise, or for an unknown id, no row.
-- Caller-based helpers (is_approved(), course_hidden_from_me()) read auth.uid(), which is null for the service role,
-- so the sender is checked explicitly here.
create function homework_reviewed_recipient(homework uuid)
  returns table (course_title text, user_id uuid)
  language sql stable security definer set search_path = public
  as $$
    select c.title, h.student_id
    from homework h
    join courses c on c.id = h.course_id
    join profiles p on p.id = h.student_id
    where h.id = homework_reviewed_recipient.homework
      and h.status = 'checked'
      and p.access_status = 'approved'
      and (
        not c.hidden
        or c.created_by = h.student_id
        or exists (select 1 from course_members cm where cm.course_id = c.id and cm.user_id = h.student_id)
      )
  $$;
revoke execute on function homework_reviewed_recipient(uuid) from public, anon, authenticated;
grant execute on function homework_reviewed_recipient(uuid) to service_role;

-- AC 7: queue one POST to the Edge Function per submitted -> checked change. The URL and the secret are read from
-- Vault on each call ('homework_reviewed_notify_url', 'homework_reviewed_notify_secret'); if either is missing,
-- nothing is queued. Everything is inside begin ... exception, so the update itself never fails (AC 6). pg_net sends
-- after the transaction commits, and only once (at most once: nothing retries a failed send).
create function notify_homework_reviewed()
  returns trigger
  language plpgsql security definer set search_path = public
  as $$
  declare
    notify_url text;
    notify_secret text;
  begin
    begin
      select decrypted_secret into notify_url
        from vault.decrypted_secrets where name = 'homework_reviewed_notify_url' limit 1;
      select decrypted_secret into notify_secret
        from vault.decrypted_secrets where name = 'homework_reviewed_notify_secret' limit 1;
      if coalesce(notify_url, '') = '' or coalesce(notify_secret, '') = '' then
        return null;
      end if;
      perform net.http_post(
        url := notify_url,
        body := jsonb_build_object('homework_id', new.id),
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || notify_secret
        ),
        timeout_milliseconds := 5000
      );
    exception when others then
      raise warning 'homework reviewed notification for % not queued: % %', new.id, sqlstate, sqlerrm;
    end;
    return null;
  end $$;
revoke execute on function notify_homework_reviewed() from public, anon, authenticated;

-- AC 4: only the submitted -> checked change; an update that keeps the status (or any other change) sends nothing.
create trigger homework_reviewed_notify
  after update of status on homework
  for each row
  when (old.status = 'submitted' and new.status = 'checked')
  execute function notify_homework_reviewed();
