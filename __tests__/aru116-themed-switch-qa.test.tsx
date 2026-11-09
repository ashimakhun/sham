// QA ARU-116: gaps in aru116-themed-switch.test.tsx, which checks ThemedSwitch on its own: every switch on the 5
// screens (Telegram page for each role, Accountant on Manage roles, Hidden course, Hidden discipline new and details)
// renders ON and OFF with the theme track and a white knob, OFF keeps the system track (AC 1–4); a switch disabled
// while saving keeps the theme colour and is dimmed on Android only (AC 5); labels and the saved value are unchanged
// (AC 7); the green Checked badge stays green (out of scope).
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { Platform, StyleSheet } from "react-native";

import RolesScreen from "@/app/roles";
import TelegramScreen from "@/app/telegram";
import NewCourseScreen from "@/app/courses/new";
import DisciplineScreen from "@/app/disciplines/[id]";
import NewDisciplineScreen from "@/app/disciplines/new";
import { StatusBadge } from "@/components/ui";
import { colors } from "@/lib/theme";
import type { Discipline, TelegramLink, User } from "@/lib/types";

import { fakeStore, users } from "./helpers/fakeStore";
import { params, setStore } from "./helpers/mocks";

jest.mock("expo-router", () => require("./helpers/mocks").expoRouter);
jest.mock("expo-router/react-navigation", () => ({ useHeaderHeight: () => 0 }));
jest.mock("@/lib/store", () => require("./helpers/mocks").store);

const linked: TelegramLink = {
  linkedAt: "2026-11-01T10:00:00.000Z",
  switches: {
    meeting_started: true,
    new_homework: false,
    homework_reviewed: true,
    chat_message: false,
  },
};
const math: Discipline = {
  id: "DM",
  name: "Math",
  hidden: false,
  createdById: "T",
  createdAt: "2026-11-01T10:00:00.000Z",
};
const accountantM: User = { ...users.M, isAccountant: true };
const everyone = Object.values({ ...users, M: accountantM });

const original = Platform.OS;
beforeEach(() => {
  jest.clearAllMocks();
  process.env.EXPO_PUBLIC_TELEGRAM_BOT_USERNAME = "ShamSchoolBot";
});
afterEach(() => {
  Platform.OS = original;
  delete process.env.EXPO_PUBLIC_TELEGRAM_BOT_USERNAME;
});

// The rendered native switch: onTintColor = ON track, tintColor = OFF track, thumbTintColor = knob.
const expectThemed = (sw: { props: Record<string, unknown> }) => {
  expect(sw.props.onTintColor).toBe(colors.primary);
  expect(sw.props.thumbTintColor).toBe("#FFFFFF");
  expect(sw.props.tintColor).toBeUndefined();
  expect(
    StyleSheet.flatten(sw.props.style as never)?.backgroundColor,
  ).toBeUndefined();
};
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
};

describe("AC 1–4: every switch in the app, ON and OFF", () => {
  it.each(["S1", "M", "T"] as const)(
    "Telegram notifications page (%s): every switch, on or off",
    async (who) => {
      setStore(fakeStore(who, { telegram: linked }));
      await render(<TelegramScreen />);
      const all = screen.getAllByRole("switch");
      expect(all.length).toBeGreaterThanOrEqual(4);
      expect(all.some((s) => s.props.value === true)).toBe(true);
      expect(all.some((s) => s.props.value === false)).toBe(true);
      all.forEach(expectThemed);
    },
  );

  it("Manage roles: the Accountant switch, on for one mentor and off for the others", async () => {
    setStore({
      ...fakeStore("T"),
      users: everyone,
      getUser: (id?: string) => everyone.find((u) => u.id === id),
    });
    await render(<RolesScreen />);
    const on = screen.getByRole("switch", { name: "Accountant, Mentor Max" });
    const off = screen.getByRole("switch", { name: "Accountant, Mentor Nina" });
    expect(on.props.value).toBe(true);
    expect(off.props.value).toBe(false);
    screen.getAllByRole("switch").forEach(expectThemed);
  });

  it("New course: Hidden course, off and then on", async () => {
    setStore(fakeStore("M"));
    await render(<NewCourseScreen />);
    expectThemed(screen.getByRole("switch", { name: "Hidden course" }));
    await fireEvent(
      screen.getByRole("switch", { name: "Hidden course" }),
      "valueChange",
      true,
    );
    const sw = screen.getByRole("switch", { name: "Hidden course" });
    expect(sw.props.value).toBe(true);
    expect(sw.props.accessibilityHint).toBe(
      "Only the owner, listeners and the teacher will see this course.",
    );
    expectThemed(sw);
  });

  it("New discipline: Hidden discipline, off and then on", async () => {
    setStore(fakeStore("T"));
    await render(<NewDisciplineScreen />);
    expectThemed(screen.getByLabelText("Hidden discipline"));
    await fireEvent(
      screen.getByLabelText("Hidden discipline"),
      "valueChange",
      true,
    );
    expect(screen.getByLabelText("Hidden discipline").props.value).toBe(true);
    expectThemed(screen.getByLabelText("Hidden discipline"));
  });

  it("Discipline details: Hidden discipline, off and on", async () => {
    params.id = "DM";
    setStore(fakeStore("T", { disciplines: [math] }));
    const view = await render(<DisciplineScreen />);
    expect(screen.getByLabelText("Hidden discipline").props.value).toBe(false);
    expectThemed(screen.getByLabelText("Hidden discipline"));
    setStore(fakeStore("T", { disciplines: [{ ...math, hidden: true }] }));
    await view.rerender(<DisciplineScreen />);
    expect(screen.getByLabelText("Hidden discipline").props.value).toBe(true);
    expectThemed(screen.getByLabelText("Hidden discipline"));
  });

  it("AC 1 is not the old system green: no switch has a green track", async () => {
    setStore(fakeStore("T", { telegram: linked }));
    await render(<TelegramScreen />);
    for (const sw of screen.getAllByRole("switch")) {
      expect(sw.props.onTintColor).not.toBe(colors.success);
      expect(String(sw.props.onTintColor).toLowerCase()).not.toMatch(
        /green|#34c759|#4cd964/,
      );
    }
  });
});

