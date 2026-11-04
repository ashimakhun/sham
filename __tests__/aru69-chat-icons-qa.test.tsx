// QA ARU-69: gaps in aru69-chat-icons.test.tsx: the card icon's label with 0 and N unread (ARU-96 removed the details
// button, so details must show none), a long title is only in the label, the Profile button
// stays first and never gets a badge, and the shared Button keeps text buttons exactly as before (no forced label,
// same colours, disabled dimming also on the icon button).
import {
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react-native";
import { StyleSheet } from "react-native";

import ProfileScreen from "@/app/(tabs)/profile";
import CourseDetailScreen from "@/app/courses/[id]";
import { CourseCard } from "@/components/CourseCard";
import { Button } from "@/components/ui";
import { colors } from "@/lib/theme";
import type { Course } from "@/lib/types";

import { courseA, fakeStore, member } from "./helpers/fakeStore";
import { params, setStore } from "./helpers/mocks";

jest.mock("expo-router", () => require("./helpers/mocks").expoRouter);
jest.mock("@/lib/store", () => require("./helpers/mocks").store);

const members = [member("A", "S1")];
const hidden = { includeHiddenElements: true };
const counts = (c: Record<string, number>) => (id: string) => c[id] ?? 0;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const styleOf = (
  node: { props: { style?: any } },
  pressed = false,
): Record<string, unknown> =>
  StyleSheet.flatten(
    typeof node.props.style === "function"
      ? node.props.style({ pressed })
      : node.props.style,
  );
const chatLabel = (node: { props: { accessibilityLabel?: string } }) =>
  node.props.accessibilityLabel;

beforeEach(() => {
  jest.clearAllMocks();
  params.id = "A";
});

// ARU-96 removed the chat button from course details: the course card's icon is the only entry point. These checks
// replace the ones that compared the details button with the card icon.
it.each([0, 1, 7, 120])(
  "ARU-96: with %i unread, course details has no chat button or badge; the card icon keeps its label",
  async (n) => {
    setStore(
      fakeStore("S1", {
        courses: [courseA],
        courseMembers: members,
        unreadCount: counts({ A: n }),
      }),
    );
    const card = await render(<CourseCard course={courseA} />);
    const count = n > 99 ? "99+" : String(n);
    const expected =
      n === 0
        ? "Open chat for Algebra"
        : `Open chat for Algebra, ${count} new message${n === 1 ? "" : "s"}`;
    expect(
      chatLabel(screen.getByRole("button", { name: /^Open chat for Algebra/ })),
    ).toBe(expected);
    await card.unmount();
    await render(<CourseDetailScreen />);
    expect(screen.queryByRole("button", { name: /^Open chat/ })).toBeNull();
    expect(screen.queryByTestId("icon-chatbubble-outline", hidden)).toBeNull();
    expect(screen.queryByTestId("unread-badge", hidden)).toBeNull();
  },
);

it("edge: a long course title is read in full by the card's chat icon, with no visible text in it", async () => {
  const long: Course = { ...courseA, title: "Advanced ".repeat(15).trim() };
  setStore(fakeStore("S1", { courses: [long], courseMembers: members }));
  await render(<CourseCard course={long} />);
  const btn = screen.getByRole("button", {
    name: `Open chat for ${long.title}`,
  });
  expect(within(btn).queryByText(long.title)).toBeNull();
});

it.each(["S1", "M", "T"] as const)(
  "AC 3 / out of scope: %s Profile: the icon button is first and never has a badge",
  async (who) => {
    setStore(fakeStore(who, { unreadCount: () => 9 }));
    await render(<ProfileScreen />);
    const all = screen.getAllByRole("button");
    const chat = all.indexOf(
      screen.getByRole("button", { name: "Open general chat" }),
    );
    const signOut = all.indexOf(
      screen.getByRole("button", { name: "Sign out" }),
    );
    expect(chat).toBeGreaterThanOrEqual(0);
    expect(chat).toBeLessThan(signOut);
    if (who === "T")
      expect(chat).toBeLessThan(
        all.indexOf(screen.getByRole("button", { name: /^Manage roles/ })),
      );
    const btn = screen.getByRole("button", { name: "Open general chat" });
    expect(within(btn).queryByTestId("unread-badge", hidden)).toBeNull();
    expect(screen.queryByText("General chat")).toBeNull();
  },
);

describe("regression: the shared Button", () => {
  it.each([
    ["primary", "#fff"],
    ["secondary", colors.primary],
    ["danger", colors.danger],
  ] as const)(
    "a %s text button keeps its text, colour and no forced label",
    async (variant, color) => {
      await render(
        <Button title="Save" variant={variant} onPress={() => {}} />,
      );
      const btn = screen.getByRole("button", { name: "Save" });
      expect(btn.props.accessibilityLabel).toBeUndefined(); // the visible text is what's read
      expect(
        StyleSheet.flatten(screen.getByText("Save").props.style).color,
      ).toBe(color);
      expect(screen.queryByTestId(/^icon-/, hidden)).toBeNull();
    },
  );

  it("a text button with unread still adds the count to its label", async () => {
    await render(<Button title="Inbox" unread={3} onPress={() => {}} />);
    expect(
      screen.getByRole("button", { name: "Inbox, 3 new messages" }),
    ).toBeTruthy();
  });

  it("edge: a disabled icon button is dimmed like other buttons, and pressing does nothing", async () => {
    const onPress = jest.fn();
    await render(
      <Button
        title="Open general chat"
        icon="chatbubble-outline"
        variant="secondary"
        disabled
        onPress={onPress}
      />,
    );
    const btn = screen.getByRole("button", { name: "Open general chat" });
    expect(styleOf(btn).opacity).toBe(0.4);
    await fireEvent.press(btn);
    expect(onPress).not.toHaveBeenCalled();
  });

  it("edge: the icon button has the same padding as a text button (44 pt with the 24 pt icon)", async () => {
    const icon = await render(
      <Button
        title="Chat"
        icon="chatbubble-outline"
        variant="secondary"
        onPress={() => {}}
      />,
    );
    const iconStyle = styleOf(icon.getByRole("button", { name: "Chat" }));
    await icon.unmount();
    await render(
      <Button title="Chat" variant="secondary" onPress={() => {}} />,
    );
    expect(iconStyle).toEqual(
      styleOf(screen.getByRole("button", { name: "Chat" })),
    );
    expect(
      (iconStyle.paddingVertical as number) * 2 + 24 - 6,
    ).toBeGreaterThanOrEqual(44);
  });
});
