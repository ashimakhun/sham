-- ARU-84: a Telegram message to the teacher when someone creates an account and waits for approval ("New account
-- waiting for your approval: <name>. Open Sham → Manage roles to accept or decline."), sent through the Sham bot
-- (ARU-48). An after-insert trigger on profiles (only rows inserted as 'pending', i.e. Auth sign-ups) queues one pg_net
-- POST to the Edge Function new-account-notifications with {"user_id": "<id>"}; the function asks
-- new_account_notification() whether the account is still waiting and who the teacher is, then sends.
--
-- Run after 0023_telegram_links.sql and 0021_account_approval.sql. Adds the column telegram_links.notify_new_account
-- (default true, so existing links get true), the kind 'new_account' in set_telegram_notification(), two functions and
-- a trigger. No RLS policy changes; existing profiles never send anything (only new inserts do).
--
-- Sign-up never fails because of this: the profile insert runs inside the Auth sign-up (handle_new_user, 0001), so the
-- Vault read and the call are wrapped in begin ... exception and only raise a warning. Setup (Vault secrets, function
-- secret, deploy): README -> Telegram notifications -> New accounts.

-- pg_net, only where the server offers it and it isn't there yet (without it the trigger just logs a warning).
do $$
begin
  if to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is null
     and exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net;
  end if;
exception when others then
  raise warning 'pg_net could not be enabled (%); new account notifications stay off until it is.', sqlerrm;
end $$;

-- AC 3: the teacher's switch, on by default (existing links get true).
alter table telegram_links add column notify_new_account boolean not null default true;

-- AC 3: set_telegram_notification() learns 'new_account'; every earlier kind is kept. Grants are kept by
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
      else
        raise exception 'Unknown notification type: %', kind using errcode = '22023';
    end case;
  end $$;

-- AC 5 / AC 7: the new account's name and the teacher's id, computed when called (by the Edge Function, service role
-- only), while the account is still pending and a teacher exists. Accepted, declined, deleted or unknown: no row.
create function new_account_notification(account uuid)
  returns table (account_name text, user_id uuid)
  language sql stable security definer set search_path = public
  as $$
    select p.full_name, t.id
    from profiles p
    join profiles t on t.role = 'teacher' and t.access_status = 'approved'
    where p.id = new_account_notification.account
      and p.access_status = 'pending'
      and p.id <> t.id
  $$;
revoke execute on function new_account_notification(uuid) from public, anon, authenticated;
grant execute on function new_account_notification(uuid) to service_role;

-- AC 6 / AC 7: queue one POST {"user_id": "<id>"} with "Authorization: Bearer <secret>" and a 5 s timeout. Both the
-- URL and the secret come from Vault; if either is missing nothing is queued. The Vault read and the call are inside
-- one exception block, so nothing here can make the sign-up fail. pg_net sends after commit, once (at most once).
-- Security definer: the insert comes from the Auth sign-up (supabase_auth_admin), which has no Vault access.
create function notify_new_account() returns trigger
  language plpgsql security definer set search_path = public
  as $$
  declare
    v_url text;
    v_secret text;
  begin
    begin
      select decrypted_secret into v_url from vault.decrypted_secrets where name = 'new_account_notify_url' limit 1;
      select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'new_account_notify_secret' limit 1;
      if coalesce(v_url, '') <> '' and coalesce(v_secret, '') <> '' then
        perform net.http_post(
          url := v_url,
          body := jsonb_build_object('user_id', new.id),
          params := '{}'::jsonb,
          headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_secret),
          timeout_milliseconds := 5000
        );
      end if;
    exception when others then
      raise warning 'new account notification for % not queued: % %', new.id, sqlstate, sqlerrm;
    end;
    return null;
  end $$;
revoke execute on function notify_new_account() from public, anon, authenticated;

-- AC 4: only inserts of pending profiles (sign-ups). profiles_teacher_approved (before insert) has already run, so a
-- teacher's own profile is 'approved' here and never matches. Status, role and name updates never fire it.
create trigger profiles_notify_new_account after insert on profiles
  for each row
  when (new.access_status = 'pending')
  execute function notify_new_account();
