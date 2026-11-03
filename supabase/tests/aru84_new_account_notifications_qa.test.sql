-- QA ARU-84: gaps in aru84_new_account_notifications.test.sql: empty Vault values skip the call, two sign-ups in one
-- statement queue two calls, a profile inserted Rejected queues nothing, a declined account moved back to waiting
-- queues nothing (only inserts), the recipient never includes a mentor or student, a sign-up with no name in the
-- metadata uses the email as the name, and existing links get the switch on.
select t.seed();

create function t.uid(name text) returns uuid language sql immutable as $$ select md5('aru84qa-' || name)::uuid $$;
create function t.calls() returns bigint language sql security definer as $$ select count(*) from net.requests $$;
grant usage on schema t to service_role;
grant execute on all functions in schema t to anon, authenticated, service_role;
create function t.recipients(acc uuid) returns text language plpgsql as $$
declare
  result text;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', false);
  set role service_role;
  select coalesce(string_agg(r.account_name || '>' || r.user_id::text, ' | '), '') into result from new_account_notification(acc) r;
  reset role;
  return result;
end $$;
grant execute on function t.recipients(uuid) to service_role;

-- Existing links (made before this test's sign-ups) have the switch on.
insert into telegram_links (user_id, chat_id) values (t.id('M'), 111), (t.id('S1'), 222);
select t.ok((select bool_and(notify_new_account) from telegram_links), 'AC3 links get New accounts on by default');

-- Empty strings in Vault are treated as missing.
insert into vault.decrypted_secrets (name, decrypted_secret) values ('new_account_notify_url', ''), ('new_account_notify_secret', '');
insert into auth.users (id, email, raw_user_meta_data) values (t.uid('e1'), 'e1@x.test', '{"full_name":"E One"}');
select t.eq(t.calls(), 0::bigint, 'AC7 empty URL and secret: no call');
update vault.decrypted_secrets set decrypted_secret = 'https://x.supabase.co/functions/v1/new-account-notifications'
  where name = 'new_account_notify_url';
insert into auth.users (id, email, raw_user_meta_data) values (t.uid('e2'), 'e2@x.test', '{"full_name":"E Two"}');
select t.eq(t.calls(), 0::bigint, 'AC7 URL set, secret empty: no call');
update vault.decrypted_secrets set decrypted_secret = 'k3y' where name = 'new_account_notify_secret';

-- Two sign-ups in one statement: two calls, each with its own id.
insert into auth.users (id, email, raw_user_meta_data) values
  (t.uid('p'), 'p@x.test', '{"full_name":"Pat"}'),
  (t.uid('q'), 'q@x.test', '{"full_name":"Quinn"}');
select t.eq(t.calls(), 2::bigint, 'AC8 two sign-ups in one statement: two calls');
select t.eq((select array_agg(body ->> 'user_id' order by body ->> 'user_id') from net.requests),
  (select array_agg(x::text order by x::text) from unnest(array[t.uid('p'), t.uid('q')]) x), 'AC8 each call has its own id');

-- No name in the sign-up metadata: handle_new_user uses the email, and that is the name sent.
insert into auth.users (id, email, raw_user_meta_data) values (t.uid('noname'), 'noname@x.test', '{}');
select t.eq(t.recipients(t.uid('noname')), 'noname@x.test>' || t.id('T')::text, 'edge: no name given: the email is used');

-- Only the teacher is ever a recipient (never the mentor or student who also linked Telegram).
select t.eq(t.recipients(t.uid('p')), 'Pat>' || t.id('T')::text, 'AC2 only the teacher');

-- A profile inserted Rejected (not a sign-up) queues nothing.
select t.eq((select count(*) from net.requests), 3::bigint, 'baseline: 3 calls so far');
set session_replication_role = replica;
insert into auth.users (id, email, raw_user_meta_data) values (t.uid('r'), 'r@x.test', '{"full_name":"Rae"}');
set session_replication_role = origin;
insert into profiles (id, full_name, access_status) values (t.uid('r'), 'Rae', 'rejected');
select t.eq(t.calls(), 3::bigint, 'AC4 a profile inserted Rejected: no call');

-- A declined account moved back to waiting (an update, not a sign-up) queues nothing.
update profiles set access_status = 'rejected' where id = t.uid('q');
update profiles set access_status = 'pending' where id = t.uid('q');
select t.eq(t.calls(), 3::bigint, 'AC4 back to waiting by an update: no call');
select t.eq(t.recipients(t.uid('q')), 'Quinn>' || t.id('T')::text, 'AC5 a waiting account is still found when processed');
