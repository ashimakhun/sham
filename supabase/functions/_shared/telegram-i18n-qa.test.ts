/**
 * @jest-environment node
 */
// QA ARU-110: gaps in telegram-i18n.test.ts: each of the 9 texts goes end to end (the Edge Function's request handler
// → sendTelegramMessages → Telegram) in Russian to a Russian recipient and in today's exact English to an English one,
// so no handler drops the Russian text; the English texts are byte for byte those on main; the profiles read asks only
// for id and the two language columns, once per send; odd language values and a missing profile fall back to English;
// a 429 retry resends the Russian text; a 403 still removes the link; the bot's replies stay English for a Russian
// account and a Russian Telegram app (criterion change); names with {placeholders} in them are shown as typed.
import { handleChatMessageRequest } from "./chat-message";
import { handleHomeworkReviewedRequest } from "./homework-reviewed";
import { handleHomeworkSubmittedRequest } from "./homework-submitted";
import { handleMeetingStartRequest } from "./meeting-start";
import { handleNewAccountRequest } from "./new-account";
import { handleNewHomeworkRequest } from "./new-homework";
import { handleNewMaterialRequest } from "./new-material";
import {
  CONNECTED,
  DISCONNECTED,
  EXPIRED,
  handleTelegramUpdate,
} from "./telegram-bot";
import {
  sendTelegramMessages,
  type ServiceClient,
  type TelegramMessage,
} from "./telegram";
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

function fakeClient(
  profiles: Profile[],
  links = profiles.map((p, i) => ({ user_id: p.id, chat_id: i + 1 })),
) {
  const reads: { table: string; columns: string; ids: string[] }[] = [];
  const deleted: string[] = [];
  const client: ServiceClient = {
    from: (table) => ({
      select: (columns) => ({
        in: async (_col, ids) => {
          reads.push({ table, columns, ids: [...ids] });
          if (table === "profiles")
            return {
              data: profiles.filter((p) => ids.includes(p.id)),
              error: null,
            };
          return {
            data: links
              .filter((l) => ids.includes(l.user_id))
              .map((l) => ({ ...SWITCHES, ...l })),
            error: null,
          };
        },
      }),
      delete: () => ({
        eq: (_c, userId) => ({
          eq: async () => {
            deleted.push(String(userId));
            return { data: null, error: null };
          },
        }),
      }),
    }),
  };
  return { client, reads, deleted };
}

const okFetch = () =>
  jest.fn(
    async () => new Response('{"ok":true}', { status: 200 }),
  ) as unknown as typeof fetch;
const sent = (f: typeof fetch) =>
  (f as unknown as jest.Mock).mock.calls.map((c) => {
    const b = JSON.parse(c[1].body);
    return [b.chat_id, b.text];
  });

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
  (send: (m: TelegramMessage[]) => Promise<never>) => Promise<Response>,
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
    "Новое домашнее задание на проверку от Сэм по курсу Algebra: Дроби",
    "New homework to check from Сэм in Algebra: Дроби",
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
    "Новый аккаунт ждёт вашего подтверждения: Anna *_<b>. Откройте Sham → Управление ролями, чтобы принять или отклонить.",
    "New account waiting for your approval: Anna *_<b>. Open Sham → Manage roles to accept or decline.",
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
    "Новая запись в блоге от Tess: Tips",
    "New blog post from Tess: Tips",
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
    "Новый файл в базе знаний от Tess: Guide.pdf",
    "New file in the knowledge base from Tess: Guide.pdf",
  ],
];

