-- ARU-50: a Telegram message to a course's listeners when new homework is assigned ("New homework assigned to you in
-- <course title>"), sent through the Sham bot (ARU-48). An after-insert trigger on homework_assignments queues one
-- pg_net call to the Edge Function new-homework-notifications with the assignment id; the function asks
-- new_homework_recipients() for the listeners at that moment and sends through the shared helper.
--
-- Run after 0023_telegram_links.sql and 0034 (it doesn't depend on 0035-0037). Adds two functions and a trigger;
-- no table, column or policy changes, homework_assignments_before_insert() and the homework_assignments policies are
-- unchanged, nothing is deleted. Existing assignments send nothing (only new inserts do).
--
-- Setup (README -> Telegram notifications -> New homework): turn on pg_net, store 'new_homework_notify_url' and
-- 'new_homework_notify_secret' in Vault, set NEW_HOMEWORK_NOTIFY_SECRET and deploy the function. Until then the trigger
-- skips the call and assigning works exactly as before.

-- pg_net, only where the server offers it and it isn't there yet (AC 7: without it the trigger just logs a warning).
do $$
begin
  if to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is null
     and exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net;
  end if;
exception when others then
  raise warning 'pg_net could not be enabled (%); new homework notifications stay off until it is.', sqlerrm;
end $$;

-- AC 9: who gets the message for an assignment, computed when called (AC 5): the current listeners of its course
-- (hidden courses too, AC 6) whose account is Approved, students and mentors only, never the assigner or the owner.
-- The owner and the teacher can't be listeners anyway (0004, 0007, 0009); the extra filters keep AC 2 true if that
-- ever changes. Unknown id or no listeners: no rows. Service role only (the Edge Function).
create function new_homework_recipients(assignment uuid)
  returns table (course_title text, user_id uuid)
  language sql stable security definer set search_path = public
  as $$
    select c.title, cm.user_id
    from homework_assignments a
    join courses c on c.id = a.course_id
    join course_members cm on cm.course_id = a.course_id
    join profiles p on p.id = cm.user_id
    where a.id = assignment
      and p.access_status = 'approved'
      and p.role in ('student', 'mentor')
      and cm.user_id <> a.created_by
      and cm.user_id <> c.created_by
    order by cm.user_id
  $$;
revoke execute on function new_homework_recipients(uuid) from public, anon, authenticated;
grant execute on function new_homework_recipients(uuid) to service_role;

-- AC 8: after each inserted assignment, queue one POST {"assignment_id": "<id>"} with "Authorization: Bearer <secret>"
-- and a 5 s timeout. Both the URL and the secret come from Vault; if either is missing nothing is queued. Everything
-- runs inside its own exception block, so no failure here (no Vault, no pg_net, the call raising) can make the insert
-- fail (AC 7). pg_net sends once and never retries (at most once). A retried or rejected insert never reaches this
-- trigger (AC 4): the before-trigger, the policy or the primary key stops it first.
create function homework_assignments_notify_new() returns trigger
  language plpgsql security definer set search_path = public
  as $$
  declare
    v_url text;
    v_secret text;
  begin
    begin
      select decrypted_secret into v_url from vault.decrypted_secrets where name = 'new_homework_notify_url' limit 1;
      select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'new_homework_notify_secret' limit 1;
      if coalesce(v_url, '') <> '' and coalesce(v_secret, '') <> '' then
        perform net.http_post(
          url := v_url,
          body := jsonb_build_object('assignment_id', new.id),
          params := '{}'::jsonb,
          headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_secret),
          timeout_milliseconds := 5000
        );
      end if;
    exception when others then
      raise warning 'new homework notification for assignment % not queued: % %', new.id, sqlstate, sqlerrm;
    end;
    return null;
  end $$;
revoke execute on function homework_assignments_notify_new() from public, anon, authenticated;

create trigger homework_assignments_notify_new after insert on homework_assignments
  for each row execute function homework_assignments_notify_new();
