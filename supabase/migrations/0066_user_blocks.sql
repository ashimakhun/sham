-- ARU-162: block a person (App Store guideline 1.2). A block is one user hiding another user's chat messages, meeting
-- notes, Blog posts and reviews from themselves. It is one-way and private: the blocked person isn't told, and nobody
-- else (the teacher included) can read it. The app hides the content after loading it; the database only keeps the
-- blocks and leaves blocked authors out of the blocker's new-message counts and Telegram notifications.
--   1. user_blocks (blocker_id, blocked_id, created_at): own rows only (select / insert / delete), approved accounts,
--      never oneself (check), only someone of my workspace (insert policy, against profiles.workspace_id). Rows go
--      when either account is deleted (cascade, ARU-75). No workspace_id column: a block is never read by anyone but
--      its blocker, and both people are always in the blocker's workspace. Not in the realtime publication (another
--      device picks a block up on its next load).
--   2. AC 4: chat_unread_counts() and general_chat_unread_count() (latest in 0040) skip messages whose author I've
--      blocked. Deleted authors (null) still count: "not exists" is null-safe (0040 note 4).
--   3. AC 4: the Telegram recipient functions leave out recipients who blocked the author: chat_message_recipients(),
--      general_message_recipients(), new_material_recipients() (latest in 0059) and meeting_notes_recipients() (0062).
--      Otherwise unchanged (grants are kept by create or replace).
-- Numbered 0066: after 0065 (ARU-163's word filter, merged first; ARU-172).

-- 1. Blocks.
create table user_blocks (
  blocker_id uuid not null references profiles (id) on delete cascade,
  blocked_id uuid not null references profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  -- AC 6: nobody blocks themselves.
  constraint user_blocks_not_self check (blocker_id <> blocked_id)
);
-- The recipient functions look blocks up by the blocked author.
create index user_blocks_blocked_idx on user_blocks (blocked_id);

alter table user_blocks enable row level security;
revoke all on user_blocks from anon, authenticated;
grant select, insert, delete on user_blocks to authenticated;

-- AC 6: my blocks are mine only. Waiting and declined accounts can't block (is_approved()).
create policy "read own blocks" on user_blocks for select to authenticated
  using (blocker_id = auth.uid());
create policy "block someone of my workspace" on user_blocks for insert to authenticated
  with check (
    blocker_id = auth.uid()
    and is_approved()
    and blocked_id <> auth.uid()
    and exists (select 1 from profiles p where p.id = blocked_id and p.workspace_id = (select my_workspace()))
  );
create policy "unblock own blocks" on user_blocks for delete to authenticated
  using (blocker_id = auth.uid());

-- 2. New-message counts without blocked authors (otherwise as 0040).
create or replace function chat_unread_counts() returns table (course_id uuid, unread bigint)
  language sql stable security invoker set search_path = public
  as $$
    select m.course_id, count(*)
    from course_messages m
    left join course_chat_reads r on r.course_id = m.course_id and r.user_id = auth.uid()
    where m.author_id is distinct from auth.uid()
      and (r.last_read_at is null or m.created_at > r.last_read_at)
      and not exists (select 1 from user_blocks b where b.blocker_id = auth.uid() and b.blocked_id = m.author_id)
    group by m.course_id
  $$;

create or replace function general_chat_unread_count() returns bigint
  language sql stable security invoker set search_path = public
  as $$
    select count(*)
    from general_messages m
    left join general_chat_reads r on r.user_id = auth.uid()
    where m.author_id is distinct from auth.uid()
      and (r.last_read_at is null or m.created_at > r.last_read_at)
      and not exists (select 1 from user_blocks b where b.blocker_id = auth.uid() and b.blocked_id = m.author_id)
  $$;

-- 3. Telegram recipients without people who blocked the author (otherwise as 0059 / 0062).
create or replace function chat_message_recipients(message uuid)
  returns table (course_title text, recipient_ids uuid[])
  language sql stable security definer set search_path = public
  as $$
    select
      c.title,
      array(
        select p.id
        from profiles p
        where p.id is distinct from m.author_id
          and p.access_status = 'approved'
          and p.workspace_id = c.workspace_id
          and (
            p.role = 'teacher'
            or c.created_by = p.id
            or exists (select 1 from course_members cm where cm.course_id = m.course_id and cm.user_id = p.id)
          )
          and not exists (select 1 from user_blocks b where b.blocker_id = p.id and b.blocked_id = m.author_id)
        order by p.id
      )
    from course_messages m
    join courses c on c.id = m.course_id
    where m.id = message
  $$;

create or replace function general_message_recipients(message uuid)
  returns table (recipient_ids uuid[])
  language sql stable security definer set search_path = public
  as $$
    select array(
      select p.id
      from profiles p
      where p.id is distinct from m.author_id
        and p.access_status = 'approved'
        and p.workspace_id = m.workspace_id
        and not exists (select 1 from user_blocks b where b.blocker_id = p.id and b.blocked_id = m.author_id)
      order by p.id
    )
    from general_messages m
    where m.id = message
  $$;

create or replace function new_material_recipients(type text, item uuid)
  returns table (user_id uuid, author_name text, item_title text)
  language sql stable security definer set search_path = public
  as $$
    with m as (
      select b.teacher_id as author_id, b.title as title, false as course_only, null::uuid as course_id, b.workspace_id
        from materials b
        where new_material_recipients.type = 'blog' and b.id = new_material_recipients.item
      union all
      select f.author_id, f.name, f.course_only, f.course_id, f.workspace_id
        from material_files f
        where new_material_recipients.type = 'file' and f.id = new_material_recipients.item
    )
    select p.id, a.full_name, m.title
    from m
    join profiles a on a.id = m.author_id
    join profiles p on p.id <> m.author_id and p.access_status = 'approved' and p.workspace_id = m.workspace_id
    join telegram_links l on l.user_id = p.id and l.notify_new_material
    where (
        not m.course_only
        or m.course_id is null
        or p.role = 'teacher'
        or exists (select 1 from courses c where c.id = m.course_id and c.created_by = p.id)
        or exists (select 1 from course_members cm where cm.course_id = m.course_id and cm.user_id = p.id)
      )
      and not exists (select 1 from user_blocks b where b.blocker_id = p.id and b.blocked_id = m.author_id)
    order by p.id
  $$;

create or replace function meeting_notes_recipients(note uuid)
  returns table (user_id uuid, author_name text, course_title text)
  language sql stable security definer set search_path = public
  as $$
    select p.id, a.full_name, c.title
    from meeting_listener_notes n
    join courses c on c.id = n.course_id
    join profiles a on a.id = n.author_id
    join profiles p on p.id <> n.author_id and p.access_status = 'approved' and p.workspace_id = c.workspace_id
    join telegram_links l on l.user_id = p.id and l.notify_meeting_notes
    where n.id = meeting_notes_recipients.note
      and n.is_public
      and (
        p.role = 'teacher'
        or c.created_by = p.id
        or exists (select 1 from course_members cm where cm.course_id = c.id and cm.user_id = p.id)
      )
      and not exists (select 1 from user_blocks b where b.blocker_id = p.id and b.blocked_id = n.author_id)
    order by p.id
  $$;
