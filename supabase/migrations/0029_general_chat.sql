-- ARU-61: one general chat for every approved user (any role), opened from the Profile tab.
-- Adds a table, its index and policies, and puts it in the realtime publication; deletes nothing.
-- Numbered 0029: 0028 is ARU-60 (meeting homework checked); this file doesn't depend on it.

create table general_messages (
  id uuid primary key default gen_random_uuid(), -- the app sends its own id so a retry cannot post twice
  author_id uuid not null references profiles (id),
  -- Same rule as course_messages (0006): not blank, at most 2000 characters.
  body text not null check (length(trim(body)) > 0 and length(body) <= 2000),
  created_at timestamptz not null default now()
);

-- Newest first; id breaks ties so paging is stable.
create index general_messages_created_idx on general_messages (created_at desc, id desc);

alter table general_messages enable row level security;

-- Approved accounts only (is_approved(), 0021): waiting and declined accounts read nothing and can't post. It is
-- checked at query time, so an account the teacher accepts sees the whole history at once.
create policy "general chat readable by approved users" on general_messages for select to authenticated
  using (is_approved());
create policy "approved users post as themselves" on general_messages for insert to authenticated
  with check (author_id = auth.uid() and is_approved());
-- No update or delete policy: messages cannot be edited or deleted, not even by the teacher.

-- Live messages (RLS still applies to realtime).
alter publication supabase_realtime add table general_messages;
