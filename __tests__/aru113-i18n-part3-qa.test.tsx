// QA ARU-113: gaps in aru113-i18n-part3.test.tsx. The dev test renders Materials (Blog), Manage roles, Delete account
// and the Telegram page, and only looks for the catalog's own English, so text never put in the catalog would pass.
// Here every other in-scope screen is rendered in Russian and scanned for any Latin word that isn't user text (AC 1,
// AC 8): Knowledge base, Material details with likes, New material, Upload PDF, File, Edit file, course chat, General
// chat, Pay, the payment section and materials section on course details, Select courses, Payments, the accountant
// blocks on Profile, Manage roles with requests and a search with no match, and "Telegram notifications are not
// available.". Also: the confirmations Make mentor, Reject, Unselect (Keep), delete material and delete file with
// Russian buttons (AC 2); likes 0 / 22 and the "2 000" limit with a non-breaking space (AC 4); Russian chat and
// material dates, and English ones on a Russian phone (AC 5); Materials keeping Knowledge base and the author filter
// after a language switch (AC 7); English screens with no Cyrillic (AC 1).
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import * as DocPicker from "expo-document-picker";
import * as ImgPicker from "expo-image-picker";
import { Alert, Platform } from "react-native";

import CoursesScreen from "@/app/(tabs)/courses";
import MaterialsScreen from "@/app/(tabs)/materials";
import ProfileScreen from "@/app/(tabs)/profile";
import CoursePaymentsScreen from "@/app/accountant/[id]";
import SelectCoursesScreen from "@/app/accountant/courses";
import CourseDetailScreen from "@/app/courses/[id]";
import CourseChatScreen from "@/app/courses/[id]/chat";
import PayScreen from "@/app/courses/[id]/pay";
import GeneralChatScreen from "@/app/general-chat";
import MaterialDetailScreen from "@/app/materials/[id]";
import FileScreen from "@/app/materials/files/[id]";
import EditFileScreen from "@/app/materials/files/[id]/edit";
import NewFileScreen from "@/app/materials/files/new";
import NewMaterialScreen from "@/app/materials/new";
import RolesScreen from "@/app/roles";
import TelegramScreen from "@/app/telegram";
import { formatDateIn } from "@/i18n";
import { DeleteAccountForm } from "@/components/DeleteAccountForm";
import { LanguageProvider } from "@/i18n/LanguageProvider";
import { localMonth } from "@/lib/billing";
import { WRONG_PASSWORD } from "@/lib/deleteAccount";
import { formatLimit } from "@/lib/files";
import type {
  AccessRequest,
  ChatMessage,
  CourseBilling,
  Material,
  MaterialFile,
  MaterialLike,
  PaymentRequest,
  User,
} from "@/lib/types";

import {
  courseA,
  courseB,
  fakeStore,
  member,
  users,
} from "./helpers/fakeStore";
import { params, setStore } from "./helpers/mocks";

jest.mock("expo-router", () => require("./helpers/mocks").expoRouter);
jest.mock("expo-router/react-navigation", () => ({ useHeaderHeight: () => 0 }));
jest.mock("@/lib/store", () => require("./helpers/mocks").store);
jest.mock("expo-localization", () => ({
  getLocales: jest.fn(() => [{ languageTag: "ru-RU", languageCode: "ru" }]),
}));
jest.mock(
  "react-native-safe-area-context",
  () => require("react-native-safe-area-context/jest/mock").default,
);
jest.mock("expo-document-picker", () => ({ getDocumentAsync: jest.fn() }));
jest.mock("expo-image-picker", () => ({
  launchImageLibraryAsync: jest.fn(),
  requestMediaLibraryPermissionsAsync: jest.fn(),
}));

const flush = () => act(async () => {});
const store = () => require("./helpers/mocks").store.useStore();
const inApp = (ui: React.ReactElement) => (
  <LanguageProvider>{ui}</LanguageProvider>
);

const month = localMonth();
const accountant = (u: User): User => ({ ...u, isAccountant: true });

