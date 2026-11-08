// ARU-107 (part a): "Download my photos". POST (the app, with the user's JWT) makes a one-time link valid for 60 s;
// GET ?token=… (the browser or system viewer) uses it once and returns the ZIP of the caller's own homework photos.
// The logic is in ../_shared/homework-photos-zip.ts (tested with Jest); this file only wires it to Supabase.
//
// No secrets to set: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase.
// Needs migration 0049_homework_photo_rule.sql (homework_photos_for_zip, claim_photo_zip_link, photo_zip_links).
//
// Deploy without JWT verification, because the GET link is opened without an auth header. The POST checks the user's
// token itself, and the GET accepts only a valid one-time token:
//   npx supabase functions deploy homework-photos-zip --no-verify-jwt

import { createClient } from 'npm:@supabase/supabase-js@2';
import { zipSync } from 'npm:fflate@0.8.2';

import { handlePhotoZipRequest, type ZipPhoto } from '../_shared/homework-photos-zip.ts';

const url = Deno.env.get('SUPABASE_URL')!;
const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const toHex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');

Deno.serve((request) =>
  handlePhotoZipRequest(request, {
    async userFromToken(jwt) {
      const { data, error } = await admin.auth.getUser(jwt);
      if (error) {
        if (error.status && error.status < 500) return null;
        throw new Error(error.message);
      }
      return data.user ? { id: data.user.id } : null;
    },
    async photosFor(userId) {
      const { data, error } = await admin.rpc('homework_photos_for_zip', { target: userId });
      if (error) throw new Error(error.message);
      return (data ?? []) as ZipPhoto[];
    },
    async saveLink({ tokenHash, userId, homeworkIds, expiresAt }) {
      // Old links are useless after a minute: clear yesterday's on the way.
      await admin.from('photo_zip_links').delete().lt('expires_at', new Date(Date.now() - 86_400_000).toISOString());
      const { error } = await admin
        .from('photo_zip_links')
        .insert({ token_hash: tokenHash, user_id: userId, homework_ids: homeworkIds, expires_at: expiresAt });
      if (error) throw new Error(error.message);
    },
    async claimLink(tokenHash) {
      const { data, error } = await admin.rpc('claim_photo_zip_link', { hash: tokenHash });
      if (error) throw new Error(error.message);
      const row = (data as { user_id: string; homework_ids: string[] }[] | null)?.[0];
      return row ? { userId: row.user_id, homeworkIds: row.homework_ids } : null;
    },
    async download(path) {
      const { data, error } = await admin.storage.from('homework').download(path);
      if (error) {
        if (/not found|404/i.test(error.message)) return null;
        throw new Error(error.message);
      }
      return new Uint8Array(await data.arrayBuffer());
    },
    // Level 0: the photos are JPEGs already; storing them keeps memory and time low.
    zip: (files) => zipSync(Object.fromEntries(files.map((f) => [f.name, [f.data, { level: 0 }]]))),
    newToken() {
      const bytes = crypto.getRandomValues(new Uint8Array(32));
      return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    },
    hash: async (token) => toHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))),
    functionUrl: `${url}/functions/v1/homework-photos-zip`,
    log: (line) => console.log(line),
  }),
);
