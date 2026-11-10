-- Run these in the Supabase SQL Editor (it runs as admin, so row-level security does not block it).
-- Everyone who signs up in the app starts as a student. Mentorship comes from courses (ARU-7/ARU-14): a student's
-- mentors are the owners of the courses they were added to, so there is no per-student mentor to set here.
-- Switching users between student and mentor is done in the app: Profile -> Manage roles (teacher only, ARU-13).
-- Workspaces (ARU-145): every account belongs to one workspace, and each workspace has at most one teacher.

-- 0. The workspaces, oldest first (since ARU-146 a sign-up creates a workspace or joins one with its invite code; only SQL Editor inserts
--    into auth.users without either still join the oldest one), with their teacher, if any.
select w.id, w.name, w.created_at, t.full_name as teacher
from workspaces w
left join profiles t on t.workspace_id = w.id and t.role = 'teacher'
order by w.created_at, w.id;

-- 1. See everyone, their workspace, their current role and whether their teacher has accepted them (ARU-43).
select w.name as workspace, p.full_name, u.email, p.role, p.access_status
from profiles p
join auth.users u on u.id = p.id
join workspaces w on w.id = p.workspace_id
order by w.created_at, p.access_status, p.role, p.full_name;

-- 2. One-time setup: make the first teacher of a workspace (use the email they signed up with, and the workspace's
--    id from step 0: pick it by id, as names don't have to be unique). This only works while that workspace has no
--    teacher; once it has one the database rejects any change to or from 'teacher' there
--    (supabase/migrations/0009_roles_screen.sql, per workspace since 0059_workspaces.sql). The account must already be
--    in that workspace. New accounts wait for the teacher's approval (ARU-43); making someone the teacher also
--    approves them.
update profiles set role = 'teacher'
where id = (select id from auth.users where email = 'teacher@example.com')
  and workspace_id = '00000000-0000-0000-0000-000000000000' -- the workspace id from step 0
  and not exists (
    select 1 from profiles t
    where t.workspace_id = '00000000-0000-0000-0000-000000000000' and t.role = 'teacher'
  );
