// QA ARU-119: gaps in aru119-inter-font.test.tsx: every text actually drawn on the Roles, Payments, Homework details
// and Profile screens ends up in an Inter face, nested text included (AC 1, AC 4); the tab bar labels and tab headers
// (AC 1); italic Medium text has a face; the faces are
// bundled assets, not URLs (offline first start); every bundled face has the Russian and Kazakh letters (AC 7).
import { render, screen } from "@testing-library/react-native";
import { StyleSheet } from "react-native";

import CoursePaymentsScreen from "@/app/accountant/[id]";
import HomeworkDetailScreen from "@/app/homework/[id]";
import TabLayout from "@/app/(tabs)/_layout";
import ProfileScreen from "@/app/(tabs)/profile";
import RolesScreen from "@/app/roles";
import { font, INTER_FONTS } from "@/lib/fonts";
import type { CourseBilling, User } from "@/lib/types";

import { courseA, fakeStore, hw, member, users } from "./helpers/fakeStore";
import { params, setStore } from "./helpers/mocks";

// Tabs stand-in for the tab bar check: keeps the options the tab layout passes.
const mockTabOptions: { current: Record<string, unknown> } = { current: {} };
jest.mock("expo-router", () => {
  const Tabs = ({
    screenOptions,
  }: {
    screenOptions: Record<string, unknown>;
  }) => {
    mockTabOptions.current = screenOptions;
    return null;
  };
  Tabs.Screen = function Screen() {
    return null;
  };
  return {
    ...require("./helpers/mocks").expoRouter,
    Tabs,
    Redirect: () => null,
  };
});
jest.mock("@/lib/store", () => require("./helpers/mocks").store);

/** The part of Node's Buffer the cmap reader uses. */
type Buf = {
  readUInt16BE: (o: number) => number;
  readUInt32BE: (o: number) => number;
  toString: (enc: "ascii", s: number, e: number) => string;
};
const fs = jest.requireActual<{
  readFileSync: (f: string) => Buf;
  readdirSync: (d: string) => string[];
}>("fs");

type Node = {
  type: unknown;
  props: { style?: unknown; testID?: string; children?: unknown };
  parent: Node | null;
};
const family = (n: Node) =>
  (
    StyleSheet.flatten(n.props.style as never) as
      { fontFamily?: string } | undefined
  )?.fontFamily;

/** The face a host Text is drawn in: its own fontFamily, else the nearest enclosing Text's (nested text inherits). */
function effectiveFamily(n: Node): string | undefined {
  let cur: Node | null = n;
  while (cur) {
    if (cur.type === "Text") {
      const f = family(cur);
      if (f) return f;
    }
    cur = cur.parent;
  }
  return undefined;
}

/** Every drawn text on screen (icon glyph stand-ins left out) whose face isn't Inter. */
function nonInter() {
  const all: Node[] = [];
  const walk = (n: unknown) => {
    if (!n || typeof n !== "object") return;
    const node = n as Node & { children: unknown[] };
    if (node.type === "Text") all.push(node);
    node.children?.forEach(walk);
  };
  walk(screen.container);
  expect(all.length).toBeGreaterThan(3);
  return all
    .filter((n) => !String(n.props.testID ?? "").startsWith("icon-"))
    .map((n) => ({
      f: effectiveFamily(n),
      text: String(JSON.stringify(n.props.children)).slice(0, 40),
    }))
    .filter(
      ({ f }) =>
        !f || !/^Inter_(300Light|500Medium|600SemiBold)(_Italic)?$/.test(f),
    );
}

const kz: User = { ...users.S1, name: "Әлия Құрманғалиқызы Іңкәр Үһ" };

beforeEach(() => jest.clearAllMocks());

