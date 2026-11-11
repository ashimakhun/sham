/**
 * @jest-environment node
 */
// QA ARU-102: gaps in new-material.test.ts: near-miss Authorization headers and the secret in the query string, odd
// bodies (array, null, wrong type value, id as number, padded id, extra fields), special characters and emoji as
// typed, a method check that never reveals whether the secret was right, and the app's switch order per role.
import { telegramSwitchesFor } from '../../../src/lib/telegram';
import { handleNewMaterialRequest, type NewMaterialDeps, newMaterialText } from './new-material';
import type { SendResult, TelegramMessage } from './telegram';

const SECRET = 'mat-secret-123';
const ID = '0b6f1c1e-2a3b-4c5d-8e9f-001122334455';
const URL_ = 'https://x.supabase.co/functions/v1/new-material-notifications';

function deps() {
  const d: NewMaterialDeps = {
    recipients: jest.fn(async () => [{ user_id: 'U1', author_name: 'Aigerim', item_title: 'Exam tips' }]),
    send: jest.fn(async (m: TelegramMessage[]): Promise<SendResult> => ({ sent: m.length, skipped: 0, failed: [], removed: 0 })),
    log: jest.fn(),
  };
  return d;
}
const req = (body: string | undefined, headers: Record<string, string> = { authorization: `Bearer ${SECRET}` }, url = URL_, method = 'POST') =>
  new Request(url, { method, headers: { 'content-type': 'application/json', ...headers }, body });

it.each([
  ['lower-case "bearer"', { authorization: `bearer ${SECRET}` }],
  ['two spaces', { authorization: `Bearer  ${SECRET}` }],
  ['an extra character', { authorization: `Bearer ${SECRET}x` }],
  ['a prefix of the secret', { authorization: `Bearer ${SECRET.slice(0, -1)}` }],
  ['the secret alone', { authorization: SECRET }],
  ['another header', { 'x-notify-secret': SECRET }],
])('AC 9: %s → 401, nothing looked up', async (_k, headers) => {
  const d = deps();
  const res = await handleNewMaterialRequest(req(JSON.stringify({ type: 'blog', id: ID }), headers), SECRET, d);
  expect(res.status).toBe(401);
  expect(d.recipients).not.toHaveBeenCalled();
  expect(d.send).not.toHaveBeenCalled();
});

it('AC 9: the secret in the query string → 401', async () => {
  const d = deps();
  const res = await handleNewMaterialRequest(req(JSON.stringify({ type: 'blog', id: ID }), {}, `${URL_}?secret=${SECRET}`), SECRET, d);
  expect(res.status).toBe(401);
});

it.each([
  ['an array', JSON.stringify([{ type: 'blog', id: ID }])],
  ['null', 'null'],
  ['type "Blog" (case)', JSON.stringify({ type: 'Blog', id: ID })],
  ['type "material"', JSON.stringify({ type: 'material', id: ID })],
  ['id as a number', JSON.stringify({ type: 'file', id: 42 })],
  ['a padded id', JSON.stringify({ type: 'file', id: ` ${ID} ` })],
  ['an SQL-looking id', JSON.stringify({ type: 'file', id: `${ID}' or '1'='1` })],
  ['malformed JSON', '{"type":'],
  ['no body', undefined],
])('AC 9: a body of %s → 400, nothing looked up', async (_k, body) => {
  const d = deps();
  const res = await handleNewMaterialRequest(req(body), SECRET, d);
  expect(res.status).toBe(400);
  expect(d.recipients).not.toHaveBeenCalled();
  expect(d.send).not.toHaveBeenCalled();
});

it('extra fields in the body are ignored; the lookup uses only type and id', async () => {
  const d = deps();
  const res = await handleNewMaterialRequest(req(JSON.stringify({ type: 'file', id: ID, user_id: 'X', title: 'Fake' })), SECRET, d);
  expect(res.status).toBe(200);
  expect(d.recipients).toHaveBeenCalledWith('file', ID);
  const sent = (d.send as jest.Mock).mock.calls[0][0] as TelegramMessage[];
  expect(sent[0].text).not.toContain('Fake');
});

it('AC 1 / edge: names and titles with *, _, <, emoji and Cyrillic are sent exactly as typed', () => {
  expect(newMaterialText('blog', 'Айгерім *A*', 'Tips_<b>1</b> 🎓')).toBe('New blog post from Айгерім *A*: Tips_<b>1</b> 🎓');
  expect(newMaterialText('file', 'T_1', 'a*b.pdf')).toBe('New file in the knowledge base from T_1: a*b.pdf');
});

it('a GET with the right secret is refused and looks nothing up', async () => {
  const d = deps();
  const res = await handleNewMaterialRequest(req(undefined, { authorization: `Bearer ${SECRET}` }, URL_, 'GET'), SECRET, d);
  expect(res.status).toBe(405);
  expect(d.recipients).not.toHaveBeenCalled();
});

it('AC 5: New materials is listed for every role, right after General chat (teacher: before New accounts)', () => {
  for (const role of ['student', 'mentor', 'teacher'] as const) {
    const kinds = telegramSwitchesFor(role).map((s) => s.kind);
    const i = kinds.indexOf('new_material');
    expect(i).toBeGreaterThan(0);
    expect(kinds[i - 1]).toBe('general_chat');
    // ARU-151 AC 7: Meeting notes now sits right below New materials, so for the teacher New accounts comes after it.
    expect(kinds[i + 1]).toBe('meeting_notes');
    if (role === 'teacher') expect(kinds[i + 2]).toBe('new_account');
    else expect(kinds.includes('new_account')).toBe(false);
  }
  expect(telegramSwitchesFor('student').find((s) => s.kind === 'new_material')?.label).toBe('New materials');
});
