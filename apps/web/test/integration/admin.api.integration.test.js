import {
  createAdminManagedUser,
  disableAdminManagedUser,
  listAdminUsers,
  resetAdminManagedUserPassword,
  updateAdminManagedUser
} from "../../lib/api";
import { clearSession, writeSession } from "../../lib/session";

function jsonResponse(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json"
    }
  });
}

describe("admin api integration", () => {
  beforeEach(() => {
    clearSession();
    vi.restoreAllMocks();
    writeSession({
      accessToken: "access-token-1",
      refreshToken: "refresh-token-1",
      expiresIn: 3600,
      user: {
        id: "usr_admin",
        email: "admin@example.com",
        name: null,
        isAdmin: true,
        isActive: true
      }
    });
  });

  it("lists and mutates users through admin endpoints", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(200, {
          items: [],
          totalUsers: 0,
          limit: 25,
          offset: 0
        })
      )
      .mockResolvedValueOnce(
        jsonResponse(201, {
          user: {
            id: "usr_1",
            email: "managed@example.com",
            name: null,
            isAdmin: false,
            isActive: true
          }
        })
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          user: {
            id: "usr_1",
            email: "managed@example.com",
            name: null,
            isAdmin: true,
            isActive: true
          }
        })
      )
      .mockResolvedValueOnce(jsonResponse(200, { success: true }))
      .mockResolvedValueOnce(jsonResponse(200, { success: true }));

    vi.stubGlobal("fetch", fetchMock);

    const listPayload = await listAdminUsers();
    expect(listPayload.totalUsers).toBe(0);

    const created = await createAdminManagedUser({
      email: "managed@example.com",
      password: "super-secret-password"
    });
    expect(created.user.email).toBe("managed@example.com");

    const updated = await updateAdminManagedUser("usr_1", { isAdmin: true });
    expect(updated.user.isAdmin).toBe(true);

    const reset = await resetAdminManagedUserPassword("usr_1", "next-super-secret-password");
    expect(reset.success).toBe(true);

    const disabled = await disableAdminManagedUser("usr_1");
    expect(disabled.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });
});
