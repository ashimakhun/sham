// ARU-159: the real StoreProvider. needsLegalAgreement from the own latest legal_agreements row (AC 8, AC 10; offline
// never blocks), agreeToTerms() through agree_to_terms() (AC 9), and the version sent with a sign-up (AC 5).
import { act, render } from '@testing-library/react-native';
import { Text } from 'react-native';

import { LEGAL_VERSION } from '@/lib/legal';
import { StoreProvider, useStore } from '@/lib/store';

const mock = {
  agreements: [] as { version: number }[] | 'error',
  agreementQueries: [] as string[][],
  rpc: jest.fn(),
  signUps: [] as unknown[],
};

jest.mock('@/lib/supabase', () => {
  const ok = (data: unknown) => Promise.resolve({ data, error: null });
  const query = (table: string): unknown => {
    const calls: string[] = [];
    const q: Record<string, unknown> = {};
    for (const m of ['select', 'order', 'insert', 'delete', 'limit', 'lt', 'or', 'in', 'eq', 'update'])
      q[m] = (...a: unknown[]) => {
        calls.push(`${m}(${a.map((x) => JSON.stringify(x)).join(',')})`);
        return q;
      };
    if (table === 'legal_agreements') mock.agreementQueries.push(calls);
    q.then = (resolve: (v: unknown) => unknown) =>
      resolve(
        table === 'profiles'
          ? { data: [{ id: 'S1', full_name: 'Student Sam', role: 'student', access_status: 'approved' }], error: null }
          : table === 'usernames'
            ? { data: [{ username: 'sam' }], error: null }
            : table === 'legal_agreements'
              ? mock.agreements === 'error'
                ? { data: null, error: { message: 'Failed to fetch' } }
                : { data: mock.agreements, error: null }
              : { data: [], error: null },
      );
    return q;
  };
  const c: Record<string, unknown> = {};
  c.on = () => c;
  c.subscribe = () => c;
  return {
    supabase: {
      auth: {
        getSession: () => ok({ session: { user: { id: 'S1', email: 'sam@users.sham.invalid' } } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
        getUser: () => ok({ user: { id: 'S1' } }),
        signUp: (args: unknown) => {
          mock.signUps.push(args);
          return Promise.resolve({ data: { user: { id: 'U', identities: [{}] } }, error: null });
        },
      },
      from: (table: string) => query(table),
      rpc: (name: string, args: unknown) => {
        if (name === 'my_recovery_code_saved') return ok(true);
        if (name === 'agree_to_terms') return mock.rpc(name, args);
        return ok([]);
      },
      functions: { invoke: () => ok({}) },
      channel: () => c,
      removeChannel: () => {},
      storage: { from: () => ({ createSignedUrls: () => ok([]) }) },
    },
  };
});

let store: ReturnType<typeof useStore>;
function Probe() {
  store = useStore();
  return <Text>{store.currentUser?.name}</Text>;
}
async function mount() {
  await render(
    <StoreProvider>
      <Probe />
    </StoreProvider>,
  );
  await act(async () => {});
  await act(async () => {});
}

beforeEach(() => {
  mock.agreements = [];
  mock.agreementQueries = [];
  mock.signUps = [];
  mock.rpc.mockReset().mockResolvedValue({ data: null, error: null });
});

describe('AC 8 / AC 10: needsLegalAgreement', () => {
  it('an account with no agreement (every account before this change) is asked', async () => {
    await mount();
    expect(store.currentUser?.id).toBe('S1');
    expect(store.needsLegalAgreement).toBe(true);
    // Only the latest version is loaded.
    expect(mock.agreementQueries[0]).toEqual(['select("version")', 'order("version",{"ascending":false})', 'limit(1)']);
  });
  it('an older version is asked', async () => {
    mock.agreements = [{ version: LEGAL_VERSION - 1 }];
    await mount();
    expect(store.needsLegalAgreement).toBe(true);
  });
  it('the current version is not asked', async () => {
    mock.agreements = [{ version: LEGAL_VERSION }];
    await mount();
    expect(store.needsLegalAgreement).toBe(false);
  });
  it('offline at start (the request fails): not blocked', async () => {
    mock.agreements = 'error';
    await mount();
    expect(store.needsLegalAgreement).toBe(false);
  });
});

describe('AC 9: agreeToTerms', () => {
  it('saves the current version through agree_to_terms and stops asking', async () => {
    await mount();
    expect(store.needsLegalAgreement).toBe(true);
    await act(() => store.agreeToTerms());
    expect(mock.rpc).toHaveBeenCalledWith('agree_to_terms', { version: LEGAL_VERSION });
    expect(store.needsLegalAgreement).toBe(false);
  });
  it('offline: a network error, and the screen stays', async () => {
    mock.rpc.mockRejectedValue(new TypeError('Network request failed'));
    await mount();
    await expect(act(() => store.agreeToTerms())).rejects.toThrow();
    expect(store.needsLegalAgreement).toBe(true);
  });
  it('a database refusal: its message, and the screen stays', async () => {
    mock.rpc.mockResolvedValue({
      data: null,
      error: { message: 'Update the app to agree to the terms.', code: '22023', hint: 'sham:terms_version_invalid' },
    });
    await mount();
    await expect(act(() => store.agreeToTerms())).rejects.toThrow('Update the app to agree to the terms.');
    expect(store.needsLegalAgreement).toBe(true);
  });
});

it('AC 5: a sign-up sends the current version with the user data', async () => {
  await mount();
  await act(() => store.signUp('Dana', 'dana_s', 'secret1', { kind: 'create', name: 'School' }));
  expect(mock.signUps).toEqual([
    {
      email: 'dana_s@users.sham.invalid',
      password: 'secret1',
      options: { data: { username: 'dana_s', full_name: 'Dana', workspace_name: 'School', terms_version: LEGAL_VERSION } },
    },
  ]);
});
