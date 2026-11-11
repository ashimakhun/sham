-- ARU-151: a Telegram message to the course when someone publishes meeting notes ("New notes from <author name> on a
-- <course title> meeting"), sent through the Sham bot (ARU-48) in each recipient's language (ARU-110). A note is
-- announced once in its life: when it is first public (saved with Publish on, or switched from private to public
-- later). Text edits, notes made private and public → private → public again never send anything.
--
--   * telegram_links.notify_meeting_notes: the Meeting notes switch, on by default (existing links get true, AC 7);
--     set_telegram_notification() learns 'meeting_notes' and keeps every earlier kind (0054).
--   * meeting_listener_notes.announced: set by the database, never by the app (writes only go through the notes
--     functions, and the before trigger below overrides whatever is sent). Every note that is public when this ships
--     is already announced (AC 8). Setting it never touches updated_at, so no "Edited" (ANALYSIS note 1).
--   * meeting_notes_recipients(note): who gets the message, computed when the Edge Function asks (service role only).
--   * A before trigger sets `announced` when the row becomes public; an after trigger queues one pg_net POST
--     {"id": "<note id>"} to the Edge Function meeting-notes-notifications when that just happened (AC 10).
--
-- Saving notes never fails because of this (AC 9): if pg_net is missing, the Vault secrets aren't set or the call
-- raises, the trigger only raises a warning. pg_net sends once and never retries. No RLS policy changes. Needs 0054
-- (set_telegram_notification with photo_deletion), 0058 (is_public) and 0059 (workspaces). Setup (Vault secrets,
-- function secret, deploy): README -> Telegram notifications -> Meeting notes.

-- pg_net, only where the server offers it and it isn't there yet (without it the trigger just logs a warning).
do $$
begin
  if to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is null
     and exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net;
  end if;
exception when others then
  raise warning 'pg_net could not be enabled (%); meeting notes notifications stay off until it is.', sqlerrm;
end $$;

-- AC 7: the switch, on by default (existing links get true).
alter table telegram_links add column notify_meeting_notes boolean not null default true;

-- AC 3 / AC 8: a note is announced at most once. Notes that are public now count as announced. Triggers are off for
-- this fill (as in 0059), so it changes nothing else and sends no realtime events.
alter table meeting_listener_notes add column announced boolean not null default false;
alter table meeting_listener_notes disable trigger user;
update meeting_listener_notes set announced = true where is_public;
alter table meeting_listener_notes enable trigger user;

-- AC 7: set_telegram_notification() learns 'meeting_notes'; every earlier kind is kept (latest: 0054). Grants are kept
-- by create or replace (authenticated only).
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
      when 'meeting_notes' then
        update telegram_links set notify_meeting_notes = enabled where user_id = auth.uid();
      else
        raise exception 'Unknown notification type: %', kind using errcode = '22023';
    end case;
  end $$;

-- Recipients (AC 1, 4, 5, 6): for a public note N, the Approved accounts that can read it in the app (0058's select
-- policy, `is_public and notes_writer(course_id)`, evaluated for each of them): the course's current listeners, its
-- current owner and the teacher, in the course's workspace (0059), except N's author. A hidden course is never hidden
-- from these people (course_hidden_from_me()), so it removes no one. Only users with a Telegram link and Meeting notes
-- on are returned (ANALYSIS note 5). Each row carries the author's name and the course title (current values).
-- A private, deleted or unknown note, or one whose author's account is gone (author_id null): no rows.
create function meeting_notes_recipients(note uuid)
  returns table (user_id uuid, author_name text, course_title text)
  language sql stable security definer set search_path = public
  as $$
    select p.id, a.full_name, c.title
    from meeting_listener_notes n
    join courses c on c.id = n.course_id
    join profiles a on a.id = n.author_id
    join profiles p on p.id <> n.author_id and p.access_status = 'approved' and p.workspace_id = c.workspace_id
    join telegram_links l on l.user_id = p.id and l.notify_meeting_notes
    where n.id = meeting_notes_recipients.note
      and n.is_public
      and (
        p.role = 'teacher'
        or c.created_by = p.id
        or exists (select 1 from course_members cm where cm.course_id = c.id and cm.user_id = p.id)
      )
    order by p.id
  $$;
revoke execute on function meeting_notes_recipients(uuid) from public, anon, authenticated;
grant execute on function meeting_notes_recipients(uuid) to service_role;

-- AC 3 / AC 10: `announced` is the database's: a new note is announced when it's saved public; an existing one once it
-- is first public, and then forever. Whatever a writer sends is overridden.
create function meeting_listener_notes_announce() returns trigger
  language plpgsql security definer set search_path = public
  as $$
  begin
    if tg_op = 'INSERT' then
      new.announced := coalesce(new.is_public, false);
    else
      new.announced := coalesce(old.announced, false) or coalesce(new.is_public, false);
    end if;
    return new;
  end $$;
revoke execute on function meeting_listener_notes_announce() from public, anon, authenticated;
create trigger meeting_listener_notes_announce before insert or update on meeting_listener_notes
  for each row execute function meeting_listener_notes_announce();

-- AC 9 / AC 10: queue one POST {"id": "<note id>"} with "Authorization: Bearer <secret>" and a 5 s timeout. Both the
-- URL and the secret come from Vault; if either is missing nothing is queued. Everything is inside its own exception
-- block, so no failure here can make the save fail. pg_net sends once and never retries (at most once).
create function queue_meeting_notes_notification(note uuid) returns void
  language plpgsql security definer set search_path = public
  as $$
  declare
    v_url text;
    v_secret text;
  begin
    begin
      select decrypted_secret into v_url from vault.decrypted_secrets where name = 'meeting_notes_notify_url' limit 1;
      select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'meeting_notes_notify_secret' limit 1;
      if coalesce(v_url, '') <> '' and coalesce(v_secret, '') <> '' then
        perform net.http_post(
          url := v_url,
          body := jsonb_build_object('id', queue_meeting_notes_notification.note),
          params := '{}'::jsonb,
          headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_secret),
          timeout_milliseconds := 5000
        );
      end if;
    exception when others then
      raise warning 'meeting notes notification for % not queued: % %',
        queue_meeting_notes_notification.note, sqlstate, sqlerrm;
    end;
  end $$;
revoke execute on function queue_meeting_notes_notification(uuid) from public, anon, authenticated;

-- AC 1-3: only when this write announced the note (inserted public, or first made public). A rejected save rolls back
-- with the queued call.
create function notify_meeting_notes_published() returns trigger
  language plpgsql security definer set search_path = public
  as $$
  begin
    begin
      if new.announced and (tg_op = 'INSERT' or not coalesce(old.announced, false)) then
        perform queue_meeting_notes_notification(new.id);
      end if;
    exception when others then
      raise warning 'meeting notes notification for % not queued: % %', new.id, sqlstate, sqlerrm;
    end;
    return null;
  end $$;
revoke execute on function notify_meeting_notes_published() from public, anon, authenticated;
create trigger meeting_listener_notes_notify after insert or update on meeting_listener_notes
  for each row execute function notify_meeting_notes_published();
