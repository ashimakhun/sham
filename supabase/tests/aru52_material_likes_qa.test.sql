-- QA ARU-52: gaps in aru52_material_likes.test.sql: what the app actually sends (only the post id), the like time
-- set by the server, a like on a missing post, a pending account's own old like, role changes, deleting a profile,
-- the teacher's rights over other people's likes, and the "Liked by" order.
select t.seed();
insert into materials (id, teacher_id, title, body) values
  ('00000000-0000-0000-0000-00000052c0a1', t.id('T'), 'Post A', 'x'),
  ('00000000-0000-0000-0000-00000052c0a2', t.id('M'), 'Post B', 'y');
create function t.a() returns uuid language sql immutable as $$ select '00000000-0000-0000-0000-00000052c0a1'::uuid $$;
create function t.b() returns uuid language sql immutable as $$ select '00000000-0000-0000-0000-00000052c0a2'::uuid $$;
grant execute on function t.a(), t.b() to anon, authenticated;

-- The app's insert: only material_id; user_id and created_at come from the database.
select t.login('S1');
select t.lives($$insert into material_likes (material_id) values (t.a())$$, 'AC1 the app''s insert (post id only) works');
reset role;
select t.ok((select user_id = t.id('S1') and created_at > now() - interval '1 minute' from material_likes where material_id = t.a()),
  'AC1 the user is the caller and the time is the server''s');

select t.login('S2');
select t.throws($$insert into material_likes (material_id, created_at) values (t.a(), '2000-01-01')$$, '42501',
  'AC3 nobody can back-date a like (it would change the order)');
select t.throws($$insert into material_likes (material_id) values ('00000000-0000-0000-0000-00000052c0ff')$$, '23503',
  'AC10 a like on a post that no longer exists fails (the app shows the error)');
select t.throws($$insert into material_likes (material_id, user_id) values (t.a(), null)$$, '42501',
  'AC7 a like without a user is refused');

-- AC 3: newest first, by the server time.
select t.lives($$insert into material_likes (material_id) values (t.a())$$, 'S2 likes A');
reset role;
update material_likes set created_at = now() - interval '1 hour' where user_id = t.id('S1');
select t.login('M2');
select t.eq((select string_agg(p.full_name, ',' order by l.created_at desc) from material_likes l join profiles p on p.id = l.user_id
  where l.material_id = t.a()), 'Student Sue,Student Sam', 'AC3 a third user reads both likers, newest first');

-- AC 7: the teacher has no extra rights over other people's likes.
select t.login('T');
select t.eq(t.affected($$delete from material_likes where material_id = t.a() and user_id = t.id('S1')$$), 0::bigint,
  'AC7 the teacher can''t remove a student''s like');
select t.login('M');
select t.eq(t.affected($$delete from material_likes where material_id = t.a()$$), 0::bigint,
  'AC7 a mentor can''t clear the likes of a post');
reset role;
select t.eq((select count(*) from material_likes where material_id = t.a()), 2::bigint, 'AC7 both likes are still there');

-- Edge case: a mentor made a student keeps their likes and can still like and unlike.
select t.login('M2');
select t.lives($$insert into material_likes (material_id) values (t.b())$$, 'M2 likes B as a mentor');
select t.login('T');
select t.lives($$select set_user_role(t.id('M2'), 'student')$$, 'M2 is made a student');
select t.login('M2');
select t.eq((select count(*) from material_likes where user_id = t.id('M2')), 1::bigint, 'edge: the like is kept');
select t.lives($$insert into material_likes (material_id) values (t.a())$$, 'edge: and as a student likes A');
select t.eq(t.affected($$delete from material_likes where material_id = t.b() and user_id = auth.uid()$$), 1::bigint,
  'edge: and unlikes B');

-- AC 8: an account that liked while approved can't be made pending again (set_access_status), so check what a
-- pending account sees of a like stored under its id (e.g. created by the admin): nothing, and it can't remove it.
reset role;
insert into auth.users (id, email, raw_user_meta_data) values ('00000000-0000-0000-0000-00000052c0b1', 'p@x.test', '{"full_name":"Pat"}');
insert into material_likes (material_id, user_id) values (t.a(), '00000000-0000-0000-0000-00000052c0b1');
select t.login('S1');
select t.ok(not exists (select 1 from profiles where id = '00000000-0000-0000-0000-00000052c0b1'),
  'AC8 approved users can''t read the pending liker''s profile, so the app neither lists nor counts that like');
do $q$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000052c0b1', 'role', 'authenticated')::text, false);
  set role authenticated;
  perform t.eq((select count(*) from material_likes), 0::bigint, 'AC8 the pending account reads no likes, not even its own');
  perform t.eq(t.affected($$delete from material_likes where user_id = auth.uid()$$), 0::bigint, 'AC8 and can''t remove it');
  reset role;
end $q$;

-- Deleting a profile (auth user) takes its likes with it.
reset role;
delete from auth.users where id = t.id('S2');
select t.eq((select count(*) from material_likes where user_id = t.id('S2')), 0::bigint, 'data: a deleted account''s likes go too');
select t.eq((select count(*) from material_likes where material_id = t.a() and user_id = t.id('S1')), 1::bigint, 'data: others'' stay');

-- The post's author deletes it while it has likes; the other post's likes stay.
select t.login('M');
select t.eq(t.affected($$delete from materials where id = t.b()$$), 1::bigint, 'AC9 the author deletes B');
reset role;
select t.eq((select count(*) from material_likes where material_id = t.b()), 0::bigint, 'AC9 B''s likes are gone');
select t.ok((select count(*) from material_likes where material_id = t.a()) >= 2, 'AC9 A keeps its likes');
