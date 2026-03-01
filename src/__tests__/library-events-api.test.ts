/**
 * @jest-environment node
 */
const authMock = jest.fn();
const getLibraryVersionMock = jest.fn();

jest.mock("@/lib/auth/config", () => ({
  authSession: () => authMock(),
}));

jest.mock("@/lib/db/library-version", () => ({
  getLibraryVersion: () => getLibraryVersionMock(),
}));

describe("Library events API", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("rejects unauthenticated requests", async () => {
    authMock.mockResolvedValue(null);

    const { GET } = await import("@/app/api/library/events/route");
    const res = await GET();

    expect(res.status).toBe(401);
    expect(await res.text()).toBe("Unauthorized");
    expect(getLibraryVersionMock).not.toHaveBeenCalled();
  });
});
