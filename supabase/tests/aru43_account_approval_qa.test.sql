-- QA ARU-43: account approval. A sweep over EVERY table in public (found from the catalog, so a table added later
-- is covered too), both buckets and every course function, as a Pending (P) and a Rejected (R) account, on a fixture
-- with data in every table; then Accept / Reject edge cases and what approved users see of waiting accounts.
select t.seed();

-- Data in every table (as the admin).
insert into courses (id, title, created_by, hidden) values ('00000000-0000-0000-0000-0000000043a1', 'Secret', t.id('M'), true);
insert into course_members (course_id, user_id, added_by) values (t.id('A'), t.id('S1'), t.id('M'));
select t.make_assignments(t.id('A'));
insert into homework (student_id, course_id, assignment_id, title, photo_path)
  values (t.id('S1'), t.id('A'), t.assignment(t.id('A'), 1), 'HW', t.id('S1') || '/x.jpg');
insert into storage.objects (bucket_id, name, owner) values ('homework', t.id('S1') || '/x.jpg', t.id('S1'));
insert into meeting_attendance (meeting_id, user_id) values (md5('meeting' || t.id('A')::text || '1')::uuid, t.id('S1'));
insert into course_messages (course_id, author_id, body) values (t.id('A'), t.id('M'), 'hi');
insert into course_chat_reads (course_id, user_id, last_read_at) values (t.id('A'), t.id('S1'), now());
-- A scheduled meeting (the meeting functions act on it).
insert into course_meetings (id, course_id, starts_at, created_by, topic)
  values ('00000000-0000-0000-0000-0000000043c1', t.id('A'), now() + interval '2 days', t.id('M'), 'Planned');
insert into materials (teacher_id, title, body) values (t.id('T'), 'Post', 'Body');
insert into storage.objects (bucket_id, name, owner)
  values ('materials', t.id('T') || '/00000000-0000-0000-0000-0000000043f1.pdf', t.id('T'));
insert into material_files (id, author_id, name, storage_path, size_bytes)
  values ('00000000-0000-0000-0000-0000000043f1', t.id('T'), 'Book', t.id('T') || '/00000000-0000-0000-0000-0000000043f1.pdf', 10);

-- New sign-ups: P stays Pending, R is declined, P2 signs up first (for the order of Requests).
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000043b2', 'p2@x.test', '{"full_name":"Pat Two"}');
update profiles set created_at = now() - interval '1 hour' where id = '00000000-0000-0000-0000-0000000043b2';
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000043b1', 'p@x.test', '{"full_name":"Pat Pending"}'),
  ('00000000-0000-0000-0000-0000000043b3', 'r@x.test', '{"full_name":"Rob Rejected"}');

create function t.u(who text) returns uuid language sql immutable as $$
  select case who when 'P' then '00000000-0000-0000-0000-0000000043b1'::uuid
                  when 'P2' then '00000000-0000-0000-0000-0000000043b2'::uuid
                  when 'R' then '00000000-0000-0000-0000-0000000043b3'::uuid end
