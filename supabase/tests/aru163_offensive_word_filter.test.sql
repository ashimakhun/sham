-- ARU-163: offensive word filter. Rules under test: supabase/migrations/0065_offensive_word_filter.sql.
-- The tests use their own words (zzbadword, ззплохо, plus "ass" for the whole-word case), never the real list.
select t.seed();
insert into course_members (course_id, user_id, added_by) values (t.id('A'), t.id('S1'), t.id('M'));
insert into course_meetings (id, course_id, starts_at, status, created_by)
  values (md5('aru163m')::uuid, t.id('A'), now() - interval '1 day', 'completed', t.id('M'));

-- The operator adds test words (upper case on purpose: AC 8, stored lower-case).
insert into blocked_words (word, language) values ('ZZBADWORD', 'en'), ('ЗЗПЛОХО', 'ru'), ('ass', 'en'), ('a.b+', 'en');
select t.eq((select string_agg(word, ',' order by word) from blocked_words where word in ('zzbadword', 'ззплохо')),
  'zzbadword,ззплохо', 'AC8 words are stored lower-case (Latin and Cyrillic)');
select t.ok((select count(*) from blocked_words where language = 'en') > 10
  and (select count(*) from blocked_words where language = 'ru') > 10, 'AC9 the migration seeds an EN and RU list');

-- What a statement raises: errcode | message | hint (or 'no error').
create function pg_temp.err(stmt text) returns text language plpgsql as $$
declare code text; msg text; hint text;
begin
  execute stmt;
  return 'no error';
exception when others then
  get stacked diagnostics code = returned_sqlstate, msg = message_text, hint = pg_exception_hint;
  return concat_ws(' | ', code, msg, hint);
end $$;
create function pg_temp.chat(body text) returns text language sql as $$
  select pg_temp.err(format('insert into course_messages (id, course_id, author_id, body) values (%L, %L, %L, %L)',
    gen_random_uuid(), t.id('A'), t.id('S1'), body)) $$;
grant execute on all functions in schema pg_temp to authenticated, anon;

-- Whole word and case (AC 5, AC 6, Terms, Edge cases), via the matcher.
select t.ok(text_has_blocked_word(x), 'match: ' || x) from unnest(array[
  'hello zzbadword', 'ZZBADWORD', 'ZzBadWord', 'zzbadword!', '«zzbadword»', E'line\nzzbadword\nnext', 'zzbadword-thing',
  'zzbadword🙂', 'ЗЗПЛОХО', 'Ззплохо', 'это ззплохо.', 'you ass!', 'mixed русский zzbadword', 'a.b+ x']) as x;
select t.ok(not text_has_blocked_word(x), 'no match: ' || x) from unnest(array[
  'class', 'assignment', 'zzbadwordthing', 'prezzbadword', 'zzbadword1', '1zzbadword', 'ыззплохо', 'ззплохоы',
  'ззплохё', 'aXb+', 'ab+', '', 'clean text']) as x;
select t.ok(not text_has_blocked_word(null), 'no match: null');

-- AC 1: course chat.
select t.login('S1');
select t.eq(pg_temp.chat('hello zzbadword'),
  '23514 | This text contains words that aren''t allowed. Please change it. | sham:text_not_allowed',
  'AC1/AC10 course chat refused with the new code');
select t.eq(pg_temp.chat('hello class'), 'no error', 'AC5 clean course chat message is posted');
reset role;
select t.eq((select count(*) from course_messages where body like '%zzbadword%'), 0::bigint, 'AC1 nothing posted');

-- AC 2: general chat.
select t.login('S2');
select t.eq(pg_temp.err(format('insert into general_messages (id, author_id, body) values (%L, %L, %L)',
  gen_random_uuid(), t.id('S2'), 'Ззплохо')), '23514 | This text contains words that aren''t allowed. Please change it. | sham:text_not_allowed',
  'AC2 general chat refused');
select t.eq(pg_temp.err(format('insert into general_messages (id, author_id, body) values (%L, %L, %L)',
  gen_random_uuid(), t.id('S2'), 'Привет')), 'no error', 'AC2 clean general chat message is posted');