describe("AC 5 / AC 7: while saving", () => {
  // Toggling through the native onChange makes RN send setValue to a native switch the test renderer doesn't have;
  // that log is noise here, anything else still prints.
  let spy: jest.SpyInstance;
  beforeEach(() => {
    const realError = console.error;
    spy = jest.spyOn(console, "error").mockImplementation((...a: unknown[]) => {
      if (!String(a[0]).includes("dispatchCommand")) realError(...a);
    });
  });
  afterEach(() => spy.mockRestore());

  it("Telegram: the saving switch is disabled and keeps the theme colour; the others stay enabled; it saves the new value", async () => {
    const save = deferred();
    const store = fakeStore("M", { telegram: linked });
    (store.setTelegramNotification as jest.Mock).mockImplementation(
      () => save.promise,
    );
    setStore(store);
    await render(<TelegramScreen />);
    const first = screen.getAllByRole("switch")[0];
    const label = first.props.accessibilityLabel as string;
    await fireEvent(first, "valueChange", false);
    const saving = screen.getByRole("switch", { name: label });
    expect(saving.props.disabled).toBe(true);
    expect(saving.props.value).toBe(false);
    expectThemed(saving);
    expect(
      screen.getAllByRole("switch").filter((s) => s.props.disabled).length,
    ).toBe(1);
    expect(store.setTelegramNotification).toHaveBeenCalledWith(
      expect.any(String),
      false,
    );
    await act(async () => save.resolve());
    expect(
      screen.getByRole("switch", { name: label }).props.disabled,
    ).toBeFalsy();
  });

  it("Manage roles on Android: the Accountant switch is dimmed while saving and back to full opacity after", async () => {
    Platform.OS = "android";
    const save = deferred();
    const store = {
      ...fakeStore("T"),
      users: everyone,
      getUser: (id?: string) => everyone.find((u) => u.id === id),
    };
    (store.setAccountant as jest.Mock).mockImplementation(() => save.promise);
    setStore(store);
    const view = await render(<RolesScreen />);
    const sw = () => screen.getByLabelText("Accountant, Mentor Nina");
    expect(StyleSheet.flatten(sw().props.style)?.opacity).toBeUndefined();
    // AC 1 / AC 3 on Android: the theme track and a white knob are both set, so the knob isn't tinted.
    expect(sw().props.trackColorForTrue).toBe(colors.primary);
    expect(sw().props.thumbTintColor).toBe("#FFFFFF");
    // Toggle without awaiting the save (it stays pending until save.resolve()).
    await act(async () => {
      sw().props.onChange({ nativeEvent: { value: true } });
    });
    expect(sw().props.disabled ?? sw().props.enabled === false).toBe(true);
    expect(StyleSheet.flatten(sw().props.style)?.opacity).toBe(0.5);
    expect(store.setAccountant).toHaveBeenCalledWith("N", true);
    await act(async () => save.resolve());
    expect(StyleSheet.flatten(sw().props.style)?.opacity).toBeUndefined();
    await view.unmount(); // while still on Android, so the next test starts clean
  });

  it("Manage roles on iOS: no extra dimming while saving (the system dims it)", async () => {
    Platform.OS = "ios";
    const save = deferred();
    const store = {
      ...fakeStore("T"),
      users: everyone,
      getUser: (id?: string) => everyone.find((u) => u.id === id),
    };
    (store.setAccountant as jest.Mock).mockImplementation(() => save.promise);
    setStore(store);
    await render(<RolesScreen />);
    const sw = () => screen.getByLabelText("Accountant, Mentor Nina");
    // Toggle without awaiting the save (it stays pending until save.resolve()).
    await act(async () => {
      sw().props.onChange({ nativeEvent: { value: true } });
    });
    expect(sw().props.disabled).toBe(true);
    expect(StyleSheet.flatten(sw().props.style)?.opacity).toBeUndefined();
    expectThemed(sw());
    await act(async () => save.resolve());
  });
});

it("out of scope: the Checked badge stays green", async () => {
  await render(<StatusBadge status="checked" />);
  expect(
    StyleSheet.flatten(screen.getByText("Checked").props.style).color,
  ).toBe(colors.success);
});
