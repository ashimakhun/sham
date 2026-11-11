-- ARU-148: an unpaid course stays highlighted after the payment period ends (overdue), until the listener is marked
-- Paid or Exempt, or the month ends. my_payment_dues(today) now also returns the caller's paid courses where `today`
-- is after the period's end day in the same month, with `overdue` true; rows within the period have `overdue` false.
-- `deadline` stays the period's end day in today's month for both. Everything else is unchanged from 0039: only the
-- caller's own rows, current listeners, exemptions and this month's Paid marks respected, nothing for unapproved
-- accounts or a null date, security definer, execute for authenticated only. The return columns change, so the
-- function is dropped and created again (nothing else in the migrations calls it). Changes and deletes no data.

drop function if exists my_payment_dues(date);

create function my_payment_dues(today date)
  returns table (course_id uuid, deadline date, overdue boolean)
  language sql stable security definer set search_path = public
  as $$
    select b.course_id,
           (date_trunc('month', today)::date + (b.end_day - 1))::date,
           extract(day from today) > b.end_day
    from course_billing b
    join course_members m on m.course_id = b.course_id and m.user_id = auth.uid()
    where today is not null
      and is_approved()
      -- From the period's first day to the end of the month (a new month starts fresh on the 1st).
      and extract(day from today) >= b.start_day
      and not exists (
        select 1 from course_payment_exemptions e where e.course_id = b.course_id and e.user_id = auth.uid())
      and not exists (
        select 1 from course_payments p
        where p.course_id = b.course_id and p.user_id = auth.uid() and p.month = date_trunc('month', today)::date)
    order by 2, 1
  $$;
revoke execute on function my_payment_dues(date) from public, anon;
grant execute on function my_payment_dues(date) to authenticated;
