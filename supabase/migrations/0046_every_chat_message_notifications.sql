-- ARU-87: a Telegram message for every new chat message, in course chats and the general chat.
--   * Course chats (changes ARU-44, 0036): chat_message_recipients() drops the read-position rules (c) and (d), so each
--     message notifies everyone in the chat except its author, whether or not they opened the chat since the last one.
--     Same signature and return type, so the service_role grant and the Edge Function's RPC call are unchanged.
--   * General chat (new): an after-insert trigger on general_messages queues one pg_net call to the same Edge Function
--     chat-message-notifications with {"general_message_id": "<id>"} (same Vault secrets chat_notify_url /
--     chat_notify_secret and the same CHAT_NOTIFY_SECRET, so nothing new to store); the function asks
--     general_message_recipients() and sends "New message in the general chat" with kind general_chat.
--   * A new switch telegram_links.notify_general_chat (default true, existing links get true) and the kind
--     'general_chat' in set_telegram_notification() (keeping every earlier kind, 0023 / 0044 / 0045).
--
-- Run after 0036, 0029 and 0045. No RLS policy changes, nothing deleted; messages posted before this migration are never
-- notified. Posting never fails because of this (the trigger only raises a warning). Setup: redeploy
-- chat-message-notifications (README -> Telegram notifications -> New chat messages).

-- AC 6: the general chat switch, on by default (existing links get true).
alter table telegram_links add column notify_general_chat boolean not null default true;

-- AC 6: set_telegram_notification() learns 'general_chat'; every earlier kind is kept. Grants are kept by
-- create or replace (authenticated only).
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
      else
        raise exception 'Unknown notification type: %', kind using errcode = '22023';
    end case;
  end $$;

-- AC 1-3: who gets a Telegram message for course chat message M (course C, author A), computed now: every user U with
--   (a) U is not A ("is distinct from": a deleted author is null, 0040 note 1);
--   (b) U Approved and in C's chat: C's owner, a listener of C, or any teacher (hidden courses: the same rule).
-- Read positions no longer matter (ARU-44's "one per batch" rules (c) and (d) are gone). One row (the course title now,
-- and the recipients) for a known message; no row for an unknown one.
create or replace function chat_message_recipients(message uuid)
  returns table (course_title text, recipient_ids uuid[])
  language sql stable security definer set search_path = public
  as $$
    select
      c.title,
      array(
        select p.id
        from profiles p
        where p.id is distinct from m.author_id
          and p.access_status = 'approved'
          and (
            p.role = 'teacher'
            or c.created_by = p.id
            or exists (select 1 from course_members cm where cm.course_id = m.course_id and cm.user_id = p.id)
          )
        order by p.id
      )
    from course_messages m
    join courses c on c.id = m.course_id
    where m.id = message
  $$;

-- AC 4 / AC 5: who gets a Telegram message for general chat message M, computed now: every Approved user except its
-- author. One row for a known message; no row for an unknown one. Service role only (the Edge Function).
create function general_message_recipients(message uuid)
  returns table (recipient_ids uuid[])
  language sql stable security definer set search_path = public
  as $$
    select array(
      select p.id
      from profiles p
      where p.id is distinct from m.author_id
        and p.access_status = 'approved'
      order by p.id
    )
    from general_messages m
    where m.id = message
  $$;
revoke execute on function general_message_recipients(uuid) from public, anon, authenticated;
grant execute on function general_message_recipients(uuid) to service_role;

-- AC 7 / AC 9: one POST per new general chat message, with the same URL and secret as course chats (Vault
-- 'chat_notify_url' / 'chat_notify_secret'). Same wrapping as notify_chat_message() (0036): a missing secret skips the
-- call and any error becomes a warning, so posting never fails; pg_net sends once, never retried. Named arguments (a
-- positional call would send the headers as query parameters); 30 s like course chats.
create function notify_general_message() returns trigger
  language plpgsql security definer set search_path = public
  as $$
  declare
    _url text;
    _secret text;
  begin
    begin
      select nullif(decrypted_secret, '') into _url from vault.decrypted_secrets where name = 'chat_notify_url' limit 1;
      select nullif(decrypted_secret, '') into _secret from vault.decrypted_secrets where name = 'chat_notify_secret' limit 1;
      if _url is not null and _secret is not null then
        perform net.http_post(
          url := _url,
          body := jsonb_build_object('general_message_id', new.id),
          headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || _secret),
          timeout_milliseconds := 30000
        );
      end if;
    exception when others then
      raise warning 'chat-message-notifications: not queued for general message %: % (%)', new.id, sqlerrm, sqlstate;
    end;
    return null;
  end $$;
revoke execute on function notify_general_message() from public, anon, authenticated;

-- AC 8: inserts only (general_messages has no update or delete policy anyway).
create trigger general_messages_notify after insert on general_messages
  for each row execute function notify_general_message();