-- AC 3: meeting notes (via the app's RPCs).
select t.login('S1');
select t.eq(pg_temp.err(format('select add_meeting_listener_notes(%L, %L, true)', md5('aru163m')::uuid, 'my zzbadword note')),
  '23514 | This text contains words that aren''t allowed. Please change it. | sham:text_not_allowed', 'AC3 add note refused');
select t.eq(pg_temp.err(format('select add_meeting_listener_notes(%L, %L, false)', md5('aru163m')::uuid, 'my note')),
  'no error', 'AC3 clean note is saved');
reset role;
create temp table n as select id from meeting_listener_notes where author_id = t.id('S1');
grant select on n to authenticated;
select t.login('S1');
select t.eq(pg_temp.err(format('select update_meeting_listener_notes(%L, %L)', (select id from n), 'edit ZZBADWORD')),
  '23514 | This text contains words that aren''t allowed. Please change it. | sham:text_not_allowed', 'AC3 edit refused');
reset role;
select t.eq((select body from meeting_listener_notes where id = (select id from n)), 'my note', 'AC3 saved note unchanged');

-- AC 7: an old note with a listed word (written before the word was listed): flag updates still work, text edits don't.
alter table meeting_listener_notes disable trigger zy_text_filter_update;
update meeting_listener_notes set body = 'old zzbadword' where id = (select id from n);
alter table meeting_listener_notes enable trigger zy_text_filter_update;
select t.lives(format('update meeting_listener_notes set is_public = not is_public, announced = true where id = %L',
  (select id from n)), 'AC7 flag update on a row with a listed word works');
select t.throws(format('update meeting_listener_notes set body = %L where id = %L', 'still zzbadword', (select id from n)),
  '23514', 'AC7 a text change keeping the word is refused');
select t.lives(format('update meeting_listener_notes set body = %L where id = %L', 'fixed', (select id from n)),
  'AC7 removing the word is saved');

-- AC 4: Blog post title or body (teacher and mentor); materials.link isn't checked.
select t.login('T');
select t.eq(pg_temp.err(format('insert into materials (teacher_id, title, body) values (%L, %L, %L)', t.id('T'), 'zzbadword', 'ok')),
  '23514 | This text contains words that aren''t allowed. Please change it. | sham:text_not_allowed', 'AC4 title refused');
select t.eq(pg_temp.err(format('insert into materials (teacher_id, title, body) values (%L, %L, %L)', t.id('T'), 'ok', 'body ззплохо')),
  '23514 | This text contains words that aren''t allowed. Please change it. | sham:text_not_allowed', 'AC4 body refused');
select t.eq(pg_temp.err(format('insert into materials (teacher_id, title, body, link) values (%L, %L, %L, %L)',
  t.id('T'), 'ok', 'ok', 'https://x.test/zzbadword')), 'no error', 'AC4 link not checked; clean post published');
select t.login('M');
select t.eq(pg_temp.err(format('insert into materials (teacher_id, title, body) values (%L, %L, %L)', t.id('M'), 'zzbadword', 'ok')),
  '23514 | This text contains words that aren''t allowed. Please change it. | sham:text_not_allowed', 'AC4 mentor post refused');
reset role;
select t.eq((select count(*) from materials where title like '%zzbadword%' or body like '%ззплохо%'), 0::bigint,
  'AC4 no refused post was created');

-- AC 8: no app role (or anon) can read or change the list: RLS with no policies.
select t.login(null);
select t.eq((select count(*) from blocked_words), 0::bigint, 'AC8 anon reads no word');
select t.throws('select text_has_blocked_word(''x'')', '42501', 'AC8 anon can''t call the matcher');
select t.login('S1');
select t.eq((select count(*) from blocked_words), 0::bigint, 'AC8 S1 reads no word');
select t.throws($$insert into blocked_words (word, language) values ('newword', 'en')$$, '42501', 'AC8 S1 can''t add a word');
select t.eq(t.affected($$update blocked_words set word = 'changed'$$), 0::bigint, 'AC8 S1 changes no word');
select t.eq(t.affected($$delete from blocked_words$$), 0::bigint, 'AC8 S1 deletes no word');
select t.throws('select text_has_blocked_word(''x'')', '42501', 'AC8 S1 can''t call the matcher');
select t.login('M');
select t.eq((select count(*) from blocked_words), 0::bigint, 'AC8 M reads no word');
select t.throws($$insert into blocked_words (word, language) values ('newword', 'en')$$, '42501', 'AC8 M can''t add a word');
select t.eq(t.affected($$update blocked_words set word = 'changed'$$), 0::bigint, 'AC8 M changes no word');
select t.eq(t.affected($$delete from blocked_words$$), 0::bigint, 'AC8 M deletes no word');
select t.throws('select text_has_blocked_word(''x'')', '42501', 'AC8 M can''t call the matcher');
select t.login('T');
select t.eq((select count(*) from blocked_words), 0::bigint, 'AC8 T reads no word');
select t.throws($$insert into blocked_words (word, language) values ('newword', 'en')$$, '42501', 'AC8 T can''t add a word');
select t.eq(t.affected($$update blocked_words set word = 'changed'$$), 0::bigint, 'AC8 T changes no word');
select t.eq(t.affected($$delete from blocked_words$$), 0::bigint, 'AC8 T deletes no word');
select t.throws('select text_has_blocked_word(''x'')', '42501', 'AC8 T can''t call the matcher');
reset role;
select t.ok((select count(*) from blocked_words where word in ('zzbadword', 'ass')) = 2
  and not exists (select 1 from blocked_words where word in ('newword', 'changed')), 'AC8 the list is unchanged');

-- AC 8: removing a word takes effect on the next send.
reset role;
delete from blocked_words where word = 'zzbadword';
select t.login('S1');
select t.eq(pg_temp.chat('hello zzbadword'), 'no error', 'AC8 a removed word is allowed on the next send');
