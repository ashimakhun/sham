-- Course feedback (ARU-53): a listener (student or mentor) of a course that has started (it has a completed meeting)
-- leaves one rating (1–5 stars) and a short text, and can edit or delete it while still a listener. Every approved
-- user who can see the course reads the feedback; for a hidden course (ARU-40) only its participants and the teacher.
-- Run after 0022_attendance_from_start.sql (uses is_member(), is_approved() from 0021 and course_hidden_from_me()
-- from 0019). Numbered 0025 because 0023 (ARU-48) and 0024 (ARU-52) are taken by open branches; it depends on
-- neither. Adds a table, a helper and a trigger; changes nothing else.

-- A course has started once one of its meetings is completed. Completed is final (set_meeting_status only changes
-- scheduled meetings), so feedback never closes again. Security definer so the insert policy doesn't depend on the
-- course_meetings policies.
create function course_started(course uuid) returns boolean
  language sql stable security definer set search_path = public
  as $$ select exists (select 1 from course_meetings where course_id = course and status = 'completed') $$;
revoke execute on function course_started(uuid) from public, anon;
grant execute on function course_started(uuid) to authenticated;

create table course_feedback (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references courses (id) on delete cascade,
  user_id uuid not null default auth.uid() references profiles (id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  -- Stored trimmed (trigger below); whitespace-only text is refused.
  body text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now(),
  -- Equals created_at until the first edit; the app shows "edited" when it is later.
  updated_at timestamptz not null default now(),
  -- One feedback per listener and course.
  unique (course_id, user_id)
);

create index course_feedback_course_idx on course_feedback (course_id, created_at desc);

-- Trims the text (spaces, tabs and line breaks) and sets the times on the server.
create function course_feedback_before_write() returns trigger
  language plpgsql set search_path = public
  as $$
  begin
    new.body := regexp_replace(new.body, '^\s+|\s+$', '', 'g');
    if tg_op = 'INSERT' then
      new.created_at := now();
      new.updated_at := new.created_at;
    else
      new.created_at := old.created_at;
      new.updated_at := now();
    end if;
    return new;
  end $$;
revoke execute on function course_feedback_before_write() from public, anon, authenticated;
create trigger course_feedback_before_write before insert or update on course_feedback
  for each row execute function course_feedback_before_write();

alter table course_feedback enable row level security;

-- Read: approved accounts (pending and rejected read nothing, ARU-43); hidden courses only for their participants
-- and the teacher (restrictive, as in 0019).
create policy "feedback readable" on course_feedback for select to authenticated using (is_approved());
create policy "hidden courses: readable by participants and the teacher" on course_feedback as restrictive
  for select to authenticated using (not course_hidden_from_me(course_id));

-- Write: only one's own row, only while a listener (is_member() is false for owners, the teacher, removed
-- listeners and accounts that aren't approved). A new feedback also needs the course to have started.
create policy "listeners add own feedback to started courses" on course_feedback for insert to authenticated
  with check (user_id = auth.uid() and is_member(course_id) and course_started(course_id));
create policy "listeners edit own feedback" on course_feedback for update to authenticated
  using (user_id = auth.uid() and is_member(course_id))
  with check (user_id = auth.uid() and is_member(course_id));
create policy "listeners delete own feedback" on course_feedback for delete to authenticated
  using (user_id = auth.uid() and is_member(course_id));

-- Only the rating and the text can be given or changed; the course, the author, the id and the times can't.
revoke insert, update, truncate on course_feedback from anon, authenticated;
grant insert (course_id, user_id, rating, body) on course_feedback to authenticated;
grant update (rating, body) on course_feedback to authenticated;

-- Live list, average and course cards.
alter publication supabase_realtime add table course_feedback;
