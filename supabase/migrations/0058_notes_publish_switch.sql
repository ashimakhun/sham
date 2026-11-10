-- ARU-143: meeting notes, part 2 — a Publish switch. A note is private (only its author sees it) or public (the
-- course's current listeners, its current owner and the teacher, as ARU-142's readers).
--   * meeting_listener_notes.is_public, default false (a new note is private, AC 1); every existing note is public
--     (AC 2).
--   * Select policy: the author, or a public note for notes_writer() (AC 4 / 5). The hidden-course restrictive
--     policies stay.
--   * add_ / update_meeting_listener_notes() take the flag (publish). Changing only the flag is not an edit: it
--     leaves updated_at alone, so no "Edited" (AC 3). The two-argument calls of 0055/0057 still work: adding makes a
--     private note, editing keeps the note's flag.
--   * delete_meeting_listener_notes() and its policy: a private note only by its author (AC 8).
--   * profiles_before_delete(): an account's private notes are deleted with it; public ones stay (AC 9).
-- meeting_listener_notes is already in supabase_realtime (0055). Numbered 0058: after ARU-142's 0057. Needs
-- notes_writer() (0057), listener_notes_clean() (0055), account_deletion_problem() (0040), owns_course(), is_member(),
-- my_role() (0021) and course_hidden_from_me() (0019).

alter table meeting_listener_notes add column is_public boolean not null default false;
-- AC 2: everything written before the switch existed was visible to the course, so it stays public.
update meeting_listener_notes set is_public = true;

-- AC 4 / 5: readers.
drop policy "notes readable by the course and the teacher" on meeting_listener_notes;
create policy "own notes, or public notes for the course and the teacher" on meeting_listener_notes
  for select to authenticated
  -- The author reads their own notes while their account is accepted (a Pending account reads nothing, ARU-43).
  using ((author_id is not null and author_id = auth.uid() and is_approved()) or (is_public and notes_writer(course_id)));

-- AC 8: the safety net behind delete_meeting_listener_notes() (direct deletes stay revoked).
drop policy "authors, the owner or the teacher delete notes" on meeting_listener_notes;
create policy "authors, or the owner or the teacher for public notes, delete notes" on meeting_listener_notes
  for delete to authenticated
  using (
    (author_id is not null and author_id = auth.uid() and (is_member(course_id) or my_role() in ('mentor', 'teacher')))
    or (is_public and (owns_course(course_id) or my_role() = 'teacher'))
  );

-- AC 1-2: a writer adds their notes, private unless published. Returns the new id.
drop function add_meeting_listener_notes(uuid, text);
create function add_meeting_listener_notes(meeting uuid, new_body text, publish boolean default false) returns uuid
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
    if not notes_writer(m.course_id) then
      raise exception 'Only the course''s listeners, its owner and the teacher can add notes.'
        using errcode = '42501', hint = 'sham:notes_add_role';
    end if;
    if m.status <> 'completed' then
      raise exception 'Notes can be added only to completed meetings.' using errcode = '23514', hint = 'sham:notes_completed';
    end if;
    cleaned := listener_notes_clean(new_body);
    insert into meeting_listener_notes (meeting_id, course_id, author_id, body, is_public)
      values (meeting, m.course_id, auth.uid(), cleaned, coalesce(publish, false))
      on conflict (meeting_id, author_id) do nothing
      returning id into new_id;
    if new_id is null then
      raise exception 'You already have notes for this meeting.' using errcode = '23505', hint = 'sham:listener_notes_exists';
    end if;
    return new_id;
  end $$;
revoke execute on function add_meeting_listener_notes(uuid, text, boolean) from public, anon;
grant execute on function add_meeting_listener_notes(uuid, text, boolean) to authenticated;

-- AC 3: the author changes their notes and/or the flag (null keeps it). Same text and flag: a no-op. Flag only:
-- is_public changes, updated_at doesn't. The text is checked first, so a migrated note over 10,000 characters must be
-- shortened even to change only the flag.
drop function update_meeting_listener_notes(uuid, text);
create function update_meeting_listener_notes(note uuid, new_body text, publish boolean default null) returns void
  language plpgsql security definer set search_path = public
  as $$
  declare
    n meeting_listener_notes%rowtype;
    cleaned text;
    flag boolean;
  begin
    select * into n from meeting_listener_notes where id = note for update;
    if not found or course_hidden_from_me(n.course_id) then
      raise exception 'Notes not found.' using errcode = 'P0002', hint = 'sham:listener_notes_not_found';
    end if;
    if n.author_id is distinct from auth.uid() then
      raise exception 'Only the author can edit these notes.' using errcode = '42501', hint = 'sham:listener_notes_author_only';
    end if;
    if not notes_writer(n.course_id) then
      raise exception 'Only the course''s listeners, its owner and the teacher can edit notes.'
        using errcode = '42501', hint = 'sham:notes_edit_role';
    end if;
    cleaned := listener_notes_clean(new_body);
    flag := coalesce(publish, n.is_public);
    if cleaned = n.body and flag = n.is_public then
      return;
    end if;
    if cleaned = n.body then
      update meeting_listener_notes set is_public = flag where id = note;
    else
      update meeting_listener_notes set body = cleaned, is_public = flag, updated_at = now() where id = note;
    end if;
  end $$;
revoke execute on function update_meeting_listener_notes(uuid, text, boolean) from public, anon;
grant execute on function update_meeting_listener_notes(uuid, text, boolean) to authenticated;

-- AC 8: the author deletes their own notes (public or private) while they can still open the meeting; the current
-- owner and the teacher delete public notes only. "Not found" means it's already gone (a safe retry).
create or replace function delete_meeting_listener_notes(note uuid) returns void
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
      -- ARU-135: a deleted account's notes have no author; that term must be false, not null (null would let anyone in).
      (n.author_id is not null and n.author_id = auth.uid() and (is_member(n.course_id) or coalesce(my_role() in ('mentor', 'teacher'), false)))
      or (n.is_public and (owns_course(n.course_id) or coalesce(my_role() = 'teacher', false)))
    ) then
      raise exception 'You can''t delete these notes.' using errcode = '42501', hint = 'sham:listener_notes_cant_delete';
    end if;
    delete from meeting_listener_notes where id = note;
  end $$;

-- AC 9: deleting an account deletes its private notes first; its public notes stay with no author (on delete set
-- null). Otherwise as 0053.
create or replace function profiles_before_delete() returns trigger
  language plpgsql security definer set search_path = public
  as $$
  declare
    problem text := account_deletion_problem(old.id);
  begin
    if problem is not null then
      raise exception '%', problem using errcode = 'P0001', hint = case when problem like 'You own courses:%' then 'sham:delete_owns_courses' else 'sham:delete_teacher' end, detail = case when problem like 'You own courses:%' then json_build_object('titles', substring(problem from '^You own courses: (.*)\. Ask the teacher'))::text else '' end;
    end if;
    delete from meeting_listener_notes where author_id = old.id and not is_public;
    return old;
  end $$;
