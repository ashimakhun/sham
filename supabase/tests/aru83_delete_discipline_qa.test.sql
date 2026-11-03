-- QA ARU-83: gaps in aru83_delete_discipline.test.sql: all-or-nothing when one course's delete fails part-way
-- through the loop, a null id, homework on an assignment of a course in the discipline but filed under a course
-- outside it, a course moved into the discipline just before the delete, a listener of courses in two disciplines,
-- and a student's unread counter after the delete.
-- Fixture: D1 holds A (owner M) and B (owner N); D2 holds E (owner N); S1 is a listener of B and E.
select t.seed();
select t.make_assignments(t.id('A'));
insert into disciplines (id, name, created_by) values
  (md5('aru83qa-d1')::uuid, 'Math', t.id('T')),
  (md5('aru83qa-d2')::uuid, 'Art', t.id('T'));
update courses set discipline_id = md5('aru83qa-d1')::uuid where id in (t.id('A'), t.id('B'));
insert into courses (id, title, created_by, discipline_id) values (md5('aru83qa-e')::uuid, 'Elsewhere', t.id('N'), md5('aru83qa-d2')::uuid);
insert into course_members (course_id, user_id, added_by) values
  (t.id('B'), t.id('S1'), t.id('N')),
  (md5('aru83qa-e')::uuid, t.id('S1'), t.id('N'));
set session_replication_role = replica;
-- Odd row: filed under E (another discipline) but on an assignment of A: it goes with A (0041's rule).
insert into homework (id, student_id, course_id, assignment_id, title, photo_path, status) values
  (md5('aru83qa-cross')::uuid, t.id('S1'), md5('aru83qa-e')::uuid, t.assignment(t.id('A'), 1), 'Cross', t.id('S1') || '/cross.jpg', 'submitted'),
  (md5('aru83qa-e-hw')::uuid, t.id('S1'), md5('aru83qa-e')::uuid, null, 'E keeps', t.id('S1') || '/e.jpg', 'submitted');
insert into storage.objects (bucket_id, name, owner) values
  ('homework', t.id('S1') || '/cross.jpg', t.id('S1')),
  ('homework', t.id('S1') || '/e.jpg', t.id('S1'));
set session_replication_role = origin;
insert into course_messages (course_id, author_id, body) values (t.id('B'), t.id('N'), 'hi'), (md5('aru83qa-e')::uuid, t.id('N'), 'hi E');

-- The photo list includes the cross row (it belongs to A) and not E's own photo.
select t.login('T');
select t.eq((select array_agg(photo_path order by photo_path) from discipline_homework_photos(md5('aru83qa-d1')::uuid)),
  array[t.id('S1') || '/a1.jpg', t.id('S1') || '/b1.jpg', t.id('S1') || '/cross.jpg'],
  'AC8a the photo list: A''s and B''s photos and the cross row (A''s assignment); not E''s own photo');
select t.throws($$select delete_discipline(null)$$, 'P0002', 'a null id: Discipline not found');
reset role;

-- All or nothing: B's delete fails (a test trigger), so A, B and D1 all stay.
do $$ begin
  execute format($f$create function pg_temp.boom() returns trigger language plpgsql as $b$
    begin
      if old.id = %L then raise exception 'boom'; end if;
      return old;
    end $b$ $f$, t.id('B'));
end $$;
create trigger t_boom before delete on courses for each row execute function pg_temp.boom();
select t.login('T');
select t.throws($$select delete_discipline(md5('aru83qa-d1')::uuid)$$, 'P0001', 'AC8b a failure in the second course fails the whole delete');
reset role;
select t.eq((select count(*) from courses where discipline_id = md5('aru83qa-d1')::uuid), 2::bigint, 'AC8b both courses are still there');
select t.eq((select count(*) from homework where id = md5('aru83qa-cross')::uuid), 1::bigint, 'AC8b A''s homework is still there');
select t.eq((select count(*) from disciplines where id = md5('aru83qa-d1')::uuid), 1::bigint, 'AC8b the discipline is still there');
drop trigger t_boom on courses;

-- A course the teacher moves into D1 just before the delete goes with it.
insert into courses (id, title, created_by) values (md5('aru83qa-f')::uuid, 'Late', t.id('N'));
select t.login('T');
select t.lives(format('select set_course_discipline(%L, %L)', md5('aru83qa-f')::uuid, md5('aru83qa-d1')::uuid),
  'edge: the teacher moves F into D1');
select t.lives($$select delete_discipline(md5('aru83qa-d1')::uuid)$$, 'the teacher deletes D1');
reset role;

select t.eq((select count(*) from courses where id = md5('aru83qa-f')::uuid), 0::bigint, 'edge: F went with D1');

-- S1 keeps E (other discipline) and its homework; B's chat no longer counts.
select t.eq((select count(*) from course_members where user_id = t.id('S1')), 1::bigint, 'AC6 S1 is still a listener of E');
select t.eq((select count(*) from homework where id = md5('aru83qa-e-hw')::uuid), 1::bigint, 'AC6 E''s homework stays');
select t.eq((select count(*) from homework where id = md5('aru83qa-cross')::uuid), 0::bigint, 'AC5 the cross row went with A');
select t.eq((select count(*) from disciplines where id = md5('aru83qa-d2')::uuid), 1::bigint, 'AC6 D2 stays');
select t.login('S1');
select t.eq((select array_agg(course_id) from chat_unread_counts()), array[md5('aru83qa-e')::uuid], 'AC7 only E''s unread counter is left');
reset role;
