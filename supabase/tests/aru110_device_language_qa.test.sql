-- QA ARU-110: gaps in aru110_device_language.test.sql: a new sign-up gets no saved phone language and no choice;
-- other spellings ('RU', 'ru-RU', ' ru') are refused; anon can neither read nor write; the column grant still blocks
-- is_accountant and mentor_id; one statement can't set the language of several rows; the service role (Edge Functions)
-- reads both language columns; the saved phone language never changes the user's choice.
select t.seed();
grant usage on schema t to service_role;
grant execute on all functions in schema t to service_role;

-- Data: a new account starts with neither value.
insert into auth.users (id, email, raw_user_meta_data) values (md5('aru110qa-new')::uuid, 'new@x.test', '{"full_name":"New One"}');
select t.ok((select language is null and device_language is null from profiles where id = md5('aru110qa-new')::uuid),
  'data: a new sign-up has no chosen and no saved phone language');

-- AC 10: only 'en' / 'ru', exactly.
select t.login('S1');
select t.throws($$update profiles set device_language = 'RU' where id = auth.uid()$$, '23514', 'AC10 RU (upper case) refused');
select t.throws($$update profiles set device_language = 'ru-RU' where id = auth.uid()$$, '23514', 'AC10 ru-RU refused');
select t.throws($$update profiles set device_language = ' ru' where id = auth.uid()$$, '23514', 'AC10 a padded value refused');

-- AC 10: one update without a where clause changes only the user's own row.
select t.eq(t.affected($$update profiles set device_language = 'ru'$$), 1::bigint, 'AC10 an update of every row changes only S1''s');
reset role;
select t.eq((select count(*) from profiles where device_language = 'ru'), 1::bigint, 'AC10 nobody else got ru');

-- The column grant still blocks the other columns.
select t.login('S1');
select t.throws($$update profiles set device_language = 'en', is_accountant = true where id = auth.uid()$$, '42501',
  'grant: is_accountant still refused, even together with device_language');
select t.throws($$update profiles set mentor_id = null where id = auth.uid()$$, '42501', 'grant: mentor_id still refused');

-- AC 2: saving the phone language is not a choice, and never changes one.
update profiles set language = 'en' where id = auth.uid();
select t.eq(t.affected($$update profiles set device_language = 'ru' where id = auth.uid()$$), 1::bigint,
  'AC2 the phone language can be saved next to a choice');
reset role;
select t.eq((select language || '/' || device_language from profiles where id = t.id('S1')), 'en/ru',
  'AC2 the choice (en) stays; the phone language (ru) is kept apart');

-- Signed out: no read, no write.
select t.login(null);
select t.eq((select count(*) from profiles where device_language is not null), 0::bigint, 'AC10 anon reads no saved phone language');
select t.throws($$update profiles set device_language = 'en' where id = md5('aru110qa-new')::uuid$$, '42501',
  'AC10 anon can''t set anyone''s phone language');
reset role;

-- Edge Functions read both columns with the service role.
set role service_role;
select t.eq((select language || '/' || device_language from profiles where id = t.id('S1')), 'en/ru',
  'service role reads language and device_language');
reset role;
