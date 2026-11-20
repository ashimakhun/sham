/**
 * @jest-environment node
 */
// ARU-112: the photo-deletion function's logic with Supabase and Storage mocked (AC 1–3, 7, 9). ARU-170 AC 13: the
// job no longer warns (the warnings are local reminders on the phone): no claim, no send, no warning counts.
import {
  type DuePhoto,
  handlePhotoDeletionRequest,
  MAX_PHOTOS_PER_RUN,
  type PhotoDeletionDeps,
  type PhotoDeletionReport,
  REMOVE_CHUNK,
} from './photo-deletion';

const SECRET = 'photo-secret-123';
const post = (headers: Record<string, string> = { 'x-cron-secret': SECRET }, method = 'POST') =>
  new Request('https://x.supabase.co/functions/v1/photo-deletion', { method, headers, body: method === 'GET' ? undefined : '{}' });

type World = {
  firstRun?: boolean;
  leftovers?: string[];
  due?: DuePhoto[];
  /** remove() throws when the call contains one of these paths. */
  failPaths?: string[];
  startFails?: boolean;
};

function deps(world: World = {}) {
  const calls: string[] = [];
  const removed: string[][] = [];
  const marked: DuePhoto[][] = [];
  const logs: string[] = [];
  const d: PhotoDeletionDeps = {
    start: jest.fn(async () => {
      calls.push('start');
      if (world.startFails) throw new Error('db down');
      return { start_date: '2026-12-08', first_run: !!world.firstRun };
    }),
    leftovers: jest.fn(async () => {
      calls.push('leftovers');
      return world.leftovers ?? [];
    }),
    due: jest.fn(async (max: number) => {
      calls.push('due');
      return (world.due ?? []).slice(0, max);
    }),
    remove: jest.fn(async (paths: string[]) => {
      calls.push(`remove:${paths.length}`);
      if (paths.some((p) => world.failPaths?.includes(p))) throw new Error('storage 500');
      removed.push(paths);
    }),
    markRemoved: jest.fn(async (photos: DuePhoto[]) => {
      calls.push('mark');
      marked.push(photos);
      return photos.length;
    }),
    log: (line) => logs.push(line),
  };
  return { d, calls, removed, marked, logs };
}

const photo = (n: number): DuePhoto => ({ homework_id: `h${n}`, photo_path: `S1/h${n}.jpg` });
const report = async (res: Response) => (await res.json()) as PhotoDeletionReport;

describe('AC 9: only the cron job', () => {
  it.each([
    ['no secret', {}],
    ['a wrong secret', { 'x-cron-secret': 'nope' }],
    ['a user JWT instead of the secret', { authorization: 'Bearer user-jwt' }],
  ])('%s is refused with 401 and nothing runs', async (_, headers) => {
    const { d, calls } = deps({ due: [photo(1)] });
    const res = await handlePhotoDeletionRequest(post(headers as Record<string, string>), SECRET, d);
    expect(res.status).toBe(401);
    expect(calls).toEqual([]);
  });

  it('an empty configured secret refuses everything', async () => {
    const { d, calls } = deps();
    expect((await handlePhotoDeletionRequest(post({ 'x-cron-secret': '' }), '', d)).status).toBe(401);
    expect(calls).toEqual([]);
  });

  it('only POST', async () => {
    const { d } = deps();
    expect((await handlePhotoDeletionRequest(post({ 'x-cron-secret': SECRET }, 'GET'), SECRET, d)).status).toBe(405);
  });
});

describe('AC 1: the first run', () => {
  it('sets the start date and removes leftovers, but deletes no homework photo', async () => {
    const { d, calls } = deps({ firstRun: true, leftovers: ['x/old.jpg'], due: [photo(1)] });
    const res = await handlePhotoDeletionRequest(post(), SECRET, d);
    expect(res.status).toBe(200);
    const r = await report(res);
    expect(r).toMatchObject({ start_date_set: true, start_date: '2026-12-08', deleted: 0, leftovers_deleted: 1 });
    expect(d.due).not.toHaveBeenCalled();
    expect(d.markRemoved).not.toHaveBeenCalled();
    expect(calls).toEqual(['start', 'leftovers', 'remove:1']);
  });

  it('when the start date can\'t be read, nothing is deleted or sent (500)', async () => {
    const { d, calls } = deps({ startFails: true, due: [photo(1)] });
    const res = await handlePhotoDeletionRequest(post(), SECRET, d);
    expect(res.status).toBe(500);
    expect(calls).toEqual(['start']);
  });
});

