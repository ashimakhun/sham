// QA ARU-146: gaps in aru146-workspace-signup.test.tsx / aru146-store-workspace-signup.test.tsx. Covered here: the
// sign-up error mapping keeps every other Auth error's own message in Join mode (only the database's refusal becomes
// "No workspace has this invite code"); Sign in never asks for a workspace; a blank full name still blocks; only the
// chosen field is sent (a value typed in the other one is dropped); the refused create in Russian; every `sham:` code
// of 0060 has an English, Russian and note text; the Manage roles card in Russian, a refused copy, a failed load.
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import * as Clipboard from "expo-clipboard";

import SignInScreen from "@/app/index";
import RolesScreen from "@/app/roles";
import { I18nContext, make } from "@/i18n/context";
import en from "@/i18n/en.json";
import notes from "@/i18n/notes.json";
import ru from "@/i18n/ru.json";
import {
  GENERIC_ERROR,
  INVITE_CODE_UNKNOWN,
  NETWORK_ERROR,
  RATE_LIMITED,
  USER_EXISTS,
  signUpErrorMessage,
  weakPasswordMessage,
} from "@/lib/password";

import { fakeStore } from "./helpers/fakeStore";
import { setStore } from "./helpers/mocks";

// Paths are relative to the repo root (Jest's working directory), as in aru74-migration-numbers-qa.test.ts.
const fs = jest.requireActual<{
  readFileSync: (file: string, encoding: "utf8") => string;
}>("fs");

jest.mock("expo-router", () => require("./helpers/mocks").expoRouter);
jest.mock("@/lib/store", () => require("./helpers/mocks").store);
jest.mock("expo-clipboard", () => ({
  setStringAsync: jest.fn(async () => true),
}));

const button = (name: string) => screen.getByRole("button", { name });
const inRu = (ui: React.ReactElement) => (
  <I18nContext.Provider value={make("ru")}>{ui}</I18nContext.Provider>
);
const refused = {
  message: "Database error saving new user",
  status: 500,
  code: "unexpected_failure",
  name: "AuthApiError",
};

beforeEach(() => jest.clearAllMocks());

describe("AC 4 / AC 6: sign-up error mapping", () => {
  it("only the database refusal becomes the invite-code message when joining; create gets the generic text", () => {
    expect(signUpErrorMessage(refused, "join")).toBe(INVITE_CODE_UNKNOWN);
    expect(signUpErrorMessage(refused, "create")).toBe(GENERIC_ERROR);
    // Same refusal reported without the code (older GoTrue) still counts.
    expect(
      signUpErrorMessage(
        { message: "Database error saving new user", status: 500 },
        "join",
      ),
    ).toBe(INVITE_CODE_UNKNOWN);
  });

  it.each(["join", "create"] as const)(
    "%s: other Auth errors keep their own message",
    (kind) => {
      expect(
        signUpErrorMessage(
          {
            message: "Password should be at least 8 characters.",
            status: 422,
            code: "weak_password",
          },
          kind,
        ),
      ).toBe(weakPasswordMessage("Password should be at least 8 characters."));
      expect(
        signUpErrorMessage(
          {
            message: "Too many requests",
            status: 429,
            code: "over_email_send_rate_limit",
          },
          kind,
        ),
      ).toBe(RATE_LIMITED);
      expect(
        signUpErrorMessage(
          {
            message: "User already registered",
            status: 422,
            code: "email_exists",
          },
          kind,
        ),
      ).toBe(USER_EXISTS);
      expect(
        signUpErrorMessage(
          {
            message: "Failed to fetch",
            status: 0,
            name: "AuthRetryableFetchError",
          },
          kind,
        ),
      ).toBe(NETWORK_ERROR);
    },
  );

  it("a different 500 is not mistaken for a wrong invite code", () => {
    expect(
      signUpErrorMessage(
        {
          message: "Internal Server Error",
          status: 500,
          code: "unexpected_failure",
        },
        "join",
      ),
    ).not.toBe(INVITE_CODE_UNKNOWN);
    expect(
      signUpErrorMessage(
        {
          message: "Error sending confirmation email",
          status: 500,
          code: "unexpected_failure",
        },
        "join",
      ),
    ).not.toBe(INVITE_CODE_UNKNOWN);
  });
});

