-- QA ARU-191: gaps in aru191_homework_photos.test.sql. Rules under test: supabase/migrations/0081_homework_photos.sql.
--   * a sender can only reference objects in their own `<uid>/<homework id>/` folder, by every way in (submit_homework,
--     an older build's photo_path, a direct row, the homework id of someone else's homework);
--   * rows and photo_path can't be changed after sending by anyone in the app (sender, checking mentor, teacher);
--   * workspaces: a W2 listener can send photos (the guard puts the rows in W2), and no one reads across workspaces;
--   * the view homework_photo_paths follows the same rules as the table;
--   * the "submitted" notification is queued once per send with all photos, and not for a refused send;
--   * clean-ups: course deletion, account deletion, workspace storage list per workspace, the leftover sweep;
--   * the (unused) deletion-warning claim counts photos.
-- Fixture (t.seed): S1 sent HW_A1 (A, S1/a1.jpg), HW_B1 (B, S1/b1.jpg); course A is M's, B is N's. Here S1 and S2 are
-- listeners of A with five assignments; W2 has teacher XT, mentor XM (owns XC) and student XS (listener of XC).
select t.seed();
select t.make_assignments(t.id('A'));
insert into course_members (course_id, user_id, added_by) values
  (t.id('A'), t.id('S1'), t.id('M')),
  (t.id('A'), t.id('S2'), t.id('M'));
grant usage on schema t to service_role;

create function t.h(n text) returns uuid language sql immutable as $$ select md5('aru191qa-' || n)::uuid $$;
create function t.x(n text) returns uuid language sql immutable as $$ select md5('aru191qa-x-' || n)::uuid $$;
create function t.p(who uuid, hw uuid, n int) returns text language sql immutable as $$
  select who || '/' || hw || '/' || n || '.jpg' $$;
create function t.ps(who uuid, hw uuid, k int) returns text[] language sql immutable as $$
  select coalesce(array_agg(t.p(who, hw, i) order by i), '{}') from generate_series(1, k) i $$;
create function t.send(hw uuid, course uuid, assignment uuid, paths text[]) returns text language sql immutable as $$
  select format('select submit_homework(%L, %L, %L, %L, %L, %L)', hw, course, assignment, 'QA ' || hw, '', paths) $$;
create function t.list(hw uuid) returns text[] language sql security definer as $$
  select coalesce(array_agg(path order by position), '{}') from public.homework_files where homework_id = hw $$;
