/**
 * @jest-environment node
 */
import { DESKTOP_AUTH_HEADER, isDesktopMode, isDesktopRequestAuthorized } from "@/lib/auth/desktop-auth";

describe("desktop auth token validation", () => {
  it("authorizes desktop requests with a matching token", () => {
    const headers = new Headers({
      [DESKTOP_AUTH_HEADER]: "token-123",
    });

    const authorized = isDesktopRequestAuthorized(headers, {
      ALEX_DESKTOP: "true",
      ALEX_DESKTOP_AUTH_TOKEN: "token-123",
    });

    expect(authorized).toBe(true);
  });

  it("rejects desktop requests with a missing token header", () => {
    const authorized = isDesktopRequestAuthorized(new Headers(), {
      ALEX_DESKTOP: "true",
      ALEX_DESKTOP_AUTH_TOKEN: "token-123",
    });

    expect(authorized).toBe(false);
  });

  it("rejects desktop requests when the token is wrong", () => {
    const headers = new Headers({
      [DESKTOP_AUTH_HEADER]: "token-abc",
    });

    const authorized = isDesktopRequestAuthorized(headers, {
      ALEX_DESKTOP: "true",
      ALEX_DESKTOP_AUTH_TOKEN: "token-xyz",
    });

    expect(authorized).toBe(false);
  });

  it("is disabled when desktop mode is off", () => {
    const headers = new Headers({
      [DESKTOP_AUTH_HEADER]: "token-123",
    });

    expect(isDesktopMode({ ALEX_DESKTOP: "false" })).toBe(false);
    expect(
      isDesktopRequestAuthorized(headers, {
        ALEX_DESKTOP: "false",
        ALEX_DESKTOP_AUTH_TOKEN: "token-123",
      })
    ).toBe(false);
  });
});
