// QA ARU-99: store gaps in aru99-store-payment-requests.test.tsx: a request sent from another device (or a double
// tap) between the check and the insert (23505) is replaced instead of failing, and its old proof is deleted; a
// failing delete of the old proof after a successful replace doesn't fail the send; an empty file is refused before
// any upload.
import { act, render } from '@testing-library/react-native';
import { Text } from 'react-native';

import { StoreProvider, useStore } from '@/lib/store';

type Res = { data: unknown; error: null | { message: string; code?: string } };
const mockState = {
  me: { id: 'S1', role: 'student' },
  calls: [] as string[],
  existing: [] as unknown[],
  // QA: what the next reads of course_payment_requests return (falls back to `existing`).
  reads: [] as unknown[][],
  insert: { data: null, error: null } as Res,
  update: { data: [{ id: 'r1' }], error: null } as Res,
  upload: { data: {}, error: null } as Res,
  proofs: [] as Res[],
  removeErr: null as null | { message: string },
};

jest.mock('@/lib/id', () => ({ newId: () => 'NEW' }));

jest.mock('@/lib/supabase', () => {
  const ok = (data: unknown) => Promise.resolve({ data, error: null });
  const query = (table: string): unknown => {
    let op = 'select';
    let payload: unknown = null;
    const q: Record<string, unknown> = {};
    for (const m of ['select', 'order', 'limit', 'lt', 'or', 'in', 'eq', 'delete']) q[m] = () => q;
    q.insert = (p: unknown) => {
      op = 'insert';
      payload = p;
      return q;
    };
    q.update = (p: unknown) => {
      op = 'update';
      payload = p;
      return q;
    };
    q.then = (resolve: (v: unknown) => unknown) => {
      if (table === 'profiles') {
        return resolve({
          data: [{ id: mockState.me.id, full_name: 'Me', role: mockState.me.role, access_status: 'approved' }],
          error: null,
        });
      }
      if (table === 'course_payment_requests') {
        if (op === 'insert') {
          mockState.calls.push(`insert ${JSON.stringify(payload)}`);
          return resolve(mockState.insert);
        }
        if (op === 'update') {
          mockState.calls.push(`update ${JSON.stringify(payload)}`);
          return resolve(mockState.update);
        }
        return resolve({ data: mockState.reads.length ? mockState.reads.shift() : mockState.existing, error: null });
      }
      return resolve({ data: [], error: null });
    };
    return q;
  };
  const c: Record<string, unknown> = {};
  c.on = () => c;
  c.subscribe = () => c;
  return {
    supabase: {
      auth: {
        getSession: () => ok({ session: { user: { id: mockState.me.id } } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      },
      from: (table: string) => query(table),
      rpc: (name: string, args: Record<string, unknown>) => {
        if (name === 'course_payment_proofs' || name === 'discipline_payment_proofs') {
          mockState.calls.push(`proofs ${args.course ?? args.discipline}`);
          const next = mockState.proofs.length > 1 ? mockState.proofs.shift()! : mockState.proofs[0];
          return Promise.resolve(next ?? { data: [], error: null });
        }
        if (name === 'delete_course' || name === 'delete_discipline') {
          mockState.calls.push(`${name} ${args.course ?? args.discipline}`);
        }
        return ok([]);
      },
      channel: () => c,
      removeChannel: () => {},
      storage: {
        from: (bucket: string) => ({
          createSignedUrls: () => ok([]),
          upload: (path: string, _f: unknown, o: { contentType: string }) => {
            mockState.calls.push(`upload ${bucket} ${path} ${o.contentType}`);
            return Promise.resolve(mockState.upload);
          },
          remove: (paths: string[]) => {
            mockState.calls.push(`remove ${bucket} ${paths.join(',')}`);
            return Promise.resolve({ data: [], error: mockState.removeErr });
          },
        }),
      },
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

const photo = { uri: 'file:///p.jpg', kind: 'image' as const, mimeType: 'image/jpeg', size: 1000 };
const pdf = { uri: 'file:///p.pdf', kind: 'pdf' as const, name: 'receipt.pdf', mimeType: 'application/pdf', size: 1000 };
const proofs = (...paths: string[]): Res => ({ data: paths.map((proof_path) => ({ proof_path })), error: null });
const row = { id: 'r1', course_id: 'A', user_id: 'S1', month: '2026-11-01', proof_path: 'S1/OLD.jpg', proof_type: 'image', sent_at: 'x' };

beforeEach(() => {
  mockState.me = { id: 'S1', role: 'student' };
  mockState.calls = [];
  mockState.existing = [];
  mockState.reads = [];
  mockState.insert = { data: null, error: null };
  mockState.update = { data: [{ id: 'r1' }], error: null };
  mockState.upload = { data: {}, error: null };
  mockState.proofs = [];
  mockState.removeErr = null;
  globalThis.fetch = jest.fn(async () => ({ arrayBuffer: async () => new ArrayBuffer(1000) })) as unknown as typeof fetch;
});

describe('sendPaymentRequest (QA)', () => {
  it('edge: 23505 (sent meanwhile from another device): replaces that request and deletes its proof', async () => {
    await mount();
    // findMine() before the insert finds nothing; after the 23505 it finds the other device's row.
    mockState.reads = [[], [{ ...row, proof_path: 'S1/OTHER.jpg' }]];
    mockState.insert = { data: null, error: { message: 'duplicate key', code: '23505' } };
    mockState.calls = [];
    await act(() => store.sendPaymentRequest('A', '2026-11-01', photo));
    expect(mockState.calls).toEqual([
      'upload payment-proofs S1/NEW.jpg image/jpeg',
      'insert {"course_id":"A","month":"2026-11-01","proof_path":"S1/NEW.jpg","proof_type":"image"}',
      'update {"proof_path":"S1/NEW.jpg","proof_type":"image"}',
      'remove payment-proofs S1/OTHER.jpg',
    ]);
  });

  it('edge: deleting the old proof fails after the replace: the send still succeeds', async () => {
    mockState.existing = [row];
    mockState.removeErr = { message: 'Network request failed' };
    await mount();
    await act(async () => {
      await expect(store.sendPaymentRequest('A', '2026-11-01', pdf)).resolves.toBeUndefined();
    });
    expect(mockState.calls).toContain('update {"proof_path":"S1/NEW.pdf","proof_type":"pdf"}');
  });

  it('AC 2: an empty file is refused before any upload', async () => {
    await mount();
    globalThis.fetch = jest.fn(async () => ({ arrayBuffer: async () => new ArrayBuffer(0) })) as unknown as typeof fetch;
    mockState.calls = [];
    await act(async () => {
      await expect(store.sendPaymentRequest('A', '2026-11-01', { ...photo, size: undefined })).rejects.toThrow(/10 MB/);
    });
    expect(mockState.calls.filter((c) => c.startsWith('upload'))).toEqual([]);
  });
});
