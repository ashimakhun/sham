// ARU-75: a student or mentor (or a waiting / declined account) deletes their own account. The app calls this with the
// user's access token and {"password": "..."}; only the token's user is ever deleted. The logic and the order of the
// steps are in ../_shared/delete-account.ts (tested with Jest); this file only wires it to Supabase.
//
// No secrets to set: SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase.
// Needs migration 0040_delete_account.sql (account_deletion_problem, account_storage_objects).
// ARU-180: the teacher deletes their account and workspace through this function too (with "workspace_name"); needs
// migrations 0077 / 0078 (workspace_deletion_target, workspace_storage_objects, delete_workspace).
//
// Deploy (keep JWT verification on: only signed-in users may call it):
//   npx supabase functions deploy delete-account

import { createClient } from 'npm:@supabase/supabase-js@2';

import { handleDeleteAccountRequest, type StorageObject, type WorkspaceTarget } from '../_shared/delete-account.ts';

const url = Deno.env.get('SUPABASE_URL')!;
const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

Deno.serve((request) =>
  handleDeleteAccountRequest(request, {
    async userFromToken(jwt) {
      const { data, error } = await admin.auth.getUser(jwt);
      if (error) {
        // A bad, expired or orphaned token (the user is gone): not signed in. Anything else is a real failure.
        if (error.status && error.status < 500) return null;
        throw new Error(error.message);
      }
      return data.user ? { id: data.user.id, email: data.user.email ?? null } : null;
    },
    async checkPassword(email, password) {
      // A separate client per request, never persisted: the session it creates is deleted with the user.
      const client = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { error } = await client.auth.signInWithPassword({ email, password });
      if (!error) return 'ok';
      if (error.status === 429) return 'rate_limited';
      if (error.status === 400 || error.code === 'invalid_credentials') return 'wrong';
      throw new Error(error.message);
    },
    async problem(userId) {
      const { data, error } = await admin.rpc('account_deletion_problem', { target: userId });
      if (error) throw new Error(error.message);
      return (data as string | null) ?? null;
    },
    async storageObjects(userId) {
      const { data, error } = await admin.rpc('account_storage_objects', { target: userId });
      if (error) throw new Error(error.message);
      return (data ?? []) as StorageObject[];
    },
    async removeObjects(bucket, names) {
      const { error } = await admin.storage.from(bucket).remove(names);
      if (error) throw new Error(error.message);
    },
    async deleteUser(userId) {
      const { error } = await admin.auth.admin.deleteUser(userId);
      if (error) throw new Error(error.message);
    },
    async workspaceTarget(userId): Promise<WorkspaceTarget | null> {
      const { data, error } = await admin.rpc('workspace_deletion_target', { target: userId });
      if (error) throw new Error(error.message);
      const row = ((data ?? []) as { workspace_id: string; workspace_name: string; other_accounts: number }[])[0];
      return row ? { workspaceId: row.workspace_id, name: row.workspace_name, otherAccounts: row.other_accounts } : null;
    },
    async workspaceStorageObjects(workspaceId) {
      const { data, error } = await admin.rpc('workspace_storage_objects', { workspace: workspaceId });
      if (error) throw new Error(error.message);
      return (data ?? []) as StorageObject[];
    },
    async deleteWorkspace(teacherId) {
      // One call, one transaction (never auth.admin.deleteUser() for the teacher, AC 11).
      const { error } = await admin.rpc('delete_workspace', { teacher: teacherId });
      if (error) throw new Error(error.message);
    },
    log: (line) => console.log(line),
  }),
);
