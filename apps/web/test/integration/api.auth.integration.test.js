import { fetchCurrentUser, loginUser, logoutUser, registerUser } from "../../lib/api";
import { clearSession, readSession, writeSession } from "../../lib/session";

function jsonResponse(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json"
    }
  });
}

describe("auth api integration", () => {
  beforeEach(() => {
    clearSession();
    vi.restoreAllMocks();
  });

  it("logs in and returns auth payload", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        accessToken: "access-token-1",
        refreshToken: "refresh-token-1",
        expiresIn: 3600,
        user: {
          id: "usr_123",
          email: "user@example.com",
          name: null
        }
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const payload = await loginUser({
      email: "user@example.com",
      password: "super-secret-password"
    });

    expect(payload.user.email).toBe("user@example.com");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain("/auth/login");
  });

  it("refreshes and retries /me when access token expires", async () => {
    writeSession({
      accessToken: "old-access",
      refreshToken: "old-refresh",
      expiresIn: 3600,
      user: {
        id: "usr_123",
        email: "user@example.com",
        name: null
      }
    });

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(401, {
          error: {
            code: "AUTH_TOKEN_EXPIRED",
            message: "Token has expired",
            details: {}
          },
          requestId: "req-1"
        })
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          accessToken: "new-access",
          refreshToken: "new-refresh",
          expiresIn: 3600,
          user: {
            id: "usr_123",
            email: "user@example.com",
            name: null
          }
        })
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          user: {
            id: "usr_123",
            email: "user@example.com",
            name: null
          }
        })
      );

    vi.stubGlobal("fetch", fetchMock);

    const mePayload = await fetchCurrentUser();
    expect(mePayload.user.email).toBe("user@example.com");
    expect(fetchMock).toHaveBeenCalledTimes(3);

    const updatedSession = readSession();
    expect(updatedSession.accessToken).toBe("new-access");
    expect(updatedSession.refreshToken).toBe("new-refresh");
  });

  it("registers and logs out through auth api wrappers", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(201, {
          accessToken: "new-access",
          refreshToken: "new-refresh",
          expiresIn: 3600,
          user: {
            id: "usr_345",
            email: "new-user@example.com",
            name: null
          }
        })
      )
      .mockResolvedValueOnce(jsonResponse(200, { success: true }));

    vi.stubGlobal("fetch", fetchMock);

    const registered = await registerUser({
      email: "new-user@example.com",
      password: "super-secret-password"
    });
    expect(registered.user.email).toBe("new-user@example.com");

    const logoutResult = await logoutUser("new-refresh");
    expect(logoutResult.success).toBe(true);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toContain("/auth/register");
    expect(fetchMock.mock.calls[1][0]).toContain("/auth/logout");
  });
});
