-- ARU-158: report content (App Store guideline 1.2), the teacher's Reports list, and the teacher / course owner
-- deleting chat messages.
--   1. content_reports: one user's report about one piece of content (a course or general chat message, a meeting
--      note, a Blog post, a Knowledge base PDF or a course review). It keeps the content's text and author as they
--      were when reported (AC 4), so it stays readable after the content is edited or deleted. Only the workspace's
--      teacher reads it (AC 5, 6); nobody writes it directly.
--   2. report_content(): the only way in. It refuses content the reporter can't see (the content table's own read
--      rules, hidden courses included), their own content, a deleted account's content, content that no longer
--      exists, and a second open report by the same person on the same content (AC 1, 3, 4).
--   3. resolve_report(): the only way to change a report's status (teacher only). Dismissed: this report; refused
--      for a report about the teacher's own content (AC 9). Removed: only once the content is gone; every open
--      report on the same content becomes Removed (AC 7). An already resolved report changes nothing.
--   4. delete_content() (AC 7, 11): the teacher deletes any course or general chat message, Blog post or review of the
--      workspace; a course's current owner deletes any message in its chat. A function rather than new delete
--      policies, so direct deletes keep their earlier rules (authors' own Blog posts and reviews; no direct chat
--      deletes). Meeting notes and PDFs already let the teacher delete (0058, 0043).
-- The operator works in the SQL Editor with supabase/reports.sql (AC 10). Numbered 0064: after 0063.

