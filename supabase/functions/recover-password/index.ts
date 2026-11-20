// ARU-165: Forgot password with username + recovery code (called signed out). The logic and the order of the steps are
// in ../_shared/recovery.ts (tested with Jest); this file only wires it to Supabase.
//
// No secrets to set: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase.
// Needs migration 0073_recovery_codes.sql (recovery_check, recovery_finish).
//
// Deploy without JWT verification (callers are signed out; the lock and the code are checked in the database):
//   npx supabase functions deploy recover-password --no-verify-jwt

import { createClient } from 'npm:@supabase/supabase-js@2';

import { handleRecoverPasswordRequest } from '../_shared/recovery.ts';

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

Deno.serve((request) =>
  handleRecoverPasswordRequest(request, {
    async check(username, code) {
      const { data, error } = await admin.rpc('recovery_check', { username, code });
      if (error) throw new Error(error.message);
      const row = ((data ?? []) as { result: string; user_id: string | null }[])[0];
      if (row?.result === 'ok' && row.user_id) return { result: 'ok', userId: row.user_id };
      return { result: row?.result === 'locked' ? 'locked' : 'wrong' };
    },
    async setPassword(userId, password) {
      const { error } = await admin.auth.admin.updateUserById(userId, { password });
      if (!error) return 'ok';
      if (error.code === 'weak_password' || (error.status === 422 && /password/i.test(error.message))) {
        return { weak: error.message };
      }
      throw new Error(error.message);
    },
    async finish(userId) {
      const { error } = await admin.rpc('recovery_finish', { account: userId });
      if (error) throw new Error(error.message);
    },
    log: (line) => console.log(line),
  }),
);
