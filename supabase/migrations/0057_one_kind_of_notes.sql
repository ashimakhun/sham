-- ARU-142: meeting notes, part 1 — one kind of notes. The separate official notes (0012, course_meetings.notes) are
-- replaced by the signed notes of 0055 (meeting_listener_notes), which now the course's current listeners, its
-- current owner and the teacher write (one entry per person and meeting) and the same people read.
--   * Select policy: a member, the owner or the teacher (mentors outside the course no longer read notes, AC 6).
--   * add_ / update_meeting_listener_notes(): also the owner and the teacher (AC 2).
--   * Existing official notes are copied into signed notes (AC 9); the body check is relaxed to 20,002 characters so
--     a merged note always fits (the functions still cap new text at 10,000).
--   * set_meeting_notes() is revoked (AC 1).
-- Nothing is dropped: course_meetings.notes / notes_updated_by / notes_updated_at and the course_meetings_new_no_notes
-- trigger stay as a backup (AC 10). meeting_listener_notes is already in supabase_realtime (0055).
-- The refusals for someone who can't write use new codes (sham:notes_add_role / sham:notes_edit_role): their wording
-- changed, and a sham: code keeps one message for good (ARU-111), so 0055's listener_notes_add_role / _edit_role keep
-- theirs.
-- Numbered 0057: 0056 is ARU-130's. Needs is_member(), owns_course(), my_role() (0021), course_hidden_from_me()
-- (0019) and trim_spaces() (0031).

-- Who writes and reads the notes of a course: a current listener, the current owner, or the teacher.
create function notes_writer(course uuid) returns boolean
  language sql stable security definer set search_path = public
  as $$ select is_member(course) or owns_course(course) or coalesce(my_role() = 'teacher', false) $$;
revoke execute on function notes_writer(uuid) from public, anon;
grant execute on function notes_writer(uuid) to authenticated;

-- AC 6: readers. The restrictive hidden-course policies from 0055 still apply on top.
drop policy "listener notes readable" on meeting_listener_notes;
create policy "notes readable by the course and the teacher" on meeting_listener_notes for select to authenticated
  using (notes_writer(course_id));

-- The safety net behind the functions (direct writes stay revoked from app users).
drop policy "listeners add own notes" on meeting_listener_notes;
create policy "writers add own notes" on meeting_listener_notes for insert to authenticated with check (
  author_id = auth.uid()
  and notes_writer(course_id)
  and exists (select 1 from course_meetings m where m.id = meeting_id and m.course_id = course_id and m.status = 'completed')
);
drop policy "authors edit own notes while listeners" on meeting_listener_notes;
create policy "authors edit own notes while writers" on meeting_listener_notes for update to authenticated
  using (author_id = auth.uid() and notes_writer(course_id))
  with check (author_id = auth.uid() and notes_writer(course_id));

-- AC 9: a merged note (existing notes + a blank line + the official text) can be up to 10,000 + 2 + 10,000.
alter table meeting_listener_notes drop constraint meeting_listener_notes_body_check;
alter table meeting_listener_notes add constraint meeting_listener_notes_body_check
  check (char_length(body) between 1 and 20002 and body = trim_spaces(body));

-- AC 2: a current listener, the owner or the teacher adds their notes to a Completed meeting. Returns the new id.
create or replace function add_meeting_listener_notes(meeting uuid, new_body text) returns uuid
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
    insert into meeting_listener_notes (meeting_id, course_id, author_id, body)
      values (meeting, m.course_id, auth.uid(), cleaned)
      on conflict (meeting_id, author_id) do nothing
      returning id into new_id;
    if new_id is null then
      raise exception 'You already have notes for this meeting.' using errcode = '23505', hint = 'sham:listener_notes_exists';
    end if;
    return new_id;
  end $$;

-- AC 2: the author changes their notes while still a listener, the owner or the teacher. The same text is a no-op
-- (no "Edited"), so a retry is safe. New text is capped at 10,000 (listener_notes_clean), so a migrated note over the
-- limit must be shortened before it can be saved.
create or replace function update_meeting_listener_notes(note uuid, new_body text) returns void
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
    if not notes_writer(n.course_id) then
      raise exception 'Only the course''s listeners, its owner and the teacher can edit notes.'
        using errcode = '42501', hint = 'sham:notes_edit_role';
    end if;
    cleaned := listener_notes_clean(new_body);
    if cleaned = n.body then
      return;
    end if;
    update meeting_listener_notes set body = cleaned, updated_at = now() where id = note;
  end $$;

-- AC 9: copy the official notes into signed notes. Runs as the table owner (no RLS). The before-write trigger keeps
-- created_at, meeting_id and author_id on update and sets course_id. A function (run once below, callable by no app
-- user) so the database tests can run it on seeded data; running it again would copy the notes again.
create function copy_official_notes() returns void
  language plpgsql set search_path = public
  as $$
declare
  r record;
  existing meeting_listener_notes%rowtype;
begin
  for r in
    select m.id, m.course_id, m.notes_updated_by as author, trim_spaces(m.notes) as body,
           coalesce(m.notes_updated_at, m.starts_at) as at
    from course_meetings m
    where m.notes is not null and trim_spaces(m.notes) <> ''
    order by m.starts_at, m.id
  loop
    existing := null;
    if r.author is not null then
      select * into existing from meeting_listener_notes where meeting_id = r.id and author_id = r.author;
    end if;
    if existing.id is not null then
      -- Merge: their notes, a blank line, the official text; keeps created_at, updated_at is the later time.
      update meeting_listener_notes
        set body = existing.body || E'\n\n' || r.body,
            updated_at = greatest(existing.updated_at, r.at)
        where id = existing.id;
    else
      -- A new note with no "Edited". A deleted editor (null) gives a "Deleted account" note; NULLs don't clash.
      insert into meeting_listener_notes (meeting_id, course_id, author_id, body, created_at, updated_at)
        values (r.id, r.course_id, r.author, r.body, r.at, r.at);
    end if;
  end loop;
end $$;
revoke execute on function copy_official_notes() from public, anon, authenticated;
select copy_official_notes();

-- AC 1: official notes can no longer be written.
revoke execute on function set_meeting_notes(uuid, text) from public, anon, authenticated;
