-- ARU-108 (Russian version, part 1): profiles.language. Rules under test: supabase/migrations/0049_profile_language.sql
-- (and the "edit own profile" policy of 0001, the column grant of 0021, the read policy of 0021).
select t.seed();
create function pg_temp.lang(who text) returns text language sql security definer as $$
  select language from profiles where id = t.id(who)
$$;

-- Data: existing accounts never chose.
select t.ok((select bool_and(language is null) from profiles), 'data: existing profiles have no language (follow the phone)');

-- AC 4 / AC 11: own row only, en / ru / null.
select t.login('S1');
select t.eq(t.affected($$update profiles set language = 'ru' where id = auth.uid()$$), 1::bigint, 'AC4 S1 sets their own language to ru');
select t.eq(pg_temp.lang('S1'), 'ru', 'AC4 saved on the account');
select t.eq(t.affected($$update profiles set language = 'en' where id = auth.uid()$$), 1::bigint, 'AC4 and back to en');
select t.eq(t.affected($$update profiles set language = null where id = auth.uid()$$), 1::bigint, 'AC11 null (follow the phone) is allowed');
select t.throws($$update profiles set language = 'de' where id = auth.uid()$$, '23514', 'AC11 another value is refused');
select t.throws($$update profiles set language = 'RU' where id = auth.uid()$$, '23514', 'AC11 case matters');
select t.eq(t.affected(format($$update profiles set language = 'ru' where id = %L$$, t.id('S2'))), 0::bigint,
  'AC11 S1 can''t change S2''s language');
select t.eq(pg_temp.lang('S2'), null::text, 'AC11 S2 unchanged');
select t.throws($$update profiles set role = 'teacher' where id = auth.uid()$$, '42501', 'grant: the role still can''t be changed');
select t.eq(t.affected($$update profiles set full_name = 'Sam S' where id = auth.uid()$$), 1::bigint, 'regression: the name still can be changed');

select t.login('T');
select t.eq(t.affected(format($$update profiles set language = 'ru' where id = %L$$, t.id('S2'))), 0::bigint,
  'AC11 the teacher can''t change a student''s language');
select t.eq(t.affected($$update profiles set language = 'ru' where id = auth.uid()$$), 1::bigint, 'AC4 the teacher sets their own');
select t.login('M');
select t.eq(t.affected($$update profiles set language = 'ru' where id = auth.uid()$$), 1::bigint, 'AC4 a mentor sets their own');

-- Reading: like the rest of profiles (approved users see approved users).
select t.login('S2');
select t.eq((select language from profiles where id = t.id('T')), 'ru', 'an approved user reads another''s language');

select t.login(null);
select t.throws($$update profiles set language = 'ru'$$, '42501', 'AC11 signed out can''t change anything');
reset role;
select t.eq((select count(*) from profiles where language = 'ru'), 2::bigint, 'only T and M chose ru');
