-- Course chat (ARU-8): one group chat per course for its owner, its listeners and the teacher.
-- Run after 0004_course_members.sql (independent of 0005). Text only; no edit or delete.

create table course_messages (
  id uuid primary key default gen_random_uuid(), -- the app sends its own id so a retry cannot post twice
  course_id uuid not null references courses (id) on delete cascade,
  author_id uuid not null references profiles (id),
  body text not null check (length(trim(body)) > 0 and length(body) <= 2000),
  created_at timestamptz not null default now()
);

-- Newest first per course; id breaks ties so paging is stable.
create index course_messages_course_idx on course_messages (course_id, created_at desc, id desc);

alter table course_messages enable row level security;

-- In the chat: the course's current owner, its listeners (is_member, 0004) and the teacher. Checked at query
-- time, so removed listeners and former owners lose access at once and new ones gain it.
create function in_course_chat(course uuid) returns boolean
  language sql stable security definer set search_path = public
  as $$
    select exists (select 1 from courses where id = course and created_by = auth.uid())
      or is_member(course)
      or my_role() = 'teacher'
  $$;
revoke execute on function in_course_chat(uuid) from public, anon;
grant execute on function in_course_chat(uuid) to authenticated;

create policy "course chat readable by participants" on course_messages for select to authenticated
  using (in_course_chat(course_id));
create policy "participants post as themselves" on course_messages for insert to authenticated
  with check (author_id = auth.uid() and in_course_chat(course_id));
-- No update or delete policy: messages cannot be edited or deleted.

-- Live messages (RLS still applies to realtime). The app listens on its own channel per open chat.
alter publication supabase_realtime add table course_messages;
