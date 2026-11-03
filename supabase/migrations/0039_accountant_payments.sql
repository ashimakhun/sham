-- ARU-66: Accountant payments. Accountants and the teacher mark which listeners of a paid course (0032) paid each
-- month and which are exempt; a listener learns only their own due courses through my_payment_dues(). Adds two
-- tables and two functions; deletes nothing and changes no existing data. Run after 0032 (and 0038).
--
-- "Today" and the month always come from the device's local date: the app sends the month of a mark and the date
-- given to my_payment_dues(); nothing here uses the server's now() for that.

-- One row per listener, course and month (the first day of the month). Undo deletes the row.
create table course_payments (
  course_id uuid not null references courses (id) on delete cascade,
  user_id uuid not null references profiles (id),
  month date not null check (extract(day from month) = 1),
  marked_by uuid not null default auth.uid() references profiles (id),
  marked_at timestamptz not null default now(),
  primary key (course_id, user_id, month)
);
create index course_payments_user_idx on course_payments (user_id);

-- Exempt lasts until cleared (clearing deletes the row). A Paid mark and an exemption can both exist; the app then
-- shows Exempt.
create table course_payment_exemptions (
  course_id uuid not null references courses (id) on delete cascade,
  user_id uuid not null references profiles (id),
  set_by uuid not null default auth.uid() references profiles (id),
  set_at timestamptz not null default now(),
  primary key (course_id, user_id)
);
create index course_payment_exemptions_user_idx on course_payment_exemptions (user_id);

-- True when the caller (an approved accountant, or the teacher) may see and change marks of `member` in `course`:
-- the course is a paid course and `member` is one of its current listeners. Rows of removed listeners and of
-- unselected courses are kept but not shown, and they come back when the listener or the course comes back.
-- my_role() and is_accountant() are null / false for unapproved accounts (0021, 0032).
create function can_manage_payment(course uuid, member uuid) returns boolean
  language sql stable security definer set search_path = public
  as $$
    select (is_accountant() or coalesce(my_role() = 'teacher', false))
      and exists (select 1 from course_billing b where b.course_id = course)
      and exists (select 1 from course_members m where m.course_id = course and m.user_id = member)
  $$;
revoke execute on function can_manage_payment(uuid, uuid) from public, anon;
grant execute on function can_manage_payment(uuid, uuid) to authenticated;

alter table course_payments enable row level security;
alter table course_payment_exemptions enable row level security;

create policy "payments readable by accountants and the teacher" on course_payments for select to authenticated
  using (can_manage_payment(course_id, user_id));
create policy "accountants and the teacher mark paid" on course_payments for insert to authenticated
  with check (can_manage_payment(course_id, user_id) and marked_by = auth.uid());
create policy "accountants and the teacher undo paid" on course_payments for delete to authenticated
  using (can_manage_payment(course_id, user_id));

create policy "exemptions readable by accountants and the teacher" on course_payment_exemptions for select
  to authenticated using (can_manage_payment(course_id, user_id));
create policy "accountants and the teacher set exempt" on course_payment_exemptions for insert to authenticated
  with check (can_manage_payment(course_id, user_id) and set_by = auth.uid());
create policy "accountants and the teacher clear exempt" on course_payment_exemptions for delete to authenticated
  using (can_manage_payment(course_id, user_id));

-- Hidden courses (ARU-40): as in 0019 and 0032, only participants and the teacher.
create policy "hidden courses: payments readable by participants and the teacher" on course_payments as restrictive
  for select to authenticated using (not course_hidden_from_me(course_id));
create policy "hidden courses: payments marked by participants and the teacher" on course_payments as restrictive
  for insert to authenticated with check (not course_hidden_from_me(course_id));
create policy "hidden courses: payments undone by participants and the teacher" on course_payments as restrictive
  for delete to authenticated using (not course_hidden_from_me(course_id));
create policy "hidden courses: exemptions readable by participants and the teacher" on course_payment_exemptions
  as restrictive for select to authenticated using (not course_hidden_from_me(course_id));
create policy "hidden courses: exemptions set by participants and the teacher" on course_payment_exemptions
  as restrictive for insert to authenticated with check (not course_hidden_from_me(course_id));
create policy "hidden courses: exemptions cleared by participants and the teacher" on course_payment_exemptions
  as restrictive for delete to authenticated using (not course_hidden_from_me(course_id));

-- Rows are never edited, only added and deleted; who and when are set by the server.
revoke all on course_payments, course_payment_exemptions from anon;
revoke insert, update on course_payments, course_payment_exemptions from authenticated;
grant select, delete on course_payments, course_payment_exemptions to authenticated;
grant insert (course_id, user_id, month) on course_payments to authenticated;
grant insert (course_id, user_id) on course_payment_exemptions to authenticated;

-- The caller's own due courses for the month of `today` (the device's local date): paid courses where the caller is
-- a current listener, isn't exempt, has no Paid mark for that month, and `today` is within the payment period. The
-- deadline is the period's end day in that month. Nothing for unapproved accounts or a null date. Listeners never
-- read the two tables themselves.
create function my_payment_dues(today date) returns table (course_id uuid, deadline date)
  language sql stable security definer set search_path = public
  as $$
    select b.course_id, (date_trunc('month', today)::date + (b.end_day - 1))::date
    from course_billing b
    join course_members m on m.course_id = b.course_id and m.user_id = auth.uid()
    where today is not null
      and is_approved()
      and extract(day from today) between b.start_day and b.end_day
      and not exists (
        select 1 from course_payment_exemptions e where e.course_id = b.course_id and e.user_id = auth.uid())
      and not exists (
        select 1 from course_payments p
        where p.course_id = b.course_id and p.user_id = auth.uid() and p.month = date_trunc('month', today)::date)
    order by 2, 1
  $$;
revoke execute on function my_payment_dues(date) from public, anon;
grant execute on function my_payment_dues(date) to authenticated;

-- Live updates for the accountants' and the teacher's screens (realtime applies the policies above).
alter publication supabase_realtime add table course_payments;
alter publication supabase_realtime add table course_payment_exemptions;
