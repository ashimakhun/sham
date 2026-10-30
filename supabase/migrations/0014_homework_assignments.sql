-- Homework assignments (ARU-32): the course's current owner or the teacher assigns homework (title, description,
-- optional deadline) to a Completed meeting, at most one per meeting. Listeners now send homework only for an
-- assignment of their course, one per assignment. Run after 0012_meeting_notes.sql. Adds a table, a column, an
-- index and a trigger, and replaces the homework insert policy; nothing is deleted. Old homework keeps
-- assignment_id = null and stays readable and checkable as before.

create table homework_assignments (
  id uuid primary key default gen_random_uuid(), -- the app sends its own id so a retry cannot assign twice
  meeting_id uuid not null unique references course_meetings (id) on delete cascade,
  course_id uuid not null references courses (id) on delete cascade, -- always the meeting's course
  title text not null check (char_length(title) between 1 and 200),
  description text not null default '',
  due_at timestamptz,
  created_by uuid not null references profiles (id),
  created_at timestamptz not null default now()
);

create index homework_assignments_course_idx on homework_assignments (course_id, created_at desc);

alter table homework_assignments enable row level security;

-- See: like meetings, the teacher and every mentor see all; a student those of courses they are a listener of.
create policy "assignments readable" on homework_assignments for select to authenticated
  using (my_role() in ('teacher', 'mentor') or is_member(course_id));

-- Assign: the course's current owner or the teacher, as themselves, on a Completed meeting of that course, with no
-- deadline or one in the future. (The trigger below gives readable messages; this policy is the rule.)
create policy "owner or teacher assigns homework" on homework_assignments for insert to authenticated with check (
  (owns_course(course_id) or my_role() = 'teacher')
  and created_by = auth.uid()
  and exists (
    select 1 from course_meetings m
    where m.id = meeting_id and m.course_id = homework_assignments.course_id and m.status = 'completed'
  )
  and (due_at is null or due_at > now())
);

-- No update or delete policy: an assignment can't be edited or removed (out of scope for ARU-32).

-- Readable errors before the policy check, and trimmed text. Runs as the definer so a missing meeting is reported
-- the same way to everyone allowed to assign.
create function homework_assignments_before_insert() returns trigger
  language plpgsql security definer set search_path = public
  as $$
  declare
    m course_meetings%rowtype;
  begin
    if not (owns_course(new.course_id) or my_role() = 'teacher') then
      raise exception 'Only the course owner or the teacher can assign homework.' using errcode = '42501';
    end if;
    select * into m from course_meetings where id = new.meeting_id;
    if not found or m.course_id <> new.course_id then
      raise exception 'Meeting not found.' using errcode = 'P0002';
    end if;
    if m.status <> 'completed' then
      raise exception 'Homework can be assigned only to completed meetings.' using errcode = '23514';
    end if;
    if exists (select 1 from homework_assignments a where a.meeting_id = new.meeting_id and a.id <> new.id) then
      raise exception 'This meeting already has homework.' using errcode = '23505';
    end if;
    if new.due_at is not null and new.due_at <= now() then
      raise exception 'The deadline must be in the future.' using errcode = '23514';
    end if;
    new.title := btrim(new.title);
    new.description := btrim(coalesce(new.description, ''));
    if char_length(new.title) = 0 then
      raise exception 'Enter a title.' using errcode = '23514';
    end if;
    if char_length(new.title) > 200 then
      raise exception 'The title can be at most 200 characters.' using errcode = '23514';
    end if;
    new.created_at := now();
    return new;
  end $$;
create trigger homework_assignments_before_insert before insert on homework_assignments
  for each row execute function homework_assignments_before_insert();

alter publication supabase_realtime add table homework_assignments;

-- Homework now belongs to an assignment (null only for homework sent before ARU-32), one per listener.
alter table homework add column assignment_id uuid references homework_assignments (id);
create unique index homework_one_per_assignment on homework (assignment_id, student_id);

-- Submit: as before (yourself, a student or mentor, a listener of the course), and now only for an assignment of
-- that same course.
drop policy "listeners submit own homework" on homework;
create policy "listeners submit own homework" on homework for insert to authenticated with check (
  student_id = auth.uid()
  and my_role() in ('student', 'mentor')
  and is_member(course_id)
  and status = 'submitted'
  and checked_by is null
  and assignment_id is not null
  and exists (select 1 from homework_assignments a where a.id = assignment_id and a.course_id = homework.course_id)
);
-- The update grant (status, checked_by, checked_at, mentor_comment) from 0005 is unchanged: checking can't move
-- homework to another assignment.
