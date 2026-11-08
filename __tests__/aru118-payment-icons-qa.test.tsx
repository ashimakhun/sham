// QA ARU-118: gaps in aru118-payment-icons.test.tsx: the teacher marks and undoes with the icons; the web
// confirmation fallback; Paid + Exempt shows Exempt and Clear exempt brings back the X (AC 6); Paid -> undo -> Set
// exempt in two steps (AC 7); busy while undoing after confirming and while clearing exempt (AC 8); a failed mark keeps
// Unpaid (AC 11); marking paid removes the waiting request line (ARU-99 regression); the glyphs (green check, red X,
// 20 pt, hidden from screen readers); a long name keeps the icon on the right; no "Mark paid" / "Undo paid" text
// anywhere; students and plain mentors still get "Not allowed".
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react-native";
import { Alert, Platform, StyleSheet } from "react-native";

import CoursePaymentsScreen from "@/app/accountant/[id]";
import { localMonth } from "@/lib/billing";
import { colors, formatDate } from "@/lib/theme";
import type {
  CourseBilling,
  CoursePayment,
  PaymentRequest,
  User,
} from "@/lib/types";

import { fakeStore, member, users } from "./helpers/fakeStore";
import { params, setStore } from "./helpers/mocks";

jest.mock("expo-router", () => require("./helpers/mocks").expoRouter);
jest.mock("@/lib/store", () => require("./helpers/mocks").store);
jest.mock(
  "react-native-safe-area-context",
  () => require("react-native-safe-area-context/jest/mock").default,
);

const hidden = { includeHiddenElements: true };
const month = localMonth();
const accountantN: User = { ...users.N, isAccountant: true };
const longName: User = {
  ...users.S3,
  name: "Abigail Alexandra Konstantinopolskaya-Montgomery Studentova",
};
const all = Object.values({ ...users, N: accountantN });
const billing: CourseBilling = {
  courseId: "A",
  startDay: 1,
  endDay: 28,
  selectedById: "N",
  selectedAt: "2026-11-01T10:00:00.000Z",
};
const markedAt = "2026-11-02T12:00:00.000Z";
const pay = (userId: string): CoursePayment => ({
  courseId: "A",
  userId,
  month,
  markedById: "N",
  markedAt,
});
const req = (userId: string): PaymentRequest => ({
  id: `r-${userId}`,
  courseId: "A",
  userId,
  month,
  proofPath: `${userId}/p.jpg`,
  proofType: "image",
  sentAt: "2026-11-02T10:00:00.000Z",
});
const staff = (
  who: "N" | "T" | "M" | "S1",
  over = {},
  people: User[] = all,
) => {
  const base = fakeStore(who, {
    courseMembers: [member("A", "S1"), member("A", "S2"), member("A", "S3")],
    courseBilling: [billing],
    ...over,
  });
  return {
    ...base,
    ...(who === "N" ? { currentUser: accountantN } : {}),
    users: people,
    getUser: (id?: string) => people.find((u) => u.id === id),
  };
};
const row = (id: string) => within(screen.getByTestId(`payment-${id}`));
const flat = (node: { props: { style?: unknown } }) =>
  StyleSheet.flatten(node.props.style as never) as Record<string, unknown>;
const answer = (ok: boolean) =>
  jest
    .spyOn(Alert, "alert")
    .mockImplementation((_t, _m, buttons) =>
      buttons?.[ok ? 1 : 0]?.onPress?.(),
    );

const realOS = Platform.OS;
beforeEach(() => {
  jest.clearAllMocks();
  jest.restoreAllMocks();
  params.id = "A";
});
afterEach(() => {
  Platform.OS = realOS;
  delete (globalThis as { confirm?: unknown }).confirm;
});

describe("roles", () => {
  it("AC 3 / AC 5: the teacher marks Paid with the check mark and undoes it with the X after confirming", async () => {
    answer(true);
    const store = staff("T", { coursePayments: [pay("S1")] });
    setStore(store);
    await render(<CoursePaymentsScreen />);
    await fireEvent.press(
      screen.getByRole("button", { name: "Mark Student Sue paid" }),
    );
    await waitFor(() =>
      expect(store.markPaid).toHaveBeenCalledWith("A", "S2", month),
    );
    await fireEvent.press(
      screen.getByRole("button", { name: "Undo paid for Student Sam" }),
    );
    await waitFor(() =>
      expect(store.undoPaid).toHaveBeenCalledWith("A", "S1", month),
    );
    expect(Alert.alert).toHaveBeenCalledTimes(1);
  });

  it.each(["M", "S1"] as const)(
    'access unchanged: %s (no Accountant) gets "Not allowed" and no icons',
    async (who) => {
      setStore(staff(who));
      await render(<CoursePaymentsScreen />);
      expect(screen.getByText("Not allowed")).toBeTruthy();
      expect(screen.queryByTestId(/^(mark|undo)-paid-/)).toBeNull();
    },
  );
});