create function t.calls() returns bigint language sql security definer as $$ select count(*) from net.requests $$;
create function t.login_x(who text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', t.x(who), 'role', 'authenticated')::text, false);
  set role authenticated;
end $$;
grant execute on all functions in schema t to anon, authenticated, service_role;

create function pg_temp.err(stmt text) returns text language plpgsql as $$
declare code text; hint text;
begin
  execute stmt;
  return 'no error';
exception when others then
  get stacked diagnostics code = returned_sqlstate, hint = pg_exception_hint;
  return code || '|' || coalesce(hint, '');
end $$;
create function pg_temp.rows(hw uuid) returns bigint language sql as $$
  select count(*) from homework_files where homework_id = hw $$;
create function pg_temp.view_rows(hw uuid) returns bigint language sql as $$
  select count(*) from homework_photo_paths where homework_id = hw $$;
create function pg_temp.files(names text[]) returns bigint language sql as $$
  select count(*) from storage.objects where bucket_id = 'homework' and name = any (names) $$;
grant execute on function pg_temp.err(text) to anon, authenticated, service_role;
grant execute on function pg_temp.rows(uuid) to anon, authenticated;
grant execute on function pg_temp.view_rows(uuid) to anon, authenticated;
grant execute on function pg_temp.files(text[]) to anon, authenticated;

-- The "submitted" notification is configured (Vault), so every homework insert queues one request.
insert into vault.decrypted_secrets (name, decrypted_secret) values
  ('homework_submitted_notify_url', 'https://x.supabase.co/functions/v1/homework-submitted-notifications'),
  ('homework_submitted_notify_secret', 'k3y');

-- W2 (as the admin; the guard sets each row's workspace).
insert into workspaces (id, name, created_at) values (t.x('W2'), 'Other school', now());
insert into auth.users (id, email, raw_user_meta_data) values
  (t.x('XT'), 'q191xt@x.test', '{"full_name":"Xena Teacher"}'),
  (t.x('XM'), 'q191xm@x.test', '{"full_name":"Xavier Mentor"}'),
  (t.x('XS'), 'q191xs@x.test', '{"full_name":"Xia Student"}');
update profiles set workspace_id = t.x('W2'), access_status = 'approved' where id in (t.x('XT'), t.x('XM'), t.x('XS'));
update profiles set role = 'teacher' where id = t.x('XT');
update profiles set role = 'mentor' where id = t.x('XM');
insert into courses (id, title, created_by) values (t.x('XC'), 'Xcourse', t.x('XM'));
insert into course_members (course_id, user_id, added_by) values (t.x('XC'), t.x('XS'), t.x('XM'));
select t.make_assignments(t.x('XC'));
select t.eq((select workspace_id from courses where id = t.x('XC')), t.x('W2'), 'setup: XC is in W2');

-- 1. S1 sends 3 photos (one notification, with all 3 rows already saved in the same transaction).
select t.login('S1');
select t.lives(t.send(t.h('s1'), t.id('A'), t.assignment(t.id('A'), 1), t.ps(t.id('S1'), t.h('s1'), 3)),
  'AC4 S1 sends 3 photos');
reset role;
insert into storage.objects (bucket_id, name, owner) select 'homework', p, t.id('S1') from unnest(t.ps(t.id('S1'), t.h('s1'), 3)) p;
select t.eq(t.calls(), 1::bigint, 'notification: one "submitted" request for a send with 3 photos');
select t.eq((select body ->> 'homework_id' from net.requests), t.h('s1')::text, 'notification: for the sent homework');

-- 2. Pointing at another user's photo, every way in: refused, nothing saved, no notification.
select t.login('S2');
-- a) submit_homework with S1's new-style photo, or S1's legacy photo.
select t.eq(pg_temp.err(t.send(t.h('s2a'), t.id('A'), t.assignment(t.id('A'), 1), array[t.p(t.id('S1'), t.h('s1'), 2)])),
  '42501|sham:homework_photo_not_yours', 'AC11 S2 can''t send S1''s 2nd photo as their own');
select t.eq(pg_temp.err(t.send(t.h('s2a'), t.id('A'), t.assignment(t.id('A'), 1),
  array[t.p(t.id('S2'), t.h('s2a'), 1), t.id('S1') || '/a1.jpg'])),
  '42501|sham:homework_photo_not_yours', 'AC11 S2 can''t hide S1''s photo at position 2');
-- b) a path that only starts with S2's folder but walks out of it is not S1's object name, and S2's folder check is
--    on the literal name: S1's file stays unreadable.
select t.lives(t.send(t.h('s2b'), t.id('A'), t.assignment(t.id('A'), 1),
  array[t.p(t.id('S2'), t.h('s2b'), 1), t.id('S2') || '/' || t.h('s2b') || '/../../' || t.id('S1') || '/a1.jpg']),
  'setup: a "../" path inside S2''s own folder is just a name');
select t.eq(pg_temp.files(array[t.id('S1') || '/a1.jpg', t.p(t.id('S1'), t.h('s1'), 1)]), 0::bigint,
  'AC11 S2 still reads none of S1''s files');
-- c) an older build's photo_path pointing at S1's new-style photo.
select t.eq(pg_temp.err(format('insert into homework (id, student_id, course_id, assignment_id, title, photo_path) values (%L, %L, %L, %L, %L, %L)',
  t.h('s2c'), t.id('S2'), t.id('A'), t.assignment(t.id('A'), 2), 'old build', t.p(t.id('S1'), t.h('s1'), 3))),
  '42501|sham:homework_photo_not_yours', 'AC11 an older build can''t point photo_path at S1''s 3rd photo');
-- d) a photo_path with no folder at all.
select t.eq(pg_temp.err(format('insert into homework (id, student_id, course_id, assignment_id, title, photo_path) values (%L, %L, %L, %L, %L, %L)',
  t.h('s2d'), t.id('S2'), t.id('A'), t.assignment(t.id('A'), 2), 'old build', 'a1.jpg')),
  '42501|sham:homework_photo_not_yours', 'AC11 a photo_path outside any folder is refused');
