-- ARU-191: up to 10 photos per homework. Rules under test: supabase/migrations/0081_homework_photos.sql.
-- Fixture (t.seed): S1 sent HW_A1 (A, photo S1/a1.jpg) and HW_B1 (B, photo S1/b1.jpg); course A is M's, B is N's.
-- Below S1 and S2 are listeners of A, A has five assignments, and S1 sends with submit_homework().
select t.seed();
select t.make_assignments(t.id('A'));
insert into course_members (course_id, user_id, added_by) values
  (t.id('A'), t.id('S1'), t.id('M')),
  (t.id('A'), t.id('S2'), t.id('M'));

create function t.h(n text) returns uuid language sql immutable as $$ select md5('aru191-' || n)::uuid $$;
grant execute on function t.h(text) to anon, authenticated, service_role;
-- The path of photo `n` of homework `hw` by `who`, and a text array of the first `k` of them.
create function t.p(who text, hw text, n int) returns text language sql immutable as $$
  select t.id(who) || '/' || t.h(hw) || '/' || n || '.jpg' $$;
create function t.ps(who text, hw text, k int) returns text[] language sql immutable as $$
  select coalesce(array_agg(t.p(who, hw, i) order by i), '{}') from generate_series(1, k) i $$;
grant execute on function t.p(text, text, int) to anon, authenticated, service_role;
grant execute on function t.ps(text, text, int) to anon, authenticated, service_role;
-- submit_homework() as a statement (for t.throws / t.lives).
create function t.send(hw text, n int, paths text[]) returns text language sql immutable as $$
  select format('select submit_homework(%L, %L, %L, %L, %L, %L)', t.h(hw), t.id('A'), t.assignment(t.id('A'), n),
                'Homework ' || hw, '', paths) $$;
grant execute on function t.send(text, int, text[]) to anon, authenticated;
-- What a statement raises: errcode|hint, or 'no error'.
create function pg_temp.err(stmt text) returns text language plpgsql as $$
declare code text; hint text;
begin
  execute stmt;
  return 'no error';
exception when others then
  get stacked diagnostics code = returned_sqlstate, hint = pg_exception_hint;
  return code || '|' || coalesce(hint, '');
end $$;
grant execute on function pg_temp.err(text) to anon, authenticated;
-- Paths of a homework's list, in order (as the admin).
create function t.list(hw uuid) returns text[] language sql security definer as $$
  select coalesce(array_agg(path order by position), '{}') from public.homework_files where homework_id = hw $$;
grant execute on function t.list(uuid) to anon, authenticated, service_role;

-- AC 8: the seeded (pre-list) photos are in the list as position 1; homework without a photo has no row.
select t.eq(t.list(t.id('HW_A1')), array[t.id('S1') || '/a1.jpg'], 'AC8 a one-photo homework has 1 list row');
select t.eq(t.list(t.id('HW_A2')), '{}'::text[], 'AC8 a homework without a photo has no list row');
select t.eq((select count(*) from homework_files), (select count(*) from homework where photo_path is not null),
  'AC8 one list row per photo_path');

-- AC 4: S1 sends 3 photos in one call; the order is kept and photo_path holds the first one (older builds).
select t.login('S1');
select t.lives(t.send('three', 1, t.ps('S1', 'three', 3)), 'AC4 S1 sends a homework with 3 photos');
reset role;
select t.eq(t.list(t.h('three')), t.ps('S1', 'three', 3), 'AC4 all 3 photos saved, in order');
select t.eq((select photo_path from homework where id = t.h('three')), t.p('S1', 'three', 1), 'note 10: photo_path = first photo');
insert into storage.objects (bucket_id, name, owner)
  select 'homework', p, t.id('S1') from unnest(t.ps('S1', 'three', 3)) p;

-- No photos: as today.
select t.login('S1');
select t.lives(t.send('none', 2, '{}'), 'AC3 a homework without photos is sent');
reset role;
select t.ok((select photo_path is null from homework where id = t.h('none')) and t.list(t.h('none')) = '{}', 'AC3 no list rows');

