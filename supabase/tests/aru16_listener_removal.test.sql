-- ARU-16: remove_listener() and listener_homework_photos() act only on actual listeners of the course.
-- Functions under test: supabase/migrations/0008_listener_functions_check_membership.sql.
-- S1 is a listener of A (and B). S2 is NOT a listener of A but is a listener of B; S2 has homework in A seeded
-- directly as the superuser (the insert policy would block it): one checked with a comment, one with a photo.
select t.seed();

insert into course_members (course_id, user_id, added_by) values
  (t.id('A'), t.id('S1'), t.id('M')),
  (t.id('B'), t.id('S1'), t.id('N')),
  (t.id('B'), t.id('S2'), t.id('N')),
  (t.id('A'), t.id('S3'), t.id('M'));
insert into homework (id, student_id, course_id, title, photo_path, status, checked_by, checked_at, mentor_comment) values
  ('00000000-0000-0000-0000-0000000000f1', t.id('S2'), t.id('A'), 'S2 in A checked', null, 'checked', t.id('M'), now(), 'Good'),
  ('00000000-0000-0000-0000-0000000000f2', t.id('S2'), t.id('A'), 'S2 in A photo', t.id('S2') || '/a.jpg', 'submitted', null, null, null),
  ('00000000-0000-0000-0000-0000000000f3', t.id('S2'), t.id('B'), 'S2 in B', t.id('S2') || '/b.jpg', 'submitted', null, null, null),
  ('00000000-0000-0000-0000-0000000000f4', t.id('S3'), t.id('A'), 'S3 in A', null, 'submitted', null, null, null);

-- Snapshot of every column of S2's homework in A, and all memberships, to compare after the calls.
create table t.s2_before as select * from homework where student_id = t.id('S2') and course_id = t.id('A');
create table t.members_before as select * from course_members;
grant select on t.s2_before, t.members_before to authenticated;

-- AC 1: non-listener → listener_homework_photos returns no rows (as the teacher and as a mentor).
select t.login('T');
select t.eq((select count(*) from listener_homework_photos(t.id('A'), t.id('S2'))), 0::bigint,
  'AC1 teacher: no rows for a non-listener with homework in the course');
reset role; select t.login('M');
select t.eq((select count(*) from listener_homework_photos(t.id('A'), t.id('S2'))), 0::bigint,
  'AC1 mentor: no rows for a non-listener with homework in the course');
select t.eq((select count(*) from listener_homework_photos(t.id('A'), '00000000-0000-0000-0000-00000000ffff')), 0::bigint,
  'AC1 unknown user: no rows');
select t.eq((select count(*) from listener_homework_photos('00000000-0000-0000-0000-00000000ffff', t.id('S2'))), 0::bigint,
  'AC1 unknown course: no rows');
select t.eq((select count(*) from listener_homework_photos(t.id('B'), t.id('S2'))), 1::bigint,
  'AC1 the same user is still listed in a course they are a listener of');

-- AC 2: non-listener → remove_listener returns without error and deletes nothing.
select t.lives($$select remove_listener('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000c2')$$,
  'AC2 mentor: remove_listener for a non-listener returns without error');
reset role; select t.login('T');
select t.lives($$select remove_listener('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000c2')$$,
  'AC2 teacher: remove_listener for a non-listener returns without error');
select t.lives($$select remove_listener('00000000-0000-0000-0000-00000000ffff', '00000000-0000-0000-0000-0000000000c2')$$,
  'AC2 unknown course: returns without error');
reset role;
select t.eq((select count(*) from homework where student_id = t.id('S2') and course_id = t.id('A')), 2::bigint,
  'AC2 the non-listener''s homework rows are all still there');
select t.ok(not exists (
    (select * from t.s2_before except select * from homework where student_id = t.id('S2') and course_id = t.id('A'))
    union all
    (select * from homework where student_id = t.id('S2') and course_id = t.id('A') except select * from t.s2_before)),
  'AC2 every column of the non-listener''s homework (checked, comment, photo_path) is unchanged');
select t.ok(not exists (
    (select * from t.members_before except select * from course_members)
    union all
    (select * from course_members except select * from t.members_before)),
  'AC2 course_members is unchanged');
select t.ok(exists (select 1 from homework where id = '00000000-0000-0000-0000-0000000000f3'),
  'AC2 the user''s homework in another course is untouched');

