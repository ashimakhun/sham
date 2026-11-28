-- ARU-182: the course owner, and the teacher on any course in their workspace, changes a course's description.
-- Rules under test: supabase/migrations/0076_course_description.sql.
-- Fixture: teacher T; mentors M (owns A), N (owns B), M2 (listener of A, owns nothing); students S1 (listener of A),
-- S2 (in nothing); P is a pending mentor; H is a hidden course owned by N. A second workspace W2 has teacher XT and
-- course XC.
select t.seed();
insert into course_members (course_id, user_id, added_by) values (t.id('A'), t.id('S1'), t.id('M')), (t.id('A'), t.id('M2'), t.id('M'));
insert into courses (id, title, description, created_by, hidden)
  values ('00000000-0000-0000-0000-0000001820c1', 'Hidden one', 'secret', t.id('N'), true);
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000001820a1', 'p182@x.test', '{"full_name":"Pending Pat"}');
update profiles set role = 'mentor' where id = '00000000-0000-0000-0000-0000001820a1'; -- still pending

create function pg_temp.as_pending() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000001820a1","role":"authenticated"}', false);
  execute 'set role authenticated';
end $$;
-- What a statement raises: errcode | hint (or 'no error').
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

-- Data: security definer with search_path, run only by authenticated.
select t.ok((select prosecdef and proconfig::text like '%search_path=public%' from pg_proc where proname = 'set_course_description'),
  'data: security definer with search_path');
select t.ok(not has_function_privilege('anon', 'set_course_description(uuid, text)', 'execute'), 'data: anon cannot run it');
select t.ok(not has_function_privilege('public', 'set_course_description(uuid, text)', 'execute'), 'data: public cannot run it');
select t.ok(has_function_privilege('authenticated', 'set_course_description(uuid, text)', 'execute'), 'data: authenticated can');

-- AC 4: the owner saves; the value is trimmed (spaces and line breaks).
select t.login('M');
select t.eq(pg_temp.set(t.id('A'), E'  New text\nline two \n '), 'no error', 'AC4 the owner saves');
select t.eq(pg_temp.desc_of(t.id('A')), E'New text\nline two', 'AC4 stored trimmed');

-- AC 6: a listener and a student in nothing (ARU-24 summary view) read the new text.
select t.login('S1');
select t.eq((select description from courses where id = t.id('A')), E'New text\nline two', 'AC6 the listener sees it');
select t.login('S2');
select t.eq((select description from courses where id = t.id('A')), E'New text\nline two', 'AC6 a non-listener student sees it');

-- Unchanged after trimming: no write (safe retry). xmin stays the same.
reset role;
create temp table before_xmin as select xmin::text as x from courses where id = t.id('A');
grant select on before_xmin to authenticated;
select t.login('M');
select t.eq(pg_temp.set(t.id('A'), E'New text\nline two   '), 'no error', 'data: an unchanged value is no error');
reset role;
select t.eq((select xmin::text from courses where id = t.id('A')), (select x from before_xmin), 'data: an unchanged value writes nothing');

-- AC 5: clearing, and only spaces, give an empty description.
select t.login('M');
select t.eq(pg_temp.set(t.id('A'), ''), 'no error', 'AC5 cleared');
select t.eq(pg_temp.desc_of(t.id('A')), '', 'AC5 empty');
select t.eq(pg_temp.set(t.id('A'), 'x'), 'no error', 'set again');
select t.eq(pg_temp.set(t.id('A'), '    '), 'no error', 'AC5 only spaces');
select t.eq(pg_temp.desc_of(t.id('A')), '', 'AC5 only spaces is empty');
select t.eq(pg_temp.set(t.id('A'), null), 'no error', 'edge: null is treated as empty');

-- Teacher: any course, hidden included.
select t.login('T');
select t.eq(pg_temp.set(t.id('B'), 'By the teacher'), 'no error', 'the teacher changes N''s course');
select t.eq(pg_temp.desc_of(t.id('B')), 'By the teacher', 'saved');
select t.eq(pg_temp.set('00000000-0000-0000-0000-0000001820c1', 'Teacher on hidden'), 'no error', 'the teacher changes a hidden course');
select t.login('N');
select t.eq(pg_temp.set('00000000-0000-0000-0000-0000001820c1', 'Owner on hidden'), 'no error', 'the owner changes their hidden course');

-- Refused: non-owner mentors, students, pending accounts.
select t.login('M2');
select t.eq(pg_temp.set(t.id('A'), 'nope'), '42501 | sham:course_description_owner_only', 'a mentor listener (not owner) is refused');
select t.login('N');
select t.eq(pg_temp.set(t.id('A'), 'nope'), '42501 | sham:course_description_owner_only', 'another mentor is refused');
select t.login('M');
select t.eq(pg_temp.set('00000000-0000-0000-0000-0000001820c1', 'nope'), 'P0002 | sham:course_not_found',
  'a mentor on a hidden course they don''t own: not found');
select t.eq(pg_temp.set('00000000-0000-0000-0000-0000001820ff', 'nope'), 'P0002 | sham:course_not_found', 'an unknown course: not found');
select t.login('S1');
select t.eq(pg_temp.set(t.id('A'), 'nope'), '42501 | sham:course_description_owner_only', 'a listener student is refused');
select t.login('S2');
select t.eq(pg_temp.set(t.id('A'), 'nope'), '42501 | sham:course_description_owner_only', 'a student in nothing is refused');
reset role;
select pg_temp.as_pending();
select t.ok(pg_temp.set(t.id('A'), 'nope') <> 'no error', 'a pending account is refused');
reset role;
select t.eq(pg_temp.desc_of(t.id('A')), '', 'nothing refused was saved');

-- Direct update through PostgREST is still refused (no grant / policy on courses).
select t.login('M');
-- Refused with 42501 (no grant) or silently by RLS (no update policy): either way nothing changes.
select pg_temp.err(format('update courses set description = %L where id = %L', 'direct', t.id('A')));
reset role;
select t.eq(pg_temp.desc_of(t.id('A')), '', 'still empty after a direct update');

-- AC 8: after an owner change the former owner is refused, the new owner can.
select t.login('T');
select t.lives(format('select change_course_owner(%L, %L)', t.id('A'), t.id('N')), 'the teacher gives A to N');
select t.login('M');
select t.eq(pg_temp.set(t.id('A'), 'old owner'), '42501 | sham:course_description_owner_only', 'AC8 the former owner is refused');
select t.login('N');
select t.eq(pg_temp.set(t.id('A'), 'new owner'), 'no error', 'AC8 the new owner can');

-- Another workspace: its teacher can't reach this workspace's course.
reset role;
insert into workspaces (id, name, created_at) values ('00000000-0000-0000-0000-0000001820e1', 'Other school', now());
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000001820e2', 'xt182@x.test', '{"full_name":"Xena Teacher"}');
update profiles set workspace_id = '00000000-0000-0000-0000-0000001820e1', access_status = 'approved'
  where id = '00000000-0000-0000-0000-0000001820e2';
update profiles set role = 'teacher' where id = '00000000-0000-0000-0000-0000001820e2';
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000001820e2","role":"authenticated"}', false);
set role authenticated;
select t.eq(pg_temp.set(t.id('A'), 'cross'), 'P0002 | sham:course_not_found', 'another workspace''s teacher: not found');
reset role;
select t.eq(pg_temp.desc_of(t.id('A')), 'new owner', 'the course is unchanged');
