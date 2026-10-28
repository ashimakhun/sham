-- Courses (ARU-6): teachers and mentors create courses; students submit homework for a course.
-- Run after 0001_init.sql and 0002_realtime.sql.

create table courses (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) > 0),
  description text not null default '',
  created_by uuid not null references profiles (id), -- the course owner in later issues
  created_at timestamptz not null default now()
);

create index courses_created_idx on courses (created_at desc);

alter table courses enable row level security;

-- Everyone signed in sees all courses (membership comes in a later issue).
create policy "courses readable" on courses for select to authenticated using (true);

-- Only teachers and mentors create courses, and only as themselves. No update/delete yet.
create policy "teachers and mentors create courses" on courses for insert to authenticated
  with check (created_by = auth.uid() and my_role() in ('teacher', 'mentor'));

-- Homework belongs to a course. Nullable so homework created before courses keeps working.
alter table homework add column course_id uuid references courses (id);
create index homework_course_idx on homework (course_id, created_at desc);

-- New homework must name an existing course.
drop policy "students submit own homework" on homework;
create policy "students submit own homework" on homework for insert to authenticated with check (
  student_id = auth.uid()
  and my_role() = 'student'
  and status = 'submitted'
  and checked_by is null
  and course_id is not null
  and exists (select 1 from courses c where c.id = course_id)
);

-- Live updates for the Courses tab.
alter publication supabase_realtime add table courses;
