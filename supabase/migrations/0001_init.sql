-- Sham: initial schema for Supabase (Postgres).
-- Not used by the app yet: it currently runs on the local mock store in src/lib/store.tsx.
-- Apply in the Supabase SQL editor (or `supabase db push`) when connecting a real backend.

create type user_role as enum ('teacher', 'mentor', 'student');
create type homework_status as enum ('submitted', 'checked');

-- One row per signed-in user (auth.users).
create table profiles (
  id uuid primary key references auth.users on delete cascade,
  full_name text not null,
  role user_role not null default 'student',
  mentor_id uuid references profiles (id), -- students only
  created_at timestamptz not null default now()
);

create table homework (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references profiles (id) on delete cascade,
  title text not null check (length(trim(title)) > 0),
  description text not null default '',
  photo_path text, -- path in the "homework" storage bucket
  status homework_status not null default 'submitted',
  checked_by uuid references profiles (id),
  checked_at timestamptz,
  mentor_comment text,
  created_at timestamptz not null default now()
);

create table materials (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references profiles (id) on delete cascade,
  title text not null check (length(trim(title)) > 0),
  body text not null,
  link text,
  created_at timestamptz not null default now()
);

create index homework_student_idx on homework (student_id, created_at desc);
create index materials_created_idx on materials (created_at desc);

-- Helpers used by the policies below.
create function my_role() returns user_role
  language sql stable security definer set search_path = public
  as $$ select role from profiles where id = auth.uid() $$;

create function is_my_student(student uuid) returns boolean
  language sql stable security definer set search_path = public
  as $$ select exists (select 1 from profiles where id = student and mentor_id = auth.uid()) $$;

alter table profiles enable row level security;
alter table homework enable row level security;
alter table materials enable row level security;

-- Profiles: everyone signed in can see names/roles; users edit only their own name.
create policy "profiles readable" on profiles for select to authenticated using (true);
create policy "edit own profile" on profiles for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid() and role = my_role()); -- cannot promote yourself

-- Homework: student sees own, mentor sees their students', teacher sees all.
create policy "homework readable" on homework for select to authenticated using (
  student_id = auth.uid() or is_my_student(student_id) or my_role() = 'teacher'
);
create policy "students submit own homework" on homework for insert to authenticated with check (
  student_id = auth.uid() and my_role() = 'student' and status = 'submitted' and checked_by is null
);
create policy "mentors check their students' homework" on homework for update to authenticated
  using (is_my_student(student_id))
  with check (is_my_student(student_id) and checked_by = auth.uid());

-- Materials: everyone signed in reads; only teachers create and delete their own.
create policy "materials readable" on materials for select to authenticated using (true);
create policy "teachers add materials" on materials for insert to authenticated
  with check (teacher_id = auth.uid() and my_role() = 'teacher');
create policy "teachers delete own materials" on materials for delete to authenticated
  using (teacher_id = auth.uid() and my_role() = 'teacher');

-- Create a profile automatically on sign-up (role defaults to student; a teacher promotes others).
create function handle_new_user() returns trigger
  language plpgsql security definer set search_path = public
  as $$
  begin
    insert into profiles (id, full_name)
    values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', new.email));
    return new;
  end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function handle_new_user();

-- Storage bucket for homework photos (private; files stored as <student_id>/<file>).
insert into storage.buckets (id, name, public) values ('homework', 'homework', false);

create policy "students upload own homework photos" on storage.objects for insert to authenticated
  with check (bucket_id = 'homework' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "homework photos readable by owner, mentor, teacher" on storage.objects for select to authenticated
  using (
    bucket_id = 'homework' and (
      (storage.foldername(name))[1] = auth.uid()::text
      or is_my_student(((storage.foldername(name))[1])::uuid)
      or my_role() = 'teacher'
    )
  );
