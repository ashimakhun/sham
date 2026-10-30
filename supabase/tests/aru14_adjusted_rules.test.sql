-- Rules added or reversed by the requirement adjustments after the ARU-14 decision (every mentor has the
-- teacher's homework rights, never on their own homework):
--   * ARU-14 edge case (reversed): a mentor who is a listener of a course sees and checks the OTHER listeners'
--     homework in that course, but never their own.
--   * ARU-13 decision 8: the role decides homework access at query time, so "make mentor" gives access to all
--     homework and photos, and "make student" takes it away; memberships and own homework are kept (ARU-13 AC 7).
--   * ARU-9 AC 8/10: changing a course's owner changes nobody's homework access and updates no homework row.
-- Rules under test: supabase/migrations/0005_homework_by_course.sql (my_role() in the policies).
select t.seed();
delete from homework;
select t.make_assignments(t.id('A')); -- ARU-32: homework is sent for an assignment
delete from storage.objects;
-- A owned by M: listeners S1, S2 and mentor N. B owned by N: listener S3.
insert into course_members (course_id, user_id, added_by) values
  (t.id('A'), t.id('S1'), t.id('M')),
  (t.id('A'), t.id('S2'), t.id('M')),
  (t.id('A'), t.id('N'), t.id('M')),
  (t.id('B'), t.id('S3'), t.id('N'));
insert into homework (id, student_id, course_id, title, photo_path) values
  (t.id('HW_A1'), t.id('S1'), t.id('A'), 'S1 in A', t.id('S1') || '/a1.jpg'),
  (t.id('HW_A2'), t.id('N'), t.id('A'), 'N in A', null),
  (t.id('HW_B1'), t.id('S3'), t.id('B'), 'S3 in B', t.id('S3') || '/b1.jpg');
insert into storage.objects (bucket_id, name, owner) values
  ('homework', t.id('S1') || '/a1.jpg', t.id('S1')),
  ('homework', t.id('S3') || '/b1.jpg', t.id('S3'));

-- ARU-14 edge case (reversed): N, a listener of A, sees and checks a fellow listener's homework in A.
select t.login('N');
select t.ok(exists (select 1 from homework where id = t.id('HW_A1')), 'listener-mentor N sees fellow listener S1''s homework in A');
select t.eq((select count(*) from storage.objects where name = t.id('S1') || '/a1.jpg'), 1::bigint,
  'listener-mentor N opens S1''s photo in A');
select t.eq(t.affected($$update homework set status = 'checked', checked_by = '00000000-0000-0000-0000-0000000000b2', checked_at = now() where id = '00000000-0000-0000-0000-0000000000e1'$$), 1::bigint,
  'listener-mentor N checks fellow listener S1''s homework in A');
select t.eq(t.affected($$update homework set status = 'checked', checked_by = '00000000-0000-0000-0000-0000000000b2' where id = '00000000-0000-0000-0000-0000000000e2'$$), 0::bigint,
  'listener-mentor N still cannot check their own homework in A');

-- ARU-13 decision 8: "make mentor" gives access to all homework and photos in every course.
reset role; select t.login('S2');
select t.eq((select count(*) from homework), 0::bigint, 'before: student S2 sees no homework');
select t.eq((select count(*) from storage.objects), 0::bigint, 'before: student S2 opens no photos');
select t.eq(t.affected($$update homework set status = 'checked', checked_by = '00000000-0000-0000-0000-0000000000c2' where id = '00000000-0000-0000-0000-0000000000e3'$$), 0::bigint,
  'before: student S2 cannot check');
reset role;
update profiles set role = 'mentor' where id = t.id('S2');
select t.login('S2');
select t.eq((select count(*) from homework), 3::bigint, 'after "make mentor": S2 sees all homework, in every course');
select t.eq((select count(*) from storage.objects), 2::bigint, 'after "make mentor": S2 opens all homework photos');
select t.eq(t.affected($$update homework set status = 'checked', checked_by = '00000000-0000-0000-0000-0000000000c2', checked_at = now() where id = '00000000-0000-0000-0000-0000000000e3'$$), 1::bigint,
  'after "make mentor": S2 checks homework in a course they are not in (B)');
select t.ok(is_member(t.id('A')), 'ARU-13 AC7: S2 is still a listener of A after "make mentor"');
select t.lives($$insert into homework (student_id, course_id, title, assignment_id) values ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000d1', 'S2 as mentor in A', t.assignment('00000000-0000-0000-0000-0000000000d1', 1))$$,
  'ARU-13 AC7: S2, now a mentor listener, can still submit to A');

-- ...and "make student" takes it away again; own homework stays visible.
reset role;
update profiles set role = 'student' where id = t.id('S2');
select t.login('S2');
select t.eq((select count(*) from homework), 1::bigint, 'after "make student": S2 sees only their own homework');
select t.eq((select count(*) from storage.objects), 0::bigint, 'after "make student": S2 opens no one else''s photos');
select t.eq(t.affected($$update homework set mentor_comment = 'late edit' where id = '00000000-0000-0000-0000-0000000000e3'$$), 0::bigint,
  'after "make student": S2 can no longer check');
select t.lives($$insert into homework (student_id, course_id, title, assignment_id) values ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000d1', 'S2 as student in A', t.assignment('00000000-0000-0000-0000-0000000000d1', 2))$$,
  'ARU-13 AC7: S2 can still submit to A as a student');

-- ARU-9 AC 8/10: an owner change moves no homework and changes nobody's access (done here as the SQL owner).
reset role;
create temp table hw_before as select * from homework;
update courses set created_by = t.id('M2') where id = t.id('A');
select t.ok(not exists (select * from homework except select * from hw_before) and not exists (select * from hw_before except select * from homework),
  'ARU-9 AC10: an owner change updates no homework row');
select t.login('M');
select t.eq((select count(*) from homework where course_id = t.id('A')), 4::bigint, 'ARU-9 AC8: former owner M still sees A''s homework');
select t.eq(t.affected($$update homework set status = 'checked', checked_by = '00000000-0000-0000-0000-0000000000b1', checked_at = now() where student_id = '00000000-0000-0000-0000-0000000000c2'$$), 2::bigint,
  'ARU-9 AC8: former owner M still checks A''s homework');
reset role; select t.login('M2');
select t.eq((select count(*) from homework where course_id = t.id('A')), 4::bigint, 'ARU-9 AC8: new owner M2 sees A''s homework (as before)');
