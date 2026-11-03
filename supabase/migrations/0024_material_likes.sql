-- Likes on Blog posts (ARU-52): any approved user likes or unlikes a post (a `materials` row) once, and everyone
-- approved sees the count and who liked it. Run after 0021_account_approval.sql (uses is_approved()); numbered 0024
-- because 0023 is taken by the open ARU-48 branch. Adds a table; changes nothing else.

create table material_likes (
  material_id uuid not null references materials (id) on delete cascade,
  user_id uuid not null default auth.uid() references profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  -- At most one like per user and post.
  primary key (material_id, user_id)
);

-- "Liked by", newest first.
create index material_likes_recent_idx on material_likes (material_id, created_at desc);

alter table material_likes enable row level security;

-- Approved accounts read every like (pending and rejected accounts read nothing, ARU-43).
create policy "likes readable" on material_likes for select to authenticated using (is_approved());
-- Only one's own like, and only while approved.
create policy "users like as themselves" on material_likes for insert to authenticated
  with check (user_id = auth.uid() and is_approved());
create policy "users remove own likes" on material_likes for delete to authenticated
  using (user_id = auth.uid() and is_approved());

-- No updates; on insert only the post and the user can be given (the time is the server's).
revoke update, insert, truncate on material_likes from anon, authenticated;
grant insert (material_id, user_id) on material_likes to authenticated;

-- Live counts and "Liked by" (the primary key carries both ids on delete events).
alter publication supabase_realtime add table material_likes;