const post: Material = {
  id: "p1",
  teacherId: "M",
  title: "How to study",
  body: "Read **every** day",
  createdAt: "2026-10-20T10:00:00.000Z",
};
const orphan: Material = {
  id: "p2",
  teacherId: "GONE",
  title: "Orphan post",
  body: "Body two",
  createdAt: "2026-10-21T10:00:00.000Z",
};
const file: MaterialFile = {
  id: "f1",
  authorId: "M",
  name: "Fractions guide",
  description: "Chapter one",
  courseId: "A",
  courseOnly: true,
  storagePath: "M/f1.pdf",
  sizeBytes: 1.2 * 1024 * 1024,
  createdAt: "2026-10-22T10:00:00.000Z",
  updatedAt: "2026-10-22T10:00:00.000Z",
};
const likes = (n: number): MaterialLike[] =>
  Array.from({ length: n }, (_, i) => ({
    materialId: "p1",
    userId: `U${i}`,
    createdAt: "2026-10-23T10:00:00.000Z",
  }));
const billing: CourseBilling = {
  courseId: "A",
  startDay: 1,
  endDay: 28,
  selectedById: "N",
  selectedAt: "2026-11-01T10:00:00.000Z",
};
const request = (userId: string): PaymentRequest => ({
  id: `r-${userId}`,
  courseId: "A",
  userId,
  month,
  proofPath: `${userId}/p.jpg`,
  proofType: "image",
  sentAt: "2026-11-02T10:00:00.000Z",
});
const messages: ChatMessage[] = [
  {
    id: "c1",
    authorId: "M",
    body: "Hello class",
    createdAt: "2026-11-03T09:05:00.000Z",
  },
  {
    id: "c2",
    authorId: null,
    body: "Old message",
    createdAt: "2026-11-03T09:10:00.000Z",
  },
  {
    id: "c3",
    authorId: "S1",
    body: "Привет all",
    createdAt: "2026-11-03T09:15:00.000Z",
  },
];
const pending: AccessRequest = {
  id: "S9",
  name: "New Person",
  email: "new@x.test",
  createdAt: "2026-11-01T10:00:00.000Z",
  status: "pending",
};
const declined: AccessRequest = {
  id: "S8",
  name: "Old Person",
  email: "old@x.test",
  createdAt: "2026-10-01T10:00:00.000Z",
  status: "rejected",
};

/** A store for `who` in `language`, with the users list carrying the same accountant flag as the current user. */
// Likers must have a profile to count (ARU-52): Liker 0, Liker 1, ...
const likers: User[] = Array.from({ length: 30 }, (_, i) => ({
  id: `U${i}`,
  name: `Liker ${i}`,
  role: "student",
}));
function as(
  who: keyof typeof users,
  language: "en" | "ru",
  over: object = {},
  isAcc = false,
) {
  const me: User = {
    ...(isAcc ? accountant(users[who]) : users[who]),
    language,
  };
  const all = [...Object.values({ ...users, [who]: me }), ...likers];
  setStore({
    ...fakeStore(who, over),
    currentUser: me,
    users: all,
    getUser: (id?: string) => all.find((u) => u.id === id),
  });
}

// User text on these screens (AC 8) and names the app keeps as they are (Sham, Telegram, PDF; AC 11's two buttons).
const USER = [
  ...Object.values(users).map((u) => u.name),
  ...likers.map((u) => u.name).reverse(),
  courseA.title,
  courseA.description,
  courseB.title,
  post.title,
  "Read",
  "every",
  "day",
  orphan.title,
  "Body two",
  file.name,
  file.description,
  "Hello class",
  "Old message",
  "Привет all",
  pending.name,
  pending.email,
  declined.name,
  declined.email,
  "zzz-nobody",
  "Connect Telegram",
  "Disconnect",
  "Telegram",
  "Sham",
  "PDF",
  // ARU-108: Profile's Language switch names each language in that language.
  "English",
];