$$;
-- Log in by id (t.login only knows the fixture names).
create function t.login_id(who uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', who, 'role', 'authenticated')::text, false);
  set role authenticated;
end $$;
-- Any error counts as refused.
create function t.fails(sql text, what text) returns void language plpgsql as $$
begin
  begin
    execute sql;
  exception when others then
    raise notice 'ok - % (%)', what, sqlstate;
    return;
  end;
  raise exception 'FAIL: % (it succeeded)', what using errcode = 'P0001';
end $$;
-- Rows of every RLS table in public visible to the caller, except their own profile row: "table=n" for each n > 0.
create function t.visible() returns text language plpgsql as $$
declare r record; n bigint; out text := '';
begin
  for r in select c.relname from pg_class c join pg_namespace s on s.oid = c.relnamespace
           where s.nspname = 'public' and c.relkind = 'r' order by c.relname loop
    if r.relname = 'profiles' then
      execute 'select count(*) from profiles where id <> auth.uid()' into n;
    else
      execute format('select count(*) from public.%I', r.relname) into n;
    end if;
    if n > 0 then out := out || r.relname || '=' || n || ' '; end if;
  end loop;
  return trim(out);
end $$;
grant execute on all functions in schema t to anon, authenticated;

select t.eq((select string_agg(access_status::text, ',' order by id) from profiles where id in (t.u('P'), t.u('P2'), t.u('R'))),
  'pending,pending,pending', 'AC1 every new sign-up is Pending');
select t.ok(not exists (select 1 from pg_class c join pg_namespace s on s.oid = c.relnamespace
  where s.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity), 'every public table has RLS on');
select t.ok((select count(*) from pg_class c join pg_namespace s on s.oid = c.relnamespace
  where s.nspname = 'public' and c.relkind = 'r') >= 11, 'the sweep sees all 11 tables');

select t.login('T');
select t.lives($$select set_access_status(t.u('R'), 'rejected')$$, 'AC6 the teacher declines R');
select t.login('S1');
select t.ok(t.visible() <> '', 'sanity: an approved student sees data in the sweep');

-- AC 4: reads, for Pending and Rejected.
select t.login_id(t.u('P'));
select t.eq(t.visible(), '', 'AC4 Pending: no row in any table but their own profile');
select t.eq((select count(*) from profiles where id = auth.uid()), 1::bigint, 'AC4 Pending: their own profile row');
select t.eq((select count(*) from storage.objects), 0::bigint, 'AC4 Pending: no object in either bucket');
select t.eq((select count(*) from chat_unread_counts()), 0::bigint, 'AC4 Pending: no unread counts');
select t.login_id(t.u('R'));
select t.eq(t.visible(), '', 'AC4 Rejected: no row in any table but their own profile');
select t.eq((select access_status::text from profiles where id = auth.uid()), 'rejected', 'AC3 Rejected reads their status');
select t.eq((select count(*) from storage.objects), 0::bigint, 'AC4 Rejected: no object in either bucket');

-- AC 4: writes and functions, as Pending (P).
select t.login_id(t.u('P'));
select t.fails($$insert into storage.objects (bucket_id, name, owner) values ('homework', auth.uid() || '/p.jpg', auth.uid())$$,
  'AC4 no homework photo upload, own folder');
select t.fails($$insert into storage.objects (bucket_id, name, owner) values ('materials', auth.uid() || '/p.pdf', auth.uid())$$,
  'AC4 no PDF upload, own folder');
select t.fails($$insert into homework (student_id, course_id, assignment_id, title) values (auth.uid(), t.id('A'), t.assignment(t.id('A'), 2), 'x')$$,
  'AC4 no homework');
select t.fails($$insert into course_messages (course_id, author_id, body) values (t.id('A'), auth.uid(), 'x')$$, 'AC4 no chat message');
select t.fails($$insert into course_chat_reads (course_id, user_id, last_read_at) values (t.id('A'), auth.uid(), now())$$, 'AC4 no read position');
select t.fails($$insert into courses (title, created_by) values ('x', auth.uid())$$, 'AC4 no course');
select t.fails($$insert into materials (teacher_id, title, body) values (auth.uid(), 'x', 'y')$$, 'AC4 no blog post');
select t.fails($$insert into material_files (id, author_id, name, storage_path, size_bytes)
  values ('00000000-0000-0000-0000-0000000043f2', auth.uid(), 'x', auth.uid() || '/00000000-0000-0000-0000-0000000043f2.pdf', 1)$$,
  'AC4 no Knowledge base item');
select t.fails($$insert into course_members (course_id, user_id, added_by) values (t.id('A'), auth.uid(), auth.uid())$$, 'AC4 can''t join a course');
select t.fails($$insert into course_meetings (course_id, starts_at, created_by) values (t.id('A'), now() + interval '1 day', auth.uid())$$,
  'AC4 no meeting');
select t.fails($$select mark_attendance(md5('meeting' || t.id('A')::text || '2')::uuid)$$, 'AC4 mark_attendance');
select t.fails($$select unmark_attendance(md5('meeting' || t.id('A')::text || '1')::uuid)$$, 'AC4 unmark_attendance');
select t.fails($$select mark_chat_read(t.id('A'), (select id from course_messages limit 1))$$, 'AC4 mark_chat_read');
-- my_role() is null for a waiting account: "not (owns_course(..) or my_role() = 'teacher')" is then null, not true.
select t.throws($$select set_meeting_status('00000000-0000-0000-0000-0000000043c1', 'canceled')$$, '42501',
  'AC4 set_meeting_status can''t cancel a scheduled meeting');
select t.throws($$select update_meeting('00000000-0000-0000-0000-0000000043c1', now() + interval '3 days', 'Hacked', null)$$, '42501',
  'AC4 update_meeting can''t edit a scheduled meeting');
select t.throws($$select set_meeting_notes(md5('meeting' || t.id('A')::text || '1')::uuid, 'Hacked')$$, '42501',
  'AC4 set_meeting_notes can''t write notes on a completed meeting');
select t.fails($$select change_course_owner(t.id('A'), auth.uid())$$, 'AC4 change_course_owner');
select t.fails($$select remove_listener(t.id('A'), t.id('S1'))$$, 'AC4 remove_listener');
select t.fails($$select * from listener_homework_photos(t.id('A'), t.id('S1'))$$, 'AC4 listener_homework_photos');
select t.fails($$select set_user_role(t.id('S2'), 'mentor')$$, 'AC4 set_user_role');
select t.fails($$select * from access_requests()$$, 'AC7 access_requests');
select t.throws($$select set_access_status(auth.uid(), 'approved')$$, '42501', 'AC7 can''t approve themselves (RPC)');
do $$ begin
  begin
    perform set_access_status(auth.uid(), 'approved');
  exception when others then
    perform t.eq(sqlerrm, 'Your account is waiting for the teacher''s approval.', 'AC4 the function says why');
  end;
end $$;
select t.fails($$update profiles set access_status = 'approved' where id = auth.uid()$$, 'AC7 can''t approve themselves (update)');
select t.fails($$update profiles set role = 'mentor' where id = auth.uid()$$, 'AC4 can''t change their role');
select t.fails($$update profiles set full_name = 'New' where id = auth.uid()$$, 'AC4 every write is rejected, the name too');
reset role;
select t.eq((select count(*) from storage.objects where (storage.foldername(name))[1] = t.u('P')::text), 0::bigint, 'AC4 nothing was uploaded');
select t.ok((select access_status = 'pending' and role = 'student' and full_name = 'Pat Pending' from profiles where id = t.u('P')),
  'AC4 P is unchanged');
select t.ok(exists (select 1 from course_members where course_id = t.id('A') and user_id = t.id('S1')), 'AC4 S1 still in A');
select t.ok((select status = 'scheduled' and topic = 'Planned' from course_meetings where id = '00000000-0000-0000-0000-0000000043c1')
  and not exists (select 1 from course_meetings where notes = 'Hacked'), 'AC4 no meeting was changed');

-- Approved users other than the teacher never see waiting accounts; the teacher does.
select t.login('M');
select t.eq((select count(*) from profiles where access_status <> 'approved'), 0::bigint, 'AC8 a mentor sees no waiting accounts');
select t.fails($$insert into course_members (course_id, user_id, added_by) values (t.id('A'), t.u('P'), t.id('M'))$$,
  'AC8 a mentor can''t add P as a listener');
select t.fails($$select set_access_status(t.u('P'), 'approved')$$, 'AC7 a mentor can''t accept');
select t.fails($$select * from access_requests()$$, 'AC7 a mentor can''t list requests');
select t.login('S2');
select t.eq((select count(*) from profiles where access_status <> 'approved'), 0::bigint, 'AC8 a student sees no waiting accounts');
select t.fails($$select set_access_status(t.u('P'), 'rejected')$$, 'AC7 a student can''t decline');

-- AC 5 / AC 6: the teacher.
select t.login('T');
select t.eq((select string_agg(full_name || ':' || email || ':' || access_status, ',') from access_requests()),
  'Pat Two:p2@x.test:pending,Pat Pending:p@x.test:pending,Rob Rejected:r@x.test:rejected', 'AC5 requests oldest first, with email');
select t.eq((select count(*) from profiles where access_status <> 'approved'), 3::bigint, 'the teacher sees waiting profiles');
select t.throws($$select set_access_status(t.u('P'), 'pending')$$, '22023', 'AC6 nothing can be set back to Pending');
select t.throws($$select set_access_status(t.id('T'), 'rejected')$$, '42501', 'AC7 the teacher''s own access can''t change');
select t.throws($$select set_access_status(t.id('S2'), 'rejected')$$, '23514', 'edge: an approved account can''t be declined');
select t.throws($$select set_access_status('00000000-0000-0000-0000-0000000043ff', 'approved')$$, 'P0002', 'unknown user');
select t.throws($$select change_course_owner(t.id('A'), t.u('P'))$$, '23514', 'AC8 P can''t own a course');
select t.throws($$select set_user_role(t.u('P'), 'mentor')$$, '23514', 'AC8 P can''t be made a mentor');
select t.fails($$insert into course_members (course_id, user_id, added_by) values (t.id('A'), t.u('R'), t.id('T'))$$,
  'AC8 the teacher can''t add R as a listener');
select t.lives($$select set_access_status(t.u('P'), 'approved')$$, 'AC6 accept P');
select t.lives($$select set_access_status(t.u('P'), 'approved')$$, 'AC6 accepting again is a no-op');
select t.lives($$select set_access_status(t.u('R'), 'approved')$$, 'AC6 Declined -> Accept');
select t.throws($$select set_access_status(t.u('P'), 'rejected')$$, '23514', 'AC6 an accepted account can''t be declined');
select t.eq((select string_agg(full_name, ',') from access_requests()), 'Pat Two', 'AC5 only P2 is left');
reset role;
select t.ok((select access_status = 'approved' and role = 'student' and access_changed_by = t.id('T') and access_changed_at is not null
  from profiles where id = t.u('P')), 'AC6 P is an approved student, with who and when');

-- AC 2: P after acceptance is an ordinary student who is in no course.
select t.login_id(t.u('P'));
select t.eq((select string_agg(title, ',' order by title) from courses), 'Algebra,Biology', 'AC2 P sees the visible courses, not the hidden one');
select t.eq((select count(*) from course_members), 0::bigint, 'AC2 but no listeners (ARU-24: not in any course)');
select t.eq((select count(*) from homework), 0::bigint, 'AC2 and no homework');
select t.eq((select count(*) from materials), 1::bigint, 'AC2 P reads the Blog');
select t.eq((select count(*) from material_files), 1::bigint, 'AC2 and the Knowledge base');
select t.eq((select count(*) from storage.objects where bucket_id = 'materials'), 1::bigint, 'AC2 and opens its PDF');
select t.eq((select count(*) from profiles where access_status <> 'approved'), 0::bigint, 'AC2 P doesn''t see P2 waiting');
select t.eq(t.affected($$update profiles set full_name = 'Pat Approved' where id = auth.uid()$$), 1::bigint, 'AC2 P can edit their name now');
select t.fails($$update profiles set access_status = 'rejected' where id = auth.uid()$$, 'AC7 nobody changes their own status');
select t.login('M');
select t.lives($$insert into course_members (course_id, user_id, added_by) values (t.id('A'), t.u('P'), t.id('M'))$$,
  'AC8 once accepted, P can be added as a listener');
reset role;
