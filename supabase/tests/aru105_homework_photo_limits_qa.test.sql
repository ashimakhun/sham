-- QA ARU-105: gaps in aru105_homework_photo_limits.test.sql: the helper's settings and who may call it; mentor N
-- gets no new rights over a student's leftover; a sender can't overwrite (update) their leftover; the in-use check is
-- exact (another name in the same folder is a leftover); a photo whose homework row is gone becomes a leftover the
-- sender may delete; a file in someone else's folder never counts as the sender's, even under a nested path.
-- Fixture (t.seed): S1 has saved homework with photos S1/a1.jpg (HW_A1, course A) and S1/b1.jpg (HW_B1, course B).
select t.seed();
insert into storage.objects (bucket_id, name, owner) values
  ('homework', t.id('S1') || '/a1.jpg.bak', t.id('S1')),
  ('homework', t.id('S1') || '/sub/left.jpg', t.id('S1')),
  ('homework', t.id('S2') || '/' || t.id('S1') || '/x.jpg', t.id('S2')),
  ('homework', t.id('S2') || '/orphan.jpg', t.id('S2'));

create function pg_temp.del(file text) returns text language sql as $$
  select format('delete from storage.objects where bucket_id = %L and name = %L', 'homework', file)
$$;
create function pg_temp.upd(file text) returns text language sql as $$
  select format('update storage.objects set owner = owner where bucket_id = %L and name = %L', 'homework', file)
$$;

-- The helper: security definer, fixed search_path, not callable by anon or public.
select t.ok((select prosecdef and provolatile = 's' and proconfig @> array['search_path=public'] from pg_proc
  where oid = 'homework_photo_in_use(text)'::regprocedure), 'helper: security definer, stable, search_path=public');
select t.ok(not has_function_privilege('anon', 'homework_photo_in_use(text)', 'execute'), 'helper: anon can''t execute');
select t.ok(has_function_privilege('authenticated', 'homework_photo_in_use(text)', 'execute'), 'helper: signed-in users can');
select t.eq((select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects'
  and policyname like 'senders % their own leftover homework photo' and permissive = 'PERMISSIVE'
  and roles = '{authenticated}'), 2::bigint, 'two permissive policies for authenticated only (select, delete)');
select t.eq((select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects'
  and policyname like '%leftover%' and cmd in ('UPDATE', 'INSERT', 'ALL')), 0::bigint, 'no new update / insert policy');

-- A mentor of another course gains nothing over a student's leftover. (The teacher already deletes every homework
-- photo since 0041 / ARU-85; unchanged.)
select t.login('N');
select t.eq(t.affected(pg_temp.del(t.id('S2') || '/orphan.jpg')), 0::bigint, 'denied: mentor N can''t delete S2''s leftover');

select t.login('S1');
-- No overwrite of a leftover (the app removes it first instead of upserting).
select t.eq(t.affected(pg_temp.upd(t.id('S1') || '/a1.jpg.bak')), 0::bigint, 'denied: S1 can''t update their own leftover');
-- Exact match: a1.jpg is in use, a1.jpg.bak is not.
select t.eq(t.affected(pg_temp.del(t.id('S1') || '/a1.jpg')), 0::bigint, 'denied: the saved photo a1.jpg stays');
select t.eq(t.affected(pg_temp.del(t.id('S1') || '/a1.jpg.bak')), 1::bigint, 'S1 deletes a1.jpg.bak (no row points to it)');
select t.eq(t.affected(pg_temp.del(t.id('S1') || '/sub/left.jpg')), 1::bigint, 'S1 deletes a leftover in a subfolder of their own folder');
-- Another user's folder, even with S1's id further down the path.
select t.eq(t.affected(pg_temp.del(t.id('S2') || '/' || t.id('S1') || '/x.jpg')), 0::bigint,
  'denied: <S2>/<S1>/x.jpg is in S2''s folder, not S1''s');

-- Once the homework row is gone, its photo is a leftover the sender may delete.
reset role;
delete from homework where id = t.id('HW_A1');
select t.login('S1');
select t.eq(t.affected(pg_temp.del(t.id('S1') || '/a1.jpg')), 1::bigint, 'S1 deletes a1.jpg once its homework row is gone');

-- Nothing else was touched.
reset role;
select t.eq((select count(*) from storage.objects where bucket_id = 'homework' and name = t.id('S1') || '/b1.jpg'), 1::bigint,
  'b1.jpg (saved homework) still there');
select t.eq((select count(*) from storage.objects where bucket_id = 'homework'
  and name in (t.id('S2') || '/orphan.jpg', t.id('S2') || '/' || t.id('S1') || '/x.jpg')), 2::bigint, 'S2''s files still there');