describe("AC 4 / AC 5: catalog", () => {
  it("every sham: code raised by 0060 has an English, Russian and note text", () => {
    const sql = fs.readFileSync(
      "supabase/migrations/0060_workspace_signup.sql",
      "utf8",
    );
    const codes = [
      ...new Set(
        [...sql.matchAll(/hint = 'sham:([a-z_]+)'/g)].map((m) => m[1]),
      ),
    ].sort();
    expect(codes).toEqual([
      "invite_code_unknown",
      "signup_update_app",
      "workspace_name_length",
    ]);
    for (const c of codes) {
      const id = `db.${c}`;
      expect((en as Record<string, string>)[id]).toBeTruthy();
      expect((ru as Record<string, string>)[id]).toMatch(/[а-яё]/i);
      expect((notes as Record<string, string>)[id]).toBeTruthy();
    }
    expect((en as Record<string, string>)["db.signup_update_app"]).toBe(
      "Update the app to create an account.",
    );
  });
});

async function openSignUp() {
  await render(<SignInScreen />);
  await fireEvent.press(screen.getByText("Create account"));
  await fireEvent.changeText(
    screen.getByPlaceholderText("Dana Serikova"),
    "Dana",
  );
  await fireEvent.changeText(
    screen.getByPlaceholderText("you@example.com"),
    "dana@example.com",
  );
  await fireEvent.changeText(
    screen.getByPlaceholderText("At least 6 characters"),
    "secret1",
  );
}

describe("AC 1: sign-up screen", () => {
  it("Sign in never shows the workspace choice and needs none", async () => {
    const signIn = jest.fn(async () => {});
    setStore(fakeStore(null, { signIn }));
    await render(<SignInScreen />);
    expect(screen.queryByTestId("workspace-choice")).toBeNull();
    await fireEvent.changeText(
      screen.getByPlaceholderText("you@example.com"),
      "dana@example.com",
    );
    await fireEvent.changeText(
      screen.getByPlaceholderText("At least 6 characters"),
      "secret1",
    );
    expect(button("Sign in")).toBeEnabled();
  });

  it("a blank full name still keeps Create account disabled with a valid choice", async () => {
    setStore(fakeStore(null));
    await openSignUp();
    await fireEvent.press(
      screen.getByRole("tab", { name: "Create a workspace" }),
    );
    await fireEvent.changeText(
      screen.getByPlaceholderText("My school"),
      "School",
    );
    expect(button("Create account")).toBeEnabled();
    await fireEvent.changeText(
      screen.getByPlaceholderText("Dana Serikova"),
      "   ",
    );
    expect(button("Create account")).toBeDisabled();
  });

  it("only the chosen field is sent: a code typed before switching to Create is dropped, and the other way round", async () => {
    const signUp = jest.fn(async () => {});
    setStore(fakeStore(null, { signUp }));
    await openSignUp();
    await fireEvent.press(
      screen.getByRole("tab", { name: "Join a workspace" }),
    );
    await fireEvent.changeText(
      screen.getByPlaceholderText("8 letters and digits"),
      "ABCD2345",
    );
    await fireEvent.press(
      screen.getByRole("tab", { name: "Create a workspace" }),
    );
    await fireEvent.changeText(
      screen.getByPlaceholderText("My school"),
      "My school",
    );
    await fireEvent.press(button("Create account"));
    await waitFor(() => expect(signUp).toHaveBeenCalledTimes(1));
    expect(signUp).toHaveBeenLastCalledWith(
      "Dana",
      "dana@example.com",
      "secret1",
      { kind: "create", name: "My school" },
    );

    await fireEvent.press(
      screen.getByRole("tab", { name: "Join a workspace" }),
    );
    // The code typed before is kept on the Join side.
    expect(
      screen.getByPlaceholderText("8 letters and digits").props.value,
    ).toBe("ABCD2345");
    await fireEvent.press(button("Create account"));
    await waitFor(() => expect(signUp).toHaveBeenCalledTimes(2));
    expect(signUp).toHaveBeenLastCalledWith(
      "Dana",
      "dana@example.com",
      "secret1",
      { kind: "join", code: "ABCD2345" },
    );
  });

  it("Russian: the choice and fields are translated, and a refused create shows the generic Russian text", async () => {
    const signUp = jest.fn(async () => {
      throw new Error(GENERIC_ERROR);
    });
    setStore(fakeStore(null, { signUp }));
    await render(inRu(<SignInScreen />));
    await fireEvent.press(screen.getByText("Регистрация"));
    await fireEvent.changeText(
      screen.getByPlaceholderText("Дана Серикова"),
      "Аня",
    );
    await fireEvent.changeText(
      screen.getByPlaceholderText("you@example.com"),
      "a@b.c",
    );
    await fireEvent.changeText(
      screen.getByPlaceholderText("Не менее 6 символов"),
      "secret1",
    );
    await fireEvent.press(
      screen.getByRole("tab", { name: ru["signIn.workspaceCreate"] }),
    );
    expect(screen.getByText(ru["signIn.workspaceName"])).toBeTruthy();
    await fireEvent.changeText(
      screen.getByPlaceholderText(ru["signIn.workspaceNamePlaceholder"]),
      "Школа",
    );
    await fireEvent.press(
      screen.getByRole("button", { name: "Создать аккаунт" }),
    );
    expect(await screen.findByText(ru["common.genericError"])).toBeTruthy();
    expect(screen.queryByText(INVITE_CODE_UNKNOWN)).toBeNull();
    expect(screen.queryByText(ru["db.invite_code_unknown"])).toBeNull();
  });
});

