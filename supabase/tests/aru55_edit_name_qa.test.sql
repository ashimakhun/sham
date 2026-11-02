-- QA ARU-55: gaps in aru55_edit_name.test.sql: the app's own call (update ... returning id), a name changed together
-- with a forbidden column, a rename followed by role and approval changes, other users seeing the new name, a
-- rejected account, and a non-breaking-space-only name.
select t.seed();
insert into auth.users (id, email, raw_user_meta_data) values ('00000000-0000-0000-0000-0000000055b1', 'r@x.test', '{"full_name":"Rae"}');
update profiles set access_status = 'rejected' where id = '00000000-0000-0000-0000-0000000055b1';

-- AC 3 / AC 12: the store's call, update ... returning id, returns the own row.
select t.login('M');
do $$
declare n int;
begin
  with u as (update profiles set full_name = 'Max Mentorov' where id = auth.uid() returning id) select count(*) into n from u;
  perform t.eq(n, 1, 'AC3 the app''s update returns the own row');
end $$;

-- AC 11: other approved users read the new name on their next load; ordering by name follows it.
select t.login('S2');
select t.eq((select full_name from profiles where id = t.id('M')), 'Max Mentorov', 'AC11 another user reads the new name');
select t.login('T');
select t.lives($$update profiles set full_name = 'Aaron Teacher' where id = auth.uid()$$, 'the teacher renames');
select t.login('S1');
select t.eq((select full_name from profiles order by full_name limit 1), 'Aaron Teacher', 'edge: name order follows the rename');

-- Roles and access: a name change bundled with a forbidden column is refused as a whole.
select t.login('S1');
select t.throws($$update profiles set full_name = 'New', role = 'mentor' where id = auth.uid()$$, '42501',
  'a name change together with a role change is refused');
reset role;
select t.ok((select full_name = 'Student Sam' and role = 'student' from profiles where id = t.id('S1')), 'and neither changed');

-- The rename doesn't get in the way of later role and owner changes.
select t.login('T');
select t.lives($$select set_user_role(t.id('M2'), 'student')$$, 'the teacher changes M2''s role after renames');
select t.lives($$select change_course_owner(t.id('A'), t.id('N'))$$, 'and an owner change still works');
select t.login('M');
select t.lives($$update profiles set full_name = 'Max Again' where id = auth.uid()$$, 'a mentor who no longer owns A renames again');

-- A rejected account can't rename itself either.
do $q$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000055b1', 'role', 'authenticated')::text, false);
  set role authenticated;
  begin
    update profiles set full_name = 'Rae Renamed' where id = auth.uid();
  exception when others then null;
  end;
  reset role;
end $q$;
select t.eq((select full_name from profiles where id = '00000000-0000-0000-0000-0000000055b1'), 'Rae', 'AC12 a rejected account keeps its name');

-- Edge: a name of only non-breaking spaces (U+00A0) or other Unicode spaces. The app's trim() removes them; record
-- what the database does.
select t.login('S3');
select t.throws($$update profiles set full_name = E'\t\n ' where id = auth.uid()$$, '23514', 'AC12 tabs and line breaks only: rejected');
select t.throws($$update profiles set full_name = chr(160) || chr(160) where id = auth.uid()$$, '23514',
  'AC12 non-breaking spaces only: rejected');
reset role;