-- e) a direct row on S2's own homework, pointing at S1's file.
select t.throws(format('insert into homework_files (homework_id, path, position) values (%L, %L, 2)',
  t.h('s2b'), t.id('S1') || '/a1.jpg'), '42501', 'AC11 S2 can''t add a row with S1''s file to their own homework');
-- f) a direct row on S1's homework.
select t.throws(format('insert into homework_files (homework_id, path, position) values (%L, %L, 4)',
  t.h('s1'), t.p(t.id('S2'), t.h('s1'), 4)), '42501', 'AC11 S2 can''t add a row to S1''s homework');
-- g) submit_homework reusing S1's homework id: refused as a duplicate, S1's list untouched.
select t.eq(split_part(pg_temp.err(t.send(t.h('s1'), t.id('A'), t.assignment(t.id('A'), 3), t.ps(t.id('S2'), t.h('s1'), 2))), '|', 1),
  '23505', 'AC11 S2 can''t send under S1''s homework id');
reset role;
select t.eq(t.list(t.h('s1')), t.ps(t.id('S1'), t.h('s1'), 3), 'AC11 S1''s list is unchanged');
select t.eq((select count(*) from homework where id in (t.h('s2a'), t.h('s2c'), t.h('s2d'))), 0::bigint,
  'AC5 no homework saved by any refused attempt');
select t.eq(t.calls(), 2::bigint, 'notification: refused sends queue nothing (only s2b was saved)');

-- 3. Rows and photo_path are fixed after sending, for everyone in the app.
select t.login('S1');
select t.throws(format('update homework set photo_path = %L where id = %L', t.id('S1') || '/a1.jpg', t.h('s1')), '42501',
  'AC11 the sender can''t change photo_path');
select t.throws(format('update homework_files set position = 4 where homework_id = %L', t.h('s1')), '42501',
  'AC11 the sender can''t reorder photos');
select t.login('M');
select t.throws(format('update homework set photo_path = %L where id = %L', t.id('S2') || '/x.jpg', t.h('s1')), '42501',
  'AC11 the checking mentor can''t change photo_path');
select t.throws(format('update homework_files set path = %L where homework_id = %L', t.id('S2') || '/x.jpg', t.h('s1')), '42501',
  'AC11 the mentor can''t change a photo row');
select t.throws(format('delete from homework_files where homework_id = %L', t.h('s1')), '42501',
  'AC11 the mentor can''t delete a photo row');
select t.throws(format('insert into homework_files (homework_id, path, position) values (%L, %L, 4)',
  t.h('s1'), t.p(t.id('S1'), t.h('s1'), 4)), '42501', 'AC11 the mentor can''t add a photo row');
-- Checking keeps every photo.
select t.lives(format('update homework set status = %L, checked_by = %L, checked_at = now(), mentor_comment = %L where id = %L',
  'checked', t.id('M'), 'Good', t.h('s1')), 'regression: M checks the 3-photo homework');
select t.login('T');
select t.throws(format('delete from homework_files where homework_id = %L', t.h('s1')), '42501',
  'AC11 the teacher can''t delete a photo row either');
reset role;
select t.eq(t.list(t.h('s1')), t.ps(t.id('S1'), t.h('s1'), 3), 'AC11 after checking all 3 photos are still listed, in order');

-- 4. The view follows the table's rules.
select t.login('S2');
select t.eq(pg_temp.view_rows(t.h('s1')), 0::bigint, 'AC11 another student in the course sees no paths in the view');
select t.login('M');
select t.eq(pg_temp.view_rows(t.h('s1')), 3::bigint, 'AC6 the course owner sees all 3 paths in the view');
reset role;

-- 5. Workspaces: XS (W2) sends 2 photos; the rows land in W2; W1 and W2 read only their own.
select t.login_x('XS');
select t.lives(t.send(t.x('xh'), t.x('XC'), t.assignment(t.x('XC'), 1), t.ps(t.x('XS'), t.x('xh'), 2)),
  'AC11 a W2 listener sends 2 photos');
reset role;
insert into storage.objects (bucket_id, name, owner) select 'homework', p, t.x('XS') from unnest(t.ps(t.x('XS'), t.x('xh'), 2)) p;
select t.eq((select array_agg(distinct workspace_id) from homework_files where homework_id = t.x('xh')), array[t.x('W2')],
  'AC11 both W2 rows are in W2');
