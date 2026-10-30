-- ARU-26: mentors share materials and delete only their own; students read only.
-- Fixture (t.seed): teacher T; mentors M, N, M2; students S1, S2, S3.
select t.seed();

create function t.material_exists(mid uuid) returns boolean language sql stable security definer
  set search_path = public as $$ select exists (select 1 from materials where id = mid) $$;
grant execute on function t.material_exists(uuid) to anon, authenticated;

-- Data check: exactly one insert and one delete policy on materials.
select t.eq((select count(*) from pg_policies where tablename = 'materials' and cmd = 'INSERT'), 1::bigint,
  'data: one insert policy on materials');
select t.eq((select count(*) from pg_policies where tablename = 'materials' and cmd = 'DELETE'), 1::bigint,
  'data: one delete policy on materials');
select t.ok(exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'materials'),
  'data: materials stays in the realtime publication');

-- Teacher material TM (existing data path).
select t.login('T');
select t.lives($$insert into materials (id, teacher_id, title, body)
  values ('00000000-0000-0000-0000-0000000000f1', t.id('T'), 'Teacher lesson', 'x')$$, 'teacher shares own material');
select t.throws($$insert into materials (teacher_id, title, body) values (t.id('M'), 'fake', 'x')$$, '42501',
  'teacher cannot share as another user');

-- AC 2: mentor shares.
select t.login('M');
select t.lives($$insert into materials (id, teacher_id, title, body, link)
  values ('00000000-0000-0000-0000-0000000000f2', t.id('M'), 'Max notes', 'x', 'https://x.test')$$,
  'AC2: mentor M shares own material');
select t.lives($$insert into materials (id, teacher_id, title, body)
  values ('00000000-0000-0000-0000-0000000000f3', t.id('M'), 'Max second', 'x')$$, 'AC2: mentor M shares a second one');
select t.throws($$insert into materials (teacher_id, title, body) values (t.id('N'), 'fake', 'x')$$, '42501',
  'mentor cannot share as another user');
select t.login('N');
select t.lives($$insert into materials (id, teacher_id, title, body)
  values ('00000000-0000-0000-0000-0000000000f4', t.id('N'), 'Nina notes', 'x')$$, 'AC2: mentor N shares own material');

-- AC 3: everyone signed in reads all; anon reads nothing.
select t.login('S1');
select t.eq((select count(*) from materials), 4::bigint, 'AC3: student sees all materials');
select t.login('N');
select t.eq((select count(*) from materials), 4::bigint, 'AC3: another mentor sees all materials');
select t.login('T');
select t.eq((select count(*) from materials), 4::bigint, 'AC3: teacher sees all materials');
select t.login(null);
select t.eq((select count(*) from materials), 0::bigint, 'anon reads no materials');
select t.throws($$insert into materials (teacher_id, title, body) values (t.id('T'), 'anon', 'x')$$, '42501',
  'anon cannot insert materials');

-- AC 5: mentor cannot delete teacher's or another mentor's material.
select t.login('N');
select t.eq(t.affected($$delete from materials where id = '00000000-0000-0000-0000-0000000000f2'$$), 0::bigint,
  'AC5: mentor N cannot delete mentor M material');
select t.eq(t.affected($$delete from materials where id = '00000000-0000-0000-0000-0000000000f1'$$), 0::bigint,
  'AC5: mentor N cannot delete teacher material');
reset role;
select t.ok(t.material_exists('00000000-0000-0000-0000-0000000000f2') and t.material_exists('00000000-0000-0000-0000-0000000000f1'),
  'AC5: both rows still exist');

-- AC 6: teacher cannot delete a mentor's material.
select t.login('T');
select t.eq(t.affected($$delete from materials where id = '00000000-0000-0000-0000-0000000000f4'$$), 0::bigint,
  'AC6: teacher cannot delete mentor N material');

-- AC 7: student cannot insert (even as self) or delete.
select t.login('S1');
select t.throws($$insert into materials (teacher_id, title, body) values (t.id('S1'), 'mine', 'x')$$, '42501',
  'AC7: student cannot share, even with teacher_id = self');
select t.eq(t.affected($$delete from materials$$), 0::bigint, 'AC7: student deletes nothing');
reset role;
select t.eq((select count(*) from materials), 4::bigint, 'AC7: all rows still exist');

-- AC 4: mentor deletes own.
select t.login('M');
select t.eq(t.affected($$delete from materials where id = '00000000-0000-0000-0000-0000000000f3'$$), 1::bigint,
  'AC4: mentor M deletes own material');
-- Teacher still deletes own (regression).
select t.login('T');
select t.eq(t.affected($$delete from materials where id = '00000000-0000-0000-0000-0000000000f1'$$), 1::bigint,
  'regression: teacher deletes own material');

-- AC 8: M2 (owns no course) shares, is made a student, keeps the material visible but can no longer delete it.
select t.login('M2');
select t.lives($$insert into materials (id, teacher_id, title, body)
  values ('00000000-0000-0000-0000-0000000000f5', t.id('M2'), 'Mo notes', 'x')$$, 'AC8: mentor M2 shares a material');
select t.login('T');
select t.lives($$select set_user_role(t.id('M2'), 'student')$$, 'AC8: teacher makes M2 a student');
select t.login('M2');
select t.eq(t.affected($$delete from materials where id = '00000000-0000-0000-0000-0000000000f5'$$), 0::bigint,
  'AC8: M2 made student cannot delete their old material');
select t.throws($$insert into materials (teacher_id, title, body) values (t.id('M2'), 'again', 'x')$$, '42501',
  'AC8: M2 made student cannot share');
select t.ok(exists (select 1 from materials where id = '00000000-0000-0000-0000-0000000000f5'),
  'AC8: M2 made student still sees their old material');
select t.login('S2');
select t.ok(exists (select 1 from materials where id = '00000000-0000-0000-0000-0000000000f5'),
  'AC8: the old material stays visible to others');
reset role;
