-- ARU-99: payment requests. Rules under test: supabase/migrations/0047_payment_requests.sql.
-- Fixture: teacher T; mentors M (owns A, Accountant off), N (Accountant on, owns B); students S1, S2, S3.
-- A is a paid course with listeners S1 and S2. H is a hidden paid course owned by M with listener S3 (N isn't in
-- it). F is a free course with listener S1. P is a pending student, listener of A.
select t.seed();
create function pg_temp.id(name text) returns uuid language sql immutable as $$ select md5('aru99-' || name)::uuid $$;

update profiles set is_accountant = true where id = t.id('N');
insert into courses (id, title, created_by, hidden) values (pg_temp.id('H'), 'Hidden', t.id('M'), true);
insert into courses (id, title, created_by) values (pg_temp.id('F'), 'Free', t.id('M'));
insert into auth.users (id, email, raw_user_meta_data) values (pg_temp.id('P'), 'p99@x.test', '{"full_name":"Pending Pat"}');
update profiles set access_status = 'pending' where id = pg_temp.id('P');
insert into course_members (course_id, user_id, added_by) values
  (t.id('A'), t.id('S1'), t.id('M')),
  (t.id('A'), t.id('S2'), t.id('M')),
  (t.id('A'), pg_temp.id('P'), t.id('M')),
  (pg_temp.id('H'), t.id('S3'), t.id('M')),
  (pg_temp.id('F'), t.id('S1'), t.id('M'));
insert into course_billing (course_id, start_day, end_day, selected_by) values
  (t.id('A'), 1, 5, t.id('N')),
  (pg_temp.id('H'), 1, 5, t.id('T'));

-- A request insert as the caller; proof in `folder` (default: the caller's own).
create function pg_temp.send(course uuid, file text, folder text default null, month text default '2026-11-01',
  kind text default 'image') returns text language sql as $$
  select format('insert into course_payment_requests (course_id, month, proof_path, proof_type) values (%L, %L, %L, %L)',
    course, month, coalesce(folder, auth.uid()::text) || '/' || file, kind)
$$;
create function pg_temp.upload(file text, folder text default null) returns text language sql as $$
  select format('insert into storage.objects (bucket_id, name, owner) values (%L, %L, %L)',
    'payment-proofs', coalesce(folder, auth.uid()::text) || '/' || file, auth.uid())
$$;
create function pg_temp.proofs() returns bigint language sql as $$
  select count(*) from storage.objects where bucket_id = 'payment-proofs'
$$;

-- Data
select t.ok(exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'course_payment_requests'),
  'data: course_payment_requests is in the realtime publication');
select t.ok((select not public and file_size_limit = 10485760 and allowed_mime_types @> array['image/jpeg', 'application/pdf']
  from storage.buckets where id = 'payment-proofs'), 'data: payment-proofs is private, 10 MB, photos and PDFs');

-- AC 2 / AC 12: S1 uploads into their own folder and sends a request; never for someone else.
select t.login('S1');
select t.lives(pg_temp.upload('p1.jpg'), 'AC2 S1 uploads a proof into their own folder');
select t.throws(pg_temp.upload('x.jpg', t.id('S2')::text), '42501', 'AC12 S1 can''t upload into S2''s folder');
select t.lives(pg_temp.send(t.id('A'), 'p1.jpg'), 'AC2 S1 sends a request for A');
select t.eq((select user_id from course_payment_requests), t.id('S1'), 'AC12 user_id is the caller');
select t.throws(pg_temp.send(t.id('A'), 'p2.jpg'), '23505', 'AC3 one request per course and month');
select t.throws(pg_temp.send(t.id('A'), 'p3.jpg', month => '2026-11-15'), '23514', 'data: month is the first day');
select t.throws(pg_temp.send(t.id('A'), 'p4.pdf', kind => 'doc'), '23514', 'data: proof_type is image or pdf');
select t.throws(format('insert into course_payment_requests (course_id, user_id, month, proof_path, proof_type) values (%L, %L, %L, %L, %L)',
  t.id('A'), t.id('S2'), '2026-11-01', t.id('S2') || '/z.jpg', 'image'), '42501', 'AC12 S1 can''t send a request as S2');