function rendered(): string[] {
  const out: string[] = [];
  const walk = (node: unknown) => {
    if (node == null) return;
    if (typeof node === "string") return void out.push(node);
    if (Array.isArray(node)) return node.forEach(walk);
    const n = node as { props?: Record<string, unknown>; children?: unknown };
    for (const key of [
      "accessibilityLabel",
      "accessibilityHint",
      "placeholder",
      "title",
    ]) {
      if (typeof n.props?.[key] === "string") out.push(n.props[key] as string);
    }
    walk(n.children);
  };
  walk(screen.toJSON());
  return out;
}
/** AC 1: no Latin word of three letters or more is left once user text (AC 8) is taken out. */
function latinLeft() {
  return rendered()
    .map((text) =>
      USER.reduce((s, u) => s.split(u).join(""), text).replace(
        /https?:\/\/\S*/g,
        "",
      ),
    )
    .filter((text) => /[A-Za-z]{3,}/.test(text));
}
const cyrillic = () =>
  rendered().filter(
    (text) =>
      /[а-яё]/i.test(text) &&
      !text.includes("Привет all") &&
      text !== "Русский",
  );

beforeEach(() => {
  jest.clearAllMocks();
  for (const k of Object.keys(params)) delete params[k as keyof typeof params];
  process.env.EXPO_PUBLIC_TELEGRAM_BOT_USERNAME = "ShamSchoolBot";
});
afterEach(() => {
  delete process.env.EXPO_PUBLIC_TELEGRAM_BOT_USERNAME;
});

type Case = [
  string,
  keyof typeof users,
  () => React.ReactElement,
  Record<string, string>,
  object,
  boolean?,
];
const cases: Case[] = [
  [
    "Material details with likes, a liked post",
    "S1",
    () => <MaterialDetailScreen />,
    { id: "p1" },
    {
      materials: [post],
      materialLikes: [
        ...likes(4),
        {
          materialId: "p1",
          userId: "S1",
          createdAt: "2026-10-23T10:00:00.000Z",
        },
      ],
    },
  ],
  [
    "Material details by a deleted author, no likes",
    "T",
    () => <MaterialDetailScreen />,
    { id: "p2" },
    { materials: [orphan] },
  ],
  ["New material (mentor)", "M", () => <NewMaterialScreen />, {}, {}],
  [
    "Upload PDF (mentor)",
    "M",
    () => <NewFileScreen />,
    {},
    { courseMembers: [member("A", "S1")] },
  ],
  [
    "File details (author)",
    "M",
    () => <FileScreen />,
    { id: "f1" },
    { materialFiles: [file] },
  ],
  [
    "Edit file (author)",
    "M",
    () => <EditFileScreen />,
    { id: "f1" },
    { materialFiles: [file] },
  ],
  [
    "Course chat with a deleted author",
    "S1",
    () => <CourseChatScreen />,
    { id: "A" },
    {
      courseMembers: [member("A", "S1")],
      loadMessages: jest.fn(async () => ({ messages, hasMore: false })),
    },
  ],
  [
    "Course chat, empty",
    "M",
    () => <CourseChatScreen />,
    { id: "A" },
    { courseMembers: [member("A", "S1")] },
  ],
  [
    "General chat",
    "S1",
    () => <GeneralChatScreen />,
    {},
    {
      loadGeneralMessages: jest.fn(async () => ({ messages, hasMore: false })),
    },
  ],
  [
    "Pay (listener of a paid course)",
    "S1",
    () => <PayScreen />,
    { id: "A" },
    {
      courses: [courseA],
      courseMembers: [member("A", "S1")],
      courseBilling: [billing],
    },
  ],
  [
    "Course details: payment section with a sent request and the materials section",
    "S1",
    () => <CourseDetailScreen />,
    { id: "A" },
    {
      courses: [courseA],
      courseMembers: [member("A", "S1")],
      courseBilling: [billing],
      materialFiles: [file],
      loadPaymentDues: jest.fn(async () => [
        { courseId: "A", deadline: "2026-11-28" },
      ]),
      loadMyPaymentRequest: jest.fn(async () => request("S1")),
    },
  ],
  [
    "Course details: Pay button (no request yet)",
    "S1",
    () => <CourseDetailScreen />,
    { id: "A" },
    {
      courses: [courseA],
      courseMembers: [member("A", "S1")],
      courseBilling: [billing],
      loadPaymentDues: jest.fn(async () => [
        { courseId: "A", deadline: "2026-11-28" },
      ]),
    },
  ],
  [
    'Courses tab card with "Payment due by …" (shared with ARU-109)',
    "S1",
    () => <CoursesScreen />,
    {},
    {
      courses: [courseA],
      courseMembers: [member("A", "S1")],
      courseBilling: [billing],
      loadPaymentDues: jest.fn(async () => [
        { courseId: "A", deadline: "2026-11-28" },
      ]),
    },
  ],
  [
    "Select courses (accountant)",
    "N",
    () => <SelectCoursesScreen />,
    {},
    { courses: [courseA, courseB], courseBilling: [billing] },
    true,
  ],
  [
    "Payments (accountant): a request, one paid, one exempt, one unpaid",
    "N",
    () => <CoursePaymentsScreen />,
    { id: "A" },
    {
      courses: [courseA],
      courseBilling: [billing],
      courseMembers: [
        member("A", "S1"),
        member("A", "S2"),
        member("A", "S3"),
        member("A", "GONE"),
      ],
      paymentRequests: [request("S1")],
      coursePayments: [
        {
          courseId: "A",
          userId: "S2",
          month,
          markedById: "N",
          markedAt: "2026-11-03T10:00:00.000Z",
        },
      ],
      paymentExemptions: [{ courseId: "A", userId: "S3" }],
    },
    true,
  ],
  [
    "Profile accountant blocks (paid course, unpaid this month, request count)",
    "N",
    () => <ProfileScreen />,
    {},
    {
      courses: [courseA],
      courseBilling: [billing],
      courseMembers: [member("A", "S1"), member("A", "S2")],
      paymentRequests: [request("S1"), request("S2")],
    },
    true,
  ],
  [
    "Profile accountant blocks (everyone has paid)",
    "N",
    () => <ProfileScreen />,
    {},
    {
      courses: [courseA],
      courseBilling: [billing],
      courseMembers: [member("A", "S1")],
      coursePayments: [
        {
          courseId: "A",
          userId: "S1",
          month,
          markedById: "N",
          markedAt: "2026-11-03T10:00:00.000Z",
        },
      ],
    },
    true,
  ],
  [
    "Manage roles with a pending and a declined request",
    "T",
    () => <RolesScreen />,
    {},
    { accessRequests: [pending, declined] },
  ],
];