describe("AC 3 / AC 4: every kind, end to end through its Edge Function handler", () => {
  it.each(kinds)(
    "%s: Russian to the Russian recipient, today's English to the English one",
    async (_k, run, ru, en) => {
      const { client, reads } = fakeClient([RU, EN]);
      const fetchFn = okFetch();
      const send = ((m: TelegramMessage[]) =>
        sendTelegramMessages(client, "TOKEN", fetchFn, m, {
          sleep: async () => {},
        })) as never;
      const res = await run(send);
      expect(res.status).toBe(200);
      expect(sent(fetchFn)).toEqual([
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
    const fetchFn = okFetch();
    await sendTelegramMessages(
      client,
      "T",
      fetchFn,
      meetingStartMessages([
        { meeting_id: "m", course_title: "A", listener_ids: ["U"] },
      ]),
    );
    expect(sent(fetchFn)).toEqual([[1, "A meeting has started"]]);
  });

  it("a recipient whose profile row is missing gets English; the others keep their language", async () => {
    const { client } = fakeClient(
      [RU],
      [
        { user_id: "RU", chat_id: 1 },
        { user_id: "GONE", chat_id: 2 },
      ],
    );
    const fetchFn = okFetch();
    await sendTelegramMessages(
      client,
      "T",
      fetchFn,
      meetingStartMessages([
        { meeting_id: "m", course_title: "A", listener_ids: ["RU", "GONE"] },
      ]),
    );
    expect(sent(fetchFn)).toEqual([
      [1, "Встреча курса A началась"],
      [2, "A meeting has started"],
    ]);
  });

  it("a chosen Russian beats an English phone; a chosen English beats a Russian phone", async () => {
    const { client } = fakeClient([
      { id: "A", language: "ru", device_language: "en" },
      { id: "B", language: "en", device_language: "ru" },
    ]);
    const fetchFn = okFetch();
    await sendTelegramMessages(
      client,
      "T",
      fetchFn,
      meetingStartMessages([
        { meeting_id: "m", course_title: "A", listener_ids: ["A", "B"] },
      ]),
    );
    expect(sent(fetchFn).map(([, t]) => t)).toEqual([
      "Встреча курса A началась",
      "A meeting has started",
    ]);
  });
});

describe("AC 7: sending behaves as today", () => {
  it("a 429 retry resends the Russian text", async () => {
    const { client } = fakeClient([RU]);
    let n = 0;
    const fetchFn = jest.fn(async () =>
      ++n === 1
        ? new Response(
            '{"ok":false,"description":"Too Many Requests","parameters":{"retry_after":1}}',
            { status: 429 },
          )
        : new Response('{"ok":true}', { status: 200 }),
    ) as unknown as typeof fetch;
    const res = await sendTelegramMessages(
      client,
      "T",
      fetchFn,
      meetingStartMessages([
        { meeting_id: "m", course_title: "A", listener_ids: ["RU"] },
      ]),
      {
        sleep: async () => {},
      },
    );
    expect(sent(fetchFn)).toEqual([
      [1, "Встреча курса A началась"],
      [1, "Встреча курса A началась"],
    ]);
    expect(res.sent).toBe(1);
  });

  it("a 403 for a Russian recipient still removes the link", async () => {
    const { client, deleted } = fakeClient([RU]);
    const fetchFn = jest.fn(
      async () =>
        new Response(
          '{"ok":false,"description":"Forbidden: bot was blocked by the user"}',
          { status: 403 },
        ),
    ) as unknown as typeof fetch;
    const res = await sendTelegramMessages(
      client,
      "T",
      fetchFn,
      meetingStartMessages([
        { meeting_id: "m", course_title: "A", listener_ids: ["RU"] },
      ]),
    );
    expect(res).toMatchObject({ sent: 0, removed: 1 });
    expect(deleted).toEqual(["RU"]);
  });

  it("a recipient who isn't linked is skipped and no language is needed for them to be skipped", async () => {
    const { client } = fakeClient([RU, EN], [{ user_id: "EN", chat_id: 2 }]);
    const fetchFn = okFetch();
    const res = await sendTelegramMessages(
      client,
      "T",
      fetchFn,
      meetingStartMessages([
        { meeting_id: "m", course_title: "A", listener_ids: ["RU", "EN"] },
      ]),
    );
    expect(res).toMatchObject({ sent: 1, skipped: 1 });
    expect(sent(fetchFn)).toEqual([[2, "A meeting has started"]]);
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
      "New homework to check from {course} in {name}: {assignment}",
    );
    expect(m.texts?.ru).toBe(
      "Новое домашнее задание на проверку от {course} по курсу {name}: {assignment}",
    );
  });
});

describe("AC 5 (revised): the bot replies stay English", () => {
  const update = (text: string, language_code = "ru") => ({
    message: {
      text,
      chat: { id: 7, type: "private" },
      from: { id: 7, language_code },
    },
  });
  const deps = (name: string | null) => {
    const replies: string[] = [];
    return {
      replies,
      d: {
        linkChat: jest.fn(async () => name),
        unlinkChat: jest.fn(async () => {}),
        reply: jest.fn(async (_c: number, t: string) => {
          replies.push(t);
        }),
      },
    };
  };

  it('/start with a valid code for a Russian account, from a Russian Telegram app: the English "Connected…" with the name as typed', async () => {
    const { d, replies } = deps("Анна");
    await handleTelegramUpdate(update("/start abc123") as never, d);
    expect(replies).toEqual([CONNECTED("Анна")]);
    expect(replies[0]).toMatch(/^Connected to Sham as Анна\./);
  });

  it('/start with an expired code from a ru-RU Telegram app: the English "This link has expired…"', async () => {
    const { d, replies } = deps(null);
    await handleTelegramUpdate(update("/start old", "ru-RU") as never, d);
    expect(replies).toEqual([EXPIRED]);
  });

  it('/stop from a Russian Telegram app: the English "Disconnected…", and the chat is unlinked', async () => {
    const { d, replies } = deps(null);
    await handleTelegramUpdate(update("/stop") as never, d);
    expect(d.unlinkChat).toHaveBeenCalledWith(7);
    expect(replies).toEqual([DISCONNECTED]);
  });
});
