-- Handling reports (ARU-158). Run these in the Supabase SQL Editor (it runs as admin, so row-level security does not
-- block it). Users report chat messages, meeting notes, Blog posts, Knowledge base PDFs and course reviews; each
-- workspace's teacher handles them in the app (Profile -> Reports). The operator sees every workspace's reports here
-- and must make sure every report is answered within 24 hours, as the Terms of Use promise: if a teacher hasn't acted,
-- handle the report below. Only the operator can dismiss a report about the teacher's own content.

-- (a) Open reports of all workspaces, oldest first. author_is_teacher: the report is about the workspace teacher's
--     own content (the teacher can delete it but not dismiss it). open_for: how long it has been waiting.
select r.id as report_id,
       w.name as workspace,
       now() - r.created_at as open_for,
       r.created_at,
       r.content_kind,
       r.content_id,
       coalesce(r.course_title, case r.content_kind when 'general_message' then 'General chat'
         when 'blog_post' then 'Blog' when 'pdf' then 'Knowledge base' end) as place,
       r.meeting_at,
       r.content_title,
       r.content_text,
       r.content_rating,
       coalesce(a.full_name, 'Deleted account') as author,
       coalesce(rp.full_name, 'Deleted account') as reporter,
       r.reason,
       r.comment,
       coalesce(a.role = 'teacher', false) as author_is_teacher
from content_reports r
join workspaces w on w.id = r.workspace_id
left join profiles a on a.id = r.author_id
left join profiles rp on rp.id = r.reporter_id
where r.status = 'open'
order by r.created_at, r.id;

-- (b) Mark a report Removed (the content is deleted, step c) or Dismissed (the content stays). Works for every report,
--     including reports about the teacher's own content. resolved_by stays empty: the operator has no app account.
update content_reports set status = 'dismissed', resolved_at = now()
where id = '00000000-0000-0000-0000-000000000000' -- report_id from (a)
  and status = 'open';

-- After deleting the content (c), mark every open report on it Removed:
update content_reports set status = 'removed', resolved_at = now()
where status = 'open'
  and (content_kind, content_id) = (select content_kind, content_id from content_reports
                                    where id = '00000000-0000-0000-0000-000000000000'); -- report_id from (a)

-- (c) Delete the reported content. Use the content_kind and content_id from (a) and run only the matching line.
delete from course_messages where id = '00000000-0000-0000-0000-000000000000';        -- course_message
delete from general_messages where id = '00000000-0000-0000-0000-000000000000';       -- general_message
delete from meeting_listener_notes where id = '00000000-0000-0000-0000-000000000000'; -- meeting_note
delete from materials where id = '00000000-0000-0000-0000-000000000000';              -- blog_post
delete from course_feedback where id = '00000000-0000-0000-0000-000000000000';        -- review
-- pdf: the row and its stored file. First note the file's path, delete the row, then delete the file in
-- Storage -> materials (the SQL Editor can't remove Storage files).
select storage_path from material_files where id = '00000000-0000-0000-0000-000000000000';
delete from material_files where id = '00000000-0000-0000-0000-000000000000';         -- pdf

-- Recently resolved reports (last 30 days), newest first, to check what was done.
select r.id as report_id, w.name as workspace, r.content_kind, r.status, r.resolved_at,
       coalesce(t.full_name, 'Operator') as resolved_by, r.content_text
from content_reports r
join workspaces w on w.id = r.workspace_id
left join profiles t on t.id = r.resolved_by
where r.status <> 'open' and r.resolved_at > now() - interval '30 days'
order by r.resolved_at desc;
