-- ARU-99: payment requests. A listener of a paid course (0032) sends one proof of payment (a photo or a PDF) per
-- course and month; accountants and the teacher see it under the listener's name on the course's payments page and
-- mark Paid as before (0039). Run after 0046. Adds a table, a private Storage bucket, policies and three functions,
-- and replaces account_storage_objects() (0040) to also cover the new bucket. Deletes no existing data.
--
-- "Waiting" (shown to accountants) is decided by the app: a request for the current device-local month from a
-- current listener who has no Paid mark and isn't Exempt. The server doesn't check the payment period or the paid
-- state: a request from a listener who is already Paid is simply not shown.
--
-- Send again replaces the proof: the app uploads a new file (a new file id every time, so nothing is overwritten:
-- no upsert and no Storage update policy), updates the row's proof_path / proof_type (sent_at is reset here), then
-- deletes the old file. If that last delete fails, the row is still right; the orphan is the listener's own file
-- and goes with their account (account_storage_objects()).

-- One request per listener, course and month (the first day of the listener's device-local month).
create table course_payment_requests (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references courses (id) on delete cascade,
  user_id uuid not null default auth.uid() references profiles (id) on delete cascade,
  month date not null check (extract(day from month) = 1),
  proof_path text not null unique,
  proof_type text not null check (proof_type in ('image', 'pdf')),
  sent_at timestamptz not null default now(),
  unique (course_id, user_id, month)
);
create index course_payment_requests_user_idx on course_payment_requests (user_id);

-- Send again: the server sets the time, so it can't be chosen by the client.
create function payment_request_touch() returns trigger
  language plpgsql set search_path = public
  as $$
begin
  new.sent_at := now();
  return new;
end $$;
create trigger payment_request_touch before update on course_payment_requests
  for each row execute function payment_request_touch();

-- True when the caller may send (or replace) a request for `course`: an approved current listener of a paid course.
create function can_send_payment_request(course uuid) returns boolean
  language sql stable security definer set search_path = public
  as $$
    select is_approved()
      and exists (select 1 from course_billing b where b.course_id = course)
      and exists (select 1 from course_members m where m.course_id = course and m.user_id = auth.uid())
  $$;
revoke execute on function can_send_payment_request(uuid) from public, anon;
grant execute on function can_send_payment_request(uuid) to authenticated;

alter table course_payment_requests enable row level security;

-- The listener reads their own requests; accountants and the teacher read those of current listeners of paid
-- courses (can_manage_payment(), 0039), so a removed listener's request or an unselected course's is kept but hidden.
create policy "payment requests readable by their sender" on course_payment_requests for select to authenticated
  using (user_id = auth.uid());
create policy "payment requests readable by accountants and the teacher" on course_payment_requests for select
  to authenticated using (can_manage_payment(course_id, user_id));
-- Only the listener creates and replaces their request, with a proof in their own folder of "payment-proofs".
create policy "listeners send payment requests" on course_payment_requests for insert to authenticated
  with check (
    user_id = auth.uid()
    and can_send_payment_request(course_id)
    and (storage.foldername(proof_path))[1] = auth.uid()::text
  );
create policy "listeners replace their payment requests" on course_payment_requests for update to authenticated
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and can_send_payment_request(course_id)
    and (storage.foldername(proof_path))[1] = auth.uid()::text
  );
create policy "listeners delete their payment requests" on course_payment_requests for delete to authenticated
  using (user_id = auth.uid());

-- Hidden courses (ARU-40): as in 0019 and 0039, only participants and the teacher.
create policy "hidden courses: payment requests readable by participants and the teacher" on course_payment_requests
  as restrictive for select to authenticated using (not course_hidden_from_me(course_id));
create policy "hidden courses: payment requests sent by participants" on course_payment_requests
  as restrictive for insert to authenticated with check (not course_hidden_from_me(course_id));
create policy "hidden courses: payment requests replaced by participants" on course_payment_requests
  as restrictive for update to authenticated using (not course_hidden_from_me(course_id))
  with check (not course_hidden_from_me(course_id));
create policy "hidden courses: payment requests deleted by participants" on course_payment_requests
  as restrictive for delete to authenticated using (not course_hidden_from_me(course_id));

-- user_id comes from auth.uid() and never changes; a replace only changes the proof (sent_at: the trigger above).
revoke all on course_payment_requests from anon;
revoke insert, update on course_payment_requests from authenticated;
grant select, delete on course_payment_requests to authenticated;
grant insert (course_id, month, proof_path, proof_type) on course_payment_requests to authenticated;
grant update (proof_path, proof_type) on course_payment_requests to authenticated;

-- Live updates for the accountants' and the teacher's screens (realtime applies the policies above).
alter publication supabase_realtime add table course_payment_requests;

-- Storage: private bucket, photos (the app sends JPEG) and PDFs up to 10 MB. Path "<user id>/<file id>.<ext>".
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('payment-proofs', 'payment-proofs', false, 10485760, array['image/jpeg', 'image/png', 'application/pdf']);

