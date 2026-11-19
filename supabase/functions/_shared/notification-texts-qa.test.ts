/**
 * @jest-environment node
 */
// QA ARU-110: gaps in notification-texts.test.ts (telegram-i18n.test.ts until ARU-171): each of the 9 texts goes end to
// end (the Edge Function's request handler → the push sender → a mocked Expo push service; Telegram until ARU-166) in
// Russian to a Russian recipient and in today's exact English to an English one, so no handler drops the Russian
// text; the profiles read asks only for id and the two language columns, once per send; odd language values and a
// missing profile fall back to English; a 429 retry resends the Russian text; a phone the push service no longer
// knows is still removed; names with {placeholders} in them are shown as typed. (ARU-171 removed the bot, and with it
// the check that its replies stay English.)
import { handleChatMessageRequest } from "./chat-message";
import { handleHomeworkReviewedRequest } from "./homework-reviewed";
import { handleHomeworkSubmittedRequest } from "./homework-submitted";
import { handleMeetingStartRequest } from "./meeting-start";
import { handleNewAccountRequest } from "./new-account";
import { handleNewHomeworkRequest } from "./new-homework";
import { handleNewMaterialRequest } from "./new-material";
import { type NotificationMessage } from "./notification";
import { sendPushMessages } from "./push";
import { pushClient, pushFetch, tokenFor } from "./push-test-helpers";
import { homeworkSubmittedMessages } from "./homework-submitted";
import { meetingStartMessages } from "./meeting-start";

const SECRET = "s3cret";
const ID = "11111111-1111-4111-8111-111111111111";
const SWITCHES = {
  notify_meeting_started: true,
  notify_chat_message: true,
  notify_general_chat: true,
  notify_homework_reviewed: true,
  notify_new_homework: true,
  notify_homework_submitted: true,
  notify_new_account: true,
  notify_new_material: true,
};

type Profile = {
  id: string;
  language: string | null;
  device_language: string | null;
};

// Recipients with a phone ("chat" n = their phone) and every switch on, and their profiles (push-test-helpers.ts).
function fakeClient(
  profiles: Profile[],
  links: { user_id: string; chat_id: number }[] = profiles.map((p, i) => ({ user_id: p.id, chat_id: i + 1 })),
) {
  return pushClient(
    links.map((l) => ({ ...SWITCHES, ...l })),
    profiles,
  );
}

