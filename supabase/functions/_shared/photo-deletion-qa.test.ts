/**
 * @jest-environment node
 */
// QA ARU-112: gaps in photo-deletion.test.ts: the Telegram text is exactly the story's (AC 4); the secret in a Bearer
// header, in another case or with extra text, or a GET, is refused and nothing runs, so only the cron job's
// x-cron-secret works (AC 9); with the right secret every step runs in order, file first and then the row (AC 2/3).
import {
  handlePhotoDeletionRequest,
  type PhotoDeletionDeps,
  photoDeletionText,
} from "./photo-deletion";

const SECRET = "s3cret-photo";
const deps = () => {
  const calls: string[] = [];
  const f =
    <T>(name: string, v: T) =>
    async () => {
      calls.push(name);
      return v;
    };
  const d: PhotoDeletionDeps = {
    start: f("start", { start_date: "2026-12-08", first_run: false }),
    leftovers: f("leftovers", ["S1/x.jpg"]),
    due: f("due", [{ homework_id: "h1", photo_path: "S1/h1.jpg" }]),
    remove: f("remove", undefined),
    markRemoved: f("mark", 1),
    claimWarnings: f("warnings", []),
    send: f("send", { sent: 0, skipped: 0, failed: [], removed: 0 }),
  };
  return { d, calls };
};
const req = (headers: Record<string, string>, method = "POST") =>
  new Request("https://x.supabase.co/functions/v1/photo-deletion", {
    method,
    headers,
    body: method === "POST" ? "{}" : undefined,
  });

it('AC 4: the text is exactly the story\'s, "photo" for 1 and "photos" otherwise', () => {
  expect(photoDeletionText(1, "2026-12-08")).toBe(
    "1 homework photo will be deleted on 8 Dec 2026. Open Sham → Homework to download them.",
  );
  expect(photoDeletionText(3, "2027-01-31")).toBe(
    "3 homework photos will be deleted on 31 Jan 2027. Open Sham → Homework to download them.",
  );
});

it.each([
  [
    "the secret as a Bearer token",
    { authorization: `Bearer ${SECRET}` },
    "POST",
  ],
  [
    "the secret in another case",
    { "x-cron-secret": SECRET.toUpperCase() },
    "POST",
  ],
  ["the secret with extra text", { "x-cron-secret": `${SECRET}x` }, "POST"],
  ["a GET with the right secret", { "x-cron-secret": SECRET }, "GET"],
])("AC 9: %s is refused and nothing runs", async (_, headers, method) => {
  const { d, calls } = deps();
  const res = await handlePhotoDeletionRequest(req(headers, method), SECRET, d);
  expect(res.status).not.toBe(200);
  expect(calls).toEqual([]);
});

it("AC 2 / AC 3 / AC 9: the right x-cron-secret runs every step, file first and then the row", async () => {
  const { d, calls } = deps();
  const res = await handlePhotoDeletionRequest(
    req({ "x-cron-secret": SECRET }),
    SECRET,
    d,
  );
  expect(res.status).toBe(200);
  expect(calls).toEqual([
    "start",
    "leftovers",
    "remove",
    "due",
    "remove",
    "mark",
    "warnings",
  ]);
});
