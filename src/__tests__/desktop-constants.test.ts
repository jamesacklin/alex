/**
 * @jest-environment node
 *
 * The Electron main process compiles with its own tsconfig and cannot import
 * from `src/`, so a handful of identity constants exist in two places. This
 * test fails if they drift.
 */
import fs from "fs";
import path from "path";
import {
  DESKTOP_PRINCIPAL_DISPLAY_NAME,
  DESKTOP_PRINCIPAL_EMAIL,
  DESKTOP_PRINCIPAL_ID,
} from "@/lib/auth/principals";
import { NON_LOGIN_PASSWORD_HASH } from "@/lib/auth/password";

function electronConstant(name: string): string {
  const source = fs.readFileSync(
    path.join(process.cwd(), "electron", "shared-constants.ts"),
    "utf8"
  );
  const match = source.match(new RegExp(`export const ${name} = '([^']*)'`));
  if (!match) {
    throw new Error(`electron/shared-constants.ts does not define ${name}`);
  }
  return match[1];
}

describe("desktop constants stay in sync with the app", () => {
  it.each([
    ["DESKTOP_PRINCIPAL_ID", DESKTOP_PRINCIPAL_ID],
    ["DESKTOP_PRINCIPAL_EMAIL", DESKTOP_PRINCIPAL_EMAIL],
    ["DESKTOP_PRINCIPAL_DISPLAY_NAME", DESKTOP_PRINCIPAL_DISPLAY_NAME],
    ["NON_LOGIN_PASSWORD_HASH", NON_LOGIN_PASSWORD_HASH],
  ])("%s matches", (name, expected) => {
    expect(electronConstant(name)).toBe(expected);
  });

  it("the desktop sentinel is not a usable password hash", async () => {
    const { isLoginCapablePasswordHash } = await import("@/lib/auth/password");
    expect(isLoginCapablePasswordHash(NON_LOGIN_PASSWORD_HASH)).toBe(false);
  });
});
