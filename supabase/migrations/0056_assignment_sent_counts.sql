-- ARU-130: "Homework sent: x of y" on completed meeting tiles. For each homework assignment of the given courses, how
-- many current listeners have sent homework for it (checked or not, each once) and how many current listeners the
-- course has. Counts only: no user ids, names or homework content, so a listener learns the number and nothing else.
-- Adds one read-only function and its grants. Changes no table, policy, publication or row.
-- Needs my_role() / is_member() (0021: they already exclude accounts waiting for approval) and
-- course_hidden_from_me() (0019).

create function assignment_sent_counts(courses uuid[])
  returns table (assignment_id uuid, sent int, listeners int)
  language sql stable security definer set search_path = public
  as $$
    -- security definer reads every course's homework, so the access rule is checked here (AC 4): the caller must be
    -- able to see the course's meetings (teacher and mentors, or a member) and the course must not be hidden from
    -- them. Disallowed courses just give no rows; there is no error.
    select
      a.id,
      -- AC 2: current listeners who sent homework for the assignment; former listeners' homework doesn't count.
      (select count(distinct h.student_id)::int
         from homework h
         join course_members m on m.course_id = a.course_id and m.user_id = h.student_id
        where h.assignment_id = a.id),
      (select count(*)::int from course_members m where m.course_id = a.course_id)
    from homework_assignments a
    where a.course_id = any (courses)
      and (my_role() in ('teacher', 'mentor') or is_member(a.course_id))
      and not course_hidden_from_me(a.course_id)
  $$;

revoke execute on function assignment_sent_counts(uuid[]) from public, anon;
grant execute on function assignment_sent_counts(uuid[]) to authenticated;
