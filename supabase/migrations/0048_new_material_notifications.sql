-- ARU-102: a Telegram message when a teacher or mentor shares a new Blog post ("New blog post from <author name>:
-- <post title>") or a new Knowledge base PDF ("New file in the knowledge base from <author name>: <file name>"), sent
-- through the Sham bot (ARU-48). After-insert triggers on materials and material_files queue one pg_net POST to the
-- Edge Function new-material-notifications with {"type": "blog" | "file", "id": "<id>"}; the function asks
-- new_material_recipients() who gets the message at that moment, then sends with kind new_material.
--
-- Run after 0046 (it keeps every kind from 0046 in set_telegram_notification()) and 0047. Adds the column
-- telegram_links.notify_new_material (default true, existing links get true), the kind 'new_material', one recipient
-- function, two trigger functions and two triggers. No RLS policy changes; items shared before this migration never
-- send anything.
--
-- Publishing never fails because of this: if pg_net is missing, the Vault secrets aren't set or the call raises, the
-- trigger only raises a warning. Setup (Vault secrets, function secret, deploy): README -> Telegram notifications ->
-- New materials.

-- pg_net, only where the server offers it and it isn't there yet (without it the triggers just log a warning).
do $$
begin
  if to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is null
     and exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net;
  end if;
exception when others then
  raise warning 'pg_net could not be enabled (%); new material notifications stay off until it is.', sqlerrm;
end $$;

-- AC 5: the switch, on by default (existing links get true).
alter table telegram_links add column notify_new_material boolean not null default true;

-- AC 5: set_telegram_notification() learns 'new_material'; every earlier kind is kept (0023, 0044, 0045, 0046).
-- Grants are kept by create or replace (authenticated only).
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
      when 'general_chat' then
        update telegram_links set notify_general_chat = enabled where user_id = auth.uid();
      when 'new_material' then
        update telegram_links set notify_new_material = enabled where user_id = auth.uid();
      else
        raise exception 'Unknown notification type: %', kind using errcode = '22023';
    end case;
  end $$;

-- AC 1-4 / AC 7 / AC 10: who gets a message for new item M, computed when called (by the Edge Function, service role
-- only). The readers of M in the app (as can_see_material_file(), 0021), except M's author:
--   * a Blog post ('blog', table materials): every Approved account;
--   * a PDF ('file', table material_files) that isn't course-only, or whose course is gone: every Approved account;
--   * a course-only PDF: Approved accounts that are a teacher, the course's current owner or one of its listeners.
-- Only users with a Telegram link and New materials on are returned (the helper would skip the rest anyway; this keeps
-- the list and the send short, ANALYSIS note 2). Each row carries the author's name and the post title or file name
-- (current values). Deleted item, unknown type or id: no rows.
create function new_material_recipients(type text, item uuid)
  returns table (user_id uuid, author_name text, item_title text)
  language sql stable security definer set search_path = public
  as $$
    with m as (
      select b.teacher_id as author_id, b.title as title, false as course_only, null::uuid as course_id
        from materials b
        where new_material_recipients.type = 'blog' and b.id = new_material_recipients.item
      union all
      select f.author_id, f.name, f.course_only, f.course_id
        from material_files f
        where new_material_recipients.type = 'file' and f.id = new_material_recipients.item
    )
    select p.id, a.full_name, m.title
    from m
    join profiles a on a.id = m.author_id
    join profiles p on p.id <> m.author_id and p.access_status = 'approved'
    join telegram_links l on l.user_id = p.id and l.notify_new_material
    where not m.course_only
       or m.course_id is null
       or p.role = 'teacher'
       or exists (select 1 from courses c where c.id = m.course_id and c.created_by = p.id)
       or exists (select 1 from course_members cm where cm.course_id = m.course_id and cm.user_id = p.id)
    order by p.id
  $$;
revoke execute on function new_material_recipients(text, uuid) from public, anon, authenticated;
grant execute on function new_material_recipients(text, uuid) to service_role;

-- AC 8 / AC 9: queue one POST {"type": <type>, "id": "<id>"} with "Authorization: Bearer <secret>" and a 5 s timeout.
-- Both the URL and the secret come from Vault; if either is missing nothing is queued. Everything is inside its own
-- exception block, so no failure here can make the insert fail. pg_net sends once and never retries (at most once).
create function queue_new_material_notification(type text, item uuid) returns void
  language plpgsql security definer set search_path = public
  as $$
  declare
    v_url text;
    v_secret text;
  begin
    begin
      select decrypted_secret into v_url from vault.decrypted_secrets where name = 'new_material_notify_url' limit 1;
      select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'new_material_notify_secret' limit 1;
      if coalesce(v_url, '') <> '' and coalesce(v_secret, '') <> '' then
        perform net.http_post(
          url := v_url,
          body := jsonb_build_object('type', queue_new_material_notification.type, 'id', queue_new_material_notification.item),
          params := '{}'::jsonb,
          headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_secret),
          timeout_milliseconds := 5000
        );
      end if;
    exception when others then
      raise warning 'new material notification for % % not queued: % %',
        queue_new_material_notification.type, queue_new_material_notification.item, sqlstate, sqlerrm;
    end;
  end $$;
revoke execute on function queue_new_material_notification(text, uuid) from public, anon, authenticated;

create function notify_new_blog_post() returns trigger
  language plpgsql security definer set search_path = public
  as $$
  begin
    begin
      perform queue_new_material_notification('blog', new.id);
    exception when others then
      raise warning 'new material notification for blog % not queued: % %', new.id, sqlstate, sqlerrm;
    end;
    return null;
  end $$;
revoke execute on function notify_new_blog_post() from public, anon, authenticated;

create function notify_new_material_file() returns trigger
  language plpgsql security definer set search_path = public
  as $$
  begin
    begin
      perform queue_new_material_notification('file', new.id);
    exception when others then
      raise warning 'new material notification for file % not queued: % %', new.id, sqlstate, sqlerrm;
    end;
    return null;
  end $$;
revoke execute on function notify_new_material_file() from public, anon, authenticated;

-- AC 6: inserts only; edits (name, description, course, course-only) and deletes never fire them. A rejected insert
-- (RLS, check constraints, the before-write trigger) rolls back with the queued call.
create trigger materials_notify_new after insert on materials
  for each row execute function notify_new_blog_post();
create trigger material_files_notify_new after insert on material_files
  for each row execute function notify_new_material_file();