const post = (
  body: unknown,
  headers: Record<string, string> = { authorization: `Bearer ${SECRET}` },
) =>
  new Request("https://x.supabase.co/functions/v1/fn", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

const RU: Profile = { id: "RU", language: null, device_language: "ru" };
const EN: Profile = { id: "EN", language: "en", device_language: "ru" };

// What each Edge Function's handler sends for one event to RU (chat 1) and EN (chat 2). English is copied from main.
const kinds: [
  string,
  (send: (m: NotificationMessage[]) => Promise<never>) => Promise<Response>,
  string,
  string,
][] = [
  [
    "meeting started",
    (send) =>
      handleMeetingStartRequest(post({}, { "x-cron-secret": SECRET }), SECRET, {
        claim: async () => [
          {
            meeting_id: "m",
            course_title: "Алгебра",
            listener_ids: ["RU", "EN"],
          },
        ],
        send,
      } as never),
    "Встреча курса Алгебра началась",
    "Алгебра meeting has started",
  ],
  [
    "course chat message",
    (send) =>
      handleChatMessageRequest(post({ message_id: ID }), SECRET, {
        recipients: async () => ({
          course_title: "Algebra",
          recipient_ids: ["RU", "EN"],
        }),
        send,
      }),
    "Новое сообщение в чате курса Algebra",
    "New message in the Algebra chat",
  ],
  [
    "general chat message",
    (send) =>
      handleChatMessageRequest(post({ general_message_id: ID }), SECRET, {
        recipients: async () => null,
        generalRecipients: async () => ({ recipient_ids: ["RU", "EN"] }),
        send,
      }),
    "Новое сообщение в общем чате",
    "New message in the general chat",
  ],
  [
    "homework reviewed",
    (send) =>
      handleHomeworkReviewedRequest(post({ homework_id: ID }), SECRET, {
        recipient: async () => [
          { user_id: "RU", course_title: "Algebra" },
          { user_id: "EN", course_title: "Algebra" },
        ],
        send,
      }),
    "Ваше домашнее задание по курсу Algebra проверено",
    "Your homework for Algebra was reviewed",
  ],
  [
    "new homework",
    (send) =>
      handleNewHomeworkRequest(post({ assignment_id: ID }), SECRET, {
        recipients: async () => [
          { user_id: "RU", course_title: "Algebra" },
          { user_id: "EN", course_title: "Algebra" },
        ],
        send,
      }),
    "Вам задано новое домашнее задание по курсу Algebra",
    "New homework assigned to you in Algebra",
  ],
  [
    "homework submitted",
    (send) =>
      handleHomeworkSubmittedRequest(post({ homework_id: ID }), SECRET, {
        recipient: async () =>
          ["RU", "EN"].map((user_id) => ({
            user_id,
            sender_name: "Сэм",
            course_title: "Algebra",
            assignment_title: "Дроби",
          })),
        send,
      }),
    "Новое домашнее задание на проверку по курсу Algebra: Дроби",
    "New homework to check in Algebra: Дроби",
  ],
  [
    "new account",
    (send) =>
      handleNewAccountRequest(post({ user_id: ID }), SECRET, {
        recipient: async () =>
          ["RU", "EN"].map((user_id) => ({
            user_id,
            account_name: "Anna *_<b>",
          })),
        send,
      }),
    "Новый аккаунт ждёт вашего подтверждения. Откройте Sham → Управление ролями, чтобы принять или отклонить.",
    "New account waiting for your approval. Open Sham → Manage roles to accept or decline.",
  ],
  [
    "new blog post",
    (send) =>
      handleNewMaterialRequest(post({ type: "blog", id: ID }), SECRET, {
        recipients: async () =>
          ["RU", "EN"].map((user_id) => ({
            user_id,
            author_name: "Tess",
            item_title: "Tips",
          })),
        send,
      }),
    "Новая запись в блоге: Tips",
    "New blog post: Tips",
  ],
  [
    "new knowledge base file",
    (send) =>
      handleNewMaterialRequest(post({ type: "file", id: ID }), SECRET, {
        recipients: async () =>
          ["RU", "EN"].map((user_id) => ({
            user_id,
            author_name: "Tess",
            item_title: "Guide.pdf",
          })),
        send,
      }),
    "Новый файл в базе знаний: Guide.pdf",
    "New file in the knowledge base: Guide.pdf",
  ],
];

describe("AC 3 / AC 4: every kind, end to end through its Edge Function handler", () => {
  it.each(kinds)(
    "%s: Russian to the Russian recipient, today's English to the English one",
    async (_k, run, ru, en) => {
      const { client, reads } = fakeClient([RU, EN]);
      const push = pushFetch();
      const send = ((m: NotificationMessage[]) =>
        sendPushMessages(client, push.fetch, m, {
          sleep: async () => {},
        })) as never;
      const res = await run(send);
      expect(res.status).toBe(200);
      expect(push.sent()).toEqual([
        [1, ru],
        [2, en],
      ]);
      // AC 10 / privacy: one profiles read per send, only the two language columns, only the recipients.
      const profileReads = reads.filter((r) => r.table === "profiles");
      expect(profileReads).toHaveLength(1);
      expect(
        profileReads[0].columns
          .split(",")
          .map((c) => c.trim())
          .sort(),
      ).toEqual(["device_language", "id", "language"]);
      expect(profileReads[0].ids.sort()).toEqual(["EN", "RU"]);
    },
  );
});

describe("AC 1: odd values and missing profiles", () => {
  it.each([
    ["upper case RU", { language: "RU", device_language: null }],
    ["ru-RU", { language: null, device_language: "ru-RU" }],
    ["empty string", { language: "", device_language: "" }],
    ["German", { language: "de", device_language: "de" }],
  ])("%s → English", async (_n, langs) => {
    const { client } = fakeClient([{ id: "U", ...langs } as Profile]);
    const push = pushFetch();
    await sendPushMessages(
      client,
      push.fetch,
      meetingStartMessages([
        { meeting_id: "m", course_title: "A", listener_ids: ["U"] },
      ]),
    );
    expect(push.sent()).toEqual([[1, "A meeting has started"]]);
  });

  it("a recipient whose profile row is missing gets English; the others keep their language", async () => {
    const { client } = fakeClient(
      [RU],
      [
        { user_id: "RU", chat_id: 1 },
        { user_id: "GONE", chat_id: 2 },
      ],
    );
    const push = pushFetch();
    await sendPushMessages(
      client,
      push.fetch,
      meetingStartMessages([
        { meeting_id: "m", course_title: "A", listener_ids: ["RU", "GONE"] },
      ]),
    );
    expect(push.sent()).toEqual([
      [1, "Встреча курса A началась"],
      [2, "A meeting has started"],
    ]);
  });

  it("a chosen Russian beats an English phone; a chosen English beats a Russian phone", async () => {
    const { client } = fakeClient([
      { id: "A", language: "ru", device_language: "en" },
      { id: "B", language: "en", device_language: "ru" },
    ]);
    const push = pushFetch();
    await sendPushMessages(
      client,
      push.fetch,
      meetingStartMessages([
        { meeting_id: "m", course_title: "A", listener_ids: ["A", "B"] },
      ]),
    );
    expect(push.sent().map(([, t]) => t)).toEqual([
      "Встреча курса A началась",
      "A meeting has started",
    ]);
  });
});

describe("AC 7: sending behaves as today", () => {
  it("a 429 retry resends the Russian text", async () => {
    const { client } = fakeClient([RU]);
    const push = pushFetch([() => ({ status: 429, body: { errors: [{ message: "Too Many Requests" }] }, retryAfter: 1 })]);
    const res = await sendPushMessages(
      client,
      push.fetch,
      meetingStartMessages([
        { meeting_id: "m", course_title: "A", listener_ids: ["RU"] },
      ]),
      {
        sleep: async () => {},
      },
    );
    expect(push.sent()).toEqual([
      [1, "Встреча курса A началась"],
      [1, "Встреча курса A началась"],
    ]);
    expect(res.sent).toBe(1);
  });

  it("a phone the push service no longer knows (DeviceNotRegistered) is still removed for a Russian recipient", async () => {
    const { client, deleted } = fakeClient([RU]);
    const push = pushFetch([
      () => ({
        status: 200,
        body: { data: [{ status: "error", message: "gone", details: { error: "DeviceNotRegistered" } }] },
      }),
    ]);
    const res = await sendPushMessages(
      client,
      push.fetch,
      meetingStartMessages([
        { meeting_id: "m", course_title: "A", listener_ids: ["RU"] },
      ]),
    );
    expect(res).toMatchObject({ sent: 0, removed: 1 });
    expect(deleted).toEqual([tokenFor(1)]);
  });

  it("a recipient without a phone is skipped and no language is needed for them to be skipped", async () => {
    const { client } = fakeClient([RU, EN], [{ user_id: "EN", chat_id: 2 }]);
    const push = pushFetch();
    const res = await sendPushMessages(
      client,
      push.fetch,
      meetingStartMessages([
        { meeting_id: "m", course_title: "A", listener_ids: ["RU", "EN"] },
      ]),
    );
    expect(res).toMatchObject({ sent: 1, skipped: 1 });
    expect(push.sent()).toEqual([[2, "A meeting has started"]]);
  });
});

describe("AC 3: names and titles exactly as typed", () => {
  it("a name or title that contains {course} or {name} is not filled in a second time", () => {
    const [m] = homeworkSubmittedMessages([
      {
        user_id: "M",
        sender_name: "{course}",
        course_title: "{name}",
        assignment_title: "{assignment}",
      },
    ]);
    expect(m.text).toBe(
      "New homework to check in {name}: {assignment}",
    );
    expect(m.texts?.ru).toBe(
      "Новое домашнее задание на проверку по курсу {name}: {assignment}",
    );
  });
});
