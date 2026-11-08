-- ARU-105: the homework bucket's limits and the sender's own leftover photo. Rules under test:
-- supabase/migrations/0049_homework_photo_limits.sql.
-- Fixture (t.seed): S1 has saved homework with photos S1/a1.jpg (course A) and S1/b1.jpg (course B). Below, S1 also
-- has a leftover S1/orphan.jpg (no homework row), S2 has a leftover S2/orphan.jpg.
select t.seed();
insert into storage.objects (bucket_id, name, owner) values
  ('homework', t.id('S1') || '/orphan.jpg', t.id('S1')),
  ('homework', t.id('S2') || '/orphan.jpg', t.id('S2')),
  ('payment-proofs', t.id('S1') || '/orphan.jpg', t.id('S1'));

create function pg_temp.objects(bucket text, file text) returns bigint language sql security definer as $$
  select count(*) from storage.objects where bucket_id = bucket and name = file
$$;
create function pg_temp.del(file text) returns text language sql as $$
  select format('delete from storage.objects where bucket_id = %L and name = %L', 'homework', file)
$$;
create function pg_temp.sees(file text) returns bigint language sql as $$
  select count(*) from storage.objects where bucket_id = 'homework' and name = file
$$;

-- AC 7 / AC 8: bucket limits.
select t.ok((select not public and file_size_limit = 10485760 and allowed_mime_types = array['image/jpeg']
  from storage.buckets where id = 'homework'), 'AC7 homework bucket: private, 10 MB, image/jpeg only');
select t.ok((select file_size_limit = 26214400 and allowed_mime_types = array['application/pdf']
  from storage.buckets where id = 'materials'), 'AC8 materials bucket unchanged (25 MB, PDF)');
select t.ok((select file_size_limit = 10485760 and allowed_mime_types @> array['image/jpeg', 'image/png', 'application/pdf']
  from storage.buckets where id = 'payment-proofs'), 'AC8 payment-proofs bucket unchanged (10 MB, JPEG/PNG/PDF)');

-- AC 9: existing objects untouched by the migration.
select t.eq(pg_temp.objects('homework', t.id('S1') || '/a1.jpg'), 1::bigint, 'AC9 existing photos stay');

-- AC 10: S1 reads and deletes their own leftover.
select t.login('S1');
select t.eq(pg_temp.sees(t.id('S1') || '/orphan.jpg'), 1::bigint, 'AC10 S1 reads their own leftover photo');
select t.eq(pg_temp.sees(t.id('S2') || '/orphan.jpg'), 0::bigint, 'denied: S1 can''t read S2''s leftover');
select t.eq(t.affected(pg_temp.del(t.id('S2') || '/orphan.jpg')), 0::bigint, 'denied: S1 can''t delete S2''s leftover');
select t.eq(t.affected(pg_temp.del(t.id('S1') || '/a1.jpg')), 0::bigint,
  'denied: S1 can''t delete their own photo of saved homework');
select t.eq(t.affected(pg_temp.del(t.id('S1') || '/orphan.jpg')), 1::bigint, 'AC10 S1 deletes their own leftover photo');
select t.eq(t.affected(format('delete from storage.objects where bucket_id = %L and name = %L', 'homework', t.id('S1') || '/missing.jpg')),
  0::bigint, 'AC10 removing a missing leftover is not an error');

-- A saved photo the sender can't see through RLS (hidden course) still counts as in use (security definer helper).
reset role;
update courses set hidden = true where id = t.id('B');
select t.login('S1');
select t.eq((select count(*) from homework where id = t.id('HW_B1')), 0::bigint, 'setup: S1 can''t see HW_B1 in hidden B');
select t.ok(homework_photo_in_use(t.id('S1') || '/b1.jpg'), 'helper: a hidden row still counts');
select t.eq(t.affected(pg_temp.del(t.id('S1') || '/b1.jpg')), 0::bigint,
  'denied: S1 can''t delete their photo of saved homework in a hidden course');

-- Other roles gain nothing through the new policies.
select t.login('M2');
select t.eq(pg_temp.sees(t.id('S2') || '/orphan.jpg'), 0::bigint, 'denied: a mentor can''t read a student''s leftover');
select t.eq(t.affected(pg_temp.del(t.id('S2') || '/orphan.jpg')), 0::bigint, 'denied: a mentor can''t delete a student''s leftover');
select t.login('S3');
select t.eq(t.affected(pg_temp.del(t.id('S2') || '/orphan.jpg')), 0::bigint, 'denied: another student can''t delete it');
select t.login(null);
select t.eq(pg_temp.sees(t.id('S2') || '/orphan.jpg'), 0::bigint, 'denied: signed out reads nothing');
select t.throws('select homework_photo_in_use(''x'')', '42501', 'denied: signed out can''t call the helper');

-- The new policies are for the homework bucket only.
select t.login('S1');
reset role;
select t.eq(pg_temp.objects('payment-proofs', t.id('S1') || '/orphan.jpg'), 1::bigint, 'payment-proofs untouched');
select t.eq(pg_temp.objects('homework', t.id('S2') || '/orphan.jpg'), 1::bigint, 'S2''s leftover still there');