-- 1. Reports.
create table content_reports (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) default default_workspace(),
  -- ARU-75 (0040): a deleted account leaves its reports (shown as "Deleted account").
  reporter_id uuid references profiles (id) on delete set null,
  content_kind text not null check (content_kind in ('course_message', 'general_message', 'meeting_note', 'blog_post', 'pdf', 'review')),
  -- No foreign key: the report outlives its content.
  content_id uuid not null,
  author_id uuid references profiles (id) on delete set null,
  -- The content as it was (AC 4): a Blog post's title or a PDF's name; the text, a PDF's description or a review's
  -- text; a review's stars.
  content_title text,
  content_text text not null default '',
  content_rating smallint,
  -- Where it was: the course (and its title then) and the meeting's start; none for the general chat and the Blog.
  course_id uuid,
  course_title text,
  meeting_at timestamptz,
  reason text not null check (reason in ('offensive', 'spam', 'harassment', 'other')),
  comment text check (comment is null or char_length(comment) <= 500),
  status text not null default 'open' check (status in ('open', 'removed', 'dismissed')),
  created_at timestamptz not null default now(),
  resolved_by uuid references profiles (id) on delete set null,
  resolved_at timestamptz
);
create index content_reports_workspace_idx on content_reports (workspace_id);
create index content_reports_status_idx on content_reports (status, created_at);
create index content_reports_content_idx on content_reports (content_kind, content_id);
-- AC 3: one open report per person per piece of content (a dismissed or removed one doesn't count).
create unique index content_reports_one_open on content_reports (reporter_id, content_kind, content_id) where status = 'open';

alter table content_reports enable row level security;
revoke all on content_reports from anon, authenticated;
grant select on content_reports to authenticated;
-- AC 5, 6: the teacher reads the workspace's reports; nobody else reads them. No insert, update or delete policy:
-- reports are written only by the functions below.
create policy "the teacher reads reports" on content_reports for select to authenticated using (my_role() = 'teacher');
create policy "workspace: only my workspace" on content_reports as restrictive for select to authenticated
  using (workspace_id = (select my_workspace()));
create trigger zz_workspace_guard before insert or update or delete on content_reports
  for each row execute function workspace_guard('profile:reporter_id', 'reporter_id', 'author_id', 'resolved_by');

-- Whether a piece of content still exists (whoever can see it). Internal: used by the functions below only.
create function report_content_exists(kind text, content uuid) returns boolean
  language sql stable security definer set search_path = public
  as $$
    select case kind
      when 'course_message' then exists (select 1 from course_messages where id = content)
      when 'general_message' then exists (select 1 from general_messages where id = content)
      when 'meeting_note' then exists (select 1 from meeting_listener_notes where id = content)
      when 'blog_post' then exists (select 1 from materials where id = content)
      when 'pdf' then exists (select 1 from material_files where id = content)
      when 'review' then exists (select 1 from course_feedback where id = content)
      else false
    end
  $$;
revoke execute on function report_content_exists(text, uuid) from public, anon, authenticated;

-- 2. AC 1-4: report a piece of content. Returns the new report's id.
create function report_content(kind text, content uuid, report_reason text, report_comment text default null)
  returns uuid
  language plpgsql security definer set search_path = public
  as $$
  declare
    me uuid := auth.uid();
    note_text text := nullif(btrim(coalesce(report_comment, '')), '');
    author uuid;
    visible boolean;
    title text;
    body text := '';
    rating smallint;
    course uuid;
    course_name text;
    meeting timestamptz;
    ws uuid;
    new_id uuid;
  begin
    if me is null then
      raise exception 'Please sign in again.' using errcode = '42501', hint = 'sham:sign_in_again';
    end if;
    if not is_approved() then
      raise exception 'Your account is not approved.' using errcode = '42501', hint = 'sham:not_approved';
    end if;
    if report_reason is null or report_reason not in ('offensive', 'spam', 'harassment', 'other') then
      raise exception 'Choose a reason.' using errcode = '22023', hint = 'sham:report_reason';
    end if;
    if char_length(coalesce(note_text, '')) > 500 then
      raise exception 'The comment can be at most 500 characters.' using errcode = '22001', hint = 'sham:report_comment_too_long';
    end if;
    if kind is null or kind not in ('course_message', 'general_message', 'meeting_note', 'blog_post', 'pdf', 'review') then
      raise exception 'This content no longer exists.' using errcode = 'P0002', hint = 'sham:report_content_missing';
    end if;

    -- The content, and whether the reporter can see it under its table's own read rules (hidden courses and
    -- workspaces included).
    if kind = 'course_message' then
      select m.author_id, m.body, m.course_id, m.workspace_id,
             in_course_chat(m.course_id) and not course_hidden_from_me(m.course_id)
        into author, body, course, ws, visible
        from course_messages m where m.id = content;
    elsif kind = 'general_message' then
      select m.author_id, m.body, m.workspace_id, is_approved() and m.workspace_id = my_workspace()
        into author, body, ws, visible
        from general_messages m where m.id = content;
    elsif kind = 'meeting_note' then
      select n.author_id, n.body, n.course_id, n.workspace_id, cm.starts_at,
             ((n.author_id is not null and n.author_id = me) or (n.is_public and notes_writer(n.course_id)))
               and not course_hidden_from_me(n.course_id)
        into author, body, course, ws, meeting, visible
        from meeting_listener_notes n left join course_meetings cm on cm.id = n.meeting_id
        where n.id = content;
    elsif kind = 'blog_post' then
      select m.teacher_id, m.title, m.body, m.workspace_id, is_approved() and m.workspace_id = my_workspace()
        into author, title, body, ws, visible
        from materials m where m.id = content;
    elsif kind = 'pdf' then
      select f.author_id, f.name, f.description, f.course_id, f.workspace_id,
             can_see_material_file(f.storage_path) and f.workspace_id = my_workspace()
        into author, title, body, course, ws, visible
        from material_files f where f.id = content;
    else
      select f.user_id, f.body, f.rating, f.course_id, f.workspace_id,
             is_approved() and not course_hidden_from_me(f.course_id)
        into author, body, rating, course, ws, visible
        from course_feedback f where f.id = content;
    end if;

    if not found then
      raise exception 'This content no longer exists.' using errcode = 'P0002', hint = 'sham:report_content_missing';
    end if;
    -- Content I can't see, my own, or a deleted account's (AC 1, 4).
    if not coalesce(visible, false) or author is null or author = me or ws is distinct from my_workspace() then
      raise exception 'You can''t report this.' using errcode = '42501', hint = 'sham:report_not_allowed';
    end if;
    if exists (
      select 1 from content_reports r
      where r.reporter_id = me and r.content_kind = kind and r.content_id = content and r.status = 'open'
    ) then
      raise exception 'You''ve already reported this.' using errcode = '23505', hint = 'sham:report_duplicate';
    end if;
    if course is not null then
      select c.title into course_name from courses c where c.id = course;
    end if;

    begin
      insert into content_reports (
        workspace_id, reporter_id, content_kind, content_id, author_id, content_title, content_text, content_rating,
        course_id, course_title, meeting_at, reason, comment
      ) values (
        ws, me, kind, content, author, title, coalesce(body, ''), rating, course, course_name, meeting, report_reason, note_text
      ) returning id into new_id;
    exception when unique_violation then
      -- Two taps at once: the other one saved it.
      raise exception 'You''ve already reported this.' using errcode = '23505', hint = 'sham:report_duplicate';
    end;
    return new_id;
  end $$;
