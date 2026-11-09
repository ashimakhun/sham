// QA ARU-124: gaps in aru124-payments-order.test.tsx: the teacher gets the same order; a Paid listener whose request
// is still stored sits with Paid; a new month while the page is open resets statuses without moving rows, and the
// next focus sorts by the new month (last month's requests and marks no longer count); duplicate names keep their
// order across re-sorts; a listener who leaves and comes back is appended until the next sort; reopening the page
// sorts afresh; AC 6: header (Change period; Unselect only for accountants) and "No listeners yet" are unchanged.
// Device date: 3 Nov 2026.
import { act, render, screen, within } from "@testing-library/react-native";
import type { ReactElement } from "react";

import CoursePaymentsScreen from "@/app/accountant/[id]";
import type {
  CourseMember,
  CoursePayment,
  PaymentExemption,
  PaymentRequest,
  User,
} from "@/lib/types";

import { fakeStore, member, users } from "./helpers/fakeStore";
import { params, refocus, setStore } from "./helpers/mocks";

jest.mock("expo-router", () => require("./helpers/mocks").expoRouter);
jest.mock("@/lib/store", () => require("./helpers/mocks").store);

const NOV_3 = new Date(2026, 10, 3, 10, 0).getTime();
const DEC_1 = new Date(2026, 11, 1, 9, 0).getTime();
const MONTH = "2026-11-01";
const accountantM: User = { ...users.M, isAccountant: true };
const people: User[] = [
  { id: "Z", name: "Zed", role: "student" },
  { id: "A1", name: "Amy", role: "student" },
  { id: "B", name: "Bob", role: "student" },
  { id: "C", name: "Cat", role: "student" },
  { id: "D", name: "Dan", role: "student" },
  { id: "E", name: "Eve", role: "student" },
];
const all = [...Object.values({ ...users, M: accountantM }), ...people];
const pay = (userId: string, month = MONTH): CoursePayment => ({
  courseId: "A",
  userId,
  month,
  markedById: "M",
  markedAt: new Date(2026, 10, 2, 12).toISOString(),
});
const req = (userId: string): PaymentRequest => ({
  id: `r-${userId}`,
  courseId: "A",
  userId,
  month: MONTH,
  proofPath: `${userId}/p.jpg`,
  proofType: "image",
  sentAt: "2026-11-02T10:00:00.000Z",
});
const ex = (userId: string): PaymentExemption => ({ courseId: "A", userId });

type Data = {
  courseMembers?: CourseMember[];
  coursePayments?: CoursePayment[];
  paymentExemptions?: PaymentExemption[];
  paymentRequests?: PaymentRequest[];
};
const baseData: Required<Data> = {
  courseMembers: people.map((p) => member("A", p.id)),
  coursePayments: [pay("C"), pay("E")],
  paymentExemptions: [ex("D"), ex("E")],
  paymentRequests: [req("Z"), req("B")],
};
const storeWith = (
  data: Data,
  who: "M" | "T" = "M",
  peopleList: User[] = all,
) => {
  const base = fakeStore(who, {
    courseBilling: [
      {
        courseId: "A",
        startDay: 1,
        endDay: 5,
        selectedById: "M",
        selectedAt: "2026-11-01T10:00:00.000Z",
      },
    ],
    ...baseData,
    ...data,
  });
  return {
    ...base,
    ...(who === "M" ? { currentUser: accountantM } : {}),
    users: peopleList,
    getUser: (id?: string) => peopleList.find((u) => u.id === id),
  };
};
const order = () =>
  screen
    .getAllByTestId(/^payment-[A-Z0-9]+$/)
    .map((n) => String(n.props.testID).slice(8));
const opened = ["B", "Z", "A1", "C", "D", "E"];

async function reload(
  rerender: (el: ReactElement) => unknown,
  s: ReturnType<typeof storeWith>,
) {
  setStore(s);
  await act(async () => {
    await rerender(<CoursePaymentsScreen />);
  });
}