-- True when the caller may read the proof `object_name` as an accountant or the teacher: it is the proof of a
-- request they may see (looked up by proof_path, not by folder name).
create function can_read_payment_proof(object_name text) returns boolean
  language sql stable security definer set search_path = public
  as $$
    select exists (
      select 1 from course_payment_requests r
      where r.proof_path = object_name
        and can_manage_payment(r.course_id, r.user_id)
        and not course_hidden_from_me(r.course_id)
    )
  $$;
revoke execute on function can_read_payment_proof(text) from public, anon;
grant execute on function can_read_payment_proof(text) to authenticated;

create policy "payment proofs uploaded to your own folder" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'payment-proofs' and (storage.foldername(name))[1] = auth.uid()::text and is_approved()
  );
create policy "payment proofs readable in your own folder" on storage.objects for select to authenticated
  using (bucket_id = 'payment-proofs' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "payment proofs deleted from your own folder" on storage.objects for delete to authenticated
  using (bucket_id = 'payment-proofs' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "payment proofs readable by accountants and the teacher" on storage.objects for select
  to authenticated using (bucket_id = 'payment-proofs' and can_read_payment_proof(name));
-- As for homework photos (0041): the teacher reads and deletes every proof, so deleting a course or a discipline
-- removes proofs in other users' folders, including removed listeners' ones. Storage deletes also need SELECT.
create policy "teacher reads every payment proof" on storage.objects for select to authenticated
  using (bucket_id = 'payment-proofs' and my_role() = 'teacher');
create policy "teacher deletes every payment proof" on storage.objects for delete to authenticated
  using (bucket_id = 'payment-proofs' and my_role() = 'teacher');

-- Deleting a course or a discipline (ARU-85 / ARU-83). The app (src/lib/store.tsx, deleteWithStorageFiles) now:
--   1. lists the homework photos (0041 / 0042) and the payment proofs (below) still in Storage;
--   2. removes them through the Storage API, then lists again and stops with an error if any is left (remove()
--      silently skips objects RLS hides);
--   3. calls delete_course() / delete_discipline(); the request rows go with the course (on delete cascade).
-- "Course not found." / "Discipline not found." (P0002) on a retry means it is already deleted: done.

-- The proofs of every request of the course (any month, current or removed listeners) still in "payment-proofs".
-- Teacher only (42501); an unknown course raises "Course not found." (P0002).
create function course_payment_proofs(course uuid)
  returns table (proof_path text)
  language plpgsql stable security definer set search_path = public
  as $$
begin
  if my_role() is distinct from 'teacher' then
    raise exception 'Only the teacher can delete a course.' using errcode = '42501';
  end if;
  if not exists (select 1 from courses c where c.id = course) then
    raise exception 'Course not found.' using errcode = 'P0002';
  end if;
  return query
    select r.proof_path
    from course_payment_requests r
    where r.course_id = course
      and exists (select 1 from storage.objects o where o.bucket_id = 'payment-proofs' and o.name = r.proof_path);
end $$;

-- The proofs of every course in the discipline still in Storage. Teacher only (42501); an unknown discipline raises
-- "Discipline not found." (P0002).
create function discipline_payment_proofs(discipline uuid)
  returns table (proof_path text)
  language plpgsql stable security definer set search_path = public
  as $$
begin
  if my_role() is distinct from 'teacher' then
    raise exception 'Only the teacher can delete a discipline.' using errcode = '42501';
  end if;
  if not exists (select 1 from disciplines d where d.id = discipline) then
    raise exception 'Discipline not found.' using errcode = 'P0002';
  end if;
  return query
    select p.proof_path
    from courses c
    cross join lateral course_payment_proofs(c.id) p
    where c.discipline_id = discipline;
end $$;

revoke execute on function course_payment_proofs(uuid) from public, anon;
revoke execute on function discipline_payment_proofs(uuid) from public, anon;
grant execute on function course_payment_proofs(uuid) to authenticated;
grant execute on function discipline_payment_proofs(uuid) to authenticated;

-- Account deletion (ARU-75, 0040): a listener's requests cascade with their profile; their proofs are already
-- covered by the owner columns, and the folder clause now includes "payment-proofs" as a safety net.
create or replace function account_storage_objects(target uuid) returns table (bucket_id text, name text)
  language sql stable security definer set search_path = public
  as $$
    select o.bucket_id, o.name
    from storage.objects o
    where o.owner = target
       or (to_jsonb(o) ->> 'owner_id') = target::text
       or (o.bucket_id in ('homework', 'materials', 'payment-proofs') and (storage.foldername(o.name))[1] = target::text)
    order by o.bucket_id, o.name
  $$;
revoke execute on function account_storage_objects(uuid) from public, anon, authenticated;
grant execute on function account_storage_objects(uuid) to service_role;
