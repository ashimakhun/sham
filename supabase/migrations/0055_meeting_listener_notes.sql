-- ARU-125: meeting notes by listeners. A current listener of a course adds their own signed notes to a Completed
-- meeting (one entry per listener and meeting); everyone who reads the meeting's notes reads them; only the author
-- edits them; the author, the current course owner and the teacher delete them. The owner's notes (0012,
-- course_meetings.notes) don't change.
-- Adds the table meeting_listener_notes (RLS, hidden-course policies as 0019, in the realtime publication) and three
-- functions, the only way to write it (direct inserts, updates and deletes are revoked, so each refusal has its own
-- message and sham: code). Changes no existing table, policy or row; deletes nothing.
-- Numbered 0055: 0053 is ARU-111's and 0054 ARU-112's; it needs trim_spaces() from 0031 and is_member(),
-- owns_course(), my_role() and course_hidden_from_me() from 0004/0005/0019/0021.

create table meeting_listener_notes (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references course_meetings (id) on delete cascade,
  -- Always the meeting's course (set by the trigger below, whatever the writer sends): for the policies and realtime.
  course_id uuid not null references courses (id) on delete cascade,
  -- AC 12: a deleted account's notes stay, with no author ("Deleted account"), as 0040 does for shared content.
  -- Several such notes on one meeting are allowed: NULLs don't clash in the unique key.
  author_id uuid references profiles (id) on delete set null,
  -- Stored trimmed (the functions trim as JavaScript's trim() does: tabs, line breaks, non-breaking and other Unicode
  -- spaces, ARU-68), 1-10,000 characters.
  body text not null check (char_length(body) between 1 and 10000 and body = trim_spaces(body)),
  created_at timestamptz not null default now(),
  -- Set by the database on every change of the text; "Edited <date and time>" shows when it's later than created_at.
  updated_at timestamptz not null default now(),
  unique (meeting_id, author_id)
);

create index meeting_listener_notes_course_idx on meeting_listener_notes (course_id);

-- The note's course is its meeting's course; the meeting, author and creation time never change (the author only
-- becomes null when their account is deleted).
create function meeting_listener_notes_before_write() returns trigger
  language plpgsql security definer set search_path = public
  as $$
  begin
    if tg_op = 'UPDATE' then
      new.meeting_id := old.meeting_id;
      -- Only "on delete set null" (a deleted account, AC 12) clears the author.
      if new.author_id is not null then
        new.author_id := old.author_id;
      end if;
      new.created_at := old.created_at;
    end if;
    new.course_id := (select m.course_id from course_meetings m where m.id = new.meeting_id);
    return new;
  end $$;
revoke execute on function meeting_listener_notes_before_write() from public, anon, authenticated;
create trigger meeting_listener_notes_before_write before insert or update on meeting_listener_notes
  for each row execute function meeting_listener_notes_before_write();

alter table meeting_listener_notes enable row level security;

-- AC 7: read like the meeting itself (0010): the teacher and every mentor, or a listener of the course.
create policy "listener notes readable" on meeting_listener_notes for select to authenticated
  using (my_role() in ('teacher', 'mentor') or is_member(course_id));

-- AC 10 / 11, the safety net behind the functions below (direct writes are revoked from app users).
create policy "listeners add own notes" on meeting_listener_notes for insert to authenticated with check (
  author_id = auth.uid()
  and is_member(course_id)
  and exists (select 1 from course_meetings m where m.id = meeting_id and m.course_id = course_id and m.status = 'completed')
);
create policy "authors edit own notes while listeners" on meeting_listener_notes for update to authenticated
  using (author_id = auth.uid() and is_member(course_id))
  with check (author_id = auth.uid() and is_member(course_id));
create policy "authors, the owner or the teacher delete notes" on meeting_listener_notes for delete to authenticated
  using (
    (author_id = auth.uid() and (is_member(course_id) or my_role() in ('mentor', 'teacher')))
    or owns_course(course_id)
    or my_role() = 'teacher'
  );

-- AC 7: hidden courses, as course_meetings in 0019.
create policy "hidden courses: readable by participants and the teacher" on meeting_listener_notes as restrictive
  for select to authenticated using (not course_hidden_from_me(course_id));
create policy "hidden courses: only participants and the teacher add" on meeting_listener_notes as restrictive
  for insert to authenticated with check (not course_hidden_from_me(course_id));
create policy "hidden courses: only participants and the teacher delete" on meeting_listener_notes as restrictive
  for delete to authenticated using (not course_hidden_from_me(course_id));

revoke insert, update, delete on meeting_listener_notes from anon, authenticated;
revoke all on meeting_listener_notes from anon;
grant select on meeting_listener_notes to authenticated;