-- AC 12: 10 is fine, 11 is refused with the new code, and nothing is saved.
select t.login('S1');
select t.eq(pg_temp.err(t.send('eleven', 3, t.ps('S1', 'eleven', 11))), '23514|sham:homework_too_many_photos',
  'AC12 11 photos are refused');
reset role;
select t.eq((select count(*) from homework where id = t.h('eleven')), 0::bigint, 'AC12 no homework saved for 11 photos');
select t.login('S1');
select t.lives(t.send('ten', 3, t.ps('S1', 'ten', 10)), 'AC12 10 photos are fine');
reset role;
select t.eq(cardinality(t.list(t.h('ten'))), 10, 'AC12 10 rows');
select t.eq(pg_temp.err(format('insert into homework_files (homework_id, path, position) values (%L, %L, 10)',
  t.h('three'), 'x/11.jpg')), 'no error', 'setup: the admin may add a 4th row');
select t.eq(pg_temp.err(format('insert into homework_files (homework_id, path, position) values (%L, %L, 9)',
  t.h('ten'), 'x/eleventh.jpg')), '23514|sham:homework_too_many_photos', 'AC12 the database refuses an 11th row, even for the admin');
delete from homework_files where path = 'x/11.jpg';

-- AC 5 / note 2: every path must be in the sender's folder for this homework; a bad one saves nothing at all.
select t.login('S1');
select t.eq(pg_temp.err(t.send('bad', 4, array[t.p('S1', 'bad', 1), t.p('S2', 'bad', 2)])),
  '42501|sham:homework_photo_not_yours', 'note 2: a path in another user''s folder is refused');
select t.eq(pg_temp.err(t.send('bad', 4, array[t.p('S1', 'bad', 1), t.id('S1') || '/' || t.h('three') || '/9.jpg'])),
  '42501|sham:homework_photo_not_yours', 'note 2: a path in another homework''s folder is refused');
select t.eq(pg_temp.err(t.send('bad', 4, array[t.id('S1') || '/a1.jpg'])),
  '42501|sham:homework_photo_not_yours', 'note 2: a photo of saved homework can''t be reused');
reset role;
select t.eq((select count(*) from homework where id = t.h('bad')), 0::bigint, 'AC5 no homework row after a refused send');

-- AC 5: a failed save (second homework for the same assignment) leaves no homework and no rows.
select t.login('S1');
select t.eq(split_part(pg_temp.err(t.send('again', 1, t.ps('S1', 'again', 2))), '|', 1), '23505',
  'AC5 a second homework for the assignment is refused as before');
reset role;
select t.eq((select count(*) from homework where id = t.h('again')), 0::bigint, 'AC5 no homework');
select t.eq(t.list(t.h('again')), '{}'::text[], 'AC5 no list rows');

-- Only through submit_homework: no direct rows, even on one's own homework; no update, no delete.
select t.login('S1');
select t.throws(format('insert into homework_files (homework_id, path, position) values (%L, %L, 4)',
  t.h('three'), t.p('S1', 'three', 4)), '42501', 'AC11 a sender can''t add a photo after sending');
select t.throws(format('insert into homework_files (homework_id, path, position) values (%L, %L, 4)',
  t.id('HW_A1'), t.id('S1') || '/' || t.id('HW_A1') || '/4.jpg'), '42501', 'AC11 nor to an older homework');
select t.throws(format('update homework_files set path = %L where homework_id = %L', t.id('S2') || '/x.jpg', t.h('three')),
  '42501', 'AC11 a sender can''t change a photo');
select t.throws(format('delete from homework_files where homework_id = %L', t.h('three')), '42501',
  'AC11 a sender can''t remove a photo');
select t.throws(format('select set_config(%L, %L, true)', 'sham.submitting_homework', t.h('three')) ||
  format('; insert into homework_files (homework_id, path, position) values (%L, %L, 4)', t.h('three'), t.p('S1', 'three', 4)),
  '42501', 'AC11 a separate statement after the homework''s own transaction is refused');
reset role;

-- An older build: insert with photo_path still works and the photo lands in the list (note 10), only from its own folder.
select t.login('S1');
select t.lives(format('insert into homework (id, student_id, course_id, assignment_id, title, photo_path) values (%L, %L, %L, %L, %L, %L)',
  t.h('old'), t.id('S1'), t.id('A'), t.assignment(t.id('A'), 5), 'Old build', t.id('S1') || '/' || t.h('old') || '.jpg'),
  'note 10: an older build sends with photo_path');
