-- ARU-16 QA additions: the storage side of removal and the full app flow on top of 0008.
-- Since ARU-14 every mentor can READ all homework photos; deleting must still be limited to photos of
-- current listeners' course homework (is_listener_homework_photo, 0004), so a non-listener's photo can never be
-- deleted through the removal path. Rules under test: 0004 storage policies + 0008 functions.
select t.seed();
delete from homework;
delete from storage.objects;
-- A owned by M. S1 is a listener of A; S2 is not (S2's homework in A is seeded as the superuser).
insert into course_members (course_id, user_id, added_by) values (t.id('A'), t.id('S1'), t.id('M'));
insert into homework (id, student_id, course_id, title, photo_path) values
  (t.id('HW_A1'), t.id('S1'), t.id('A'), 'S1 in A', t.id('S1') || '/a1.jpg'),
  (t.id('HW_A2'), t.id('S2'), t.id('A'), 'S2 in A (not a listener)', t.id('S2') || '/a2.jpg');
insert into storage.objects (bucket_id, name, owner) values
  ('homework', t.id('S1') || '/a1.jpg', t.id('S1')),
  ('homework', t.id('S2') || '/a2.jpg', t.id('S2'));

-- Non-listener: a mentor can read the photo (ARU-14) but can neither list it for removal nor delete it.
select t.login('M2');
select t.eq((select count(*) from storage.objects where name = t.id('S2') || '/a2.jpg'), 1::bigint,
  'ARU-14 still holds: any mentor can read a non-listener''s photo');
select t.eq((select count(*) from listener_homework_photos(t.id('A'), t.id('S2')) where photo_path is not null), 0::bigint,
  'AC1 no photo path is returned for a non-listener, so the app has nothing to delete');
select t.eq(t.affected($$delete from storage.objects where name like '%/a2.jpg'$$), 0::bigint,
  'storage: a mentor cannot delete a non-listener''s photo directly either');
reset role; select t.login('T');
select t.eq(t.affected($$delete from storage.objects where name like '%/a2.jpg'$$), 0::bigint,
  'storage: the teacher cannot delete a non-listener''s photo directly either');
select t.lives($$select remove_listener('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000c2')$$,
  'AC2 the full app flow for a non-listener returns without error');
reset role;
select t.ok(exists (select 1 from homework where id = t.id('HW_A2')) and exists (select 1 from storage.objects where name = t.id('S2') || '/a2.jpg'),
  'AC2 the non-listener''s homework and photo are both still there (nothing orphaned)');

-- Real listener, in the app's order (store.tsx removeListener), by a mentor who does not own the course:
-- 1. list photos, 2. delete them through Storage, 3. remove_listener.
select t.login('M2');
select t.eq((select count(*) from listener_homework_photos(t.id('A'), t.id('S1'))), 1::bigint, 'AC3 step 1: S1 has 1 homework in A');
select t.eq(t.affected($$delete from storage.objects where bucket_id = 'homework' and name in (select photo_path from listener_homework_photos('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000c1') where photo_path is not null)$$), 1::bigint,
  'AC3 step 2: the listener''s photo is deleted through the storage policy');
select t.lives($$select remove_listener('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000c1')$$,
  'AC3 step 3: remove_listener');
reset role;
select t.ok(not exists (select 1 from homework where id = t.id('HW_A1')), 'AC3 the listener''s homework is gone');
select t.ok(not exists (select 1 from storage.objects where name = t.id('S1') || '/a1.jpg'), 'AC3 the listener''s photo is gone');
select t.ok(not exists (select 1 from course_members where user_id = t.id('S1')), 'AC3 the membership is gone');

-- Retry after "photos deleted, remove_listener failed" (ARU-7 accepted failure path): S1 is a listener again with
-- homework whose photo is already gone. Listing still returns the row; remove_listener finishes the job.
insert into course_members (course_id, user_id, added_by) values (t.id('A'), t.id('S1'), t.id('M'));
insert into homework (id, student_id, course_id, title, photo_path) values
  (t.id('HW_B1'), t.id('S1'), t.id('A'), 'photo already deleted', t.id('S1') || '/gone.jpg');
select t.login('M');
select t.eq((select count(*) from listener_homework_photos(t.id('A'), t.id('S1'))), 1::bigint,
  'ARU-7 retry path: the listener''s homework is still listed for the second attempt');
select t.eq(t.affected($$delete from storage.objects where name like '%/gone.jpg'$$), 0::bigint,
  'ARU-7 retry path: deleting an already-missing photo deletes nothing and is not an error');
select t.lives($$select remove_listener('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000c1')$$,
  'ARU-7 retry path: the second remove_listener completes');
reset role;
select t.ok(not exists (select 1 from homework where id = t.id('HW_B1')), 'ARU-7 retry path: the homework is gone after the retry');

-- Function shapes stay what the app calls (store.tsx: rpc('listener_homework_photos'|'remove_listener', {course, member})).
select t.eq((select pg_get_function_arguments(oid) from pg_proc where proname = 'remove_listener'), 'course uuid, member uuid',
  'remove_listener keeps the argument names the app passes');
select t.eq((select pg_get_function_arguments(oid) from pg_proc where proname = 'listener_homework_photos'), 'course uuid, member uuid',
  'listener_homework_photos keeps the argument names the app passes');
select t.eq((select pg_get_function_result(oid) from pg_proc where proname = 'listener_homework_photos'), 'TABLE(id uuid, photo_path text)',
  'listener_homework_photos keeps its return shape');
select t.ok(not exists (select 1 from pg_policies where tablename = 'course_members' and cmd in ('DELETE', 'ALL')),
  'still no delete policy on course_members (removal only through remove_listener)');
