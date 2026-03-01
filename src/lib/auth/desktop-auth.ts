export const DESKTOP_AUTH_HEADER = "x-alex-desktop-auth";

type DesktopAuthEnv = {
  ALEX_DESKTOP?: string;
  ALEX_DESKTOP_AUTH_TOKEN?: string;
};
const DEFAULT_DESKTOP_AUTH_ENV = process.env as DesktopAuthEnv;

export function isDesktopMode(env: DesktopAuthEnv = DEFAULT_DESKTOP_AUTH_ENV): boolean {
  return env.ALEX_DESKTOP === "true";
}

export function isDesktopRequestAuthorized(
  requestHeaders: Pick<Headers, "get">,
  env: DesktopAuthEnv = DEFAULT_DESKTOP_AUTH_ENV
): boolean {
  if (!isDesktopMode(env)) {
    return false;
  }

  const expectedToken = env.ALEX_DESKTOP_AUTH_TOKEN;
  if (!expectedToken) {
    return false;
  }

  const presentedToken = requestHeaders.get(DESKTOP_AUTH_HEADER);
  return presentedToken === expectedToken;
}
