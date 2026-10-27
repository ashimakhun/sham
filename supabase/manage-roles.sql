-- Run these in the Supabase SQL Editor (it runs as admin, so row-level security does not block it).
-- Everyone who signs up in the app starts as a student.

-- 1. See everyone and their current role.
select p.full_name, u.email, p.role, m.full_name as mentor
from profiles p
join auth.users u on u.id = p.id
left join profiles m on m.id = p.mentor_id
order by p.role, p.full_name;

-- 2. Make someone a teacher or mentor (use the email they signed up with).
update profiles set role = 'teacher' where id = (select id from auth.users where email = 'teacher@example.com');
update profiles set role = 'mentor', mentor_id = null where id = (select id from auth.users where email = 'mentor@example.com');

-- 3. Assign a student to a mentor.
update profiles
set mentor_id = (select id from auth.users where email = 'mentor@example.com')
where id = (select id from auth.users where email = 'student@example.com');
