-- QA ARU-61: gaps in aru61_general_chat.test.sql: a role switch keeps access, the order is the server's (who can set
-- created_at), messages from many users page stably, and the general chat stays apart from course chats.
select t.seed();
insert into course_members (course_id, user_id, added_by) values (t.id('A'), t.id('S1'), t.id('M'));

-- AC 9: switched to mentor and back, a user keeps reading and posting.
select t.login('T');
select t.lives($$select set_user_role(t.id('S2'), 'mentor')$$, 'S2 becomes a mentor');
select t.login('S2');
select t.lives($$insert into general_messages (author_id, body) values (auth.uid(), 'as mentor')$$, 'AC9 a mentor posts');
select t.login('T');
select t.lives($$select set_user_role(t.id('S2'), 'student')$$, 'S2 back to student');
select t.login('S2');
select t.lives($$insert into general_messages (author_id, body) values (auth.uid(), 'as student')$$, 'AC9 and again as a student');
select t.eq((select count(*) from general_messages where author_id = t.id('S2')), 2::bigint, 'AC9 both messages are there');

-- Separate from course chats: a general message is not in any course chat, and course messages don't leak here.
reset role;
insert into course_messages (course_id, author_id, body) values (t.id('A'), t.id('M'), 'course only');
select t.login('S3');
select t.eq((select count(*) from course_messages), 0::bigint, 'regression: a student in no course still reads no course chat');
select t.ok(not exists (select 1 from general_messages where body = 'course only'), 'regression: course messages stay out of the general chat');
select t.ok(not exists (select 1 from chat_unread_counts()), 'regression: no course unread count from general messages');

-- Paging: the app pages by (created_at, id) newest first; equal timestamps keep a stable order.
reset role;
insert into general_messages (id, author_id, body, created_at)
select ('00000000-0000-0000-0000-0000000061' || lpad(n::text, 2, '0'))::uuid, t.id('M'), 'same time ' || n, '2026-11-01 10:00:00+00'
from generate_series(1, 5) n;
select t.login('S1');
select t.eq((select string_agg(body, ',' order by created_at desc, id desc) from general_messages where body like 'same time%'),
  'same time 5,same time 4,same time 3,same time 2,same time 1', 'edge: equal timestamps page in a stable order (id breaks ties)');
reset role;

-- Edge case "server time order": a client must not choose its message's time. Otherwise a message dated in the
-- future stays pinned as the newest at the bottom for everyone, and a backdated one hides in the history.
select t.login('S1');
do $$
begin
  begin
    insert into general_messages (author_id, body, created_at) values (auth.uid(), 'pinned', '2099-01-01');
  exception when others then null;
  end;
end $$;
select t.ok(not exists (select 1 from general_messages where created_at > now() + interval '1 minute'),
  'edge: a message can''t be dated in the future (the server sets the time)');
reset role;
