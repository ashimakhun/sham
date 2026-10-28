-- ARU-7: teachers and mentors add and remove course listeners.
-- Access rules under test: supabase/migrations/0004_course_members.sql. Follows the TEST DESIGN in Linear:
-- teacher T; mentors M (owns A), N (owns B, becomes a listener of A), M2 (no link); students S1, S2, S3.
select t.seed();

-- AC 1 / roles: owner mentor adds a student and a mentor (N) in one insert.
reset role; select t.login('M');
select t.lives($$insert into course_members (course_id, user_id, added_by) values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000b1'),
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000b1')$$,
  'AC1 owner mentor adds a student and a mentor in one go');

-- AC 1/7: a mentor who does not own the course, and the teacher, can add too.
reset role; select t.login('M2');
select t.lives($$insert into course_members (course_id, user_id, added_by) values ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000b3')$$,
  'AC1 non-owner mentor adds a listener (S1 to B)');
reset role; select t.login('T');
select t.lives($$insert into course_members (course_id, user_id, added_by) values ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-0000000000a1')$$,
  'AC1 teacher adds a mentor listener (M2 to B)');

-- AC 3: a listener can be in several courses.
reset role;
select t.eq((select count(*) from course_members where user_id = t.id('S1')), 2::bigint, 'AC3 S1 is a listener of both A and B');

-- AC 4: no duplicates.
select t.login('M');
select t.throws($$insert into course_members (course_id, user_id, added_by) values ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000b1')$$, '23505',
  'AC4 adding an existing listener again is rejected');

-- AC 5: never the owner, the teacher or an unknown user.
select t.throws($$insert into course_members (course_id, user_id, added_by) values ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b1')$$, '42501',
  'AC5 the course owner cannot be added as a listener');
select t.throws($$insert into course_members (course_id, user_id, added_by) values ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1')$$, '42501',
  'AC5 the teacher cannot be added as a listener');
select t.throws($$insert into course_members (course_id, user_id, added_by) values ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-00000000ffff', '00000000-0000-0000-0000-0000000000b1')$$, '42501',
  'AC5 an unknown user cannot be added as a listener');
select t.throws($$insert into course_members (course_id, user_id, added_by) values ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-0000000000a1')$$, '42501',
  'added_by must be the signed-in user');
-- One bad row rejects the whole multi-row insert (all or nothing).
select t.throws($$insert into course_members (course_id, user_id, added_by) values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-0000000000b1'),
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1')$$, '42501',
  'AC1 a batch with one invalid listener adds nobody');
reset role;
select t.ok(not exists (select 1 from course_members where user_id = t.id('S3')), 'AC1 nothing from the rejected batch was saved');

-- AC 7: students cannot add or remove listeners, directly or through the functions.
select t.login('S1');
select t.throws($$insert into course_members (course_id, user_id, added_by) values ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000c1')$$, '42501',
  'AC7 student insert into course_members is rejected');
select t.eq(t.affected($$delete from course_members where course_id = '00000000-0000-0000-0000-0000000000d1'$$), 0::bigint,
  'AC7 student direct delete removes nothing');
select t.throws($$select remove_listener('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000c1')$$, '42501',
  'AC7 student rpc remove_listener is rejected');
select t.throws($$select * from listener_homework_photos('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000c1')$$, '42501',
  'AC7 student rpc listener_homework_photos is rejected');
select t.eq(t.affected($$delete from storage.objects where bucket_id = 'homework'$$), 0::bigint,
  'AC7 storage: student cannot delete homework photos');

-- AC 8: students see listeners only of courses they are in (via is_member(), no recursion).
select t.eq((select count(*) from course_members where course_id = t.id('A')), 2::bigint, 'AC8 listener S1 sees all listeners of A');
select t.eq((select count(*) from course_members where course_id = t.id('B')), 2::bigint, 'AC8 listener S1 sees all listeners of B');
reset role; select t.login('S2');
select t.eq((select count(*) from course_members), 0::bigint, 'AC8 student in no course sees no listener rows');
reset role; select t.login('M2');
select t.eq((select count(*) from course_members), 4::bigint, 'roles: any mentor sees all listeners');
reset role; select t.login('T');
select t.eq((select count(*) from course_members), 4::bigint, 'roles: teacher sees all listeners');
reset role; select t.login(null);
select t.eq((select count(*) from course_members), 0::bigint, 'roles: anon sees no listeners');
select t.throws($$select remove_listener('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000c1')$$, '42501',
  'roles: anon cannot execute remove_listener');
select t.throws($$select * from listener_homework_photos('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000c1')$$, '42501',
  'roles: anon cannot execute listener_homework_photos');
select t.throws($$select is_member('00000000-0000-0000-0000-0000000000d1')$$, '42501', 'roles: anon cannot execute is_member');

-- AC 9 (data): a listener reads their own memberships and each course's owner.
reset role; select t.login('S1');
select t.eq((select string_agg(c.title || ':' || p.full_name, ',' order by c.title)
  from course_members m join courses c on c.id = m.course_id join profiles p on p.id = c.created_by
  where m.user_id = auth.uid()), 'Algebra:Mentor Max,Biology:Mentor Nina', 'AC9 S1 reads own courses with owner as mentor');

-- Homework access (changed by ARU-14): every mentor sees all homework.
reset role; select t.login('N');
select t.eq((select count(*) from homework where student_id = t.id('S1')), 3::bigint, 'ARU-14: mentor N sees S1''s homework');
reset role; select t.login('M');
select t.eq((select count(*) from homework where student_id = t.id('S1')), 3::bigint, 'ARU-14: mentor M sees S1''s homework');

