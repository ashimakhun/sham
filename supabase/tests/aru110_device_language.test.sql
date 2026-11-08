-- ARU-110 (Russian version, part 4): profiles.device_language. Rules under test:
-- supabase/migrations/0051_profile_device_language.sql (and the "edit own profile" policy of 0001, the column grants
-- of 0021 / 0050, the read policy of 0021).
select t.seed();
create function pg_temp.dev(who text) returns text language sql security definer as $$
  select device_language from profiles where id = t.id(who)
$$;

-- Data: existing accounts have no saved phone language.
select t.ok((select bool_and(device_language is null) from profiles), 'data: existing profiles have no device language');

-- AC 10: own row only, en / ru / null.
select t.login('S1');
select t.eq(t.affected($$update profiles set device_language = 'ru' where id = auth.uid()$$), 1::bigint, 'AC2 S1 saves their phone language');
select t.eq(pg_temp.dev('S1'), 'ru', 'AC2 saved on the account');
select t.eq((select language from profiles where id = auth.uid()), null::text, 'AC2 not a choice: language stays null');
select t.eq(t.affected($$update profiles set device_language = 'en' where id = auth.uid()$$), 1::bigint, 'AC2 the phone changed to en');
select t.eq(t.affected($$update profiles set device_language = null where id = auth.uid()$$), 1::bigint, 'AC10 null is allowed');
select t.throws($$update profiles set device_language = 'de' where id = auth.uid()$$, '23514', 'AC10 another value is refused');
select t.throws($$update profiles set device_language = '' where id = auth.uid()$$, '23514', 'AC10 an empty value is refused');
select t.eq(t.affected(format($$update profiles set device_language = 'ru' where id = %L$$, t.id('S2'))), 0::bigint,
  'AC10 S1 can''t set S2''s device language');
select t.eq(pg_temp.dev('S2'), null::text, 'AC10 S2 unchanged');
select t.throws($$update profiles set role = 'teacher' where id = auth.uid()$$, '42501', 'grant: the role still can''t be changed');
select t.throws($$update profiles set access_status = 'approved' where id = auth.uid()$$, '42501', 'grant: the access status still can''t be changed');
select t.eq(t.affected($$update profiles set language = 'ru', full_name = 'Sam S' where id = auth.uid()$$), 1::bigint,
  'regression: name and language still can be changed');

select t.login('T');
select t.eq(t.affected(format($$update profiles set device_language = 'ru' where id = %L$$, t.id('S2'))), 0::bigint,
  'AC10 the teacher can''t set a student''s device language');
select t.eq(t.affected($$update profiles set device_language = 'ru' where id = auth.uid()$$), 1::bigint, 'AC2 the teacher saves their own');

select t.login(null);
select t.throws($$update profiles set device_language = 'ru'$$, '42501', 'AC10 signed out can''t change anything');
reset role;
select t.eq((select count(*) from profiles where device_language = 'ru'), 1::bigint, 'only T saved ru');
