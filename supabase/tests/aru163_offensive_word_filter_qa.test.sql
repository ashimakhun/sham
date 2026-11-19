-- QA ARU-163: gaps in aru163_offensive_word_filter.test.sql. Kazakh and accented Latin letters next to a word count as
-- letters (no match), tabs / no-break spaces / Markdown around it don't hide it, a capital Ё is folded; one list for
-- every workspace (another workspace is refused too); a refused chat message or Blog post queues no Telegram call
-- (before trigger), a clean one does; updates that don't change the checked text (Blog link, notes' flags) pass;
-- the matcher stays unreachable for app users; no security definer function is callable signed out (ARU-154).
-- Notes, not promised by the story (Out of scope: disguised words): a zero-width space or a Latin homoglyph inside a
-- word, or a Greek letter right next to it, are recorded below as they behave today.
select t.seed();
create function t.r(n text) returns uuid language sql immutable as $$ select md5('aru163qa' || n)::uuid $$;
create function t.login_as(who uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', who, 'role', 'authenticated')::text, false);
  set role authenticated;
end $$;
grant execute on function t.r(text) to anon, authenticated;
grant execute on function t.login_as(uuid) to anon, authenticated;

create function pg_temp.err(stmt text) returns text language plpgsql as $$
declare code text; hint text;
begin
  execute stmt;
  return 'no error';
exception when others then
  get stacked diagnostics code = returned_sqlstate, hint = pg_exception_hint;
  return concat_ws(' | ', code, hint);
end $$;
grant execute on all functions in schema pg_temp to authenticated, anon;

insert into course_members (course_id, user_id, added_by) values (t.id('A'), t.id('S1'), t.id('M'));
insert into blocked_words (word, language) values ('zzbadword', 'en'), ('ЁЗЗ', 'ru');

-- Whole word: letters of Kazakh and accented Latin are letters; other separators are not.
select t.ok(not text_has_blocked_word(x), 'no match (letter next to it): ' || x) from unnest(array[
  'әzzbadword', 'zzbadwordқ', 'ézzbadword', 'zzbadwordñ', 'Ұёзз', 'ёззі']) as x;
select t.ok(text_has_blocked_word(x), 'match: ' || x) from unnest(array[
  E'tab\tzzbadword', E'nbsp zzbadword', '**zzbadword**', '_zzbadword_', '(zzbadword)', 'zzbadword,', 'Ёзз!',
  'ЁЗЗ', 'it''s zzbadword', '#zzbadword']) as x;
-- Recorded behaviour, outside the story's promises (disguised words are out of scope).
select t.ok(not text_has_blocked_word(E'zz​badword'), 'out of scope: a zero-width space inside the word is not caught');
select t.ok(not text_has_blocked_word('zzbаdword'), 'out of scope: a Cyrillic "а" homoglyph inside a Latin word is not caught');
select t.ok(text_has_blocked_word('αzzbadword'), 'Terms: a Greek letter is not a Latin/Cyrillic letter, so it counts as a boundary');

-- One global list: another workspace's user is refused too.
insert into workspaces (id, name, created_at) values (t.r('W2'), 'Other school', now());
insert into auth.users (id, email, raw_user_meta_data) values (t.r('X'), 'x163qa@x.test', '{"full_name":"Xia"}');
update profiles set workspace_id = t.r('W2'), access_status = 'approved' where id = t.r('X');
select t.login_as(t.r('X'));
select t.eq(pg_temp.err(format('insert into general_messages (id, author_id, body) values (%L, %L, %L)',
  gen_random_uuid(), t.r('X'), 'hi zzbadword')), '23514 | sham:text_not_allowed', 'AC8 one list: another workspace is refused too');
reset role;

-- No Telegram call for a refused message or post (before triggers); a clean one queues one.
insert into vault.decrypted_secrets (name, decrypted_secret) values
  ('chat_notify_url', 'https://x.test/chat'), ('chat_notify_secret', 'k'),
  ('new_material_notify_url', 'https://x.test/material'), ('new_material_notify_secret', 'k');
select t.login('S1');
select t.eq(pg_temp.err(format('insert into course_messages (id, course_id, author_id, body) values (%L, %L, %L, %L)',
  gen_random_uuid(), t.id('A'), t.id('S1'), 'zzbadword')), '23514 | sham:text_not_allowed', 'AC1 refused');
reset role;
select t.eq((select count(*) from net.requests), 0::bigint, 'AC1 a refused chat message queues no Telegram call');
select t.login('S1');
select t.eq(pg_temp.err(format('insert into course_messages (id, course_id, author_id, body) values (%L, %L, %L, %L)',
  gen_random_uuid(), t.id('A'), t.id('S1'), 'clean')), 'no error', 'AC5 clean message posted');
reset role;
select t.eq((select count(*) from net.requests), 1::bigint, 'AC5 a clean chat message still queues its Telegram call');
select t.login('T');
select t.eq(pg_temp.err(format('insert into materials (id, teacher_id, title, body) values (%L, %L, %L, %L)',
  t.r('bad'), t.id('T'), 'Title', 'zzbadword')), '23514 | sham:text_not_allowed', 'AC4 refused post');
reset role;
select t.eq((select count(*) from net.requests where url like '%material%'), 0::bigint,
  'AC4 a refused Blog post queues no new-material call');

-- AC 7: updates that don't change the checked text pass, even on an old row with a listed word.
set session_replication_role = replica;
insert into materials (id, teacher_id, title, body, link) values (t.r('old'), t.id('T'), 'Old zzbadword', 'body', null);
set session_replication_role = origin;
select t.lives(format('update materials set link = %L where id = %L', 'https://x.test', t.r('old')),
  'AC7 an old Blog post with a listed word: changing only its link works');
select t.throws(format('update materials set body = %L where id = %L', 'new body', t.r('old')), '23514',
  'AC7 a text change that keeps a listed word in the title is refused');

-- Grants: the matcher and helpers stay unreachable for app users; ARU-154.
select t.ok(not has_function_privilege('authenticated', 'text_has_blocked_word(text)', 'execute')
  and not has_function_privilege('anon', 'text_has_blocked_word(text)', 'execute')
  and not has_function_privilege('anon', 'sham_fold_case(text)', 'execute')
  and not has_function_privilege('authenticated', 'refuse_blocked_words()', 'execute'),
  'grants: no app role can call the matcher or the trigger function');
select t.eq((select coalesce(string_agg(p.proname, ',' order by p.proname), '') from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'execute')), '',
  'ARU-154: no security definer function in public is callable signed out');
select t.eq((select coalesce(string_agg(p.proname, ',' order by p.proname), '') from pg_proc p
  where p.proname in ('text_has_blocked_word', 'refuse_blocked_words') and not (p.proconfig @> array['search_path=public'])),
  '', 'the new security definer functions have search_path=public');
select t.ok((select relrowsecurity from pg_class where oid = 'blocked_words'::regclass)
  and not exists (select 1 from pg_policies where tablename = 'blocked_words'), 'AC8 RLS on, no policies');