describe('AC 2 / AC 3: deleting due photos', () => {
  it('deletes the files first, then marks the rows; counts are reported', async () => {
    const { d, calls, removed, marked } = deps({ due: [photo(1), photo(2)] });
    const r = await report(await handlePhotoDeletionRequest(post(), SECRET, d));
    expect(calls).toEqual(['start', 'leftovers', 'due', 'remove:2', 'mark']);
    expect(removed).toEqual([['S1/h1.jpg', 'S1/h2.jpg']]);
    expect(marked).toEqual([[photo(1), photo(2)]]);
    expect(r).toMatchObject({ start_date_set: false, deleted: 2, failed: 0 });
  });

  it('a failed Storage call keeps those rows (retried next run) and the other chunks still go', async () => {
    const due = Array.from({ length: REMOVE_CHUNK + 1 }, (_, i) => photo(i));
    const { d, marked, logs } = deps({ due, failPaths: [due[REMOVE_CHUNK].photo_path] });
    const r = await report(await handlePhotoDeletionRequest(post(), SECRET, d));
    expect(r).toMatchObject({ deleted: REMOVE_CHUNK, failed: 1 });
    expect(marked.flat().map((p) => p.homework_id)).not.toContain(`h${REMOVE_CHUNK}`);
    expect(logs.join('\n')).toMatch(/photo delete failed for 1 photo/);
  });

  it('a failed mark counts as failed', async () => {
    const { d } = deps({ due: [photo(1)] });
    (d.markRemoved as jest.Mock).mockRejectedValueOnce(new Error('db hiccup'));
    const r = await report(await handlePhotoDeletionRequest(post(), SECRET, d));
    expect(r).toMatchObject({ deleted: 0, failed: 1 });
  });

  it('an empty day does nothing and reports zeros', async () => {
    const { d } = deps();
    const r = await report(await handlePhotoDeletionRequest(post(), SECRET, d));
    expect(r).toEqual({
      start_date_set: false,
      start_date: '2026-12-08',
      deleted: 0,
      failed: 0,
      leftovers_deleted: 0,
      leftovers_failed: 0,
    });
    expect(d.remove).not.toHaveBeenCalled();
  });

  it('edge case: one run asks for at most MAX_PHOTOS_PER_RUN, in chunks of REMOVE_CHUNK', async () => {
    const due = Array.from({ length: MAX_PHOTOS_PER_RUN + 5 }, (_, i) => photo(i));
    const { d } = deps({ due });
    const r = await report(await handlePhotoDeletionRequest(post(), SECRET, d));
    expect(d.due).toHaveBeenCalledWith(MAX_PHOTOS_PER_RUN);
    expect(r.deleted).toBe(MAX_PHOTOS_PER_RUN);
    expect((d.remove as jest.Mock).mock.calls.every(([paths]) => paths.length <= REMOVE_CHUNK)).toBe(true);
  });
});

describe('AC 7: leftovers', () => {
  it('are deleted on every run; a failed call is counted and the rest of the run goes on', async () => {
    const { d } = deps({ leftovers: ['a.jpg', 'b.jpg'], failPaths: ['a.jpg'], due: [photo(1)] });
    const r = await report(await handlePhotoDeletionRequest(post(), SECRET, d));
    expect(r).toMatchObject({ leftovers_deleted: 0, leftovers_failed: 2, deleted: 1 });
  });
});

describe('ARU-170 AC 13: no warnings from the job', () => {
  it('the deps have no warning step and the report no warning counts', async () => {
    const { d, calls, logs } = deps({ due: [photo(1)] });
    expect(Object.keys(d).sort()).toEqual(['due', 'leftovers', 'log', 'markRemoved', 'remove', 'start']);
    const r = await report(await handlePhotoDeletionRequest(post(), SECRET, d));
    expect(Object.keys(r).some((k) => k.startsWith('warning'))).toBe(false);
    expect(calls).toEqual(['start', 'leftovers', 'due', 'remove:1', 'mark']);
    expect(logs.join('\n')).not.toMatch(/warning/i);
  });

  it('the function source no longer claims warnings or sends anything', () => {
    const fs = jest.requireActual<{ readFileSync: (f: string, e: 'utf8') => string }>('fs');
    for (const file of ['supabase/functions/_shared/photo-deletion.ts', 'supabase/functions/photo-deletion/index.ts']) {
      const source = fs.readFileSync(file, 'utf8');
      expect(source).not.toMatch(/rpc<[^>]*>\('claim_photo_deletion_warnings'|sendPushMessages|sendTelegramMessages/);
    }
  });
});
