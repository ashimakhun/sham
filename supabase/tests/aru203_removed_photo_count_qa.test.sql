-- ARU-203 QA re-test: homework.photos_removed_count (0081). Adds to the dev's aru203_removed_photo_count.test.sql:
-- the migration's backfill statement on pre-seeded removed rows, 10 photos, several homework in one run, duplicate
-- paths in one call, an older build's homework (photo_path plus its list row), and writes by every app role
-- (student, mentor, teacher, anon; insert, update, upsert) all refused or ignored.
-- Fixture (t.seed): S1 sent HW_A1 (A, photo S1/a1.jpg, copied into homework_files by 0081) and HW_B1 (B, photo
-- S1/b1.jpg); HW_A2 (A) is checked and has no photo. Course A is M's, B is N's.
select t.seed();
select t.make_assignments(t.id('A'));
insert into course_members (course_id, user_id, added_by) values (t.id('A'), t.id('S1'), t.id('M'));

create function t.h(n text) returns uuid language sql immutable as $$ select md5('aru203qa-' || n)::uuid $$;
create function t.p(hw text, n int) returns text language sql immutable as $$
  select t.id('S1') || '/' || t.h(hw) || '/' || n || '.jpg' $$;
create function t.ps(hw text, k int) returns text[] language sql immutable as $$
  select array_agg(t.p(hw, i) order by i) from generate_series(1, k) i $$;
create function t.send(hw text, n int, k int) returns text language sql immutable as $$
  select format('select submit_homework(%L, %L, %L, %L, %L, %L)', t.h(hw), t.id('A'), t.assignment(t.id('A'), n),
                'Homework ' || hw, '', t.ps(hw, k)) $$;
create function t.count_of(hw uuid) returns integer language sql security definer as $$
  select photos_removed_count from public.homework where id = hw $$;
create function t.removed(hw uuid) returns text language sql security definer as $$
  select photos_removed_count || '|' || (photo_removed_at is not null) from public.homework where id = hw $$;
grant execute on function t.h(text), t.p(text, int), t.ps(text, int), t.send(text, int, int), t.count_of(uuid),
  t.removed(uuid) to anon, authenticated, service_role;

-- Backfill (migration 0081): homework removed before the count existed get 1, every other homework keeps 0. The
-- statement below is copied verbatim from 0081 (aru203-removed-photo-count-qa.test.ts checks it is still there).
-- Pre-seed the pre-migration state: HW_A2 removed by the old job with count 0, HW_B1 not removed.
update homework set photo_removed_at = now() - interval '3 days', photos_removed_count = 0 where id = t.id('HW_A2');
update homework set photos_removed_count = 0 where id = t.id('HW_B1');
create table t.before as select id, status, checked_at, checked_by, workspace_id, photo_path, photo_removed_at
  from homework;
update homework set photos_removed_count = 1 where photo_removed_at is not null;
select t.eq(t.removed(t.id('HW_A2')), '1|true', 'backfill: a homework removed before the count gets 1');
select t.eq(t.removed(t.id('HW_B1')), '0|false', 'backfill: a homework still with its photo stays 0');
select t.eq((select count(*) from homework h join t.before b using (id)
  where (h.status, h.checked_at, h.checked_by, h.workspace_id, h.photo_path, h.photo_removed_at)
    is distinct from (b.status, b.checked_at, b.checked_by, b.workspace_id, b.photo_path, b.photo_removed_at)),
  0::bigint, 'backfill: no other column changes (status, checked_at, workspace, photo, removal time)');
-- Run twice (a re-applied migration) it stays 1.
update homework set photos_removed_count = 1 where photo_removed_at is not null;
select t.eq(t.count_of(t.id('HW_A2')), 1, 'backfill: run twice, still 1');

-- S1 sends 10 photos (ten), 2 photos (two) and 4 photos (four); all are checked 7 months ago.
select t.login('S1');
select t.lives(t.send('ten', 1, 10), 'S1 sends 10 photos');
select t.lives(t.send('two', 2, 2), 'S1 sends 2 photos');
select t.lives(t.send('four', 3, 4), 'S1 sends 4 photos');
reset role;
update homework set status = 'checked', checked_by = t.id('M'), checked_at = now() - interval '7 months'
  where id in (t.h('ten'), t.h('two'), t.h('four'), t.id('HW_A1'));

-- 10 photos in one run: 10.
select t.eq(mark_homework_photos_removed(array_fill(t.h('ten'), array[10]), t.ps('ten', 10)), 10, 'ten: 10 marked');
select t.eq(t.removed(t.h('ten')), '10|true', 'ten: count 10, removed');