revoke execute on function report_content(text, uuid, text, text) from public, anon;
grant execute on function report_content(text, uuid, text, text) to authenticated;

-- 3. AC 7-9: the teacher resolves a report of their workspace. 'removed' once the content is gone (every open report
-- on it); 'dismissed' for this report, never about the teacher's own content. An already resolved report: no change.
create function resolve_report(report uuid, new_status text) returns void
  language plpgsql security definer set search_path = public
  as $$
  declare
    me uuid := auth.uid();
    r content_reports%rowtype;
  begin
    if me is null then
      raise exception 'Please sign in again.' using errcode = '42501', hint = 'sham:sign_in_again';
    end if;
    if my_role() is distinct from 'teacher' then
      raise exception 'Only the teacher can handle reports.' using errcode = '42501', hint = 'sham:report_teacher_only';
    end if;
    if new_status is null or new_status not in ('removed', 'dismissed') then
      raise exception 'A report can only be marked removed or dismissed.' using errcode = '22023', hint = 'sham:report_status_values';
    end if;
    select * into r from content_reports where id = report and workspace_id = my_workspace() for update;
    if not found then
      raise exception 'Report not found.' using errcode = 'P0002', hint = 'sham:report_not_found';
    end if;
    if r.status <> 'open' then
      return;
    end if;
    if new_status = 'dismissed' then
      -- AC 9: only the operator dismisses a report about the teacher's own content.
      if r.author_id = me then
        raise exception 'Only the operator can dismiss a report about your own content.'
          using errcode = '42501', hint = 'sham:report_dismiss_own';
      end if;
      update content_reports set status = 'dismissed', resolved_by = me, resolved_at = now() where id = r.id;
      return;
    end if;
    if report_content_exists(r.content_kind, r.content_id) then
      raise exception 'Delete the content first.' using errcode = '23514', hint = 'sham:report_content_exists';
    end if;
    update content_reports set status = 'removed', resolved_by = me, resolved_at = now()
      where workspace_id = r.workspace_id and content_kind = r.content_kind and content_id = r.content_id and status = 'open';
  end $$;
revoke execute on function resolve_report(uuid, text) from public, anon;
grant execute on function resolve_report(uuid, text) to authenticated;

-- 4. AC 7, 11: the teacher deletes any course or general chat message, Blog post or review of the workspace; a
-- course's current owner (owns_course(), so a former owner can't) any message in that course's chat. Nobody else
-- deletes chat messages, their own included. Returns false when the content is already gone (not an error: a report
-- on it is then resolved as Removed). The workspace guard (0059) still refuses another workspace's rows.
create function delete_content(kind text, content uuid) returns boolean
  language plpgsql security definer set search_path = public
  as $$
  declare
    me uuid := auth.uid();
    teacher boolean := coalesce(my_role() = 'teacher', false);
    ws uuid;
    course uuid;
    allowed boolean;
  begin
    if me is null then
      raise exception 'Please sign in again.' using errcode = '42501', hint = 'sham:sign_in_again';
    end if;
    if kind = 'course_message' then
      select m.workspace_id, m.course_id into ws, course from course_messages m where m.id = content for update;
      allowed := found and (teacher or owns_course(course)) and not course_hidden_from_me(course);
    elsif kind = 'general_message' then
      select m.workspace_id into ws from general_messages m where m.id = content for update;
      allowed := found and teacher;
    elsif kind = 'blog_post' then
      select m.workspace_id into ws from materials m where m.id = content for update;
      allowed := found and teacher;
    elsif kind = 'review' then
      select f.workspace_id, f.course_id into ws, course from course_feedback f where f.id = content for update;
      allowed := found and teacher;
    else
      raise exception 'You can''t delete this content.' using errcode = '42501', hint = 'sham:content_cant_delete';
    end if;
    if ws is null then
      return false;
    end if;
    if not allowed or ws is distinct from my_workspace() then
      raise exception 'You can''t delete this content.' using errcode = '42501', hint = 'sham:content_cant_delete';
    end if;
    if kind = 'course_message' then
      delete from course_messages where id = content;
    elsif kind = 'general_message' then
      delete from general_messages where id = content;
    elsif kind = 'blog_post' then
      delete from materials where id = content;
    else
      delete from course_feedback where id = content;
    end if;
    return true;
  end $$;
revoke execute on function delete_content(text, uuid) from public, anon;
grant execute on function delete_content(text, uuid) to authenticated;

-- Realtime: deleted chat messages reach open chats (a DELETE event carries the primary key; the app removes the row
-- by id). course_messages and general_messages are already in the publication (0006, 0029).