-- Photos of course homework of non-listeners stay protected from staff deletes.
reset role;
insert into homework (id, student_id, course_id, title, photo_path) values
  ('00000000-0000-0000-0000-0000000000e9', t.id('S2'), t.id('A'), 'S2 in A', t.id('S2') || '/x.jpg');
insert into storage.objects (bucket_id, name, owner) values ('homework', t.id('S2') || '/x.jpg', t.id('S2'));
select t.login('M2');
select t.eq(t.affected($$delete from storage.objects where name like '%/x.jpg'$$), 0::bigint,
  'storage: a mentor cannot delete photos of a non-listener''s homework');
select t.eq((select count(*) from storage.objects where name like '%/x.jpg'), 1::bigint,
  'storage (changed by ARU-14): any mentor can read homework photos, but still cannot delete a non-listener''s');

-- AC 6: N (a listener of A who does not own it) removes S1 from A, in the app's order.
reset role; select t.login('N');
select t.eq((select count(*) from listener_homework_photos(t.id('A'), t.id('S1'))), 2::bigint,
  'AC6 count for the dialog: S1 has 2 homework in A (checked and unchecked)');
select t.eq((select count(*) from listener_homework_photos(t.id('A'), t.id('S1')) where photo_path is not null), 1::bigint,
  'AC6 one of them has a photo');
-- Step 2: delete the photo through Storage (the policy allows it while S1 is still a listener).
select t.eq((select count(*) from storage.objects where name = t.id('S1') || '/a1.jpg'), 1::bigint,
  'AC6 storage: remover can see the listener''s course photo (needed by Storage to delete it)');
select t.eq(t.affected($$delete from storage.objects where bucket_id = 'homework' and name in (select photo_path from listener_homework_photos('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000c1') where photo_path is not null)$$), 1::bigint,
  'AC6 storage: remover deletes the listener''s course photo');
-- Step 3: remove_listener deletes homework + membership.
select t.lives($$select remove_listener('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000c1')$$,
  'AC6/AC7 non-owner listener-mentor removes S1 from A');
select t.lives($$select remove_listener('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000c1')$$,
  'AC6 removing again returns without error (safe retry / two people at once)');
reset role;
select t.ok(not exists (select 1 from course_members where course_id = t.id('A') and user_id = t.id('S1')), 'AC6 S1 left course A');
select t.ok(exists (select 1 from course_members where course_id = t.id('B') and user_id = t.id('S1')), 'AC6 S1 is still in course B');
select t.ok(not exists (select 1 from homework where id in (t.id('HW_A1'), t.id('HW_A2'))), 'AC6 S1''s checked and unchecked homework in A is deleted');
select t.ok(exists (select 1 from homework where id = t.id('HW_B1')), 'AC6 S1''s homework in B is untouched');
select t.ok(not exists (select 1 from storage.objects where name = t.id('S1') || '/a1.jpg'), 'AC6 the A photo is gone');
select t.ok(exists (select 1 from storage.objects where name = t.id('S1') || '/b1.jpg'), 'AC6 the B photo is untouched');
select t.ok(exists (select 1 from course_members where course_id = t.id('A') and user_id = t.id('N')), 'AC6 other listeners stay');

-- AC 6: a listener with no homework (dialog without the second sentence); the teacher removes.
select t.login('T');
select t.eq((select count(*) from listener_homework_photos(t.id('B'), t.id('M2'))), 0::bigint, 'AC6 M2 has 0 homework in B');
select t.lives($$select remove_listener('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000b3')$$,
  'AC6 teacher removes a listener with no homework');
reset role;
select t.ok(not exists (select 1 from course_members where course_id = t.id('B') and user_id = t.id('M2')), 'AC6 M2 left course B');

-- Edge: re-adding a removed listener starts with no homework in that course.
select t.login('M');
select t.lives($$insert into course_members (course_id, user_id, added_by) values ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000b1')$$,
  'edge: re-add S1 to A');
select t.eq((select count(*) from homework where student_id = t.id('S1') and course_id = t.id('A')), 0::bigint,
  'edge: re-added listener has no homework in A');

-- Data checks.
reset role;
select t.ok(not exists (select 1 from pg_policies where tablename = 'course_members' and cmd in ('DELETE', 'ALL')),
  'data: no delete policy on course_members (removal only through remove_listener)');
select t.ok((select relrowsecurity from pg_class where oid = 'public.course_members'::regclass), 'data: RLS is on for course_members');
select t.ok(exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'course_members'),
  'AC2 course_members is in the supabase_realtime publication');
select t.ok(exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'homework'),
  'AC6 homework is published, so deleted homework disappears live');
select t.ok((select bool_and(p.prosecdef and 'search_path=public' = any(p.proconfig)) from pg_proc p
  where p.proname in ('is_member', 'remove_listener', 'listener_homework_photos', 'is_listener_homework_photo')),
  'data: the four helpers are security definer with search_path = public');
insert into courses (id, title, created_by) values ('00000000-0000-0000-0000-0000000000d3', 'Temp', t.id('M'));
insert into course_members (course_id, user_id, added_by) values ('00000000-0000-0000-0000-0000000000d3', t.id('S2'), t.id('M'));
delete from courses where id = '00000000-0000-0000-0000-0000000000d3';
select t.ok(not exists (select 1 from course_members where course_id = '00000000-0000-0000-0000-0000000000d3'),
  'data: deleting a course removes its listeners (on delete cascade)');