-- One run covering two homework (2 and 3 of 4 photos): each gets its own count.
select t.eq(mark_homework_photos_removed(
    array[t.h('two'), t.h('two'), t.h('four'), t.h('four'), t.h('four')],
    array[t.p('two', 1), t.p('two', 2), t.p('four', 1), t.p('four', 2), t.p('four', 3)]), 5,
  'one run over two homework: 5 marked');
select t.eq(t.removed(t.h('two')), '2|true', 'two: count 2, removed');
select t.eq(t.removed(t.h('four')), '3|false', 'four: 3 counted, one left');
-- The same path twice in one call counts once.
select t.eq(mark_homework_photos_removed(array[t.h('four'), t.h('four')], array[t.p('four', 4), t.p('four', 4)]), 1,
  'four: the last photo passed twice is marked once');
select t.eq(t.removed(t.h('four')), '4|true', 'four: count 4 over two runs, not 5');
-- A whole retried batch changes nothing.
select t.eq(mark_homework_photos_removed(array_fill(t.h('ten'), array[10]), t.ps('ten', 10)), 0, 'ten: a retry marks 0');
select t.eq(t.removed(t.h('ten')), '10|true', 'ten: a retry doesn''t count twice');

-- An older build's homework (photo_path and the list row 0081 copied from it): counts 1, once.
select t.eq((select count(*) from homework_files where homework_id = t.id('HW_A1')), 1::bigint,
  'old build: HW_A1 has its one list row');
select t.eq(mark_homework_photos_removed(array[t.id('HW_A1')], array[t.id('S1') || '/a1.jpg']), 1, 'old build: 1 marked');
select t.eq(t.removed(t.id('HW_A1')), '1|true', 'old build: count 1, removed');
select t.eq(mark_homework_photos_removed(array[t.id('HW_A1')], array[t.id('S1') || '/a1.jpg']), 0, 'old build: retry 0');
select t.eq(t.count_of(t.id('HW_A1')), 1, 'old build: still 1 after the retry');

-- App users can't write the column, whatever the role.
select t.login('S1');
select t.throws(format('update homework set photos_removed_count = 0 where id = %L', t.h('ten')), '42501',
  'the student (sender) can''t update the count');
select t.throws(format('insert into homework (id, student_id, course_id, assignment_id, title, description) values '
    || '(%L, %L, %L, %L, %L, %L) on conflict (id) do update set photos_removed_count = 99',
    t.h('ten'), t.id('S1'), t.id('A'), t.assignment(t.id('A'), 1), 'x', ''), '42501',
  'the student can''t set it through an upsert');
select t.lives(format('insert into homework (id, student_id, course_id, assignment_id, title, description, '
    || 'photos_removed_count) values (%L, %L, %L, %L, %L, %L, 42)',
    t.h('forged'), t.id('S1'), t.id('A'), t.assignment(t.id('A'), 4), 'Forged', ''),
  'a student insert with a count is allowed (the count is ignored)');
reset role;
select t.eq(t.count_of(t.h('forged')), 0, 'the forged insert count is reset to 0');
select t.login('M');
select t.throws(format('update homework set photos_removed_count = 0 where id = %L', t.h('ten')), '42501',
  'the checking mentor can''t update the count');
select t.lives(format('update homework set status = %L, mentor_comment = %L where id = %L', 'checked', 'again',
  t.h('ten')), 'the mentor re-checks with a comment');
reset role;
select t.eq(t.count_of(t.h('ten')), 10, 'the count stays 10 after the mentor''s update');
select t.login('T');
select t.throws(format('update homework set photos_removed_count = 0 where id = %L', t.h('ten')), '42501',
  'the teacher can''t update the count');
reset role;
select t.login(null);
select t.throws(format('update homework set photos_removed_count = 0 where id = %L', t.h('ten')), '42501',
  'anon can''t update the count');
reset role;
select t.ok(not has_function_privilege('authenticated', 'mark_homework_photos_removed(uuid[], text[])', 'execute')
  and not has_function_privilege('anon', 'mark_homework_photos_removed(uuid[], text[])', 'execute'),
  'neither app role can call the deletion job');
select t.eq(t.count_of(t.h('ten')), 10, 'after every app write, ten is still 10');

-- The count is readable with the homework (the sender sees it; another student doesn't see the homework at all).
select t.login('S1');
select t.eq((select photos_removed_count from homework where id = t.h('two')), 2, 'the sender reads the count');
reset role;
select t.login('S2');
select t.eq((select count(*) from homework where id = t.h('two')), 0::bigint, 'another student sees no row');
reset role;

-- Nothing is left below zero: the check constraint holds even for the admin.
select t.throws(format('update homework set photos_removed_count = -1 where id = %L', t.h('two')), '23514',
  'a negative count is refused');
