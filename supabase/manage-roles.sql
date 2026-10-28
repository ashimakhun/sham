-- Run these in the Supabase SQL Editor (it runs as admin, so row-level security does not block it).
-- Everyone who signs up in the app starts as a student. Mentorship comes from courses (ARU-7/ARU-14): a student's
-- mentors are the owners of the courses they were added to, so there is no per-student mentor to set here.

-- 1. See everyone and their current role.
select p.full_name, u.email, p.role
from profiles p
join auth.users u on u.id = p.id
order by p.role, p.full_name;

-- 2. Make someone a teacher (there is only one) or a mentor (use the email they signed up with).
update profiles set role = 'teacher' where id = (select id from auth.users where email = 'teacher@example.com');
update profiles set role = 'mentor' where id = (select id from auth.users where email = 'mentor@example.com');