describe("AC 8 / AC 9: Manage roles card", () => {
  it('Russian: labels and Copy are translated; "Скопировано" after copying', async () => {
    const getWorkspaceInvite = jest.fn(async () => ({
      name: "Моя школа",
      code: "ABCD2345",
    }));
    setStore(fakeStore("T", { getWorkspaceInvite }));
    await render(inRu(<RolesScreen />));
    expect(await screen.findByText("ABCD2345")).toBeTruthy();
    expect(screen.getByText("Моя школа")).toBeTruthy();
    expect(screen.getByText(ru["roles.inviteCode"].toUpperCase())).toBeTruthy();
    expect(screen.getByText(ru["roles.copy"])).toBeTruthy();
    await fireEvent.press(
      screen.getByRole("button", { name: ru["roles.copyLabel"] }),
    );
    expect(Clipboard.setStringAsync).toHaveBeenCalledWith("ABCD2345");
    expect(await screen.findByText(ru["roles.copied"])).toBeTruthy();
  });

  it('a refused clipboard shows no "Copied" and nothing breaks', async () => {
    (Clipboard.setStringAsync as jest.Mock).mockRejectedValueOnce(
      new Error("denied"),
    );
    setStore(
      fakeStore("T", {
        getWorkspaceInvite: jest.fn(async () => ({
          name: "Sham",
          code: "ABCD2345",
        })),
      }),
    );
    await render(<RolesScreen />);
    await screen.findByText("ABCD2345");
    await fireEvent.press(button("Copy invite code"));
    await act(async () => {});
    expect(screen.queryByText("Copied")).toBeNull();
    expect(screen.getByText("ABCD2345")).toBeTruthy();
  });

  it("the code is selectable, so it can also be copied by hand", async () => {
    setStore(
      fakeStore("T", {
        getWorkspaceInvite: jest.fn(async () => ({
          name: "Sham",
          code: "ABCD2345",
        })),
      }),
    );
    await render(<RolesScreen />);
    expect((await screen.findByTestId("invite-code")).props.selectable).toBe(
      true,
    );
  });

  it("a failed load shows no card and the rest of Manage roles still renders", async () => {
    setStore(
      fakeStore("T", {
        getWorkspaceInvite: jest.fn(async () =>
          Promise.reject(new Error("offline")),
        ),
      }),
    );
    await render(<RolesScreen />);
    await act(async () => {});
    expect(screen.queryByTestId("workspace-card")).toBeNull();
    expect(screen.queryByText("Not allowed")).toBeNull();
    expect(screen.getAllByRole("button").length).toBeGreaterThan(0);
  });
});