reset role;
select t.eq(t.list(t.h('old')), array[t.id('S1') || '/' || t.h('old') || '.jpg'], 'note 10: its photo is in the list');
select t.login('S2');
select t.eq(pg_temp.err(format('insert into homework (id, student_id, course_id, assignment_id, title, photo_path) values (%L, %L, %L, %L, %L, %L)',
  t.h('steal'), t.id('S2'), t.id('A'), t.assignment(t.id('A'), 1), 'Steal', t.id('S1') || '/a1.jpg')),
  '42501|sham:homework_photo_not_yours', 'note 2: an older build can''t point at another user''s file');
reset role;

-- AC 6 / AC 11: who reads the rows and the files.
create function pg_temp.rows(hw uuid) returns bigint language sql as $$ select count(*) from homework_files where homework_id = hw $$;
create function pg_temp.files(hw text) returns bigint language sql as $$
  select count(*) from storage.objects where bucket_id = 'homework' and name like t.id('S1') || '/' || t.h(hw) || '/%' $$;
grant execute on function pg_temp.rows(uuid) to authenticated, anon;
grant execute on function pg_temp.files(text) to authenticated, anon;
select t.login('S1');
select t.eq(pg_temp.rows(t.h('three')), 3::bigint, 'AC6 the sender reads all 3 rows');
select t.eq(pg_temp.files('three'), 3::bigint, 'AC6 the sender reads all 3 files');
select t.login('M');
select t.eq(pg_temp.rows(t.h('three')), 3::bigint, 'AC6 the course owner reads all 3 rows');
select t.eq(pg_temp.files('three'), 3::bigint, 'AC6 the course owner reads all 3 files');
select t.login('T');
select t.eq(pg_temp.files('three'), 3::bigint, 'AC6 the teacher reads all 3 files');
select t.login('S2');
select t.eq(pg_temp.rows(t.h('three')), 0::bigint, 'AC11 another student in the course sees no rows');
select t.eq(pg_temp.files('three'), 0::bigint, 'AC11 and no files');
select t.login(null);
select t.throws(format('select count(*) from homework_files where homework_id = %L', t.h('three')), '42501', 'AC11 signed out: no rows');
select t.eq(pg_temp.files('three'), 0::bigint, 'AC11 signed out: no files');
reset role;
-- Hidden course: a mentor who isn't part of it reads neither rows nor files.
update courses set hidden = true where id = t.id('A');
select t.login('N');
select t.eq(pg_temp.rows(t.h('three')), 0::bigint, 'AC11 hidden course: a mentor outside it sees no rows');
select t.eq(pg_temp.files('three'), 0::bigint, 'AC11 hidden course: and no files');
select t.login('M');
select t.eq(pg_temp.files('three'), 3::bigint, 'AC11 hidden course: its owner still reads them');
reset role;
update courses set hidden = false where id = t.id('A');

-- Helpers: every list photo is in use, belongs to a listener, and isn't a leftover; a real orphan is.
select t.ok(homework_photo_in_use(t.p('S1', 'three', 2)), 'note 4: a 2nd photo is in use');
select t.ok(is_listener_homework_photo(t.p('S1', 'three', 3)), 'note 4: a 3rd photo is a listener''s photo');
insert into storage.objects (bucket_id, name, owner, created_at) values
  ('homework', t.id('S1') || '/' || t.h('orphan') || '/1.jpg', t.id('S1'), now() - interval '2 days');
update storage.objects set created_at = now() - interval '2 days' where name like t.id('S1') || '/' || t.h('three') || '/%';
select t.eq((select array_agg(name order by name) from leftover_homework_photos(100) where name like t.id('S1') || '/%/%'),
  array[t.id('S1') || '/' || t.h('orphan') || '/1.jpg'], 'note 4: the sweep keeps list photos and takes the real orphan');
select t.login('S1');
select t.eq(t.affected(format('delete from storage.objects where bucket_id = %L and name = %L', 'homework', t.p('S1', 'three', 2))),
  0::bigint, 'note 4: the sender can''t delete a sent 2nd photo');
