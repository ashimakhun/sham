-- ARU-8 QA additions to aru8_course_chat.test.sql: full paging walk with the app's cursor, owner change in both
-- directions, chats without listeners, and the helper's definition. M owns A, N owns B (no listeners).
select t.seed();
insert into course_members (course_id, user_id, added_by) values
  (t.id('A'), t.id('S1'), t.id('M')),
  (t.id('A'), t.id('M2'), t.id('M'));

-- Edge / AC 12: a course with no listeners — its owner and the teacher can still chat.
select t.login('N');
select t.lives($$insert into course_messages (course_id, author_id, body) values ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000b2', 'Owner alone')$$,
  'edge: owner posts in a course with no listeners');
reset role; select t.login('T');
select t.lives($$insert into course_messages (course_id, author_id, body) values ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000a1', 'Teacher here')$$,
  'edge: teacher posts in a course with no listeners');
select t.eq((select count(*) from course_messages where course_id = t.id('B')), 2::bigint, 'edge: teacher reads a course with no listeners');

-- AC 2: a listener of A cannot read or post in B; a mentor owning B cannot use A.
reset role; select t.login('S1');
select t.eq((select count(*) from course_messages where course_id = t.id('B')), 0::bigint, 'AC2 listener of A reads nothing in B');
select t.throws($$insert into course_messages (course_id, author_id, body) values ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000c1', 'Wrong room')$$, '42501',
  'AC2 listener of A cannot post in B');

-- AC 10: owner change M -> N. N posts; M (not a listener) can't read or post; M's messages stay with M as author.
reset role; select t.login('M');
insert into course_messages (course_id, author_id, body) values (t.id('A'), t.id('M'), 'From the first owner');
reset role;
update courses set created_by = t.id('N') where id = t.id('A');
select t.login('N');
select t.lives($$insert into course_messages (course_id, author_id, body) values ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000b2', 'New owner here')$$,
  'AC10 new owner posts');
select t.ok(exists (select 1 from course_messages where course_id = t.id('A') and author_id = t.id('M')),
  'AC10 the former owner''s messages remain, with the former owner as author');
reset role; select t.login('M');
select t.throws($$insert into course_messages (course_id, author_id, body) values ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000b1', 'Still here?')$$, '42501',
  'AC10 former owner (not a listener) cannot post');
-- "unless they are a listener": the former owner added as a listener gets access back.
reset role; select t.login('N');
insert into course_members (course_id, user_id, added_by) values (t.id('A'), t.id('M'), t.id('N'));
reset role; select t.login('M');
select t.ok((select count(*) from course_messages where course_id = t.id('A')) >= 2, 'AC10 former owner who is a listener reads again');
reset role;
update courses set created_by = t.id('M') where id = t.id('A');
delete from course_members where course_id = t.id('A') and user_id = t.id('M');

-- AC 7: page through 120 messages with the app's (created_at, id) cursor, including 30 with the same timestamp.
-- Mirrors store.loadMessages: newest first, 51 rows (50 + "has more"), then
-- created_at < c.created_at or (created_at = c.created_at and id < c.id).
delete from course_messages where course_id = t.id('A');
insert into course_messages (course_id, author_id, body, created_at)
  select t.id('A'), t.id('M'), 'bulk ' || g,
         case when g <= 30 then timestamptz '2026-10-28 10:00:00+00' else timestamptz '2026-10-28 10:00:00+00' + g * interval '1 second' end
  from generate_series(1, 120) g;
select t.login('S1');
do $$
declare
  c_at timestamptz; c_id uuid; page int := 0; n int; seen uuid[] := '{}'; sizes text := '';
  r record;
begin
  loop
    n := 0;
    for r in
      select id, created_at from course_messages
      where course_id = t.id('A')
        and (c_at is null or created_at < c_at or (created_at = c_at and id < c_id))
      order by created_at desc, id desc
      limit 51
    loop
      n := n + 1;
      exit when n = 51; -- the 51st row only says "there is more"
      seen := seen || r.id;
      c_at := r.created_at; c_id := r.id;
    end loop;
    page := page + 1;
    sizes := sizes || least(n, 50) || ' ';
    exit when n < 51 or page > 10;
  end loop;
  perform t.eq(trim(sizes), '50 50 20', 'AC7 a listener pages 120 messages as 50, 50, 20');
  perform t.eq(cardinality(seen), 120, 'AC7 every message is loaded once');
  perform t.eq((select count(distinct x) from unnest(seen) x)::int, 120, 'AC7 no duplicates across pages, even with 30 equal timestamps');
end $$;

-- Data: the helper is security definer with a fixed search_path, and the policies go through it (no recursion).
reset role;
select t.ok((select prosecdef and 'search_path=public' = any(proconfig) from pg_proc where proname = 'in_course_chat'),
  'data: in_course_chat is security definer with search_path = public');
select t.ok(not exists (select 1 from pg_policies where tablename = 'course_messages'
  and (coalesce(qual, '') || coalesce(with_check, '')) like '%course_members%'),
  'data: course_messages policies do not query course_members directly');
select t.ok(not exists (select 1 from information_schema.role_routine_grants where routine_name = 'in_course_chat' and grantee in ('anon', 'PUBLIC')),
  'data: anon cannot execute in_course_chat');
