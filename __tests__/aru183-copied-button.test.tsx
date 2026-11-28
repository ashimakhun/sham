// ARU-183: on Manage roles, the invite Copy button itself turns into a check mark + "Copied" for 2 seconds, with no
// separate "Copied" text next to it; the button keeps one width; the code stays on one line.
import { act, fireEvent, render, screen, within } from "@testing-library/react-native";
import * as Clipboard from "expo-clipboard";
import { AccessibilityInfo, StyleSheet } from "react-native";

import RolesScreen from "@/app/roles";
import { I18nContext, make } from "@/i18n/context";
import en from "@/i18n/en.json";
import ru from "@/i18n/ru.json";

import { fakeStore } from "./helpers/fakeStore";
import { setStore } from "./helpers/mocks";

jest.mock("expo-router", () => require("./helpers/mocks").expoRouter);
jest.mock("@/lib/store", () => require("./helpers/mocks").store);
jest.mock("expo-clipboard", () => ({
  setStringAsync: jest.fn(async () => true),
}));

const CODE = "62VACEZU";
const inRu = (ui: React.ReactElement) => (
  <I18nContext.Provider value={make("ru")}>{ui}</I18nContext.Provider>
);

async function show(lang: "en" | "ru" = "en") {
  setStore(
    fakeStore("T", {
      getWorkspaceInvite: jest.fn(async () => ({ name: "Sham", code: CODE })),
    }),
  );
  const ui = <RolesScreen />;
  const r = await render(lang === "ru" ? inRu(ui) : ui);
  await screen.findByText(CODE);
  return r;
}

const copyButton = (lang: "en" | "ru" = "en") =>
  screen.getByRole("button", {
    name: (lang === "ru" ? ru : en)["roles.copyLabel"],
  });

let announce: jest.SpyInstance;
beforeEach(() => {
  jest.clearAllMocks();
  announce = jest
    .spyOn(AccessibilityInfo, "announceForAccessibility")
    .mockImplementation(() => {});
});
afterEach(() => {
  jest.useRealTimers();
});

describe("ARU-183 Copy / Copied", () => {
  it.each(["en", "ru"] as const)(
    "%s: the button shows Copied in place of Copy, with no separate text",
    async (lang) => {
      const t = lang === "ru" ? ru : en;
      await show(lang);
      expect(screen.getByText(t["roles.copy"])).toBeTruthy();
      expect(screen.queryByText(t["roles.copied"])).toBeNull();
      await fireEvent.press(copyButton(lang));
      expect(Clipboard.setStringAsync).toHaveBeenCalledWith(CODE);
      expect(screen.getByText(t["roles.copied"])).toBeTruthy();
      expect(screen.queryByText(t["roles.copy"])).toBeNull();
      expect(screen.queryByTestId("invite-copied")).toBeNull();
      // The visible label is inside the button.
      expect(within(copyButton(lang)).getByText(t["roles.copied"])).toBeTruthy();
      expect(announce).toHaveBeenCalledTimes(1);
      expect(announce).toHaveBeenCalledWith(t["roles.copied"]);
    },
  );

  it("goes back to Copy after 2 seconds, and a second tap restarts the 2 seconds", async () => {
    jest.useFakeTimers();
    await show();
    await fireEvent.press(copyButton());
    await act(async () => {
      jest.advanceTimersByTime(1500);
    });
    await fireEvent.press(copyButton());
    expect(Clipboard.setStringAsync).toHaveBeenCalledTimes(2);
    await act(async () => {
      jest.advanceTimersByTime(1999);
    });
    expect(screen.getByText("Copied")).toBeTruthy();
    await act(async () => {
      jest.advanceTimersByTime(1);
    });
    expect(screen.getByText("Copy")).toBeTruthy();
    expect(screen.queryByText("Copied")).toBeNull();
  });

  it("a refused clipboard keeps Copy and announces nothing", async () => {
    (Clipboard.setStringAsync as jest.Mock).mockRejectedValueOnce(
      new Error("denied"),
    );
    await show();
    await fireEvent.press(copyButton());
    await act(async () => {});
    expect(screen.getByText("Copy")).toBeTruthy();
    expect(screen.queryByText("Copied")).toBeNull();
    expect(announce).not.toHaveBeenCalled();
  });

  it("both labels are always laid out, so the button's width can't depend on the state", async () => {
    await show("ru");
    const labels = () =>
      [ru["roles.copy"], ru["roles.copied"]].map(
        (text) => screen.getAllByText(text, { includeHiddenElements: true }).length,
      );
    expect(labels()).toEqual([1, 1]);
    await fireEvent.press(copyButton("ru"));
    expect(labels()).toEqual([1, 1]);
    expect(copyButton("ru").props.accessibilityLabel).toBe(ru["roles.copyLabel"]);
  });

  it("the code stays on one line, shrinks to fit and is still selectable", async () => {
    await show();
    const code = screen.getByTestId("invite-code");
    expect(code.props.numberOfLines).toBe(1);
    expect(code.props.adjustsFontSizeToFit).toBe(true);
    expect(code.props.selectable).toBe(true);
    expect(StyleSheet.flatten(code.props.style).flex).toBe(1);
  });

  it("leaving the screen while Copied shows no error, and coming back shows Copy", async () => {
    jest.useFakeTimers();
    const errors = jest.spyOn(console, "error").mockImplementation(() => {});
    const r = await show();
    await fireEvent.press(copyButton());
    await r.unmount();
    await act(async () => {
      jest.advanceTimersByTime(3000);
    });
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
    await show();
    expect(screen.getByText("Copy")).toBeTruthy();
  });
});
