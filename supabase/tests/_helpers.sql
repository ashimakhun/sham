-- Test helpers (schema "t"). Loaded after the migrations, as the superuser.

create schema t;
grant usage on schema t to anon, authenticated;

-- Fixed ids so tests read like the TEST DESIGN in Linear.
create function t.id(name text) returns uuid language sql immutable as $$
  select (case name
    when 'T'  then '00000000-0000-0000-0000-0000000000a1'
    when 'M'  then '00000000-0000-0000-0000-0000000000b1'
    when 'N'  then '00000000-0000-0000-0000-0000000000b2'
    when 'M2' then '00000000-0000-0000-0000-0000000000b3'
    when 'S1' then '00000000-0000-0000-0000-0000000000c1'
    when 'S2' then '00000000-0000-0000-0000-0000000000c2'
    when 'S3' then '00000000-0000-0000-0000-0000000000c3'
    when 'A'  then '00000000-0000-0000-0000-0000000000d1'
    when 'B'  then '00000000-0000-0000-0000-0000000000d2'
    when 'HW_A1' then '00000000-0000-0000-0000-0000000000e1'
    when 'HW_A2' then '00000000-0000-0000-0000-0000000000e2'
    when 'HW_B1' then '00000000-0000-0000-0000-0000000000e3'
    when 'HW_OLD' then '00000000-0000-0000-0000-0000000000e4'
  end)::uuid
$$;

-- Fails the test with a readable message.
create function t.ok(cond boolean, what text) returns void language plpgsql as $$
begin
  if cond is distinct from true then
    raise exception 'FAIL: %', what using errcode = 'P0001';
  end if;
  raise notice 'ok - %', what;
end $$;

create function t.eq(got anyelement, expected anyelement, what text) returns void language plpgsql as $$
begin
  if got is distinct from expected then
    raise exception 'FAIL: % (expected %, got %)', what, expected, got using errcode = 'P0001';
  end if;
  raise notice 'ok - %', what;
end $$;

-- Runs sql and checks it fails with the given SQLSTATE (e.g. 42501 RLS / permission, 23505 duplicate).
create function t.throws(sql text, state text, what text) returns void language plpgsql as $$
begin
  begin
    execute sql;
  exception when others then
    if sqlstate = state then
      raise notice 'ok - %', what;
      return;
    end if;
    raise exception 'FAIL: % (expected SQLSTATE %, got % %)', what, state, sqlstate, sqlerrm using errcode = 'P0001';
  end;
  raise exception 'FAIL: % (expected SQLSTATE %, but it succeeded)', what, state using errcode = 'P0001';
end $$;

-- Runs sql and checks it succeeds.
create function t.lives(sql text, what text) returns void language plpgsql as $$
begin
  execute sql;
  raise notice 'ok - %', what;
exception when others then
  raise exception 'FAIL: % (% %)', what, sqlstate, sqlerrm using errcode = 'P0001';
end $$;

-- Number of rows a statement affected (for "silently does nothing" checks under RLS).
create function t.affected(sql text) returns bigint language plpgsql as $$
declare n bigint;
begin
  execute sql;
  get diagnostics n = row_count;
  return n;
end $$;

grant execute on all functions in schema t to anon, authenticated;

-- Become a signed-in app user (or anon with null) for the rest of the transaction / session.
-- Usage: select t.login('S1'); ... reset role;
create function t.login(who text) returns void language plpgsql as $$
begin
  if who is null then
    perform set_config('request.jwt.claims', '', false);
    set role anon;
  else
    perform set_config('request.jwt.claims', json_build_object('sub', t.id(who), 'role', 'authenticated')::text, false);
    set role authenticated;
  end if;
end $$;
grant execute on function t.login(text) to anon, authenticated;

-- Fixture used by every test file:
--   teacher T; mentors M (owns A), N (owns B), M2 (no course); students S1 (mentor_id = M), S2, S3.
--   Course A by M, course B by N. S1: two homework in A (one checked, one with a photo), one in B (photo),
--   and one legacy homework with no course.
create function t.seed() returns void language plpgsql as $$
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (t.id('T'),  't@x.test',  '{"full_name":"Teacher Tess"}'),
    (t.id('M'),  'm@x.test',  '{"full_name":"Mentor Max"}'),
    (t.id('N'),  'n@x.test',  '{"full_name":"Mentor Nina"}'),
    (t.id('M2'), 'm2@x.test', '{"full_name":"Mentor Mo"}'),
    (t.id('S1'), 's1@x.test', '{"full_name":"Student Sam"}'),
    (t.id('S2'), 's2@x.test', '{"full_name":"Student Sue"}'),
    (t.id('S3'), 's3@x.test', '{"full_name":"Student Sid"}');
  update profiles set role = 'teacher' where id = t.id('T');
  update profiles set role = 'mentor' where id in (t.id('M'), t.id('N'), t.id('M2'));
  update profiles set mentor_id = t.id('M') where id = t.id('S1');

  insert into courses (id, title, created_by, created_at) values
    (t.id('A'), 'Algebra', t.id('M'), now() - interval '2 days'),
    (t.id('B'), 'Biology', t.id('N'), now() - interval '1 day');

  insert into homework (id, student_id, course_id, title, photo_path, status, checked_by) values
    (t.id('HW_A1'), t.id('S1'), t.id('A'), 'A one', t.id('S1') || '/a1.jpg', 'submitted', null),
    (t.id('HW_A2'), t.id('S1'), t.id('A'), 'A two', null, 'checked', t.id('M')),
    (t.id('HW_B1'), t.id('S1'), t.id('B'), 'B one', t.id('S1') || '/b1.jpg', 'submitted', null),
    (t.id('HW_OLD'), t.id('S1'), null, 'Before courses', null, 'submitted', null);
  insert into storage.objects (bucket_id, name, owner) values
    ('homework', t.id('S1') || '/a1.jpg', t.id('S1')),
    ('homework', t.id('S1') || '/b1.jpg', t.id('S1'));
end $$;