describe("AC 1 / AC 4: every text drawn on the screens the story names is Inter", () => {
  it("Roles (teacher), with a Kazakh name", async () => {
    setStore({ ...fakeStore("T"), users: [users.T, users.M, kz] } as never);
    await render(<RolesScreen />);
    expect(screen.getAllByText(kz.name).length).toBeGreaterThan(0);
    expect(nonInter()).toEqual([]);
  });

  it("Payments (accountant)", async () => {
    const accountant: User = { ...users.M, isAccountant: true };
    const billing: CourseBilling = {
      courseId: "A",
      startDay: 1,
      endDay: 5,
      selectedById: "M",
      selectedAt: "2026-11-01T10:00:00.000Z",
    };
    const all = [users.T, accountant, users.S1, users.S2];
    params.id = "A";
    setStore({
      ...fakeStore("M", {
        courses: [courseA],
        courseMembers: [member("A", "S1"), member("A", "S2")],
      }),
      currentUser: accountant,
      users: all,
      getUser: (id?: string) => all.find((u) => u.id === id),
      courseBilling: [billing],
    } as never);
    await render(<CoursePaymentsScreen />);
    expect(screen.getAllByText(users.S1.name).length).toBeGreaterThan(0);
    expect(nonInter()).toEqual([]);
  });

  it("Homework details (student) with a reviewer comment", async () => {
    params.id = "h1";
    setStore(
      fakeStore("S1", {
        courses: [courseA],
        courseMembers: [member("A", "S1")],
        visibleHomework: [
          hw({
            id: "h1",
            courseId: "A",
            studentId: "S1",
            title: "Essay",
            status: "checked",
            reviewComment: "**Good** work",
          } as never),
        ],
      }),
    );
    await render(<HomeworkDetailScreen />);
    expect(screen.getAllByText(/Essay/).length).toBeGreaterThan(0);
    expect(nonInter()).toEqual([]);
  });

  it("Profile (mentor): name card, buttons and section labels", async () => {
    setStore(fakeStore("M"));
    await render(<ProfileScreen />);
    expect(nonInter()).toEqual([]);
  });
});

describe("AC 1: the tab bar", () => {
  it("tab labels are Light 300 and tab header titles SemiBold 600", async () => {
    setStore(fakeStore("S1"));
    await render(<TabLayout />);
    expect(
      StyleSheet.flatten(mockTabOptions.current.tabBarLabelStyle as never),
    ).toMatchObject(font(300));
    expect(
      StyleSheet.flatten(mockTabOptions.current.headerTitleStyle as never),
    ).toMatchObject(font(600));
  });
});

describe("faces", () => {
  it("italic Medium text still gets a bundled Inter italic face", () => {
    expect(Object.keys(INTER_FONTS)).toContain(font(500, true).fontFamily);
  });

  it("every face is a bundled asset (require), never a URL to download (offline first start)", () => {
    for (const v of Object.values(INTER_FONTS))
      expect(typeof v === "string" && /^https?:/.test(v)).toBe(false);
    const src = String(fs.readFileSync("src/lib/fonts.ts"));
    expect(src).not.toMatch(/https?:\/\//);
    expect(src).not.toMatch(/from '@expo-google-fonts\/inter'/); // the index would bundle all 18 faces
  });

  it("no ios/ or android/ folder was added (Continuous Native Generation)", () => {
    const top = fs.readdirSync(".");
    expect(top).not.toContain("ios");
    expect(top).not.toContain("android");
  });
});

// AC 7: read each TTF's cmap (formats 4 and 12) and check the Russian and Kazakh letters are all there.
function codepoints(buf: Buf): Set<number> {
  const n = buf.readUInt16BE(4);
  let cmap = 0;
  for (let i = 0; i < n; i++) {
    const rec = 12 + i * 16;
    if (buf.toString("ascii", rec, rec + 4) === "cmap")
      cmap = buf.readUInt32BE(rec + 8);
  }
  const out = new Set<number>();
  const tables = buf.readUInt16BE(cmap + 2);
  for (let i = 0; i < tables; i++) {
    const off = cmap + buf.readUInt32BE(cmap + 4 + i * 8 + 4);
    const format = buf.readUInt16BE(off);
    if (format === 12) {
      const groups = buf.readUInt32BE(off + 12);
      for (let g = 0; g < groups; g++) {
        const s = buf.readUInt32BE(off + 16 + g * 12);
        const e = buf.readUInt32BE(off + 20 + g * 12);
        for (let c = s; c <= e; c++) out.add(c);
      }
    } else if (format === 4) {
      const segs = buf.readUInt16BE(off + 6) / 2;
      const ends = off + 14;
      const starts = ends + segs * 2 + 2;
      for (let k = 0; k < segs; k++) {
        const e = buf.readUInt16BE(ends + k * 2);
        for (
          let c = buf.readUInt16BE(starts + k * 2);
          c <= e && c !== 0xffff;
          c++
        )
          out.add(c);
      }
    }
  }
  return out;
}

it("AC 7: every bundled face has all Russian letters and the Kazakh қ ң ә ұ ү һ і ғ ө (upper and lower case)", () => {
  const letters =
    "АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯабвгдеёжзийклмнопрстуфхцчшщъыьэюяҚҢӘҰҮҺІҒӨқңәұүһіғө«»№—…";
  for (const name of Object.keys(INTER_FONTS)) {
    const dir = name.replace(/^Inter_/, "");
    const cps = codepoints(
      fs.readFileSync(
        `node_modules/@expo-google-fonts/inter/${dir}/${name}.ttf`,
      ),
    );
    const missing = [...letters].filter((ch) => !cps.has(ch.codePointAt(0)!));
    expect({ name, missing }).toEqual({ name, missing: [] });
  }
});
