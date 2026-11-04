-- QA ARU-99: gaps in aru99_payment_requests.test.sql: a removed listener can't replace their request, the month of
-- a request can't be changed, an unselected paid course hides its requests and proofs from accountants while the
-- sender still sees their own (and they come back when selected again), a rejected listener can't upload, and the
-- teacher can delete any proof while accountants can't delete one.
-- Fixture: teacher T; N is an accountant; S1 and S2 listen to paid course A; R is a rejected student, listener of A.
select t.seed();
create function pg_temp.id(name text) returns uuid language sql immutable as $$ select md5('aru99qa-' || name)::uuid $$;

update profiles set is_accountant = true where id = t.id('N');
insert into auth.users (id, email, raw_user_meta_data) values (pg_temp.id('R'), 'r99@x.test', '{"full_name":"Rejected Rae"}');
insert into course_members (course_id, user_id, added_by) values
  (t.id('A'), t.id('S1'), t.id('M')),
  (t.id('A'), t.id('S2'), t.id('M')),
  (t.id('A'), pg_temp.id('R'), t.id('M'));
update profiles set access_status = 'rejected' where id = pg_temp.id('R');
insert into course_billing (course_id, start_day, end_day, selected_by) values (t.id('A'), 1, 28, t.id('N'));
-- S1's and S2's proofs and requests, as the admin.
insert into storage.objects (bucket_id, name, owner) values
  ('payment-proofs', t.id('S1') || '/a.jpg', t.id('S1')),
  ('payment-proofs', t.id('S1') || '/b.jpg', t.id('S1')),
  ('payment-proofs', t.id('S2') || '/c.pdf', t.id('S2')),
  ('homework', t.id('S1') || '/hw.jpg', t.id('S1'));
insert into course_payment_requests (course_id, user_id, month, proof_path, proof_type) values
  (t.id('A'), t.id('S1'), '2026-11-01', t.id('S1') || '/a.jpg', 'image'),
  (t.id('A'), t.id('S2'), '2026-11-01', t.id('S2') || '/c.pdf', 'pdf');

-- The month of a request never changes (column grants).
select t.login('S1');
select t.throws(format('update course_payment_requests set month = %L', '2026-12-01'), '42501', 'data: the month can''t be changed');
reset role;

-- A rejected listener can't upload or send.
select set_config('request.jwt.claims', json_build_object('sub', pg_temp.id('R'), 'role', 'authenticated')::text, false);
set role authenticated;
select t.throws(format('insert into storage.objects (bucket_id, name, owner) values (%L, %L, %L)',
  'payment-proofs', pg_temp.id('R') || '/r.jpg', pg_temp.id('R')), '42501', 'access: a rejected listener can''t upload');
select t.throws(format('insert into course_payment_requests (course_id, month, proof_path, proof_type) values (%L, %L, %L, %L)',
  t.id('A'), '2026-11-01', pg_temp.id('R') || '/r.jpg', 'image'), '42501', 'access: a rejected listener can''t send');
reset role;

-- Unselected: the accountant sees no requests or proofs; the sender still sees their own.
delete from course_billing where course_id = t.id('A');
select t.login('N');
select t.eq((select count(*) from course_payment_requests), 0::bigint, 'edge: an unselected course''s requests are hidden');
select t.eq((select count(*) from storage.objects where bucket_id = 'payment-proofs'), 0::bigint, 'edge: and their proofs');
reset role;
select t.login('S1');
select t.eq((select count(*) from course_payment_requests), 1::bigint, 'edge: the sender still sees their own request');
select t.throws(format('update course_payment_requests set proof_path = %L', t.id('S1') || '/b.jpg'), '42501',
  'edge: no replacing while the course isn''t a paid course');
reset role;
insert into course_billing (course_id, start_day, end_day, selected_by) values (t.id('A'), 1, 28, t.id('N'));
select t.login('N');
select t.eq((select count(*) from course_payment_requests), 2::bigint, 'edge: selected again, the requests come back');
reset role;

-- A removed listener can't replace their request.
delete from course_members where course_id = t.id('A') and user_id = t.id('S1');
select t.login('S1');
select t.throws(format('update course_payment_requests set proof_path = %L', t.id('S1') || '/b.jpg'), '42501',
  'edge: a removed listener can''t replace their request');
reset role;

-- The teacher may delete any proof (for course and discipline deletion).
select t.login('T');
select t.eq(t.affected($$delete from storage.objects where bucket_id = 'payment-proofs' and name like '%/b.jpg'$$), 1::bigint,
  'the teacher can delete any proof');
reset role;
-- An accountant can't delete proofs.
select t.login('N');
select t.eq(t.affected($$delete from storage.objects where bucket_id = 'payment-proofs'$$), 0::bigint,
  'AC12 accountants never delete proofs');
reset role;