describe("AC 1 / AC 8: every other in-scope screen in Russian has no Latin app text", () => {
  // Rest arguments: a callback with more parameters than a row has values is taken as a `done` callback by jest.
  it.each(cases)("%s", async (...[, who, ui, p, over, isAcc]: Case) => {
    Object.assign(params, p);
    as(who, "ru", over, isAcc);
    await render(inApp(ui()));
    await flush();
    await flush();
    expect(latinLeft()).toEqual([]);
  });

  it.each(cases)(
    "English: %s has no Cyrillic",
    async (...[_name, who, ui, p, over, isAcc]: Case) => {
      Object.assign(params, p);
      as(who, "en", over, isAcc);
      await render(inApp(ui()));
      await flush();
      await flush();
      expect(cyrillic()).toEqual([]);
      // The screen shows its content, not a "not found" / "not allowed" state, so the Russian scan above saw it too.
      if (process.env.QA_DUMP) console.log(_name, "\n", rendered().join(" | "));
      expect(rendered().join(" ")).not.toMatch(/not found|not allowed|^Only /i);
    },
  );

  it('Knowledge base view of the Materials tab, with the "Course only" badge and file size', async () => {
    as("S1", "ru", {
      materialFiles: [file],
      courseMembers: [member("A", "S1")],
    });
    await render(inApp(<MaterialsScreen />));
    await flush();
    await fireEvent.press(screen.getByRole("tab", { name: /База знаний/ }));
    expect(screen.getByText(file.name)).toBeTruthy();
    expect(latinLeft()).toEqual([]);
  });

  it("Materials empty states (Blog and Knowledge base)", async () => {
    as("S1", "ru");
    await render(inApp(<MaterialsScreen />));
    await flush();
    expect(latinLeft()).toEqual([]);
    await fireEvent.press(screen.getByRole("tab", { name: /База знаний/ }));
    expect(latinLeft()).toEqual([]);
  });

  it("Manage roles: a search with no match echoes the search text in Russian", async () => {
    as("T", "ru");
    await render(inApp(<RolesScreen />));
    await flush();
    const search = screen.getByPlaceholderText(/./);
    await fireEvent.changeText(search, "zzz-nobody");
    expect(screen.getByText(/zzz-nobody/)).toBeTruthy();
    expect(screen.getByText(/zzz-nobody/).props.children.toString()).toMatch(
      /[а-яё]/i,
    );
    expect(latinLeft()).toEqual([]);
  });

  it('Telegram not configured: "Telegram notifications are not available." is in Russian', async () => {
    delete process.env.EXPO_PUBLIC_TELEGRAM_BOT_USERNAME;
    as("S1", "ru");
    await render(inApp(<TelegramScreen />));
    await flush();
    expect(rendered().join(" ")).toMatch(/[а-яё]/i);
    expect(latinLeft()).toEqual([]);
  });
});
describe("AC 2: confirmations in Russian on iOS, both buttons included; Cancel / Keep changes nothing", () => {
  let alert: jest.SpyInstance;
  const os = Platform.OS;
  beforeEach(() => {
    // Taps the cancel button, so the confirmation's promise settles and nothing is left pending.
    alert = jest.spyOn(Alert, "alert").mockImplementation((_t, _m, buttons) => {
      buttons?.find((b) => b.style === "cancel")?.onPress?.();
    });
    Platform.OS = "ios";
  });
  afterEach(() => {
    alert.mockRestore();
    Platform.OS = os;
  });
  const lastAlert = () => {
    expect(alert).toHaveBeenCalled();
    const [title, message, buttons] =
      alert.mock.calls[alert.mock.calls.length - 1];
    return {
      title,
      message,
      buttons: (buttons ?? []).map((b: { text: string }) => b.text) as string[],
    };
  };
  const allRussian = ({
    title,
    message,
    buttons,
  }: {
    title: string;
    message?: string;
    buttons: string[];
  }) => {
    const strip = (s: string) => USER.reduce((x, u) => x.split(u).join(""), s);
    for (const s of [title, message ?? "", ...buttons]) {
      expect(strip(s)).not.toMatch(/[A-Za-z]{3,}/);
      expect(s).toMatch(/[а-яё]/i);
    }
    expect(buttons).toHaveLength(2);
  };

  it("Make mentor (Manage roles)", async () => {
    as("T", "ru");
    await render(inApp(<RolesScreen />));
    await flush();
    await fireEvent.press(
      screen.getAllByRole("button", { name: "Сделать ментором" })[0],
    );
    const a = lastAlert();
    allRussian(a);
    expect(a.buttons).toEqual(["Отмена", "Сделать ментором"]);
    expect(store().setUserRole).not.toHaveBeenCalled();
  });

  it("Make student (Manage roles), for a mentor who owns no course", async () => {
    as("T", "ru", { courses: [] });
    await render(inApp(<RolesScreen />));
    await flush();
    await fireEvent.press(
      screen.getAllByRole("button", { name: "Сделать студентом" })[0],
    );
    const a = lastAlert();
    allRussian(a);
    expect(a.buttons[0]).toBe("Отмена");
    expect(store().setUserRole).not.toHaveBeenCalled();
  });

  it("AC 3: Make student for a mentor who owns courses shows the refusal in Russian, course titles as typed", async () => {
    as("T", "ru", { courses: [courseA] });
    await render(inApp(<RolesScreen />));
    await flush();
    // Mentors sorted by name: Mentor Max (owns Algebra) first.
    await fireEvent.press(
      screen.getAllByRole("button", { name: "Сделать студентом" })[0],
    );
    expect(alert).not.toHaveBeenCalled();
    const shown = rendered().filter((s) => s.includes(courseA.title));
    expect(shown.length).toBeGreaterThan(0);
    for (const s of shown) expect(s).toMatch(/[а-яё]/i);
    expect(latinLeft()).toEqual([]);
  });

  it("Reject request (Manage roles), with the person's name", async () => {
    as("T", "ru", { accessRequests: [pending] });
    await render(inApp(<RolesScreen />));
    await flush();
    await fireEvent.press(screen.getByRole("button", { name: "Отклонить" }));
    const a = lastAlert();
    allRussian(a);
    expect(a.message).toContain(pending.name);
    expect(store().setAccessStatus).not.toHaveBeenCalled();
  });

  it('Unselect paid course: "Оставить" instead of Keep', async () => {
    as(
      "N",
      "ru",
      { courses: [courseA, courseB], courseBilling: [billing] },
      true,
    );
    await render(inApp(<SelectCoursesScreen />));
    await flush();
    await fireEvent.press(
      screen.getByRole("button", { name: "Убрать из платных" }),
    );
    const a = lastAlert();
    allRussian(a);
    expect(a.buttons).toEqual(["Оставить", "Убрать из платных"]);
    expect(a.message).toContain(courseA.title);
    expect(store().unselectPaidCourse).not.toHaveBeenCalled();
  });

  it("Delete material (author on Material details): the button is Russian; it deletes without a confirmation, as today", async () => {
    as("M", "ru", { materials: [post] });
    params.id = "p1";
    await render(inApp(<MaterialDetailScreen />));
    await flush();
    await fireEvent.press(
      screen.getByRole("button", { name: "Удалить материал" }),
    );
    expect(alert).not.toHaveBeenCalled();
    expect(store().deleteMaterial).toHaveBeenCalledWith("p1");
  });

  it("Delete file (author on File), with the file name as typed", async () => {
    as("M", "ru", { materialFiles: [file] });
    params.id = "f1";
    await render(inApp(<FileScreen />));
    await flush();
    await fireEvent.press(screen.getByRole("button", { name: "Удалить" }));
    const a = lastAlert();
    allRussian(a);
    expect(a.message).toContain(file.name);
    expect(store().deleteMaterialFile).not.toHaveBeenCalled();
  });
});

