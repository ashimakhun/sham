-- Course meetings (ARU-10): the course owner or the teacher schedules meetings and marks them completed or
-- canceled. The teacher, every mentor and the course's listeners see them. Run after 0005_homework_by_course.sql
-- (needs is_member() from 0004 and owns_course() from 0005). Adds a table only; nothing is deleted.
-- Editing and rescheduling (rescheduled_at, update_meeting) come with ARU-15.

create type meeting_status as enum ('scheduled', 'completed', 'canceled');

create table course_meetings (
  id uuid primary key default gen_random_uuid(), -- the app sends its own id so a retry cannot schedule twice
  course_id uuid not null references courses (id) on delete cascade,
  starts_at timestamptz not null, -- date and start time; there is no end time (product-owner decision 6)
  topic text not null default 'Meeting' check (length(trim(topic)) > 0),
  location text, -- free text: a link (http/https, opened by the app) or a place
  status meeting_status not null default 'scheduled',
  created_by uuid not null references profiles (id),
  created_at timestamptz not null default now(),
  status_changed_by uuid references profiles (id),
  status_changed_at timestamptz
);

create index course_meetings_course_idx on course_meetings (course_id, starts_at);

alter table course_meetings enable row level security;

-- See: the teacher and every mentor see all meetings; a student only those of courses they are a listener of.
create policy "meetings readable" on course_meetings for select to authenticated
  using (my_role() in ('teacher', 'mentor') or is_member(course_id));

-- Schedule: the current owner of the course or the teacher, as themselves, a new Scheduled meeting in the future.
create policy "owner or teacher schedules meetings" on course_meetings for insert to authenticated with check (
  (owns_course(course_id) or my_role() = 'teacher')
  and created_by = auth.uid()
  and status = 'scheduled'
  and starts_at > now()
  and status_changed_by is null
  and status_changed_at is null
);

-- No update or delete policy: meetings are never deleted (cancel instead), and the status changes only through
-- set_meeting_status() below.

-- Marks a Scheduled meeting completed (only once it has started) or canceled. Completed and canceled are final.
-- Asking again for the status the meeting already has is a no-op, so a retry after a network error is safe.
create function set_meeting_status(meeting uuid, new_status meeting_status) returns void
  language plpgsql security definer set search_path = public
  as $$
  declare
    m course_meetings%rowtype;
  begin
    select * into m from course_meetings where id = meeting for update;
    if not found then
      raise exception 'Meeting not found.' using errcode = 'P0002';
    end if;
    if not (owns_course(m.course_id) or my_role() = 'teacher') then
      raise exception 'Only the course owner or the teacher can change a meeting''s status.' using errcode = '42501';
    end if;
    if new_status = m.status and new_status <> 'scheduled' then
      return; -- already done: safe retry
    end if;
    if m.status <> 'scheduled' then
      raise exception 'This meeting is already %; its status can''t change.', m.status using errcode = '23514';
    end if;
    if new_status = 'scheduled' then
      raise exception 'A meeting can only be marked completed or canceled.' using errcode = '22023';
    end if;
    if new_status = 'completed' and m.starts_at > now() then
      raise exception 'A meeting can be marked completed only after it has started.' using errcode = '23514';
    end if;
    update course_meetings
      set status = new_status, status_changed_by = auth.uid(), status_changed_at = now()
      where id = meeting;
  end $$;
revoke execute on function set_meeting_status(uuid, meeting_status) from public, anon;
grant execute on function set_meeting_status(uuid, meeting_status) to authenticated;

-- Live updates (RLS still applies to realtime).
alter publication supabase_realtime add table course_meetings;
