-- ARU-26 QA additions to aru26_mentor_materials.test.sql (TEST DESIGN "Access checks" and "Data checks"):
-- old policy names gone, no update path, anon delete, DELETE ... RETURNING as the store's deleteMaterial uses it
-- (an RLS-blocked delete returns no row, which the app turns into "You can no longer delete this material."),
-- and a mentor made student who also can't delete another author's row.
select t.seed();

create function t.material_count() returns bigint language sql stable security definer
  set search_path = public as $$ select count(*) from materials $$;
grant execute on function t.material_count() to anon, authenticated;
-- Rows a DELETE ... RETURNING id hands back, like supabase.from('materials').delete().eq('id', x).select('id').
create function t.deleted_returning(mid uuid) returns bigint language plpgsql as $$
declare n bigint;
begin
  with d as (delete from materials where id = mid returning id) select count(*) into n from d;
  return n;
end $$;
grant execute on function t.deleted_returning(uuid) to anon, authenticated;

-- Data: the 0001 policies are dropped by name; the new ones carry the role check.
select t.ok(not exists (select 1 from pg_policies where tablename = 'materials'
  and policyname in ('teachers add materials', 'teachers delete own materials')), 'data: old teacher-only policies dropped');
select t.ok((select bool_and(coalesce(qual, with_check) ilike '%my_role()%' and coalesce(qual, with_check) ilike '%auth.uid()%')
  from pg_policies where tablename = 'materials' and cmd in ('INSERT', 'DELETE')),
  'data: insert and delete policies check the author and the role');
select t.ok(not exists (select 1 from pg_policies where tablename = 'materials' and cmd in ('UPDATE', 'ALL')),
  'data: no update policy (editing is out of scope)');
select t.ok(exists (select 1 from pg_policies where tablename = 'materials' and cmd = 'SELECT' and policyname = 'materials readable'),
  'data: the select policy is unchanged');

-- Materials by the teacher, mentor M and mentor N.
insert into materials (id, teacher_id, title, body) values
  ('00000000-0000-0000-0000-0000000000f1', t.id('T'), 'Teacher lesson', 'x'),
  ('00000000-0000-0000-0000-0000000000f2', t.id('M'), 'Max notes', 'x'),
  ('00000000-0000-0000-0000-0000000000f3', t.id('M'), 'Max second', 'x'),
  ('00000000-0000-0000-0000-0000000000f4', t.id('N'), 'Nina notes', 'x');

-- No update path for anyone, including the author.
select t.login('M');
select t.eq(t.affected($$update materials set title = 'edited' where id = '00000000-0000-0000-0000-0000000000f2'$$), 0::bigint,
  'no update: a mentor cannot edit their own material');
select t.login('T');
select t.eq(t.affected($$update materials set title = 'edited' where id = '00000000-0000-0000-0000-0000000000f4'$$), 0::bigint,
  'no update: the teacher cannot edit a mentor material');
reset role;
select t.eq((select count(*) from materials where title = 'edited'), 0::bigint, 'no update: nothing was changed');

-- The store's delete path (DELETE ... RETURNING): own row comes back, others' don't.
select t.login('M');
select t.eq(t.deleted_returning('00000000-0000-0000-0000-0000000000f3'), 1::bigint,
  'AC4: mentor deleting own material gets the row back (store treats it as done)');
select t.eq(t.deleted_returning('00000000-0000-0000-0000-0000000000f4'), 0::bigint,
  'AC5: mentor deleting another mentor''s material gets no row back (store shows the refusal)');
select t.eq(t.deleted_returning('00000000-0000-0000-0000-0000000000f1'), 0::bigint,
  'AC5: mentor deleting the teacher''s material gets no row back');
select t.login('T');
select t.eq(t.deleted_returning('00000000-0000-0000-0000-0000000000f2'), 0::bigint,
  'AC6: the teacher deleting a mentor''s material gets no row back');
select t.eq(t.material_count(), 3::bigint, 'AC5/AC6: only the author''s own delete removed a row');

-- Anonymous: no delete either.
select t.login(null);
select t.eq(t.affected($$delete from materials$$), 0::bigint, 'anon deletes nothing');
select t.eq(t.material_count(), 3::bigint, 'anon: all rows still exist');

-- AC 8 variant: M2 (owns no course) shared a material and is made a student; M2 can't delete it, nor others'.
reset role;
insert into materials (id, teacher_id, title, body) values ('00000000-0000-0000-0000-0000000000f5', t.id('M2'), 'Mo notes', 'x');
select t.login('T');
select t.lives($$select set_user_role(t.id('M2'), 'student')$$, 'AC8: teacher makes M2 a student');
select t.login('M2');
select t.eq(t.deleted_returning('00000000-0000-0000-0000-0000000000f5'), 0::bigint,
  'AC8: M2 as a student gets no row back for their old material (store shows the refusal)');
select t.eq(t.deleted_returning('00000000-0000-0000-0000-0000000000f4'), 0::bigint,
  'AC8: M2 as a student cannot delete another mentor''s material');
select t.eq((select count(*) from materials), 4::bigint, 'AC8: M2 as a student still reads every material');
-- Made mentor again, M2 can delete their old material (the rule follows the current role).
reset role;
select t.login('T');
select t.lives($$select set_user_role(t.id('M2'), 'mentor')$$, 'teacher makes M2 a mentor again');
select t.login('M2');
select t.eq(t.deleted_returning('00000000-0000-0000-0000-0000000000f5'), 1::bigint,
  'M2 made mentor again deletes their old material');
