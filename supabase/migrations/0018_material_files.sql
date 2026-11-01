-- Knowledge base (ARU-30): teachers and mentors upload PDF books, each with a name, an optional description and an
-- optional course. Everyone signed in sees and opens them; only the author (while still a teacher or mentor) edits
-- the name, description and course, or deletes the item. Run after 0017_meeting_attendance.sql.
-- Adds a table, a trigger function, a private storage bucket and its policies; nothing existing is changed or deleted.

create table material_files (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references profiles (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 200),
  description text not null default '' check (char_length(description) <= 2000),
  -- set null: an item outlives its course as "No course", so its PDF is never left without a row.
  course_id uuid references courses (id) on delete set null,
  -- Always "<author id>/<item id>.pdf" in the "materials" bucket, so a row can't point at someone else's file.
  storage_path text not null unique,
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 26214400),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (storage_path = author_id::text || '/' || id::text || '.pdf')
);

create index material_files_created_idx on material_files (created_at desc);

-- Trims the name and description (spaces, tabs and line breaks, like the app) and keeps the server's times: created_at
-- on insert, updated_at on every change. Runs before the checks, so "   " is rejected as an empty name.
create function material_files_before_write() returns trigger
  language plpgsql set search_path = public
  as $$
  begin
    new.name := btrim(new.name, E' \t\r\n');
    new.description := btrim(coalesce(new.description, ''), E' \t\r\n');
    if tg_op = 'INSERT' then
      new.created_at := now();
    end if;
    new.updated_at := now();
    return new;
  end $$;

create trigger material_files_before_write before insert or update on material_files
  for each row execute function material_files_before_write();

alter table material_files enable row level security;

-- Everyone signed in reads all items (anon reads nothing).
create policy "material files readable" on material_files for select to authenticated using (true);
-- Teachers and mentors add items as themselves. my_role() is checked on every write, as in 0013_mentor_materials.sql,
-- so a mentor made a student keeps their items visible but can no longer add, change or delete them.
create policy "teachers and mentors add material files" on material_files for insert to authenticated
  with check (author_id = auth.uid() and my_role() in ('teacher', 'mentor'));
create policy "authors update own material files" on material_files for update to authenticated
  using (author_id = auth.uid() and my_role() in ('teacher', 'mentor'))
  with check (author_id = auth.uid() and my_role() in ('teacher', 'mentor'));
create policy "authors delete own material files" on material_files for delete to authenticated
  using (author_id = auth.uid() and my_role() in ('teacher', 'mentor'));

-- Updates may change only the name, description and course (the PDF, author and times stay as they are).
revoke update on material_files from anon, authenticated;
grant update (name, description, course_id) on material_files to authenticated;

-- Live updates on every device (the app reloads on any change).
alter publication supabase_realtime add table material_files;

-- Private bucket for the PDFs: PDF only, 25 MB at most (also checked by the app before uploading).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('materials', 'materials', false, 26214400, array['application/pdf']);

-- Read for everyone signed in (the app opens a PDF through a 60-second signed link created on tap).
create policy "material files readable by signed-in users" on storage.objects for select to authenticated
  using (bucket_id = 'materials');
-- Upload and delete only in your own folder ("<your id>/…") and only while you are a teacher or mentor.
create policy "teachers and mentors upload own material files" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'materials'
    and (storage.foldername(name))[1] = auth.uid()::text
    and my_role() in ('teacher', 'mentor')
  );
create policy "authors delete own material files from storage" on storage.objects for delete to authenticated
  using (
    bucket_id = 'materials'
    and (storage.foldername(name))[1] = auth.uid()::text
    and my_role() in ('teacher', 'mentor')
  );
