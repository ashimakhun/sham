// QA ARU-122: gaps in aru122-uppercase-controls.test.tsx, which checks the shared styles on their own. Here real screens
// are rendered in English and Russian (the catalog is on main since ARU-108/109/113) and swept:
// - AC 7: no upper-cased text holds user text (names, emails, course, homework and post titles, chat messages);
// - AC 8: no screen reader label is written in capitals, so nothing is read letter by letter;
// - upper case comes from the style, not the text: an upper-cased node never holds text already in capitals, and the
//   only catalog texts written in capitals are the section headings AC 5 keeps;
// - AC 9: the Russian Button label stays as written in the catalog, is upper-cased by the style, and can wrap;
// - the controls on Roles, the accountant page, the Homework tab and course details carry the upper-case style in
//   Russian (AC 1–4), while their titles stay as written (AC 7).
import { act, render, screen, within } from "@testing-library/react-native";
import { StyleSheet } from "react-native";

import HomeworkScreen from "@/app/(tabs)/homework";
import AccountantCourseScreen from "@/app/accountant/[id]";
import CourseDetailScreen from "@/app/courses/[id]";
import RolesScreen from "@/app/roles";
import { Button } from "@/components/ui";
import { LanguageProvider } from "@/i18n/LanguageProvider";
import en from "@/i18n/en.json";
import ru from "@/i18n/ru.json";
import { localMonth } from "@/lib/billing";
import type { AccessRequest, CourseBilling, User } from "@/lib/types";

import { courseA, courseB, fakeStore, hw, member, users } from "./helpers/fakeStore";
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
jest.mock("expo-image-picker", () => ({
  launchImageLibraryAsync: jest.fn(),
  requestMediaLibraryPermissionsAsync: jest.fn(),
}));

const flush = () => act(async () => {});
const inApp = (ui: React.ReactElement) => <LanguageProvider>{ui}</LanguageProvider>;
const hidden = { includeHiddenElements: true };

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
const billing: CourseBilling = {
  courseId: "A",
  startDay: 1,
  endDay: 28,
  selectedById: "N",
  selectedAt: "2026-11-01T10:00:00.000Z",
};

function as(who: keyof typeof users, language: "en" | "ru", over: object = {}, accountant = false) {
  const me: User = { ...users[who], language, ...(accountant ? { isAccountant: true } : {}) };
  const all = Object.values({ ...users, [who]: me });
  setStore({
    ...fakeStore(who, over),
    currentUser: me,
    users: all,
    getUser: (id?: string) => all.find((u) => u.id === id),
  });
}

// User text on these screens: it must never be upper-cased (AC 7).
const USER_TEXT = [
  ...Object.values(users).map((u) => u.name),
  courseA.title,
  courseB.title,
  pending.name,
  pending.email,
  declined.name,
  declined.email,
  "Fractions sheet",
];

type Node = { type: string; props: Record<string, unknown>; children: (Node | string)[] | null };
const textOf = (n: Node | string): string =>
  typeof n === "string" ? n : (n.children ?? []).map(textOf).join("");
const nodes = (n: Node | Node[] | null, out: Node[] = []): Node[] => {
  if (!n) return out;
  if (Array.isArray(n)) {
    n.forEach((c) => nodes(c, out));
    return out;
  }
  out.push(n);
  for (const c of n.children ?? []) if (typeof c !== "string") nodes(c, out);
  return out;
};
const all = () => nodes(screen.toJSON() as Node | Node[] | null);
const upper = (n: Node) =>
  (StyleSheet.flatten(n.props.style as object) as { textTransform?: string } | undefined)?.textTransform ===
  "uppercase";
// At least 4 letters, every one a capital: what a screen reader would spell out.
const shouting = (s: string) => {
  const letters = [...s.replace(/\{[^}]*\}/g, "")].filter((c) => c.toLowerCase() !== c.toUpperCase());
  return letters.length >= 4 && letters.every((c) => c === c.toUpperCase());
};

