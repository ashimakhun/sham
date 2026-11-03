-- QA ARU-70: gaps in aru70_teacher_sets_any_course_discipline.test.sql: the mentor owner after the teacher picked a
-- hidden discipline for their course (keep it unchanged, move it to a visible one, can't pick it back), a mentor
-- listener (not owner) refused, the former owner after an owner change refused while the teacher still can, and the
-- teacher's change visible to the owner and a listener.
select t.seed();
insert into course_members (course_id, user_id, added_by) values (t.id('A'), t.id('S1'), t.id('M')), (t.id('A'), t.id('M2'), t.id('M'));
insert into disciplines (id, name, hidden, created_by) values
  ('00000000-0000-0000-0000-0000000070e1', 'Math', false, t.id('T')),
  ('00000000-0000-0000-0000-0000000070e2', 'Secret', true, t.id('T'));

-- The teacher puts M's course A into the hidden discipline.
select t.login('T');
select t.lives(format('select set_course_discipline(%L, %L)', t.id('A'), '00000000-0000-0000-0000-0000000070e2'), 'the teacher sets Secret on A');

-- The owner sees the id but not the name, keeps it unchanged, moves it to Math, and can't pick Secret again.
select t.login('M');
select t.eq((select discipline_id from courses where id = t.id('A')), '00000000-0000-0000-0000-0000000070e2'::uuid,
  'edge: the owner reads the id (shown as Hidden discipline)');
select t.lives(format('select set_course_discipline(%L, %L)', t.id('A'), '00000000-0000-0000-0000-0000000070e2'),
  'edge: the owner saves it unchanged');
select t.lives(format('select set_course_discipline(%L, %L)', t.id('A'), '00000000-0000-0000-0000-0000000070e1'), 'edge: the owner moves it to Math');
select t.throws(format('select set_course_discipline(%L, %L)', t.id('A'), '00000000-0000-0000-0000-0000000070e2'), 'P0002',
  'edge: and can''t pick Secret again');

-- AC 2: the teacher's change is seen by the listener.
select t.login('T');
select t.lives(format('select set_course_discipline(%L, null)', t.id('A')), 'the teacher clears it');
select t.login('S1');
select t.ok((select discipline_id is null from courses where id = t.id('A')), 'AC2 the listener sees the cleared discipline');

-- AC 4: a mentor listener who doesn't own A is refused.
select t.login('M2');
select t.throws(format('select set_course_discipline(%L, %L)', t.id('A'), '00000000-0000-0000-0000-0000000070e1'), '42501',
  'AC4 a mentor listener (not owner) is refused');

-- Edge ARU-9: after A goes to N, M is refused and N and the teacher can change it.
select t.login('T');
select t.lives(format('select change_course_owner(%L, %L)', t.id('A'), t.id('N')), 'the teacher gives A to N');
select t.login('M');
select t.throws(format('select set_course_discipline(%L, %L)', t.id('A'), '00000000-0000-0000-0000-0000000070e1'), '42501',
  'edge: the former owner is refused');
select t.login('N');
select t.lives(format('select set_course_discipline(%L, %L)', t.id('A'), '00000000-0000-0000-0000-0000000070e1'), 'edge: the new owner sets Math');
select t.login('T');
select t.lives(format('select set_course_discipline(%L, %L)', t.id('A'), '00000000-0000-0000-0000-0000000070e2'),
  'the teacher still changes it (to the hidden one)');
reset role;
select t.eq((select discipline_id from courses where id = t.id('A')), '00000000-0000-0000-0000-0000000070e2'::uuid, 'A is in Secret');