describe("AC 4: likes and limits on the real screens", () => {
  it.each([
    [0, /0 лайков/],
    [22, /22 лайка/],
  ])("%i likes on Material details read in Russian", async (n, re) => {
    as("S2", "ru", { materials: [post], materialLikes: likes(n) });
    params.id = "p1";
    await render(inApp(<MaterialDetailScreen />));
    await flush();
    if (n === 0) {
      // No count shown at 0 is also fine, as long as no English count is.
      expect(rendered().join(" ")).not.toMatch(/\blikes?\b/i);
    } else {
      expect(rendered().join(" ")).toMatch(re);
    }
  });

  it('limits: "2 000" with a non-breaking space in Russian, "2,000" in English', () => {
    expect(formatLimit(2000, "ru")).toBe("2 000");
    expect(formatLimit(2000, "en")).toBe("2,000");
  });
});

describe("AC 5: dates", () => {
  it("chat message times and material dates in Russian", async () => {
    as("S1", "ru", { materials: [post] });
    params.id = "p1";
    await render(inApp(<MaterialDetailScreen />));
    await flush();
    expect(rendered().join(" ")).toContain(formatDateIn("ru", post.createdAt));
    expect(formatDateIn("ru", post.createdAt)).toMatch(/окт/);
  });

  it("English chosen on a Russian phone: Material details date is English", async () => {
    as("S1", "en", { materials: [post] });
    params.id = "p1";
    await render(inApp(<MaterialDetailScreen />));
    await flush();
    expect(rendered().join(" ")).toMatch(/Oct/);
    expect(cyrillic()).toEqual([]);
  });
});