describe("AC 5: web confirmation", () => {
  it("on web the X uses window.confirm with the title and message; Cancel keeps Paid, OK undoes", async () => {
    Platform.OS = "web";
    const confirm = jest.fn(() => false);
    (globalThis as { confirm?: unknown }).confirm = confirm;
    const store = staff("N", { coursePayments: [pay("S1")] });
    setStore(store);
    await render(<CoursePaymentsScreen />);
    await fireEvent.press(screen.getByTestId("undo-paid-S1"));
    expect(confirm).toHaveBeenCalledWith(
      "Undo paid\n\nUndo paid for Student Sam for this month? They will show as Unpaid.",
    );
    expect(store.undoPaid).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    await fireEvent.press(screen.getByTestId("undo-paid-S1"));
    await waitFor(() => expect(store.undoPaid).toHaveBeenCalledTimes(1));
  });

  it("dismissing the native dialog (tap outside on Android) counts as Cancel and leaves the X usable", async () => {
    jest
      .spyOn(Alert, "alert")
      .mockImplementation((_t, _m, _b, opts) => opts?.onDismiss?.());
    const store = staff("N", { coursePayments: [pay("S1")] });
    setStore(store);
    await render(<CoursePaymentsScreen />);
    await fireEvent.press(screen.getByTestId("undo-paid-S1"));
    await act(async () => {});
    expect(store.undoPaid).not.toHaveBeenCalled();
    expect(
      screen.getByTestId("undo-paid-S1").props.accessibilityState,
    ).toMatchObject({ disabled: false });
  });
});

describe("AC 6 / AC 7: status changes", () => {
  it("AC 6: Paid and Exempt shows Exempt with no icon; after Clear exempt it shows Paid with the X and no Set exempt", async () => {
    const exempt = { courseId: "A", userId: "S1" };
    const store = staff("N", {
      coursePayments: [pay("S1")],
      paymentExemptions: [exempt],
    });
    setStore(store);
    const view = await render(<CoursePaymentsScreen />);
    expect(row("S1").getByText("Exempt")).toBeTruthy();
    expect(row("S1").queryByTestId("undo-paid-S1")).toBeNull();
    expect(row("S1").queryByTestId("mark-paid-S1")).toBeNull();
    await fireEvent.press(
      row("S1").getByRole("button", { name: "Clear exempt for Student Sam" }),
    );
    await waitFor(() =>
      expect(store.setExempt).toHaveBeenCalledWith("A", "S1", false),
    );
    setStore({ ...store, paymentExemptions: [] });
    await view.rerender(<CoursePaymentsScreen />);
    expect(row("S1").getByText(`Paid · ${formatDate(markedAt)}`)).toBeTruthy();
    expect(row("S1").getByTestId("undo-paid-S1")).toBeTruthy();
    expect(row("S1").queryByRole("button", { name: /exempt/ })).toBeNull();
  });

  it("AC 7: a Paid listener becomes Exempt in two steps: undo Paid, then Set exempt", async () => {
    answer(true);
    const store = staff("N", { coursePayments: [pay("S1")] });
    setStore(store);
    const view = await render(<CoursePaymentsScreen />);
    expect(
      row("S1").queryByRole("button", { name: "Set Student Sam exempt" }),
    ).toBeNull();
    await fireEvent.press(screen.getByTestId("undo-paid-S1"));
    await waitFor(() => expect(store.undoPaid).toHaveBeenCalled());
    setStore({ ...store, coursePayments: [] });
    await view.rerender(<CoursePaymentsScreen />);
    expect(row("S1").getByText("Unpaid")).toBeTruthy();
    await fireEvent.press(
      row("S1").getByRole("button", { name: "Set Student Sam exempt" }),
    );
    await waitFor(() =>
      expect(store.setExempt).toHaveBeenCalledWith("A", "S1", true),
    );
  });

  it("ARU-99 regression: marking a listener with a waiting request paid removes the request line on reload", async () => {
    const store = staff("N", { paymentRequests: [req("S2")] });
    setStore(store);
    const view = await render(<CoursePaymentsScreen />);
    expect(row("S2").getByTestId("request-S2")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("mark-paid-S2"));
    await waitFor(() =>
      expect(store.markPaid).toHaveBeenCalledWith("A", "S2", month),
    );
    setStore({ ...store, coursePayments: [pay("S2")] });
    await view.rerender(<CoursePaymentsScreen />);
    expect(row("S2").queryByTestId("request-S2")).toBeNull();
    expect(
      row("S2").queryByRole("button", { name: /View payment proof/ }),
    ).toBeNull();
    expect(row("S2").getByTestId("undo-paid-S2")).toBeTruthy();
  });
});