select t.throws(pg_temp.send(t.id('A'), 'z.jpg', t.id('S2')::text, '2026-12-01'), '42501', 'AC12 a proof must be in your own folder');
select t.throws(pg_temp.send(pg_temp.id('F'), 'f.jpg'), '42501', 'AC12 no request for a free course');
select t.throws(pg_temp.send(t.id('B'), 'b.jpg'), '42501', 'AC12 no request for a course you aren''t in');
-- Send again: a new file, then the row points at it; sent_at is the server's.
select t.lives(pg_temp.upload('p5.pdf'), 'AC3 S1 uploads a new proof');
select t.eq(t.affected(format('update course_payment_requests set proof_path = %L, proof_type = %L',
  t.id('S1') || '/p5.pdf', 'pdf')), 1::bigint, 'AC3 Send again replaces the proof');
select t.eq(t.affected(format('delete from storage.objects where bucket_id = %L and name = %L', 'payment-proofs',
  t.id('S1') || '/p1.jpg')), 1::bigint, 'AC3 S1 deletes the old proof');
select t.throws(format('update course_payment_requests set user_id = %L', t.id('S2')), '42501', 'AC12 user_id never changes');
select t.throws(format('update course_payment_requests set course_id = %L', pg_temp.id('F')), '42501', 'AC12 course_id never changes');
select t.throws(format('update course_payment_requests set sent_at = %L', '2020-01-01'), '42501', 'data: sent_at can''t be chosen');
select t.eq((select count(*) from course_payment_requests), 1::bigint, 'AC3 still one request');
reset role;
select t.ok((select sent_at > now() - interval '1 minute' from course_payment_requests), 'AC3 sent_at is reset on Send again');

select t.login('S2');
select t.lives(pg_temp.upload('s2.jpg'), 'S2 uploads a proof');
select t.lives(pg_temp.send(t.id('A'), 's2.jpg'), 'S2 sends a request');
select t.eq((select count(*) from course_payment_requests), 1::bigint, 'AC12 S2 sees only their own request');
select t.eq((select count(*) from storage.objects where bucket_id = 'payment-proofs'), 1::bigint, 'AC12 S2 sees only their own proof');
select t.eq(t.affected(format('update course_payment_requests set proof_type = %L where user_id = %L', 'pdf', t.id('S1'))),
  0::bigint, 'AC12 S2 can''t replace S1''s request');
select t.eq(t.affected(format('delete from course_payment_requests where user_id = %L', t.id('S1'))), 0::bigint,
  'AC12 S2 can''t delete S1''s request');
select t.eq(t.affected(format('delete from storage.objects where name like %L', t.id('S1') || '/%')), 0::bigint,
  'AC12 S2 can''t delete S1''s proof');
reset role;

select t.login('S3');
select t.lives(pg_temp.upload('h.jpg'), 'S3 uploads a proof');
select t.lives(pg_temp.send(pg_temp.id('H'), 'h.jpg'), 'S3 (a participant) sends a request for hidden H');
reset role;

-- AC 9 / AC 12: accountants and the teacher read current listeners' requests and proofs.
select t.login('N');
select t.eq((select count(*) from course_payment_requests where course_id = t.id('A')), 2::bigint, 'AC9 N sees A''s two requests');
select t.eq((select count(*) from storage.objects where bucket_id = 'payment-proofs'), 2::bigint, 'AC9 N reads A''s two proofs');
select t.eq((select count(*) from course_payment_requests where course_id = pg_temp.id('H')), 0::bigint, 'ARU-40 N doesn''t see H''s request');
select t.throws(pg_temp.send(t.id('A'), 'n.jpg'), '42501', 'AC12 N (not a listener) can''t send a request');
select t.eq(t.affected('update course_payment_requests set proof_type = ''pdf'''), 0::bigint, 'AC12 accountants never change requests');
select t.eq(t.affected('delete from course_payment_requests'), 0::bigint, 'AC12 accountants never delete requests');
select t.eq(t.affected('delete from storage.objects where bucket_id = ''payment-proofs'''), 0::bigint, 'AC12 accountants never delete proofs');
reset role;
select t.login('T');
select t.eq((select count(*) from course_payment_requests), 3::bigint, 'AC12 the teacher sees every request (hidden H too)');
select t.eq(pg_temp.proofs(), 3::bigint, 'AC12 the teacher reads every proof');
select t.throws(pg_temp.send(t.id('A'), 't.jpg'), '42501', 'AC12 the teacher can''t send a request');
reset role;
-- The owner who isn't an accountant, another student and a pending account read nothing.
select t.login('M');
select t.eq((select count(*) from course_payment_requests) + pg_temp.proofs(), 0::bigint, 'AC12 the owner M reads nothing');
select t.login('S3');
select t.eq((select count(*) from course_payment_requests where course_id = t.id('A')), 0::bigint, 'AC12 S3 reads nothing of A');
reset role;
select set_config('request.jwt.claims', json_build_object('sub', pg_temp.id('P'), 'role', 'authenticated')::text, false);
set role authenticated;
select t.throws(pg_temp.upload('p.jpg'), '42501', 'access: a pending account can''t upload a proof');
select t.throws(pg_temp.send(t.id('A'), 'p.jpg'), '42501', 'access: a pending account can''t send a request');
reset role;
select t.login(null);
select t.throws('select count(*) from course_payment_requests', '42501', 'access: anon can''t read requests');
reset role;

