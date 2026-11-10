// QA ARU-138: gaps in aru138-chat-send-icon.test.tsx: the course owner, a mentor listener and the teacher get the same
// icon button and send with it (roles and access unchanged); in Russian the sending state keeps the "Отправить" label
// and reports busy; a retry after a failed send reuses the message id (no duplicate) and the next message gets a new
// one; layout: the field takes the freed width, the button never grows or shrinks and stays at the bottom of the row,
// and "…" doesn't scale with the font size.
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import { StyleSheet } from "react-native";

import CourseChatScreen from "@/app/courses/[id]/chat";
import GeneralChatScreen from "@/app/general-chat";
import { I18nContext, make } from "@/i18n/context";
import { colors } from "@/lib/theme";

import { courseA, fakeStore, member } from "./helpers/fakeStore";
import { params, setStore } from "./helpers/mocks";

jest.mock("expo-router", () => require("./helpers/mocks").expoRouter);
jest.mock("expo-router/react-navigation", () => ({ useHeaderHeight: () => 0 }));
jest.mock("@/lib/store", () => require("./helpers/mocks").store);

const hidden = { includeHiddenElements: true };
const ru = (ui: React.ReactElement) => (
  <I18nContext.Provider value={make("ru")}>{ui}</I18nContext.Provider>
);
const members = [member("A", "S1"), member("A", "M2")];
const flat = (style: any): Record<string, unknown> =>
  StyleSheet.flatten(
    typeof style === "function" ? style({ pressed: false }) : style,
  );
const sendBtn = () => screen.getByTestId("chat-send");
const field = () => screen.getByLabelText("Message");

beforeEach(() => {
  jest.clearAllMocks();
  params.id = "A";
});

it.each([
  ["the course owner", courseA.createdById],
  ["a mentor listener", "M2"],
  ["the teacher", "T"],
])(
  "AC9 / roles: %s gets the icon button in the course chat and sends with it",
  async (_who, id) => {
    const send = jest.fn(async () => {});
    setStore(
      fakeStore(id as "M", { courseMembers: members, sendMessage: send }),
    );
    await render(<CourseChatScreen />);
    expect(screen.queryAllByTestId("icon-send", hidden)).toHaveLength(1);
    expect(screen.queryByText("Send", hidden)).toBeNull();
    await fireEvent.changeText(field(), "Hello class");
    await fireEvent.press(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ courseId: "A", body: "Hello class" }),
    );
    await waitFor(() => expect(field().props.value).toBe(""));
  },
);

describe.each([
  {
    name: "General chat",
    Screen: GeneralChatScreen,
    key: "sendGeneralMessage",
  },
  { name: "course chat", Screen: CourseChatScreen, key: "sendMessage" },
])("$name", ({ Screen, key }) => {
  const open = async (send: jest.Mock, lang: "en" | "ru" = "en") => {
    setStore(fakeStore("S1", { courseMembers: members, [key]: send }));
    await render(lang === "ru" ? ru(<Screen />) : <Screen />);
  };

  it('AC6 / AC8 in Russian: while sending it is still "Отправить" (never "…"), disabled and busy', async () => {
    let finish: () => void = () => {};
    const send = jest.fn(() => new Promise<void>((r) => (finish = r)));
    await open(send, "ru");
    await fireEvent.changeText(screen.getByLabelText("Сообщение"), "Привет");
    await fireEvent.press(screen.getByRole("button", { name: "Отправить" }));
    const btn = screen.getByRole("button", { name: "Отправить" });
    expect(btn.props.accessibilityState).toMatchObject({
      disabled: true,
      busy: true,
    });
    expect(screen.queryByRole("button", { name: "…" })).toBeNull();
    expect(screen.getByText("…", hidden)).toBeTruthy();
    await act(async () => finish());
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Отправить" }).props
          .accessibilityState,
      ).toMatchObject({ busy: false }),
    );
    expect(screen.queryAllByTestId("icon-send", hidden)).toHaveLength(1);
  });

  it("AC7: a retry after a failure reuses the same message id (no duplicate); the next message gets a new id", async () => {
    const send = jest
      .fn()
      .mockRejectedValueOnce(new Error("Network request failed"))
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);
    await open(send);
    await fireEvent.changeText(field(), "Hi");
    await fireEvent.press(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText("Network request failed")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(field().props.value).toBe(""));
    const [first, retry] = send.mock.calls.map((c) => c[0]);
    expect(retry.id).toBe(first.id);
    expect(retry.body).toBe("Hi");
    await fireEvent.changeText(field(), "Next");
    await fireEvent.press(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(3));
    expect(send.mock.calls[2][0].id).not.toBe(first.id);
  });

  it("AC5: a tab-only message stays disabled and a press sends nothing", async () => {
    const send = jest.fn(async () => {});
    await open(send);
    await fireEvent.changeText(field(), "\t \t");
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    await fireEvent.press(sendBtn());
    expect(send).not.toHaveBeenCalled();
  });

  it("AC3 / edge cases: the field takes the freed width; the button is fixed 44 × 44 at the bottom of the row", async () => {
    await open(jest.fn(async () => {}));
    const row = flat(sendBtn().parent?.props.style ?? {});
    // The row is the composer's flex row; the Pressable's host parent carries it.
    const rowStyle = row.flexDirection
      ? row
      : flat(sendBtn().parent?.parent?.props.style ?? {});
    expect(rowStyle).toMatchObject({
      flexDirection: "row",
      alignItems: "flex-end",
    });
    expect(flat(field().props.style)).toMatchObject({
      flex: 1,
      maxHeight: 120,
    });
    const s = flat(sendBtn().props.style);
    expect(s).toMatchObject({
      width: 44,
      height: 44,
      borderRadius: 10,
      backgroundColor: colors.primary,
    });
    expect(s.flex).toBeUndefined();
    expect(s.flexGrow).toBeUndefined();
    expect(s.flexShrink === undefined || s.flexShrink === 0).toBe(true);
    expect(s.paddingHorizontal).toBeUndefined();
  });

  it('edge case: "…" while sending does not scale with the font size', async () => {
    await open(jest.fn(() => new Promise<void>(() => {})));
    await fireEvent.changeText(field(), "x");
    // The press handler returns nothing (the send runs inside useAction), so awaiting the press doesn't hang.
    await fireEvent.press(screen.getByRole("button", { name: "Send" }));
    expect(screen.getByText("…", hidden).props.allowFontScaling).toBe(false);
  });
});
