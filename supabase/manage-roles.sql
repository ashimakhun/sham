-- Run these in the Supabase SQL Editor (it runs as admin, so row-level security does not block it).
-- Everyone who signs up in the app starts as a student. Mentorship comes from courses (ARU-7/ARU-14): a student's
-- mentors are the owners of the courses they were added to, so there is no per-student mentor to set here.
-- Switching users between student and mentor is done in the app: Profile -> Manage roles (teacher only, ARU-13).

-- 1. See everyone and their current role.
select p.full_name, u.email, p.role
from profiles p
join auth.users u on u.id = p.id
order by p.role, p.full_name;

-- 2. One-time setup: make the first teacher (use the email they signed up with).
--    There is exactly one teacher. This only works while there is no teacher yet; once a teacher exists the
--    database rejects any change to or from 'teacher' (supabase/migrations/0009_roles_screen.sql).
update profiles set role = 'teacher' where id = (select id from auth.users where email = 'teacher@example.com');
