// ARU-165: Profile → Recovery code → Make a new code. The app calls this with the user's access token and
// {"password": "..."}; the password is checked here, on the server, and only the token's user gets a new code. The
// logic is in ../_shared/recovery.ts (tested with Jest); this file only wires it to Supabase.
//
// No secrets to set: SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase.
// Needs migration 0073_recovery_codes.sql (replace_recovery_code).
//
// Deploy (keep JWT verification on: only signed-in users may call it):
//   npx supabase functions deploy new-recovery-code

import { createClient } from 'npm:@supabase/supabase-js@2';

import { handleNewRecoveryCodeRequest } from '../_shared/recovery.ts';

const url = Deno.env.get('SUPABASE_URL')!;
const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

Deno.serve((request) =>
  handleNewRecoveryCodeRequest(request, {
    async userFromToken(jwt) {
      const { data, error } = await admin.auth.getUser(jwt);
      if (error) {
        if (error.status && error.status < 500) return null;
        throw new Error(error.message);
      }
      return data.user ? { id: data.user.id, email: data.user.email ?? null } : null;
    },
    async checkPassword(email, password) {
      // A separate client per request, never persisted. Its own session is ended right away (scope 'local': only
      // this throwaway session, never the user's other devices), so the check leaves no extra session behind.
      const client = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { error } = await client.auth.signInWithPassword({ email, password });
      if (!error) {
        await client.auth.signOut({ scope: 'local' }).catch(() => {});
        return 'ok';
      }
      if (error.status === 429) return 'rate_limited';
      if (error.status === 400 || error.code === 'invalid_credentials') return 'wrong';
      throw new Error(error.message);
    },
    async replaceCode(userId) {
      const { data, error } = await admin.rpc('replace_recovery_code', { account: userId });
      if (error) throw new Error(error.message);
      return data as string;
    },
    log: (line) => console.log(line),
  }),
);
