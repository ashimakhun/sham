-- ARU-203: the deletion job stores how many photos it removed (homework.photos_removed_count, 0081), adding up over
-- runs when a homework's deletes partly failed. App users can't set it. App side:
-- __tests__/aru203-removed-photo-count.test.tsx.
-- Fixture (t.seed): S1 sent HW_A1 (A, photo S1/a1.jpg) and HW_B1 (B, photo S1/b1.jpg); course A is M's.
select t.seed();
select t.make_assignments(t.id('A'));
insert into course_members (course_id, user_id, added_by) values (t.id('A'), t.id('S1'), t.id('M'));

create function t.h(n text) returns uuid language sql immutable as $$ select md5('aru203-' || n)::uuid $$;
create function t.p(hw text, n int) returns text language sql immutable as $$
  select t.id('S1') || '/' || t.h(hw) || '/' || n || '.jpg' $$;
create function t.ps(hw text, k int) returns text[] language sql immutable as $$
  select array_agg(t.p(hw, i) order by i) from generate_series(1, k) i $$;
create function t.send(hw text, n int, k int) returns text language sql immutable as $$
  select format('select submit_homework(%L, %L, %L, %L, %L, %L)', t.h(hw), t.id('A'), t.assignment(t.id('A'), n),
                'Homework ' || hw, '', t.ps(hw, k)) $$;
create function t.removed(hw uuid) returns text language sql security definer as $$
  select photos_removed_count || '|' || (photo_removed_at is not null) from public.homework where id = hw $$;
grant execute on function t.h(text), t.p(text, int), t.ps(text, int), t.send(text, int, int), t.removed(uuid)
  to anon, authenticated, service_role;

-- S1 sends homework with 1, 3 and 5 photos; all are checked 7 months ago.
select t.login('S1');
select t.lives(t.send('one', 1, 1), 'S1 sends 1 photo');
select t.lives(t.send('three', 2, 3), 'S1 sends 3 photos');
select t.lives(t.send('five', 3, 5), 'S1 sends 5 photos');
reset role;
update homework set status = 'checked', checked_by = t.id('M'), checked_at = now() - interval '7 months'
  where id in (t.h('one'), t.h('three'), t.h('five'));
select t.eq(t.removed(t.h('three')), '0|false', 'a new homework starts at 0');

-- One run removes every photo: the count is the number of photos.
select t.eq(mark_homework_photos_removed(array[t.h('one')], t.ps('one', 1)), 1, 'one: 1 marked');
select t.eq(t.removed(t.h('one')), '1|true', 'one: count 1, removed');
select t.eq(mark_homework_photos_removed(array_fill(t.h('five'), array[5]), t.ps('five', 5)), 5, 'five: 5 marked');
select t.eq(t.removed(t.h('five')), '5|true', 'five: count 5, removed');

-- Partial deletion: run 1 removes 2 of 3 (the third delete failed), run 2 the last one.
select t.eq(mark_homework_photos_removed(array[t.h('three'), t.h('three')], array[t.p('three', 1), t.p('three', 2)]), 2,
  'three: run 1 marks 2');
select t.eq(t.removed(t.h('three')), '2|false', 'three: 2 counted, not removed yet');
-- The same paths again (a retried run) change nothing.
select t.eq(mark_homework_photos_removed(array[t.h('three')], array[t.p('three', 1)]), 0, 'three: a retry marks nothing');
select t.eq(t.removed(t.h('three')), '2|false', 'three: a retry doesn''t count twice');
select t.eq(mark_homework_photos_removed(array[t.h('three')], array[t.p('three', 3)]), 1, 'three: run 2 marks the last');
select t.eq(t.removed(t.h('three')), '3|true', 'three: count 3 over two runs, removed');
-- After removal a stray call for the homework (no rows left) leaves the count alone.
select t.eq(mark_homework_photos_removed(array[t.h('three')], array[t.p('three', 3)]), 0, 'three: nothing left to mark');
select t.eq(t.removed(t.h('three')), '3|true', 'three: still 3');

-- A photo_path with no list row (the legacy path): counts 1.
update homework set status = 'checked', checked_by = t.id('M'), checked_at = now() - interval '7 months'
  where id = t.id('HW_A1');
delete from homework_files where homework_id = t.id('HW_A1');
select t.eq(mark_homework_photos_removed(array[t.id('HW_A1')], array[t.id('S1') || '/a1.jpg']), 1, 'legacy: 1 marked');
select t.eq(t.removed(t.id('HW_A1')), '1|true', 'legacy: count 1, removed');

-- App users can't write the column: not in the update grant, and an insert or update can't set it.
select t.ok(not has_column_privilege('authenticated', 'homework', 'photos_removed_count', 'update')
  and not has_column_privilege('anon', 'homework', 'photos_removed_count', 'update'), 'no update grant on the column');
select t.ok(not has_function_privilege('authenticated', 'homework_keep_photos_removed_count()', 'execute'),
  'the guard trigger function is not callable');
select t.login('S1');
insert into homework (id, student_id, course_id, assignment_id, title, description, photos_removed_count)
  values (t.h('forged'), t.id('S1'), t.id('A'), t.assignment(t.id('A'), 4), 'Forged', '', 7);
reset role;
select t.eq(t.removed(t.h('forged')), '0|false', 'a count sent on insert is ignored');
select t.login('M');
select t.throws(format('update homework set photos_removed_count = 9 where id = %L', t.h('one')), '42501',
  'a mentor can''t update the count');
select t.lives(format('update homework set mentor_comment = %L where id = %L', 'ok', t.h('one')),
  'a mentor still updates a granted column');
reset role;
select t.eq(t.removed(t.h('one')), '1|true', 'the count stays after a mentor update');
select t.ok(not has_function_privilege('authenticated', 'mark_homework_photos_removed(uuid[], text[])', 'execute'),
  'app users can''t call the deletion job');
