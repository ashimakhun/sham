// ARU-99: the store against a fake Supabase client. sendPaymentRequest(): upload under a new name, save the row
// (insert, or update when one was sent this month), then delete the old proof; a failed save removes the new file.
// deleteCourse() / deleteDiscipline(): payment proofs are removed (and checked) after the homework photos, before
// delete_course() / delete_discipline().
import { act, render } from '@testing-library/react-native';
import { Text } from 'react-native';

import { StoreProvider, useStore } from '@/lib/store';

type Res = { data: unknown; error: null | { message: string; code?: string } };
const mockState = {
  me: { id: 'S1', role: 'student' },
  calls: [] as string[],
  existing: [] as unknown[],
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
        return resolve({ data: mockState.existing, error: null });
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
  mockState.insert = { data: null, error: null };
  mockState.update = { data: [{ id: 'r1' }], error: null };
  mockState.upload = { data: {}, error: null };
  mockState.proofs = [];
  mockState.removeErr = null;
  globalThis.fetch = jest.fn(async () => ({ arrayBuffer: async () => new ArrayBuffer(1000) })) as unknown as typeof fetch;
});

describe('sendPaymentRequest', () => {
  it('AC 2: uploads a photo as JPEG under a new name in my folder, then saves the request', async () => {
    await mount();
    await act(() => store.sendPaymentRequest('A', '2026-11-01', photo));
    expect(mockState.calls).toEqual([
      'upload payment-proofs S1/NEW.jpg image/jpeg',
      'insert {"course_id":"A","month":"2026-11-01","proof_path":"S1/NEW.jpg","proof_type":"image"}',
    ]);
  });

  it('AC 3: Send again updates this month\'s request to the new PDF, then deletes the old proof', async () => {
    mockState.existing = [row];
    await mount();
    await act(() => store.sendPaymentRequest('A', '2026-11-01', pdf));
    expect(mockState.calls).toEqual([
      'upload payment-proofs S1/NEW.pdf application/pdf',
      'update {"proof_path":"S1/NEW.pdf","proof_type":"pdf"}',
      'remove payment-proofs S1/OLD.jpg',
    ]);
  });

  it('edge: if saving the row fails, the new file is removed again and the error shows', async () => {
    mockState.insert = { data: null, error: { message: 'Network request failed' } };
    await mount();
    await act(async () => {
      await expect(store.sendPaymentRequest('A', '2026-11-01', photo)).rejects.toThrow('Network request failed');
    });
    expect(mockState.calls.at(-1)).toBe('remove payment-proofs S1/NEW.jpg');
  });

  it('edge: an upload error saves nothing', async () => {
    mockState.upload = { data: null, error: { message: 'The object exceeded the maximum allowed size' } };
    await mount();
    await act(async () => {
      await expect(store.sendPaymentRequest('A', '2026-11-01', photo)).rejects.toThrow('maximum allowed size');
    });
    expect(mockState.calls).toEqual(['upload payment-proofs S1/NEW.jpg image/jpeg']);
  });

  it('AC 2: a file over 10 MB or not a PDF is refused before any upload', async () => {
    await mount();
    await act(async () => {
      await expect(store.sendPaymentRequest('A', '2026-11-01', { ...pdf, size: 11 * 1024 * 1024 })).rejects.toThrow(
        'The proof must be a photo or a PDF up to 10 MB.',
      );
      await expect(
        store.sendPaymentRequest('A', '2026-11-01', { ...pdf, name: 'x.docx', mimeType: 'application/msword' }),
      ).rejects.toThrow('The proof must be a photo or a PDF up to 10 MB.');
    });
    globalThis.fetch = jest.fn(async () => ({ arrayBuffer: async () => new ArrayBuffer(11 * 1024 * 1024) })) as unknown as typeof fetch;
    await act(async () => {
      await expect(store.sendPaymentRequest('A', '2026-11-01', { ...photo, size: undefined })).rejects.toThrow('10 MB');
    });
    expect(mockState.calls).toEqual([]);
  });

  it('edge: refused by RLS (no longer a listener): the new file is removed again', async () => {
    mockState.insert = { data: null, error: { message: 'new row violates row-level security policy', code: '42501' } };
    await mount();
    await act(async () => {
      await expect(store.sendPaymentRequest('A', '2026-11-01', photo)).rejects.toThrow(
        "You're no longer a listener of this course.",
      );
    });
    expect(mockState.calls.at(-1)).toBe('remove payment-proofs S1/NEW.jpg');
  });

  it('the teacher can\'t send a request', async () => {
    mockState.me = { id: 'T', role: 'teacher' };
    await mount();
    await expect(store.sendPaymentRequest('A', '2026-11-01', photo)).rejects.toThrow('Only a student or mentor');
  });
});

describe('AC 13: deleting a course or a discipline removes payment proofs first', () => {
  beforeEach(() => {
    mockState.me = { id: 'T', role: 'teacher' };
  });

  it('proofs are removed and checked before delete_course()', async () => {
    mockState.proofs = [proofs('S1/a.jpg', 'S2/b.pdf'), proofs()];
    await mount();
    await act(() => store.deleteCourse('A'));
    expect(mockState.calls).toEqual([
      'proofs A',
      'remove payment-proofs S1/a.jpg,S2/b.pdf',
      'proofs A',
      'delete_course A',
    ]);
  });

  it('a proof Storage skipped stops the delete with the "Try again" error', async () => {
    mockState.proofs = [proofs('S1/a.jpg'), proofs('S1/a.jpg')];
    await mount();
    await act(async () => {
      await expect(store.deleteCourse('A')).rejects.toThrow(
        "Some payment proofs couldn't be deleted, so the course wasn't deleted. Try again.",
      );
    });
    expect(mockState.calls).not.toContain('delete_course A');
  });

  it('a discipline lists its courses\' proofs the same way', async () => {
    mockState.proofs = [proofs('S1/a.jpg'), proofs()];
    await mount();
    await act(() => store.deleteDiscipline('D'));
    expect(mockState.calls).toEqual(['proofs D', 'remove payment-proofs S1/a.jpg', 'proofs D', 'delete_discipline D']);
  });

  it('before 0047 runs (no function) the course is still deleted', async () => {
    mockState.proofs = [{ data: null, error: { message: 'Could not find the function', code: 'PGRST202' } }];
    await mount();
    await act(() => store.deleteCourse('A'));
    expect(mockState.calls).toEqual(['proofs A', 'delete_course A']);
  });
});
