// ARU-158: the real StoreProvider against a fake Supabase client. The teacher's reports load with the data; Delete
// content deletes through the content's usual path and only then marks the reports Removed; content already gone
// still resolves; a refused delete leaves the report open; reporting calls report_content().
import { act, render } from '@testing-library/react-native';
import { Text } from 'react-native';

import { StoreProvider, useStore } from '@/lib/store';
import type { ContentReport } from '@/lib/types';

type Call = { table: string; op: string; filters: string[] };
const mockState = {
  me: 'T',
  reports: [] as Record<string, unknown>[],
  rpcs: [] as { name: string; args: Record<string, unknown> }[],
  rpcErrors: {} as Record<string, { message: string; code?: string; hint?: string }>,
  calls: [] as Call[],
  // Rows a delete removes (by table), and rows a select still finds after a delete.
  deletes: {} as Record<string, unknown[]>,
  remaining: {} as Record<string, unknown[]>,
  storageRemoved: [] as string[][],
};

jest.mock('@/lib/supabase', () => {
  const ok = (data: unknown) => Promise.resolve({ data, error: null });
  const query = (table: string): unknown => {
    const call: Call = { table, op: 'select', filters: [] };
    const q: Record<string, unknown> = {};
    for (const m of ['insert', 'update', 'limit', 'lt', 'in', 'order']) q[m] = () => q;
    q.select = () => q;
    q.delete = () => {
      call.op = 'delete';
      return q;
    };
    q.eq = (col: string, v: string) => {
      call.filters.push(`${col}=${v}`);
      return q;
    };
    q.or = (f: string) => {
      call.filters.push(f);
      return q;
    };
    q.then = (resolve: (v: unknown) => unknown) => {
      mockState.calls.push(call);
      if (table === 'profiles') {
        return resolve({
          data: [
            { id: 'T', full_name: 'Teacher Tess', role: 'teacher', access_status: 'approved' },
            { id: 'S1', full_name: 'Student Sam', role: 'student', access_status: 'approved' },
          ].filter((p) => mockState.me === 'T' || p.id === mockState.me),
          error: null,
        });
      }
      if (table === 'content_reports') return resolve({ data: mockState.reports, error: null });
      if (call.op === 'delete') return resolve({ data: mockState.deletes[table] ?? [], error: null });
      if (table in mockState.remaining) return resolve({ data: mockState.remaining[table], error: null });
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
        getSession: () => ok({ session: { user: { id: mockState.me } } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
        getUser: () => ok({ user: { id: mockState.me } }),
      },
      from: (table: string) => query(table),
      rpc: (name: string, args: Record<string, unknown>) => {
        mockState.rpcs.push({ name, args });
        const error = mockState.rpcErrors[name];
        if (error) return Promise.resolve({ data: null, error });
        return ok(name === 'access_requests' ? [] : null);
      },
      channel: () => c,
      removeChannel: () => {},
      storage: {
        from: () => ({
          createSignedUrls: () => ok([]),
          remove: (paths: string[]) => {
            mockState.storageRemoved.push(paths);
            return ok([]);
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

const reportRow = {
  id: 'r1',
  reporter_id: 'S1',
  content_kind: 'course_message',
  content_id: 'c1',
  author_id: 'S2',
  content_title: null,
  content_text: 'Rude',
  content_rating: null,
  course_id: 'A',
  course_title: 'Algebra',
  meeting_at: null,
  reason: 'spam',
  comment: null,
  status: 'open',
  created_at: '2026-11-18T10:00:00.000Z',
  resolved_by: null,
  resolved_at: null,
};
const report = (over: Partial<ContentReport> = {}): ContentReport => ({ ...store.contentReports[0], ...over });
const resolves = () => mockState.rpcs.filter((r) => r.name === 'resolve_report');

beforeEach(() => {
  mockState.me = 'T';
  mockState.reports = [reportRow];
  mockState.rpcs = [];
  mockState.rpcErrors = {};
  mockState.calls = [];
  mockState.deletes = {};
  mockState.remaining = {};
  mockState.storageRemoved = [];
});

it('AC 5 / 6: the teacher loads open and recently resolved reports', async () => {
  await mount();
  expect(store.contentReports).toEqual([
    expect.objectContaining({ id: 'r1', kind: 'course_message', contentId: 'c1', authorId: 'S2', text: 'Rude', courseTitle: 'Algebra', status: 'open' }),
  ]);
  const call = mockState.calls.find((c) => c.table === 'content_reports');
  expect(call?.filters[0]).toMatch(/^status\.eq\.open,resolved_at\.gte\./);
});

it('AC 5: a student loads no reports', async () => {
  mockState.me = 'S1';
  await mount();
  expect(store.contentReports).toEqual([]);
  expect(mockState.calls.some((c) => c.table === 'content_reports')).toBe(false);
});

const deletes = () => mockState.rpcs.filter((r) => r.name === 'delete_content').map((r) => r.args);

it('AC 7: deletes the message (delete_content), then marks the reports Removed', async () => {
  await mount();
  await act(() => store.deleteReportedContent(report()));
  expect(deletes()).toEqual([{ kind: 'course_message', content: 'c1' }]);
  const names = mockState.rpcs.map((r) => r.name);
  expect(names.indexOf('delete_content')).toBeLessThan(names.indexOf('resolve_report'));
  expect(resolves()).toEqual([{ name: 'resolve_report', args: { report: 'r1', new_status: 'removed' } }]);
});

it('AC 7: Blog posts and reviews go through delete_content too', async () => {
  await mount();
  await act(() => store.deleteReportedContent(report({ kind: 'blog_post', contentId: 'b1' })));
  await act(() => store.deleteReportedContent(report({ kind: 'review', contentId: 'f1' })));
  expect(deletes()).toEqual([
    { kind: 'blog_post', content: 'b1' },
    { kind: 'review', content: 'f1' },
  ]);
  expect(resolves()).toHaveLength(2);
});

it('AC 7: a refused delete leaves the report open', async () => {
  mockState.rpcErrors.delete_content = { message: "You can't delete this content.", code: '42501', hint: 'sham:content_cant_delete' };
  await mount();
  await expect(store.deleteReportedContent(report({ kind: 'review', contentId: 'f1' }))).rejects.toThrow(
    "You can't delete this content.",
  );
  expect(resolves()).toHaveLength(0);
});

it('AC 7 / analysis note 1: a private note: the notes refusal shows and the report stays open', async () => {
  mockState.rpcErrors.delete_meeting_listener_notes = {
    message: "You can't delete these notes.",
    code: '42501',
    hint: 'sham:listener_notes_cant_delete',
  };
  await mount();
  await expect(store.deleteReportedContent(report({ kind: 'meeting_note', contentId: 'n1' }))).rejects.toThrow(
    "You can't delete these notes.",
  );
  expect(resolves()).toHaveLength(0);
});

it('AC 7 / analysis note 2: notes already deleted ("not found") resolve', async () => {
  mockState.rpcErrors.delete_meeting_listener_notes = { message: 'Notes not found.', code: 'P0002', hint: 'sham:listener_notes_not_found' };
  await mount();
  await act(() => store.deleteReportedContent(report({ kind: 'meeting_note', contentId: 'n1' })));
  expect(resolves()).toHaveLength(1);
});

it('AC 7: a PDF is deleted with its stored file', async () => {
  mockState.remaining.material_files = [{ storage_path: 'M/p1.pdf' }];
  mockState.deletes.material_files = [{ id: 'p1' }];
  await mount();
  await act(() => store.deleteReportedContent(report({ kind: 'pdf', contentId: 'p1' })));
  expect(mockState.storageRemoved).toEqual([['M/p1.pdf']]);
  expect(mockState.calls.some((c) => c.table === 'material_files' && c.op === 'delete')).toBe(true);
  expect(resolves()).toHaveLength(1);
});

it('AC 7: a PDF the author already deleted resolves without touching Storage', async () => {
  mockState.remaining.material_files = [];
  await mount();
  await act(() => store.deleteReportedContent(report({ kind: 'pdf', contentId: 'p1' })));
  expect(mockState.storageRemoved).toEqual([]);
  expect(resolves()).toHaveLength(1);
});

it('AC 8: Dismiss calls resolve_report with dismissed', async () => {
  await mount();
  await act(() => store.dismissReport('r1'));
  expect(resolves()).toEqual([{ name: 'resolve_report', args: { report: 'r1', new_status: 'dismissed' } }]);
});

it('AC 2: reporting sends the trimmed comment, or none', async () => {
  mockState.me = 'S1';
  await mount();
  await act(() => store.reportContent({ kind: 'review', contentId: 'f1', reason: 'other', comment: '  why  ' }));
  await act(() => store.reportContent({ kind: 'pdf', contentId: 'p1', reason: 'spam', comment: '   ' }));
  expect(mockState.rpcs.filter((r) => r.name === 'report_content').map((r) => r.args)).toEqual([
    { kind: 'review', content: 'f1', report_reason: 'other', report_comment: 'why' },
    { kind: 'pdf', content: 'p1', report_reason: 'spam', report_comment: null },
  ]);
});

it('AC 11: deleting a chat message calls delete_content; a refusal throws its message', async () => {
  await mount();
  await act(() => store.deleteChatMessage('general_message', 'g1'));
  expect(deletes()).toEqual([{ kind: 'general_message', content: 'g1' }]);
  mockState.rpcErrors.delete_content = { message: "You can't delete this content.", code: '42501', hint: 'sham:content_cant_delete' };
  await expect(store.deleteChatMessage('course_message', 'c1')).rejects.toThrow("You can't delete this content.");
});
