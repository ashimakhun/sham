-- ARU-13 QA additions (revised TEST DESIGN, decision 8): photos follow the role after set_user_role, a new
-- mentor never checks their own homework, and AC 5 holds even when a course is created between the app's
-- check and the call. Rules under test: supabase/migrations/0009_roles_screen.sql + 0005 homework rules.
select t.seed();
insert into course_members (course_id, user_id, added_by) values
  (t.id('A'), t.id('S1'), t.id('M')),
  (t.id('A'), t.id('S2'), t.id('M'));
-- S2's own homework with a photo, next to S1's (seeded: HW_A1 with a1.jpg, HW_B1 with b1.jpg).
insert into homework (id, student_id, course_id, title, photo_path) values
  ('00000000-0000-0000-0000-0000000000f5', t.id('S2'), t.id('A'), 'S2 own', t.id('S2') || '/own.jpg');
insert into storage.objects (bucket_id, name, owner) values ('homework', t.id('S2') || '/own.jpg', t.id('S2'));

-- Before: student S2 opens only their own photo.
select t.login('S2');
select t.eq((select count(*) from storage.objects where bucket_id = 'homework'), 1::bigint, 'before: student S2 opens only their own photo');

-- AC 3 / decision 8: "Make mentor" through set_user_role -> every photo in every course.
select t.login('T');
select t.lives($$select set_user_role('00000000-0000-0000-0000-0000000000c2', 'mentor')$$, 'AC3: the teacher makes S2 a mentor');
select t.login('S2');
select t.eq((select count(*) from storage.objects where bucket_id = 'homework'), 3::bigint,
  'decision 8: new mentor S2 opens every homework photo (A and B)');
select t.eq(t.affected($$update homework set status = 'checked', checked_by = '00000000-0000-0000-0000-0000000000c2', checked_at = now() where id = '00000000-0000-0000-0000-0000000000f5'$$), 0::bigint,
  'decision 8: new mentor S2 still cannot check their own homework');
select t.eq(t.affected($$update homework set status = 'checked', checked_by = '00000000-0000-0000-0000-0000000000c2', checked_at = now() where id = '00000000-0000-0000-0000-0000000000e1'$$), 1::bigint,
  'decision 8: new mentor S2 checks a fellow listener''s homework in A');

-- AC 4: "Make student" -> back to own homework and own photo only; own homework kept (AC 7).
select t.login('T');
select t.lives($$select set_user_role('00000000-0000-0000-0000-0000000000c2', 'student')$$, 'AC4: the teacher makes S2 a student again');
select t.login('S2');
select t.eq((select count(*) from storage.objects where bucket_id = 'homework'), 1::bigint,
  'AC4: S2 made student opens only their own photo again');
select t.eq((select count(*) from homework), 1::bigint, 'AC7: S2 keeps (and still sees) their own homework');
select t.ok(is_member(t.id('A')), 'AC7: S2 is still a listener of A');

-- AC 5: the database refuses even if the app's course list was stale (a course created just before the call).
select t.login('T');
select t.lives($$select set_user_role('00000000-0000-0000-0000-0000000000b3', 'student')$$, 'AC4: M2 (owns nothing) can be made a student');
select t.lives($$select set_user_role('00000000-0000-0000-0000-0000000000b3', 'mentor')$$, 'M2 made mentor again');
reset role;
insert into courses (id, title, created_by) values ('00000000-0000-0000-0000-0000000000d4', 'Zoology', t.id('M2'));
select t.login('T');
select t.throws($$select set_user_role('00000000-0000-0000-0000-0000000000b3', 'student')$$, '23514',
  'AC5: a course created after the app loaded still blocks "Make student"');
reset role;
select t.eq((select role from profiles where id = t.id('M2')), 'mentor'::user_role, 'AC5: M2 is still a mentor');

-- AC 8: the lock is taken on the target's profile row before counting courses.
select t.ok((select prosrc ilike '%for update%' and prosecdef from pg_proc where proname = 'set_user_role'),
  'AC8: set_user_role is security definer and locks the target profile (for update)');
select t.ok((select 'search_path=public' = any(proconfig) from pg_proc where proname = 'set_user_role'),
  'AC8: set_user_role has search_path = public');
