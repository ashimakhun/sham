-- QA ARU-182: gaps in aru182_course_description.test.sql. An accountant mentor who doesn't own the course and a
-- declined course owner are refused; a mentor listener of a hidden course gets "not found"; another workspace's
-- teacher can't reach a hidden course either; a save changes only the description (title, hidden flag, discipline,
-- owner kept); inner line breaks, Markdown and emoji are kept; a 20 000-character text saves (no length limit).
-- Recorded, not asserted as a rule: outer no-break spaces (U+00A0) are not trimmed by the server; the app trims them
-- before sending (JavaScript trim()), so only a direct API call can store them.
-- Fixture (t.seed): teacher T; mentors M (owns A), N (owns B), M2; students S1, S2.
select t.seed();
insert into course_members (course_id, user_id, added_by) values (t.id('A'), t.id('S1'), t.id('M'));
insert into courses (id, title, description, created_by, hidden)
  values ('00000000-0000-0000-0000-0000001821c1', 'Hidden one', 'secret', t.id('N'), true);
insert into course_members (course_id, user_id, added_by)
  values ('00000000-0000-0000-0000-0000001821c1', t.id('M2'), t.id('N'));
insert into disciplines (id, name, created_by) values ('00000000-0000-0000-0000-0000001821d1', 'Math', t.id('T'));
update courses set discipline_id = '00000000-0000-0000-0000-0000001821d1' where id = t.id('A');

create function pg_temp.err(stmt text) returns text language plpgsql as $$
declare code text; hint text;
begin
  execute stmt;
  return 'no error';
exception when others then
  get stacked diagnostics code = returned_sqlstate, hint = pg_exception_hint;
  return concat_ws(' | ', code, nullif(hint, ''));
end $$;
grant execute on function pg_temp.err(text) to authenticated, anon;
create function pg_temp.set(course uuid, txt text) returns text language sql as $$
  select pg_temp.err(format('select set_course_description(%L, %L)', course, txt))
$$;
grant execute on function pg_temp.set(uuid, text) to authenticated, anon;
create function pg_temp.desc_of(course uuid) returns text language sql security definer as $$
  select description from public.courses where id = course
$$;
grant execute on function pg_temp.desc_of(uuid) to authenticated, anon;

-- An accountant mentor who doesn't own A is refused.
update profiles set is_accountant = true where id = t.id('N');
select t.login('N');
select t.eq(pg_temp.set(t.id('A'), 'accountant'), '42501 | sham:course_description_owner_only',
  'an accountant mentor who does not own the course is refused');
reset role;
update profiles set is_accountant = false where id = t.id('N');

-- A mentor listener of a hidden course they don't own: not found (as for its discipline).
select t.login('M2');
select t.eq(pg_temp.set('00000000-0000-0000-0000-0000001821c1', 'peek'), '42501 | sham:course_description_owner_only',
  'a mentor listener of a hidden course is refused');
select t.login('M');
select t.eq(pg_temp.set('00000000-0000-0000-0000-0000001821c1', 'peek'), 'P0002 | sham:course_not_found',
  'a mentor outside a hidden course gets "not found"');
reset role;
select t.eq(pg_temp.desc_of('00000000-0000-0000-0000-0000001821c1'), 'secret', 'the hidden course is unchanged');

-- A save changes only the description.
create temp table a_before as select title, hidden, discipline_id, created_by, workspace_id from courses where id = t.id('A');
select t.login('M');
select t.eq(pg_temp.set(t.id('A'), E'## Week 1\n\n**Bold** and _italic_ 🎓\n\nWeek 2'), 'no error', 'the owner saves Markdown and emoji');
reset role;
select t.eq(pg_temp.desc_of(t.id('A')), E'## Week 1\n\n**Bold** and _italic_ 🎓\n\nWeek 2',
  'inner line breaks, Markdown and emoji are kept as typed');
select t.ok((select (c.title, c.hidden, c.discipline_id, c.created_by, c.workspace_id)
    = (b.title, b.hidden, b.discipline_id, b.created_by, b.workspace_id)
  from courses c, a_before b where c.id = t.id('A')), 'title, hidden flag, discipline, owner and workspace unchanged');

-- No length limit (out of scope): 20 000 characters save.
select t.login('T');
select t.eq(pg_temp.set(t.id('A'), repeat('Long text. ', 2000)), 'no error', 'a 20 000-character description saves');
reset role;
select t.eq(char_length(pg_temp.desc_of(t.id('A'))), 21999, 'stored whole, outer space trimmed');

-- Recorded behaviour: outer no-break spaces stay when the API is called directly (the app trims them first).
select t.login('M');
select t.eq(pg_temp.set(t.id('A'), E' Spaced '), 'no error', 'a direct call with no-break spaces is accepted');
reset role;
select t.eq(pg_temp.desc_of(t.id('A')), E' Spaced ', 'recorded: the server keeps outer no-break spaces');

-- A declined (rejected) course owner is refused, and nothing changes.
set session_replication_role = replica;
update profiles set access_status = 'rejected' where id = t.id('M');
set session_replication_role = origin;
select t.login('M');
select t.ok(pg_temp.set(t.id('A'), 'declined') in ('42501 | sham:course_description_owner_only', 'P0002 | sham:course_not_found'),
  'a declined owner is refused');
reset role;
select t.eq(pg_temp.desc_of(t.id('A')), E' Spaced ', 'nothing changed for the declined owner');

-- Another workspace's teacher can't reach a hidden course either.
insert into workspaces (id, name, created_at) values ('00000000-0000-0000-0000-0000001821e1', 'Other school', now());
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000001821e2', 'xt1821@x.test', '{"full_name":"Xena Teacher"}');
update profiles set workspace_id = '00000000-0000-0000-0000-0000001821e1', access_status = 'approved'
  where id = '00000000-0000-0000-0000-0000001821e2';
update profiles set role = 'teacher' where id = '00000000-0000-0000-0000-0000001821e2';
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000001821e2","role":"authenticated"}', false);
set role authenticated;
select t.eq(pg_temp.set('00000000-0000-0000-0000-0000001821c1', 'cross'), 'P0002 | sham:course_not_found',
  'another workspace''s teacher: a hidden course is not found');
reset role;
select t.eq(pg_temp.desc_of('00000000-0000-0000-0000-0000001821c1'), 'secret', 'the hidden course is still unchanged');