select t.login('M');
select t.eq(pg_temp.rows(t.x('xh')), 0::bigint, 'AC11 a W1 mentor sees no W2 rows');
select t.eq(pg_temp.view_rows(t.x('xh')), 0::bigint, 'AC11 nor W2 paths in the view');
select t.eq(pg_temp.files(t.ps(t.x('XS'), t.x('xh'), 2)), 0::bigint, 'AC11 nor W2 files');
select t.login('T');
select t.eq(pg_temp.files(t.ps(t.x('XS'), t.x('xh'), 2)), 0::bigint, 'AC11 the W1 teacher reads no W2 files');
select t.login_x('XM');
select t.eq(pg_temp.rows(t.x('xh')), 2::bigint, 'AC6 the W2 course owner reads both rows');
select t.eq(pg_temp.files(t.ps(t.x('XS'), t.x('xh'), 2)), 2::bigint, 'AC6 and both files');
select t.eq(pg_temp.rows(t.h('s1')), 0::bigint, 'AC11 a W2 mentor sees no W1 rows');
select t.eq(pg_temp.files(t.ps(t.id('S1'), t.h('s1'), 3)), 0::bigint, 'AC11 nor W1 files');
-- A W2 user can't add a row to a W1 homework (also through the guard).
select t.throws(format('insert into homework_files (homework_id, path, position) values (%L, %L, 4)',
  t.h('s1'), t.p(t.x('XM'), t.h('s1'), 4)), '42501', 'AC11 a W2 mentor can''t add a row to W1 homework');
reset role;
select t.ok((select array_agg(name) from workspace_storage_objects(t.x('W2'))) @> t.ps(t.x('XS'), t.x('xh'), 2),
  'AC11 deleting W2 finds its nested photos');
select t.ok(not exists (select 1 from workspace_storage_objects(t.x('W2')) w where w.name = any (t.ps(t.id('S1'), t.h('s1'), 3))),
  'AC11 deleting W2 never lists W1''s photos');

-- 6. The (unused) deletion-warning claim counts photos: s1 is due in about 20 days → 3 photos.
update app_settings set photo_deletion_start = (now() at time zone 'utc')::date - 400;
update homework set checked_at = now() - interval '6 months' + interval '20 days' where id = t.h('s1');
select t.eq((select photo_count from claim_photo_deletion_warnings() where user_id = t.id('S1')), 3,
  'AC9 the warning counts the homework''s 3 photos');

-- 7. Leftover sweep: after a send with 3, a leftover 4th from an earlier attempt is swept; the 3 stay.
insert into storage.objects (bucket_id, name, owner, created_at)
  values ('homework', t.p(t.id('S1'), t.h('s1'), 4), t.id('S1'), now() - interval '2 days');
update storage.objects set created_at = now() - interval '2 days' where name = any (t.ps(t.id('S1'), t.h('s1'), 3));
select t.eq((select array_agg(name) from leftover_homework_photos(1000) where name like t.id('S1') || '/' || t.h('s1') || '/%'),
  array[t.p(t.id('S1'), t.h('s1'), 4)], 'AC5 only the leftover 4th file is swept');

-- 8. Deleting the course removes every row; the photo list names every file first.
select t.login('T');
select t.ok((select array_agg(photo_path) from course_homework_photos(t.id('A'))) @> t.ps(t.id('S1'), t.h('s1'), 3),
  'AC11 course deletion lists all 3 photos');
select t.lives(format('select delete_course(%L)', t.id('A')), 'AC11 the teacher deletes course A');
reset role;
select t.eq((select count(*) from homework_files where homework_id in (t.h('s1'), t.h('s2b'))), 0::bigint,
  'AC11 course deletion: no rows left');

-- 9. Account deletion: XS's rows go with the account, the nested files are listed for removal.
select t.ok((select array_agg(name) from account_storage_objects(t.x('XS'))) @> t.ps(t.x('XS'), t.x('xh'), 2),
  'AC11 account deletion finds XS''s nested photos');
delete from auth.users where id = t.x('XS');
select t.eq((select count(*) from homework_files where homework_id = t.x('xh')), 0::bigint,
  'AC11 account deletion: no rows left');