-- AC 3: an actual listener → both functions behave as before (ARU-7 AC 6).
select t.login('M');
select t.eq((select count(*) from listener_homework_photos(t.id('A'), t.id('S1'))), 2::bigint,
  'AC3 listener_homework_photos lists all of the listener''s homework in the course');
select t.eq((select count(*) from listener_homework_photos(t.id('A'), t.id('S1')) where photo_path = t.id('S1') || '/a1.jpg'), 1::bigint,
  'AC3 listener_homework_photos returns the photo path');
select t.lives($$select remove_listener('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000c1')$$,
  'AC3 remove_listener for an actual listener succeeds');
reset role;
select t.eq((select count(*) from homework where student_id = t.id('S1') and course_id = t.id('A')), 0::bigint,
  'AC3 the listener''s homework in the course is deleted');
select t.ok(not exists (select 1 from course_members where course_id = t.id('A') and user_id = t.id('S1')),
  'AC3 the membership row is deleted');
select t.ok(exists (select 1 from homework where id = t.id('HW_B1')), 'AC3 the listener''s homework in another course stays');
select t.ok(exists (select 1 from course_members where course_id = t.id('B') and user_id = t.id('S1')),
  'AC3 the listener''s membership in another course stays');
select t.ok(exists (select 1 from course_members where course_id = t.id('A') and user_id = t.id('S3'))
    and exists (select 1 from homework where id = '00000000-0000-0000-0000-0000000000f4'),
  'AC3 other listeners of the course and their homework stay');

-- AC 4: a repeated call (retry / second remover) returns without error and deletes nothing more,
-- even if homework for the removed user reappeared in the course (seeded as the superuser).
insert into homework (id, student_id, course_id, title, status) values
  ('00000000-0000-0000-0000-0000000000f5', t.id('S1'), t.id('A'), 'S1 leftover', 'submitted');
create table t.counts_before as select (select count(*) from homework) as hw, (select count(*) from course_members) as cm;
grant select on t.counts_before to authenticated;
select t.login('T');
select t.lives($$select remove_listener('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000c1')$$,
  'AC4 a second remove_listener for the same listener returns without error');
select t.eq((select count(*) from listener_homework_photos(t.id('A'), t.id('S1'))), 0::bigint,
  'AC4 the removed listener has no photos listed any more');
reset role;
select t.eq((select count(*) from homework), (select hw from t.counts_before), 'AC4 the repeat call deletes no homework');
select t.eq((select count(*) from course_members), (select cm from t.counts_before), 'AC4 the repeat call deletes no memberships');
select t.ok(exists (select 1 from homework where id = '00000000-0000-0000-0000-0000000000f5'),
  'AC4/AC5 homework is not deleted when the membership row is already gone');

-- AC 6: students and anonymous callers are still rejected; privileges and function settings are unchanged.
select t.login('S2');
select t.throws($$select remove_listener('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000c3')$$, '42501',
  'AC6 student remove_listener is rejected');
select t.throws($$select * from listener_homework_photos('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000c3')$$, '42501',
  'AC6 student listener_homework_photos is rejected');
reset role; select t.login(null);
select t.throws($$select remove_listener('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000c3')$$, '42501',
  'AC6 anonymous remove_listener is rejected');
select t.throws($$select * from listener_homework_photos('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000c3')$$, '42501',
  'AC6 anonymous listener_homework_photos is rejected');
reset role;
select t.ok(exists (select 1 from course_members where course_id = t.id('A') and user_id = t.id('S3')),
  'AC6 rejected calls removed nothing');

select t.ok(not has_function_privilege('anon', 'remove_listener(uuid, uuid)', 'execute')
    and not has_function_privilege('anon', 'listener_homework_photos(uuid, uuid)', 'execute'),
  'AC6 anon has no execute on either function');
select t.ok(not exists (
    select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where p.proname in ('remove_listener', 'listener_homework_photos') and a.grantee = 0 and a.privilege_type = 'EXECUTE'),
  'AC6 public has no execute on either function');
select t.ok(has_function_privilege('authenticated', 'remove_listener(uuid, uuid)', 'execute')
    and has_function_privilege('authenticated', 'listener_homework_photos(uuid, uuid)', 'execute'),
  'AC6 authenticated can execute both functions');
select t.eq((select count(*) from pg_proc
    where proname in ('remove_listener', 'listener_homework_photos') and prosecdef and proconfig @> array['search_path=public']),
  2::bigint, 'both functions stay security definer with search_path = public');
select t.eq((select provolatile::text from pg_proc where proname = 'listener_homework_photos'), 's',
  'listener_homework_photos stays stable');