describe("AC 8 / AC 11: busy and errors", () => {
  it("AC 8: after confirming, the X is dimmed and disabled until undo finishes; a second tap does nothing", async () => {
    answer(true);
    let finish: () => void = () => {};
    const undoPaid = jest.fn(() => new Promise<void>((r) => (finish = r)));
    setStore(staff("N", { coursePayments: [pay("S1")], undoPaid }));
    await render(<CoursePaymentsScreen />);
    void fireEvent.press(screen.getByTestId("undo-paid-S1"));
    await waitFor(() =>
      expect(
        screen.getByTestId("undo-paid-S1").props.accessibilityState,
      ).toMatchObject({ disabled: true }),
    );
    expect(flat(screen.getByTestId("undo-paid-S1")).opacity).toBe(0.4);
    void fireEvent.press(screen.getByTestId("undo-paid-S1"));
    await act(async () => {});
    expect(undoPaid).toHaveBeenCalledTimes(1);
    expect(Alert.alert).toHaveBeenCalledTimes(1);
    await act(async () => finish());
    expect(
      screen.getByTestId("undo-paid-S1").props.accessibilityState,
    ).toMatchObject({ disabled: false });
  });

  it("AC 8: while Clear exempt runs, its link is dimmed and disabled", async () => {
    let finish: () => void = () => {};
    const setExempt = jest.fn(() => new Promise<void>((r) => (finish = r)));
    setStore(
      staff("N", {
        paymentExemptions: [{ courseId: "A", userId: "S3" }],
        setExempt,
      }),
    );
    await render(<CoursePaymentsScreen />);
    void fireEvent.press(
      row("S3").getByRole("button", { name: "Clear exempt for Abby Student" }),
    );
    await waitFor(() =>
      expect(
        row("S3").getByRole("button", { name: "Clear exempt for Abby Student" })
          .props.accessibilityState,
      ).toMatchObject({
        disabled: true,
      }),
    );
    expect(flat(row("S3").getByText("Clear exempt")).opacity).toBe(0.4);
    await act(async () => finish());
  });

  it("AC 11: a failed mark shows the error under the row; the row stays Unpaid with the check mark", async () => {
    const markPaid = jest.fn(async () => {
      throw new Error("Network request failed");
    });
    setStore(staff("N", { markPaid }));
    await render(<CoursePaymentsScreen />);
    await fireEvent.press(screen.getByTestId("mark-paid-S2"));
    await waitFor(() =>
      expect(row("S2").getByText("Network request failed")).toBeTruthy(),
    );
    expect(row("S2").getByText("Unpaid")).toBeTruthy();
    expect(
      row("S2").getByTestId("mark-paid-S2").props.accessibilityState,
    ).toMatchObject({ disabled: false });
  });
});

describe("look and layout", () => {
  it("AC 2 / AC 4 / AC 9: a green 20 pt check mark and a red 20 pt X, hidden from screen readers", async () => {
    setStore(staff("N", { coursePayments: [pay("S1")] }));
    await render(<CoursePaymentsScreen />);
    const check = within(screen.getByTestId("mark-paid-S2")).getByTestId(
      "icon-checkmark",
      hidden,
    );
    expect(check.props).toMatchObject({
      size: 20,
      color: colors.success,
      importantForAccessibility: "no",
    });
    expect(check.props.accessibilityElementsHidden).toBe(true);
    const x = within(screen.getByTestId("undo-paid-S1")).getByTestId(
      "icon-close",
      hidden,
    );
    expect(x.props).toMatchObject({
      size: 20,
      color: colors.danger,
      importantForAccessibility: "no",
    });
    expect(flat(screen.getByTestId("undo-paid-S1")).borderRadius).toBe(18);
  });

  it("AC 2 / long names: the icon sits on the right of a centred row; the name column flexes and wraps", async () => {
    const people = all.map((u) => (u.id === "S3" ? longName : u));
    setStore(staff("N", {}, people));
    await render(<CoursePaymentsScreen />);
    const icon = screen.getByTestId("mark-paid-S3");
    const line = icon.parent!;
    expect(flat(line)).toMatchObject({
      flexDirection: "row",
      alignItems: "center",
    });
    const kids = line.children as unknown as { props: { style?: unknown } }[];
    expect(kids[kids.length - 1]).toBe(icon);
    expect(flat(kids[0])).toMatchObject({ flex: 1 });
    const name = row("S3").getByText(longName.name);
    expect(name.props.numberOfLines).toBeUndefined();
  });

  it('AC 2 / AC 4: no "Mark paid" or "Undo paid" text link anywhere on the page', async () => {
    setStore(staff("N", { coursePayments: [pay("S1")] }));
    await render(<CoursePaymentsScreen />);
    expect(screen.queryByText(/^Mark paid$|^Undo paid$/)).toBeNull();
  });

  it("AC 1: the badge text uses the shared badge text style (so ARU-119 font changes reach it)", async () => {
    setStore(staff("N"));
    await render(<CoursePaymentsScreen />);
    const text = within(row("S1").getByTestId("status-badge")).getByText(
      "Unpaid",
    );
    expect(flat(text)).toMatchObject({ fontSize: 12, fontWeight: "600" });
  });
});
