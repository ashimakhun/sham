/**
 * @jest-environment node
 */
// ARU-112: the photo-deletion function's logic with Supabase, Storage and Telegram mocked (AC 1–4, 7, 9), and once
// end to end with the real ARU-48 sending helper and a mocked Telegram (the Photo deletion switch is respected).
import {
  type DuePhoto,
  formatUtcDay,
  handlePhotoDeletionRequest,
  MAX_PHOTOS_PER_RUN,
  type PhotoDeletionDeps,
  type PhotoDeletionReport,
  photoDeletionMessages,
  photoDeletionText,
  type PhotoWarning,
  REMOVE_CHUNK,
} from './photo-deletion';
import { sendTelegramMessages, type SendResult, type ServiceClient, type TelegramMessage } from './telegram';

const SECRET = 'photo-secret-123';
const post = (headers: Record<string, string> = { 'x-cron-secret': SECRET }, method = 'POST') =>
  new Request('https://x.supabase.co/functions/v1/photo-deletion', { method, headers, body: method === 'GET' ? undefined : '{}' });

type World = {
  firstRun?: boolean;
  leftovers?: string[];
  due?: DuePhoto[];
  warnings?: PhotoWarning[];
  /** remove() throws when the call contains one of these paths. */
  failPaths?: string[];
  startFails?: boolean;
};

function deps(world: World = {}) {
  const calls: string[] = [];
  const removed: string[][] = [];
  const marked: DuePhoto[][] = [];
  const sent: TelegramMessage[][] = [];
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
    claimWarnings: jest.fn(async () => {
      calls.push('warnings');
      return world.warnings ?? [];
    }),
    send: jest.fn(async (messages: TelegramMessage[]): Promise<SendResult> => {
      calls.push('send');
      sent.push(messages);
      return { sent: messages.length, skipped: 0, failed: [], removed: 0 };
    }),
    log: (line) => logs.push(line),
  };
  return { d, calls, removed, marked, sent, logs };
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
  it('sets the start date, removes leftovers and sends warnings, but deletes no homework photo', async () => {
    const { d, calls } = deps({ firstRun: true, leftovers: ['x/old.jpg'], due: [photo(1)], warnings: [] });
    const res = await handlePhotoDeletionRequest(post(), SECRET, d);
    expect(res.status).toBe(200);
    const r = await report(res);
    expect(r).toMatchObject({ start_date_set: true, start_date: '2026-12-08', deleted: 0, leftovers_deleted: 1 });
    expect(d.due).not.toHaveBeenCalled();
    expect(d.markRemoved).not.toHaveBeenCalled();
    expect(calls).toEqual(['start', 'leftovers', 'remove:1', 'warnings']);
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
    expect(calls).toEqual(['start', 'leftovers', 'due', 'remove:2', 'mark', 'warnings']);
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

  it('a failed mark counts as failed, and the warnings still run', async () => {
    const { d } = deps({ due: [photo(1)], warnings: [{ user_id: 'S1', photo_count: 1, earliest: '2026-12-08' }] });
    (d.markRemoved as jest.Mock).mockRejectedValueOnce(new Error('db hiccup'));
    const r = await report(await handlePhotoDeletionRequest(post(), SECRET, d));
    expect(r).toMatchObject({ deleted: 0, failed: 1, warnings_sent: 1 });
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
      warnings_sent: 0,
      warnings_skipped: 0,
      warnings_failed: 0,
    });
    expect(d.remove).not.toHaveBeenCalled();
    expect(d.send).not.toHaveBeenCalled();
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

describe('AC 4: warnings', () => {
  it('one message per sender with the count and the earliest date', async () => {
    const { d, sent } = deps({
      warnings: [
        { user_id: 'S1', photo_count: 2, earliest: '2026-12-08' },
        { user_id: 'M2', photo_count: 1, earliest: '2027-01-03' },
      ],
    });
    const r = await report(await handlePhotoDeletionRequest(post(), SECRET, d));
    expect(sent).toEqual([
      [
        {
          userId: 'S1',
          kind: 'photo_deletion',
          text: '2 homework photos will be deleted on 8 Dec 2026. Open Sham → Homework to download them.',
        },
        {
          userId: 'M2',
          kind: 'photo_deletion',
          text: '1 homework photo will be deleted on 3 Jan 2027. Open Sham → Homework to download them.',
        },
      ],
    ]);
    expect(r.warnings_sent).toBe(2);
  });

  it('"photo" for 1, "photos" otherwise', () => {
    expect(photoDeletionText(1, '2026-12-08')).toMatch(/^1 homework photo will/);
    expect(photoDeletionText(3, '2026-12-08')).toMatch(/^3 homework photos will/);
  });

  it('the date is the UTC day, whatever the server\'s time zone', () => {
    expect(formatUtcDay('2026-12-31')).toBe('31 Dec 2026');
    expect(formatUtcDay('2027-01-01')).toBe('1 Jan 2027');
  });

  it('a row without photos sends nothing', () => {
    expect(photoDeletionMessages([{ user_id: 'S1', photo_count: 0, earliest: '2026-12-08' }])).toEqual([]);
  });

  it('end to end: the Photo deletion switch is respected (off = skipped, not failed)', async () => {
    const links = [
      { user_id: 'S1', chat_id: 1, notify_photo_deletion: true },
      { user_id: 'S2', chat_id: 2, notify_photo_deletion: false },
    ];
    const client = {
      from: () => ({
        select: () => ({ in: async () => ({ data: links, error: null }) }),
        delete: () => ({ eq: () => ({ eq: async () => ({ data: null, error: null }) }) }),
      }),
    } as unknown as ServiceClient;
    const fetchFn = jest.fn(async () => new Response('{"ok":true}', { status: 200 })) as unknown as typeof fetch;
    const { d } = deps({
      warnings: [
        { user_id: 'S1', photo_count: 1, earliest: '2026-12-08' },
        { user_id: 'S2', photo_count: 4, earliest: '2026-12-09' },
      ],
    });
    d.send = (messages) => sendTelegramMessages(client, 'tok', fetchFn, messages, { sleep: async () => {} });
    const r = await report(await handlePhotoDeletionRequest(post(), SECRET, d));
    expect(r).toMatchObject({ warnings_sent: 1, warnings_skipped: 1, warnings_failed: 0 });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const body = JSON.parse(((fetchFn as jest.Mock).mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body).toMatchObject({ chat_id: 1, text: expect.stringContaining('1 homework photo will be deleted on 8 Dec 2026') });
    expect(body.parse_mode).toBeUndefined();
  });

  it('a failed warning step doesn\'t undo the deletions', async () => {
    const { d } = deps({ due: [photo(1)] });
    (d.claimWarnings as jest.Mock).mockRejectedValueOnce(new Error('db hiccup'));
    const res = await handlePhotoDeletionRequest(post(), SECRET, d);
    expect(res.status).toBe(200);
    expect((await report(res)).deleted).toBe(1);
  });
});
