-- ARU-44: a Telegram message "New message in the <course title> chat" from the Sham bot (ARU-48) when someone else
-- writes in a course chat. An after-insert trigger on course_messages queues one pg_net call to the Edge Function
-- chat-message-notifications with the message id; the function asks chat_message_recipients() who gets it and sends
-- through the ARU-48 helper (which skips people who aren't linked or have Chat messages off).
--
-- Run after 0023_telegram_links.sql (the function needs telegram_links) and 0034. Adds two functions and a trigger;
-- no table, column or policy is added or changed, and nothing is deleted. Messages already posted are never notified.
--
-- On Supabase: turn on pg_net (Database -> Extensions) and store the function's URL and secret in Vault as
-- 'chat_notify_url' and 'chat_notify_secret' (README -> Telegram notifications -> New chat messages). Until then the
-- trigger skips the call and posting works exactly as before.

-- pg_net only where the server has it (Supabase). Plain Postgres (npm run test:db) skips it and keeps the stand-in
-- from supabase/tests/_supabase_stubs.sql; a `net` schema that already exists is left alone.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_net') and to_regnamespace('net') is null then
    create extension if not exists pg_net;
  end if;
end $$;

-- Who gets a Telegram message for `message` (AC 9), computed now. For message M in course C by author A at time T, user
-- U is a recipient when:
--   (a) U <> A;
--   (b) U is Approved and in C's chat: C's owner, a listener of C, or any teacher (the in_course_chat() rules, applied
--       to U directly: in_course_chat() reads auth.uid(), which is null for the service role);
--   (c) U has no read position for C, or it is strictly before T;
--   (d) M is the oldest message, by (created_at, id), among messages in C by someone other than U that are newer than
--       U's read position (all of them when U has none): one Telegram message per batch of new messages (AC 3, 4, 10).
-- One row (the course title now, and the recipients) for a known message; no row for an unknown one.
create function chat_message_recipients(message uuid)
  returns table (course_title text, recipient_ids uuid[])
  language sql stable security definer set search_path = public
  as $$
    select
      c.title,
      array(
        select p.id
        from profiles p
        left join course_chat_reads r on r.course_id = m.course_id and r.user_id = p.id
        where p.id <> m.author_id
          and p.access_status = 'approved'
          and (
            p.role = 'teacher'
            or c.created_by = p.id
            or exists (select 1 from course_members cm where cm.course_id = m.course_id and cm.user_id = p.id)
          )
          and (r.last_read_at is null or r.last_read_at < m.created_at)
          and not exists (
            select 1 from course_messages o
            where o.course_id = m.course_id
              and o.author_id <> p.id
              and (r.last_read_at is null or o.created_at > r.last_read_at)
              and (o.created_at, o.id) < (m.created_at, m.id)
          )
        order by p.id
      )
    from course_messages m
    join courses c on c.id = m.course_id
    where m.id = message
  $$;
revoke execute on function chat_message_recipients(uuid) from public, anon, authenticated;
grant execute on function chat_message_recipients(uuid) to service_role;

-- AC 7 / AC 8: queue one POST to the Edge Function per new message, with the URL and secret read from Vault. Nothing in
-- here can make the insert fail: a missing secret skips the call, and any error (no Vault, no pg_net, the call raising)
-- becomes a warning. pg_net sends after the insert commits and never retries, so a message is notified at most once.
-- Named arguments: Supabase's net.http_post has `params` third, so a positional call would send the headers as query
-- parameters. The function may wait on Telegram's rate limit, hence 30 s (matching AC 1's "about 30 seconds").
create function notify_chat_message() returns trigger
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
          body := jsonb_build_object('message_id', new.id),
          headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || _secret),
          timeout_milliseconds := 30000
        );
      end if;
    exception when others then
      raise warning 'chat-message-notifications: not queued for message %: % (%)', new.id, sqlerrm, sqlstate;
    end;
    return null;
  end $$;
revoke execute on function notify_chat_message() from public, anon, authenticated;

create trigger course_messages_notify after insert on course_messages
  for each row execute function notify_chat_message();