let now = NOV_3;
beforeEach(() => {
  jest.clearAllMocks();
  now = NOV_3;
  jest.spyOn(Date, "now").mockImplementation(() => now);
  params.id = "A";
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

it("roles: the teacher gets the same order as the accountant", async () => {
  setStore(storeWith({}, "T"));
  await render(<CoursePaymentsScreen />);
  expect(order()).toEqual(opened);
});

it("AC 1: a Paid listener whose request is still stored is in the Paid group, without the request line", async () => {
  setStore(
    storeWith({ coursePayments: [...baseData.coursePayments, pay("B")] }),
  );
  await render(<CoursePaymentsScreen />);
  expect(order()).toEqual(["Z", "A1", "B", "C", "D", "E"]);
  expect(screen.queryByTestId("request-B")).toBeNull();
});

it("new month while open: statuses reset without moving rows; the next focus sorts by the new month", async () => {
  jest.useFakeTimers({ doNotFake: ["Date"] });
  setStore(storeWith({}));
  const { rerender } = await render(<CoursePaymentsScreen />);
  expect(order()).toEqual(opened);
  // useNow ticks every 30 s: the clock passes midnight into December while the page stays open.
  now = DEC_1;
  await act(async () => {
    jest.advanceTimersByTime(30_000);
  });
  await reload(rerender, storeWith({}));
  expect(order()).toEqual(opened);
  // November's marks and requests no longer count: C is Unpaid, B and Z have no request line.
  expect(
    within(screen.getByTestId("payment-C")).getByText("Unpaid"),
  ).toBeTruthy();
  expect(screen.queryByTestId("request-B")).toBeNull();
  await refocus();
  // All unpaid A–Z (Amy, Bob, Cat, Zed), then exempt (Dan, Eve).
  expect(order()).toEqual(["A1", "B", "C", "Z", "D", "E"]);
});

it("AC 5: listeners with the same name keep the same relative order across re-sorts", async () => {
  const twins: User[] = [
    { id: "X1", name: "Sam Twin", role: "student" },
    { id: "X2", name: "Sam Twin", role: "student" },
  ];
  const list = [...all, ...twins];
  const data = {
    courseMembers: twins.map((t) => member("A", t.id)),
    coursePayments: [],
    paymentExemptions: [],
    paymentRequests: [],
  };
  setStore(storeWith(data, "M", list));
  const { rerender } = await render(<CoursePaymentsScreen />);
  const first = order();
  await refocus();
  expect(order()).toEqual(first);
  await reload(
    rerender,
    storeWith({ ...data, coursePayments: [pay("X1"), pay("X2")] }, "M", list),
  );
  await refocus();
  expect(order()).toEqual(first);
});

it("a listener who leaves and comes back while open is appended, then sorted on the next focus", async () => {
  setStore(storeWith({}));
  const { rerender } = await render(<CoursePaymentsScreen />);
  await reload(
    rerender,
    storeWith({
      courseMembers: people
        .filter((p) => p.id !== "B")
        .map((p) => member("A", p.id)),
    }),
  );
  expect(order()).toEqual(["Z", "A1", "C", "D", "E"]);
  await reload(rerender, storeWith({}));
  expect(order()).toEqual(["Z", "A1", "C", "D", "E", "B"]);
  await refocus();
  expect(order()).toEqual(opened);
});

it("AC 3: reopening the page (a fresh screen) sorts with the current data", async () => {
  setStore(storeWith({}));
  const view = await render(<CoursePaymentsScreen />);
  await view.unmount();
  setStore(
    storeWith({ coursePayments: [...baseData.coursePayments, pay("Z")] }),
  );
  await render(<CoursePaymentsScreen />);
  expect(order()).toEqual(["B", "A1", "C", "Z", "D", "E"]);
});

describe("AC 6: the rest of the page is unchanged", () => {
  it("accountant: header with period, Change period and Unselect", async () => {
    setStore(storeWith({}));
    await render(<CoursePaymentsScreen />);
    const header = within(screen.getByTestId("payments-header"));
    expect(header.getByText("Algebra")).toBeTruthy();
    expect(header.getByRole("button", { name: "Change period" })).toBeTruthy();
    expect(header.getByRole("button", { name: "Unselect" })).toBeTruthy();
  });

  it("teacher: Change period but no Unselect", async () => {
    setStore(storeWith({}, "T"));
    await render(<CoursePaymentsScreen />);
    const header = within(screen.getByTestId("payments-header"));
    expect(header.getByRole("button", { name: "Change period" })).toBeTruthy();
    expect(header.queryByRole("button", { name: "Unselect" })).toBeNull();
  });

  it('no listeners: "No listeners yet", and still after a focus', async () => {
    setStore(storeWith({ courseMembers: [] }));
    await render(<CoursePaymentsScreen />);
    expect(screen.getByText("No listeners yet")).toBeTruthy();
    await refocus();
    expect(screen.getByText("No listeners yet")).toBeTruthy();
  });

  it('access unchanged: a mentor without Accountant gets "Not allowed"', async () => {
    setStore({ ...storeWith({}), currentUser: users.M });
    await render(<CoursePaymentsScreen />);
    expect(screen.getByText("Not allowed")).toBeTruthy();
  });
});