/** AC 7 / AC 8 / style-not-text sweep of whatever is on screen. */
function sweep() {
  const tree = all();
  const caps = tree.filter((n) => n.type === "Text" && upper(n));
  expect(caps.length).toBeGreaterThan(0);
  for (const n of caps) {
    const s = textOf(n);
    for (const u of USER_TEXT) expect({ node: s, has: s.includes(u) ? u : null }).toEqual({ node: s, has: null });
    // The style does the upper-casing, so the text itself is as written. A one-word status like "OK" is too short to count.
    expect({ node: s, shouting: shouting(s) }).toEqual({ node: s, shouting: false });
  }
  for (const n of tree) {
    const label = n.props.accessibilityLabel;
    if (typeof label === "string") expect({ label, shouting: shouting(label) }).toEqual({ label, shouting: false });
  }
  return caps.map((n) => textOf(n));
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("catalog: upper case is a style, not the text", () => {
  // Section headings were upper case before ARU-122 and stay so (AC 5); Profile's NAME label is a section label too.
  const HEADINGS = new Set([
    "profile.nameLabel",
    "homework.mentorFeedback",
    "disciplines.reviews",
    "disciplines.courses",
    "listeners.heading",
    "feedback.heading",
    "meetings.heading",
    "meetings.historyHeading",
    "files.courseMaterials",
    "accountant.header",
  ]);
  const flat = (o: object, p = ""): [string, string][] =>
    Object.entries(o).flatMap(([k, v]) =>
      typeof v === "string" ? [[p + k, v] as [string, string]] : flat(v as object, `${p}${k}.`),
    );

  it.each([
    ["en", en],
    ["ru", ru],
  ] as const)("%s: only section headings are written in capitals", (_lang, cat) => {
    const loud = flat(cat)
      .filter(([, v]) => shouting(v))
      .map(([k]) => k);
    expect(loud.filter((k) => !HEADINGS.has(k))).toEqual([]);
  });
});

describe("AC 9: Russian buttons", () => {
  it("a long Russian label stays as written, is upper-cased by the style and can wrap", async () => {
    const label = (ru as Record<string, string>)["homework.addButton"];
    await render(<Button title={label} onPress={() => {}} />);
    const text = screen.getByText(label);
    expect(text.props.numberOfLines).toBeUndefined();
    expect(StyleSheet.flatten(text.props.style)).toMatchObject({
      textTransform: "uppercase",
      fontWeight: "500",
      letterSpacing: 0.5,
    });
    expect(screen.getByRole("button", { name: label })).toBeTruthy();
    expect(shouting(label)).toBe(false);
  });
});

describe.each(["en", "ru"] as const)("real screens in %s", (lang) => {
  it("Roles (teacher, a pending and a declined request): badges upper case, names as written, icon labels in normal case", async () => {
    as("T", lang, { accessRequests: [pending, declined] });
    await render(inApp(<RolesScreen />));
    await flush();
    const caps = sweep();
    const declinedBadge = lang === "ru" ? ru["roles.declinedBadge" as keyof typeof ru] : en["roles.declinedBadge" as keyof typeof en];
    expect(caps).toContain(declinedBadge);
    // Names are not upper-cased (AC 7), and the X / check icons are read with the person's name (AC 8).
    expect(upper(screen.getByText(pending.name) as unknown as Node)).toBe(false);
    const reject = screen.getByTestId(`reject-request-${pending.id}`);
    expect(reject.props.accessibilityLabel).toContain(pending.name);
  });

  it("accountant course page: Change period and Unselect are upper-cased links, the course title is not", async () => {
    params.id = "A";
    as(
      "N",
      lang,
      {
        courses: [courseA, courseB],
        courseBilling: [billing],
        courseMembers: [member("A", "S1"), member("A", "S2")],
        coursePayments: [{ courseId: "A", userId: "S1", month: localMonth(), markedById: "N", markedAt: "2026-11-02T10:00:00.000Z" }],
      },
      true,
    );
    await render(inApp(<AccountantCourseScreen />));
    await flush();
    const caps = sweep();
    const cat = (lang === "ru" ? ru : en) as Record<string, string>;
    expect(caps).toEqual(expect.arrayContaining([cat["accountant.changePeriod"], cat["accountant.unselect"]]));
    for (const t of screen.queryAllByText(courseA.title)) expect(upper(t as unknown as Node)).toBe(false);
  });

  it("Homework tab (mentor): the filter tabs are upper case, the homework titles are not", async () => {
    as("M", lang, {
      courses: [courseA],
      courseMembers: [member("A", "S1")],
      visibleHomework: [
        hw({ id: "h1", courseId: "A", studentId: "S1", title: "Fractions sheet", status: "submitted" }),
      ],
    });
    await render(inApp(<HomeworkScreen />));
    await flush();
    sweep();
    const tabs = screen.getAllByRole("tab");
    expect(tabs.length).toBeGreaterThan(1);
    for (const tab of tabs) {
      const texts = within(tab).queryAllByText(/./, hidden);
      expect(texts.some((t) => upper(t as unknown as Node))).toBe(true);
      // The tab's own label is read as written.
      const label = tab.props.accessibilityLabel;
      if (typeof label === "string") expect(shouting(label)).toBe(false);
    }
  });

  it("course details (teacher): buttons and badges upper case; course title, owner name and listeners as written", async () => {
    params.id = "A";
    as("T", lang, { courses: [courseA], courseMembers: [member("A", "S1")] });
    await render(inApp(<CourseDetailScreen />));
    await flush();
    sweep();
    for (const t of screen.getAllByText(courseA.title)) expect(upper(t as unknown as Node)).toBe(false);
    for (const b of screen.getAllByRole("button")) {
      const label = b.props.accessibilityLabel;
      if (typeof label === "string") expect(shouting(label)).toBe(false);
    }
  });
});
