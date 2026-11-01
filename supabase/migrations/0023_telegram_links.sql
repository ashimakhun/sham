-- Telegram notifications setup (ARU-48): a Sham account is linked to a private chat with the Sham Telegram bot
-- through a one-time code, and its owner chooses which notification types they get there. This migration only
-- stores links and switches; sending is the shared Edge Function helper (supabase/functions/_shared/telegram.ts)
-- and each notification story (ARU-41, ARU-44, ARU-49, ARU-50). Run after 0021_account_approval.sql (uses
-- is_approved()) and 0022 if present (independent of it). Adds two tables and five functions; changes nothing else.
--
-- Access:
--   telegram_links       each signed-in user reads only their own row (not even the teacher sees others');
--                        nobody writes directly: only the functions below and the service role (the Edge Functions).
--   telegram_link_codes  no access at all for app users; only the functions and the service role.
--   create_telegram_link_code(), set_telegram_notification(), disconnect_telegram()   any signed-in user (approved for
--                        the first one); they act on the caller's own row only.
--   link_telegram_chat(), unlink_telegram_chat()   service role only: called by the telegram-webhook Edge Function.
-- Not in the realtime publication: the app refetches when the Profile tab is focused or the app comes back.

create table telegram_links (
  user_id uuid primary key references profiles (id) on delete cascade,
  -- One Telegram chat per account and one account per chat.
  chat_id bigint not null unique,
  linked_at timestamptz not null default now(),
  notify_meeting_started boolean not null default true,
  notify_new_homework boolean not null default true,
  notify_homework_reviewed boolean not null default true,
  notify_chat_message boolean not null default true
);

alter table telegram_links enable row level security;
create policy "own telegram link readable" on telegram_links for select to authenticated using (user_id = auth.uid());
revoke insert, update, delete, truncate on telegram_links from anon, authenticated;

-- Telegram allows [A-Za-z0-9_-], at most 64 characters, in a /start parameter.
create table telegram_link_codes (
  code text primary key check (code ~ '^[A-Za-z0-9_-]{1,64}$'),
  user_id uuid not null references profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  used_at timestamptz
);
create index telegram_link_codes_user_idx on telegram_link_codes (user_id);

-- RLS on and no policy: app users read nothing (an empty result, like every other table they can't see) and can't
-- write; only the functions and the service role touch codes.
alter table telegram_link_codes enable row level security;
revoke insert, update, delete, truncate on telegram_link_codes from anon, authenticated;

-- A new one-time code for the caller (valid 15 minutes, see link_telegram_chat). Approved accounts only. The caller's
-- earlier unused codes are deleted, so only the newest link works; used codes stay.
create function create_telegram_link_code() returns text
  language plpgsql volatile security definer set search_path = public
  as $$
  declare
    new_code text;
  begin
    if auth.uid() is null or not is_approved() then
      raise exception 'Only accepted accounts can connect Telegram.' using errcode = '42501';
    end if;
    delete from telegram_link_codes c where c.user_id = auth.uid() and c.used_at is null;
    -- 64 hex characters from two random UUIDs (about 244 random bits).
    new_code := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
    insert into telegram_link_codes (code, user_id) values (new_code, auth.uid());
    return new_code;
  end $$;

-- Turns one notification type on or off for the caller. Unknown types are an error; not linked: nothing happens.
create function set_telegram_notification(kind text, enabled boolean) returns void
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
      else
        raise exception 'Unknown notification type: %', kind using errcode = '22023';
    end case;
  end $$;

-- Removes the caller's link and switches. No error if not linked.
create function disconnect_telegram() returns void
  language plpgsql security definer set search_path = public
  as $$
  begin
    if auth.uid() is null then
      raise exception 'Please sign in again.' using errcode = '42501';
    end if;
    delete from telegram_links where user_id = auth.uid();
  end $$;

revoke execute on function create_telegram_link_code() from public, anon;
revoke execute on function set_telegram_notification(text, boolean) from public, anon;
revoke execute on function disconnect_telegram() from public, anon;
grant execute on function create_telegram_link_code() to authenticated;
grant execute on function set_telegram_notification(text, boolean) to authenticated;
grant execute on function disconnect_telegram() to authenticated;

-- The bot (service role): links a private chat with a code from /start. Returns the account's name, or null when the
-- code is unknown, used, older than 15 minutes, or its account is no longer approved. In one call: marks the code used,
-- moves the chat away from any other account, and replaces this account's earlier chat (its switches are kept).
create function link_telegram_chat(code text, chat_id bigint) returns text
  language plpgsql security definer set search_path = public
  as $$
  declare
    c telegram_link_codes%rowtype;
    who text;
  begin
    if link_telegram_chat.code is null or link_telegram_chat.chat_id is null then
      return null;
    end if;
    select * into c from telegram_link_codes t where t.code = link_telegram_chat.code for update;
    if not found or c.used_at is not null or c.created_at < now() - interval '15 minutes' then
      return null;
    end if;
    select p.full_name into who from profiles p where p.id = c.user_id and p.access_status = 'approved';
    if not found then
      return null;
    end if;
    update telegram_link_codes t set used_at = now() where t.code = c.code;
    delete from telegram_links l where l.chat_id = link_telegram_chat.chat_id and l.user_id <> c.user_id;
    insert into telegram_links as l (user_id, chat_id) values (c.user_id, link_telegram_chat.chat_id)
      on conflict (user_id) do update set chat_id = excluded.chat_id, linked_at = now();
    return who;
  end $$;

-- The bot (service role): /stop. No error when the chat isn't linked.
create function unlink_telegram_chat(chat_id bigint) returns void
  language plpgsql security definer set search_path = public
  as $$
  begin
    delete from telegram_links l where l.chat_id = unlink_telegram_chat.chat_id;
  end $$;

revoke execute on function link_telegram_chat(text, bigint) from public, anon, authenticated;
revoke execute on function unlink_telegram_chat(bigint) from public, anon, authenticated;
grant execute on function link_telegram_chat(text, bigint) to service_role;
grant execute on function unlink_telegram_chat(bigint) to service_role;
