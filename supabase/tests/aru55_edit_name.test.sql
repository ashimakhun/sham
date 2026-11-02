-- ARU-55: users edit their own name. Rules under test: "edit own profile" (0001), the full_name-only column grant
-- (0021) and the blank-name trigger (0026_profile_name_not_blank.sql).
-- Fixture (t.seed): approved teacher T, mentors M, N, M2, students S1, S2, S3; new sign-up P stays pending.
select t.seed();

create function t.name(who uuid) returns text language sql security definer set search_path = public as $$
  select full_name from profiles where id = who
$$;
grant execute on function t.name(uuid) to anon, authenticated;

-- AC 12: own name — student, mentor and teacher.
select t.login('S1');
select t.lives($$update profiles set full_name = 'Dana Serikova' where id = t.id('S1')$$, 'AC12 a student updates their own name');
select t.login('M');
select t.lives($$update profiles set full_name = 'Мақсат Ержанұлы 🙂' where id = t.id('M')$$, 'AC12 a mentor updates their own name (non-Latin, emoji)');
select t.login('T');
select t.lives($$update profiles set full_name = 'Teacher Tessa' where id = t.id('T')$$, 'AC12 the teacher updates their own name');
reset role;
select t.eq(t.name(t.id('S1')), 'Dana Serikova', 'AC12 the student''s new name is stored');
select t.eq(t.name(t.id('M')), 'Мақсат Ержанұлы 🙂', 'AC12 the mentor''s new name is stored');
select t.eq(t.name(t.id('T')), 'Teacher Tessa', 'AC12 the teacher''s new name is stored');

-- AC 12: another user's name changes nothing (S, M and T, the teacher on a student included).
select t.login('S1');
update profiles set full_name = 'Hacked' where id = t.id('S2');
select t.login('M');
update profiles set full_name = 'Hacked' where id = t.id('S1');
update profiles set full_name = 'Hacked' where id = t.id('N');
select t.login('T');
update profiles set full_name = 'Hacked' where id = t.id('S3');
update profiles set full_name = 'Hacked' where id = t.id('M2');
reset role;
select t.eq((select count(*) from profiles where full_name = 'Hacked'), 0::bigint, 'AC12 nobody changes another user''s name');
select t.eq(t.name(t.id('S2')), 'Student Sue', 'AC12 S2 keeps their name (student tried)');
select t.eq(t.name(t.id('S3')), 'Student Sid', 'AC12 S3 keeps their name (teacher tried)');

-- AC 12: blank or whitespace-only own name is rejected; the old name is kept.
select t.login('S1');
select t.throws($$update profiles set full_name = '' where id = t.id('S1')$$, '23514', 'AC12 an empty name is rejected');
select t.throws($$update profiles set full_name = '   ' where id = t.id('S1')$$, '23514', 'AC12 a spaces-only name is rejected');
select t.throws($$update profiles set full_name = E' \t\n ' where id = t.id('S1')$$, '23514', 'AC12 a whitespace-only name is rejected');
select t.login('T');
select t.throws($$update profiles set full_name = '  ' where id = t.id('T')$$, '23514', 'AC12 the teacher cannot blank their own name');
reset role;
select t.eq(t.name(t.id('S1')), 'Dana Serikova', 'AC12 the old name is kept after a rejected blank');

-- Analysis note 2: role and access status stay non-editable (column grant), even on the own row.
select t.login('S1');
select t.throws($$update profiles set role = 'mentor' where id = t.id('S1')$$, '42501', 'a student cannot update their role');
select t.throws($$update profiles set access_status = 'rejected' where id = t.id('S1')$$, '42501', 'a student cannot update their access status');
select t.throws($$update profiles set access_changed_by = t.id('S1') where id = t.id('S1')$$, '42501', 'access_changed_by is not editable');
select t.throws($$update profiles set mentor_id = t.id('N') where id = t.id('S1')$$, '42501', 'mentor_id is not editable');
select t.login('T');
select t.throws($$update profiles set access_status = 'rejected' where id = t.id('S2')$$, '42501', 'the teacher cannot set access status directly');

-- Signed out: no update.
select t.login(null);
select t.throws($$update profiles set full_name = 'Anon' where id = t.id('S2')$$, '42501', 'anon cannot update profiles');
reset role;

-- Analysis note 2: a pending account cannot update its own name (my_role() is null, so the policy check fails).
insert into auth.users (id, email, raw_user_meta_data)
  values ('00000000-0000-0000-0000-0000000005a1', 'p@x.test', '{"full_name":"Pending Pat"}');
select t.eq((select access_status::text from profiles where id = '00000000-0000-0000-0000-0000000005a1'), 'pending', 'P is pending');
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000005a1', 'role', 'authenticated')::text, false);
set role authenticated;
select t.throws($$update profiles set full_name = 'Pat P.' where id = auth.uid()$$, '42501', 'a pending account cannot rename itself');
reset role;
select t.eq(t.name('00000000-0000-0000-0000-0000000005a1'), 'Pending Pat', 'the pending account keeps its name');

-- Data checks: sign-up is unchanged (a blank name from the API still creates the profile), existing rows untouched.
insert into auth.users (id, email, raw_user_meta_data)
  values ('00000000-0000-0000-0000-0000000005a2', 'blank@x.test', '{"full_name":"  "}');
select t.eq(t.name('00000000-0000-0000-0000-0000000005a2'), '  ', 'sign-up with a blank name still works as before');
-- Updates that don't change the name (role, access status) still work on a row whose name is blank or long.
select t.lives($$update profiles set role = 'mentor' where id = '00000000-0000-0000-0000-0000000005a2'$$, 'role change on a blank-name row still works');
update profiles set full_name = repeat('x', 120) where id = t.id('S2');
select t.lives($$update profiles set role = 'mentor' where id = t.id('S2')$$, 'role change on a long-name row still works');
select t.login('S3');
select t.lives($$update profiles set full_name = 'Student Sid' where id = t.id('S3')$$, 'saving the same name again is allowed');
reset role;