describe("AC 7: Materials keeps its view and author filter after a language switch", () => {
  it("Knowledge base selected, then Russian → English → Russian: still Knowledge base, in the new language", async () => {
    as("S1", "ru", {
      materials: [post],
      materialFiles: [file],
      courseMembers: [member("A", "S1")],
    });
    const view = await render(inApp(<MaterialsScreen />));
    await flush();
    await fireEvent.press(screen.getByRole("tab", { name: /База знаний/ }));
    expect(screen.getByText(file.name)).toBeTruthy();
    as("S1", "en", {
      materials: [post],
      materialFiles: [file],
      courseMembers: [member("A", "S1")],
    });
    await view.rerender(inApp(<MaterialsScreen />));
    await flush();
    expect(
      screen.getByRole("tab", { name: /Knowledge base/, selected: true }),
    ).toBeTruthy();
    expect(screen.getByText(file.name)).toBeTruthy();
    expect(cyrillic()).toEqual([]);
  });

  it("Blog author filter kept after switching to Russian", async () => {
    const other: Material = {
      ...post,
      id: "p3",
      teacherId: "N",
      title: "Nina post",
    };
    as("S1", "en", { materials: [post, other] });
    const view = await render(inApp(<MaterialsScreen />));
    await flush();
    await fireEvent.press(screen.getByRole("button", { name: /author/i }));
    await fireEvent.press(screen.getByRole("button", { name: users.N.name }));
    await flush();
    expect(screen.queryByText(post.title)).toBeNull();
    as("S1", "ru", { materials: [post, other] });
    await view.rerender(inApp(<MaterialsScreen />));
    await flush();
    expect(screen.getByText("Nina post")).toBeTruthy();
    expect(screen.queryByText(post.title)).toBeNull();
  });
});

