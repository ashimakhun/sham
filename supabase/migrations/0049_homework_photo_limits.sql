-- ARU-105: smaller homework photos. The app resizes and compresses photos before upload; this migration
--   * limits the "homework" bucket to JPEG files up to 10 MB (AC 7). Existing files are not touched (AC 9).
--   * lets a sender read and delete their OWN photo in their OWN folder while no homework row points to it (AC 10):
--     after a failed send the app removes the uploaded photo, and the next send removes any leftover first.
-- Adds one helper and two storage policies; changes no data. The "materials" (0018) and "payment-proofs" (0047)
-- buckets keep their limits (AC 8). The daily clean-up of leftover photos (AC 12) is part of ARU-107's job.
--
-- Access:
--   select / delete a "homework" object in your own folder   only while no homework row has photo_path = name
--   (a photo of saved homework, your own included, and anything in another user's folder stay as before)
-- The 0019 restrictive policies still apply; an orphan has no homework row, so they allow it.

update storage.buckets
  set file_size_limit = 10485760, allowed_mime_types = array['image/jpeg']
  where id = 'homework';

-- Whether any homework row points to this object. Security definer: under the caller's RLS a row they can't see
-- (for example in a hidden course) would make the photo look like an orphan.
create function homework_photo_in_use(object_name text) returns boolean
  language sql stable security definer set search_path = public
  as $$ select exists (select 1 from homework h where h.photo_path = object_name) $$;

revoke execute on function homework_photo_in_use(text) from public, anon;
grant execute on function homework_photo_in_use(text) to authenticated;

-- Storage deletes also need SELECT, so both commands get a policy. No update (upsert) policy.
create policy "senders read their own leftover homework photo" on storage.objects for select to authenticated
  using (
    bucket_id = 'homework'
    and (storage.foldername(name))[1] = auth.uid()::text
    and not homework_photo_in_use(name)
  );
create policy "senders delete their own leftover homework photo" on storage.objects for delete to authenticated
  using (
    bucket_id = 'homework'
    and (storage.foldername(name))[1] = auth.uid()::text
    and not homework_photo_in_use(name)
  );