-- Edge: a removed listener's request is kept but hidden from accountants (and their proof with it).
delete from course_members where course_id = t.id('A') and user_id = t.id('S2');
select t.login('N');
select t.eq((select count(*) from course_payment_requests), 1::bigint, 'edge: a removed listener''s request isn''t shown');
select t.eq(pg_temp.proofs(), 1::bigint, 'edge: nor their proof');
reset role;
select t.login('S2');
select t.throws(pg_temp.send(t.id('A'), 's2b.jpg', month => '2026-12-01'), '42501', 'edge: a removed listener can''t send');
reset role;

-- AC 13: deleting the course lists and removes every proof first (removed listeners' too), then cascades the rows.
select t.login('M');
select t.throws($$select * from course_payment_proofs(t.id('A'))$$, '42501', 'AC13 the owner can''t list proofs');
select t.throws($$select * from discipline_payment_proofs(t.id('A'))$$, '42501', 'AC13 a mentor can''t list a discipline''s proofs');
reset role;
select t.login('T');
select t.eq((select count(*) from course_payment_proofs(t.id('A'))), 2::bigint, 'AC13 the teacher lists A''s two proofs');
select t.throws($$select * from course_payment_proofs(gen_random_uuid())$$, 'P0002', 'AC13 unknown course: not found');
select t.throws($$select * from discipline_payment_proofs(gen_random_uuid())$$, 'P0002', 'AC13 unknown discipline: not found');
select t.eq(t.affected(format('delete from storage.objects where bucket_id = %L and name in (select proof_path from course_payment_proofs(%L))',
  'payment-proofs', t.id('A'))), 2::bigint, 'AC13 the teacher removes proofs in other users'' folders');
select t.eq((select count(*) from course_payment_proofs(t.id('A'))), 0::bigint, 'AC13 a second listing is empty');
select t.lives(format('select delete_course(%L)', t.id('A')), 'AC13 the course is deleted');
reset role;
select t.eq((select count(*) from course_payment_requests where course_id = t.id('A')), 0::bigint, 'AC13 the requests went with the course');

-- Disciplines: H's proof is listed through its discipline.
insert into disciplines (id, name, created_by) values (pg_temp.id('D'), 'Disc', t.id('T'));
update courses set discipline_id = pg_temp.id('D') where id = pg_temp.id('H');
select t.login('T');
select t.eq((select count(*) from discipline_payment_proofs(pg_temp.id('D'))), 1::bigint, 'AC13 a discipline lists its courses'' proofs');
reset role;

-- ARU-75: account_storage_objects() covers the listener's proofs; a deleted profile takes their requests.
select t.ok((select count(*) from account_storage_objects(t.id('S3')) where bucket_id = 'payment-proofs') = 1,
  'ARU-75 account_storage_objects lists S3''s proof');
delete from course_members where user_id = t.id('S3');
delete from homework where student_id = t.id('S3');
delete from profiles where id = t.id('S3');
select t.eq((select count(*) from course_payment_requests where user_id = t.id('S3')), 0::bigint, 'ARU-75 requests cascade with the account');