-- The checks shared by adding and editing: the text, trimmed; null when it's valid.
create function listener_notes_clean(new_body text) returns text
  language plpgsql immutable set search_path = public
  as $$
  declare
    cleaned text := trim_spaces(coalesce(new_body, ''));
  begin
    if cleaned = '' then
      raise exception 'Notes can''t be empty.' using errcode = '23514', hint = 'sham:listener_notes_empty';
    end if;
    if char_length(cleaned) > 10000 then
      raise exception 'Notes can be at most 10,000 characters.' using errcode = '22001', hint = 'sham:notes_too_long';
    end if;
    return cleaned;
  end $$;
revoke execute on function listener_notes_clean(text) from public, anon, authenticated;

-- AC 1-2, 5, 10: a current listener adds their notes to a Completed meeting of the course. Returns the new id.
create function add_meeting_listener_notes(meeting uuid, new_body text) returns uuid
  language plpgsql security definer set search_path = public
  as $$
  declare
    m course_meetings%rowtype;
    cleaned text;
    new_id uuid;
  begin
    select * into m from course_meetings where id = meeting;
    -- The meeting as the caller sees it (0010 and 0019): otherwise it doesn't exist for them.
    if not found or course_hidden_from_me(m.course_id)
      or not (coalesce(my_role() in ('teacher', 'mentor'), false) or is_member(m.course_id)) then
      raise exception 'Meeting not found.' using errcode = 'P0002', hint = 'sham:meeting_not_found';
    end if;
    if not is_member(m.course_id) then
      raise exception 'Only listeners of this course can add notes.' using errcode = '42501', hint = 'sham:listener_notes_add_role';
    end if;
    if m.status <> 'completed' then
      raise exception 'Notes can be added only to completed meetings.' using errcode = '23514', hint = 'sham:notes_completed';
    end if;
    cleaned := listener_notes_clean(new_body);
    insert into meeting_listener_notes (meeting_id, course_id, author_id, body)
      values (meeting, m.course_id, auth.uid(), cleaned)
      on conflict (meeting_id, author_id) do nothing
      returning id into new_id;
    if new_id is null then
      raise exception 'You already have notes for this meeting.' using errcode = '23505', hint = 'sham:listener_notes_exists';
    end if;
    return new_id;
  end $$;
revoke execute on function add_meeting_listener_notes(uuid, text) from public, anon;
grant execute on function add_meeting_listener_notes(uuid, text) to authenticated;

-- AC 3, 10, 11: the author changes their notes while still a listener of the course. The same text is a no-op (no
-- "Edited"), so a retry is safe.
create function update_meeting_listener_notes(note uuid, new_body text) returns void
  language plpgsql security definer set search_path = public
  as $$
  declare
    n meeting_listener_notes%rowtype;
    cleaned text;
  begin
    select * into n from meeting_listener_notes where id = note for update;
    if not found or course_hidden_from_me(n.course_id) then
      raise exception 'Notes not found.' using errcode = 'P0002', hint = 'sham:listener_notes_not_found';
    end if;
    if n.author_id is distinct from auth.uid() then
      raise exception 'Only the author can edit these notes.' using errcode = '42501', hint = 'sham:listener_notes_author_only';
    end if;
    if not is_member(n.course_id) then
      raise exception 'Only listeners of this course can edit notes.' using errcode = '42501', hint = 'sham:listener_notes_edit_role';
    end if;
    cleaned := listener_notes_clean(new_body);
    if cleaned = n.body then
      return;
    end if;
    update meeting_listener_notes set body = cleaned, updated_at = now() where id = note;
  end $$;
revoke execute on function update_meeting_listener_notes(uuid, text) from public, anon;
grant execute on function update_meeting_listener_notes(uuid, text) to authenticated;

-- AC 4, 9, 10, 11: deletes notes. The author while they can still see them (a current listener, or a mentor, who reads
-- every meeting); the current course owner; the teacher. "Not found" means it's already gone (a safe retry).
create function delete_meeting_listener_notes(note uuid) returns void
  language plpgsql security definer set search_path = public
  as $$
  declare
    n meeting_listener_notes%rowtype;
  begin
    select * into n from meeting_listener_notes where id = note for update;
    if not found or course_hidden_from_me(n.course_id) then
      raise exception 'Notes not found.' using errcode = 'P0002', hint = 'sham:listener_notes_not_found';
    end if;
    if not (
      (n.author_id = auth.uid() and (is_member(n.course_id) or coalesce(my_role() in ('mentor', 'teacher'), false)))
      or owns_course(n.course_id)
      or coalesce(my_role() = 'teacher', false)
    ) then
      raise exception 'You can''t delete these notes.' using errcode = '42501', hint = 'sham:listener_notes_cant_delete';
    end if;
    delete from meeting_listener_notes where id = note;
  end $$;
revoke execute on function delete_meeting_listener_notes(uuid) from public, anon;
grant execute on function delete_meeting_listener_notes(uuid) to authenticated;

-- AC 8a: live updates (RLS still applies to realtime).
alter publication supabase_realtime add table meeting_listener_notes;
