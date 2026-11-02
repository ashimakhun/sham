-- QA ARU-63: gaps in aru63_disciplines.test.sql: names made only of other whitespace (tabs, line breaks, non-breaking
-- spaces), the creation time set by the server, the teacher creating a hidden discipline and unhiding it, an owner
-- change moving the discipline control, the teacher on a course they own, an unknown discipline on a new course, a
-- declined account, and what the visibility helper tells a student.
select t.seed();
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000063b1', 'd@x.test', '{"full_name":"Declined Dee"}');
update profiles set access_status = 'rejected' where id = '00000000-0000-0000-0000-0000000063b1';

select t.login('T');
select t.lives($$insert into disciplines (id, name) values ('00000000-0000-0000-0000-0000000063e1', 'Math')$$, 'teacher creates Math');

-- AC 1: whitespace-only names. The app trims with JavaScript trim(); the database must refuse them as well.
select t.throws($$insert into disciplines (name) values (E'\t\t')$$, '23514', 'AC1 a name of tabs only is refused');
select t.throws($$insert into disciplines (name) values (E' \n ')$$, '23514', 'AC1 a name of spaces and a line break is refused');
select t.throws($$insert into disciplines (name) values (chr(160) || chr(160))$$, '23514', 'AC1 a name of non-breaking spaces is refused');
reset role;
select t.eq((select count(*) from disciplines), 1::bigint, 'AC1 nothing else was saved');

-- The creation time is the server's (the insert grant covers id, name and hidden only).
select t.login('T');
select t.throws($$insert into disciplines (name, created_at) values ('Old', '2000-01-01')$$, '42501', 'created_at can''t be given');

-- AC 2: the teacher creates a discipline hidden from the start, and unhides it.
select t.lives($$insert into disciplines (id, name, hidden) values ('00000000-0000-0000-0000-0000000063e2', 'Secret', true)$$,
  'AC2 teacher creates a hidden discipline');
select t.login('S1');
select t.eq((select count(*) from disciplines where id = '00000000-0000-0000-0000-0000000063e2'), 0::bigint, 'AC2 a student doesn''t see it');
select t.ok(not discipline_visible_to_me('00000000-0000-0000-0000-0000000063e2'), 'AC2 the helper says not visible to a student');
select t.ok(discipline_visible_to_me('00000000-0000-0000-0000-0000000063e1'), 'the helper says Math is visible');
select t.login('T');
select t.eq(t.affected($$update disciplines set hidden = false where id = '00000000-0000-0000-0000-0000000063e2'$$), 1::bigint,
  'AC2 the teacher unhides it');
select t.login('S1');
select t.eq((select count(*) from disciplines), 2::bigint, 'AC2 then the student sees both');

-- A declined account sees none and can't use the function.
reset role;
do $q$
begin
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000063b1","role":"authenticated"}', false);
  set role authenticated;
  perform t.eq((select count(*) from disciplines), 0::bigint, 'declined accounts read no disciplines');
  perform t.ok(not discipline_visible_to_me('00000000-0000-0000-0000-0000000063e1'), 'declined: nothing is visible');
  reset role;
end $q$;

-- AC 4: an unknown discipline on a new course is refused.
select t.login('M');
select t.throws(format('insert into courses (title, created_by, discipline_id) values (%L, %L, %L)',
  'Ghost', t.id('M'), '00000000-0000-0000-0000-0000000063ff'), '42501', 'AC4 a course in an unknown discipline is refused');

-- AC 5 / edge: an owner change moves the control. M sets Math on A, the teacher gives A to N.
select t.lives(format('select set_course_discipline(%L, %L)', t.id('A'), '00000000-0000-0000-0000-0000000063e1'), 'M sets Math on A');
select t.login('T');
select t.lives(format('select change_course_owner(%L, %L)', t.id('A'), t.id('N')), 'the teacher gives A to N');
select t.login('M');
select t.throws(format('select set_course_discipline(%L, null)', t.id('A')), '42501', 'edge: the former owner is refused');
select t.login('N');
select t.lives(format('select set_course_discipline(%L, null)', t.id('A')), 'edge: the new owner can clear it');
reset role;
select t.ok((select discipline_id is null from courses where id = t.id('A')), 'and A has no discipline');

-- AC 5: the teacher on a course they own may use a hidden discipline (they can see it).
insert into courses (id, title, created_by) values ('00000000-0000-0000-0000-0000000063c9', 'Teacher course', t.id('T'));
select t.login('T');
select t.lives($$update disciplines set hidden = true where id = '00000000-0000-0000-0000-0000000063e2'$$, 'hide Secret again');
select t.lives(format('select set_course_discipline(%L, %L)', '00000000-0000-0000-0000-0000000063c9', '00000000-0000-0000-0000-0000000063e2'),
  'AC5 the teacher puts their own course into a hidden discipline');
select t.lives(format('select set_course_discipline(%L, %L)', '00000000-0000-0000-0000-0000000063c9', '00000000-0000-0000-0000-0000000063e1'),
  'AC5 and moves it to Math');
reset role;
select t.eq((select discipline_id from courses where id = '00000000-0000-0000-0000-0000000063c9'),
  '00000000-0000-0000-0000-0000000063e1'::uuid, 'the teacher''s course is in Math');