describe("AC 3: app errors on the real screens are in Russian", () => {
  const DocumentPicker = jest.mocked(DocPicker);
  const ImagePicker = jest.mocked(ImgPicker);
  const payStore = {
    courses: [courseA],
    courseMembers: [member("A", "S1")],
    courseBilling: [billing],
  };

  it("Pay: a PDF over 10 MB shows the proof rule in Russian", async () => {
    DocumentPicker.getDocumentAsync.mockResolvedValueOnce({
      canceled: false,
      assets: [
        {
          uri: "file:///big.pdf",
          name: "big.pdf",
          mimeType: "application/pdf",
          size: 11 * 1024 * 1024,
        },
      ],
    } as never);
    as("S1", "ru", payStore);
    params.id = "A";
    await render(inApp(<PayScreen />));
    await flush();
    await fireEvent.press(screen.getByRole("button", { name: /PDF/ }));
    await flush();
    // The intro and the error both name the limit; the error is the second.
    expect(screen.getAllByText(/10 МБ/)).toHaveLength(2);
    expect(latinLeft()).toEqual([]);
  });

  it("Pay: photo access denied shows the permission message in Russian", async () => {
    ImagePicker.requestMediaLibraryPermissionsAsync.mockResolvedValueOnce({
      granted: false,
    } as never);
    as("S1", "ru", payStore);
    params.id = "A";
    await render(inApp(<PayScreen />));
    await flush();
    await fireEvent.press(screen.getByRole("button", { name: /фото/i }));
    await flush();
    expect(screen.getByText(/^Sham нужен доступ/)).toBeTruthy();
    expect(latinLeft()).toEqual([]);
  });

  it("File: opening fails offline, the message is in Russian", async () => {
    const fail = jest.fn(async () => {
      throw new Error("Network request failed");
    });
    as("M", "ru", { materialFiles: [file], getMaterialFileUrl: fail });
    params.id = "f1";
    await render(inApp(<FileScreen />));
    await flush();
    await fireEvent.press(screen.getByRole("button", { name: /PDF/ }));
    await flush();
    expect(fail).toHaveBeenCalled();
    expect(latinLeft()).toEqual([]);
  });

  it("Delete account: a wrong password is shown in Russian", async () => {
    const del = jest.fn(async () => {
      throw new Error(WRONG_PASSWORD);
    });
    as("S1", "ru", { deleteAccount: del });
    await render(inApp(<DeleteAccountForm onCancel={() => {}} />));
    await flush();
    await fireEvent.changeText(screen.getByLabelText(/Пароль/), "nope");
    await fireEvent.press(screen.getAllByRole("button")[0]);
    await flush();
    expect(del).toHaveBeenCalled();
    expect(screen.queryByText(WRONG_PASSWORD)).toBeNull();
    expect(latinLeft()).toEqual([]);
  });

  it("Delete account: the teacher is refused in Russian", async () => {
    as("T", "ru");
    await render(inApp(<DeleteAccountForm onCancel={() => {}} />));
    await flush();
    expect(
      String(screen.getByTestId("delete-account-blocked").props.children),
    ).toMatch(/[а-яё]/i);
    expect(latinLeft()).toEqual([]);
  });
});