reset role;

-- Listener removal and course deletion find every photo.
select t.login('M');
select t.eq((select count(*) from listener_homework_photos(t.id('A'), t.id('S1')) where photo_path like '%/' || t.h('three') || '/%'),
  3::bigint, 'AC11 listener removal lists all 3 photos');
select t.login('T');
select t.ok((select array_agg(photo_path) from course_homework_photos(t.id('A'))) @> t.ps('S1', 'three', 3),
  'AC11 course deletion lists all 3 photos');
reset role;
select t.ok((select array_agg(name) from account_storage_objects(t.id('S1'))) @> t.ps('S1', 'three', 3),
  'AC11 account deletion finds the nested photos');
select t.ok((select array_agg(name) from workspace_storage_objects((select workspace_id from profiles where id = t.id('S1'))))
  @> t.ps('S1', 'three', 3), 'AC11 workspace deletion finds the nested photos');

-- AC 10: the ZIP lists every photo, in order, with its position and the homework's count.
insert into storage.objects (bucket_id, name, owner) select 'homework', p, t.id('S1') from unnest(t.ps('S1', 'ten', 3)) p;
select t.eq((select string_agg(position || '/' || photo_count, ',' order by ord)
  from homework_photos_for_zip(t.id('S1')) with ordinality as z(a, b, c, d, e, f, g, position, photo_count, ord) where a = t.h('three')), '1/3,2/3,3/3',
  'AC10 3 rows for a 3-photo homework, in order');
select t.eq((select count(*) from homework_photos_for_zip(t.id('S1')) where homework_id = t.h('ten')), 3::bigint,
  'AC10 photos not in Storage are left out');

-- AC 9: the deletion job. "three" is checked 7 months ago: all 3 are due; partly marked → not removed yet.
update homework set status = 'checked', checked_by = t.id('M'), checked_at = now() - interval '7 months' where id = t.h('three');
update app_settings set photo_deletion_start = (now() at time zone 'utc')::date - 400;
select t.eq((select array_agg(photo_path order by photo_path) from due_homework_photos(1000) where homework_id = t.h('three')),
  t.ps('S1', 'three', 3), 'AC9 every photo of the homework is due');
select t.eq((select count(*) from due_homework_photos(2)), 2::bigint, 'note 5: the batch limit counts photos');
select t.eq(mark_homework_photos_removed(array[t.h('three'), t.h('three')], array[t.p('S1', 'three', 1), t.p('S1', 'three', 2)]), 2,
  'AC9 two photos marked');
select t.ok((select photo_removed_at is null from homework where id = t.h('three')), 'note 5: one photo left: not removed yet');
select t.eq((select array_agg(photo_path) from due_homework_photos(1000) where homework_id = t.h('three')),
  array[t.p('S1', 'three', 3)], 'note 5: the next run lists the one left');
select t.eq(mark_homework_photos_removed(array[t.h('three')], array[t.p('S1', 'three', 3)]), 1, 'AC9 the last one marked');
select t.ok((select photo_removed_at is not null and photo_path is null from homework where id = t.h('three')),
  'AC9 photo_removed_at set once every photo is gone');
select t.eq(t.list(t.h('three')), '{}'::text[], 'AC9 no list rows left');

-- Removing a listener deletes their homework, and with it every list row.
select t.login('M');
select remove_listener(t.id('A'), t.id('S1'));
reset role;
select t.eq((select count(*) from homework_files where homework_id = t.h('ten')), 0::bigint, 'AC11 listener removal: rows gone');

-- No app user can call the job or trigger helpers.
select t.ok(not has_function_privilege('anon', 'submit_homework(uuid, uuid, uuid, text, text, text[])', 'execute'),
  'signed out can''t call submit_homework');
select t.ok(not has_function_privilege('authenticated', 'homework_files_limit()', 'execute')
  and not has_function_privilege('authenticated', 'homework_photo_path_to_files()', 'execute'), 'trigger functions are not callable');
select t.ok(not has_table_privilege('anon', 'homework_files', 'select') and not has_table_privilege('anon', 'homework_photo_paths', 'select'),
  'signed out reads neither the table nor the view');
