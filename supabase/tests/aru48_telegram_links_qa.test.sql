-- QA ARU-48: gaps in aru48_telegram_links.test.sql: an old code stops working once a newer one exists, relinking the
-- same chat, large real-world chat ids, a null kind, the teacher not seeing others' links, codes being unguessable
-- (unique per call), a deleted account's codes and link, and the pending account's set/disconnect calls.
select t.seed();
insert into auth.users (id, email, raw_user_meta_data) values ('00000000-0000-0000-0000-0000000048b1', 'p@x.test', '{"full_name":"Pending Pat"}');

create function t.bot() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', false);
  set role service_role;
end $$;
grant usage on schema t to service_role;
grant execute on all functions in schema t to anon, authenticated, service_role;
create table t.codes (who text, code text);
grant all on t.codes to authenticated, service_role;

-- AC 1 / edge "Tapping Connect twice": only the newest code works.
select t.login('S1');
insert into t.codes values ('first', create_telegram_link_code());
insert into t.codes values ('second', create_telegram_link_code());
select t.ok((select count(distinct code) from t.codes) = 2, 'each tap makes a different code');
select t.bot();
select t.ok(link_telegram_chat((select code from t.codes where who = 'first'), 5000000001) is null,
  'edge: the older code no longer works');
select t.eq(link_telegram_chat((select code from t.codes where who = 'second'), 5000000001), 'Student Sam',
  'AC2 the newest code links a large (real-world size) chat id');
reset role;
select t.eq((select chat_id from telegram_links where user_id = t.id('S1')), 5000000001::bigint, 'AC2 the chat id is stored exactly');

-- AC 8: linking the same chat again (a new code, same Telegram) keeps one row and the switches.
select t.login('S1');
select t.lives($$select set_telegram_notification('meeting_started', false)$$, 'S1 turns Meeting started off');
delete from t.codes;
insert into t.codes values ('again', create_telegram_link_code());
select t.bot();
select t.eq(link_telegram_chat((select code from t.codes where who = 'again'), 5000000001), 'Student Sam', 'AC8 relinking the same chat works');
reset role;
select t.eq((select count(*) from telegram_links where chat_id = 5000000001), 1::bigint, 'AC8 still one row');
select t.ok(not (select notify_meeting_started from telegram_links where user_id = t.id('S1')), 'AC8 and the switch is kept');

-- AC 5: a null kind is refused like an unknown one.
select t.login('S1');
select t.throws($$select set_telegram_notification(null, true)$$, '22023', 'AC5 a null kind is refused');

-- AC 9: the teacher sees only their own link, not S1's.
select t.login('T');
select t.eq((select count(*) from telegram_links), 0::bigint, 'AC9 the teacher (not linked) reads no links at all');
select t.eq((select count(*) from telegram_link_codes), 0::bigint, 'AC9 nor any codes');

-- AC 9: a pending account's switch and disconnect calls change nothing.
select t.login('M2');
select t.lives($$select create_telegram_link_code()$$, 'M2 makes a code (kept unused)');
do $q$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000048b1', 'role', 'authenticated')::text, false);
  set role authenticated;
  perform set_telegram_notification('chat_message', false);
  perform disconnect_telegram();
  perform t.eq((select count(*) from telegram_links), 0::bigint, 'AC9 the pending account reads nothing');
  reset role;
end $q$;
select t.ok((select notify_chat_message from telegram_links where user_id = t.id('S1')), 'AC9 S1''s switches are untouched');

-- Edge: a deleted account takes its codes and link with it; its old code then links nothing.
reset role;
insert into t.codes select 'M2', code from telegram_link_codes where user_id = t.id('M2');
delete from auth.users where id = t.id('S1');
delete from auth.users where id = t.id('M2');
select t.eq((select count(*) from telegram_links where chat_id = 5000000001), 0::bigint, 'edge: the deleted account''s link is gone');
select t.eq((select count(*) from telegram_link_codes where user_id in (t.id('S1'), t.id('M2'))), 0::bigint, 'edge: and its codes');
select t.bot();
select t.ok(link_telegram_chat((select code from t.codes where who = 'M2'), 5000000002) is null, 'edge: the deleted account''s code links nothing');
reset role;
select t.eq((select count(*) from telegram_links), 0::bigint, 'edge: nothing was linked');
