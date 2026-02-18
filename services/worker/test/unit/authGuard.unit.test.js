const jwt = require("jsonwebtoken");

const { ApiError } = require("../../src/errors");
const { requireAdminAuth } = require("../../src/auth/guard");

describe("worker admin guard", () => {
  const secret = "worker-guard-test-secret";

  function buildRequest(token) {
    return {
      headers: {
        authorization: token ? `Bearer ${token}` : undefined
      }
    };
  }

  it("returns 401 when bearer token is missing", async () => {
    const usersRepo = {
      findById: vi.fn()
    };
    const guard = requireAdminAuth({ jwtAccessSecret: secret }, usersRepo);

    await expect(guard(buildRequest())).rejects.toBeInstanceOf(ApiError);
    await expect(guard(buildRequest())).rejects.toMatchObject({ statusCode: 401 });
  });

  it("returns 403 for authenticated non-admin user", async () => {
    const token = jwt.sign({ type: "access", email: "user@example.com" }, secret, {
      subject: "user-1",
      expiresIn: 3600
    });
    const usersRepo = {
      findById: vi.fn().mockResolvedValue({ id: "user-1", is_admin: false, is_active: true })
    };
    const guard = requireAdminAuth({ jwtAccessSecret: secret }, usersRepo);

    await expect(guard(buildRequest(token))).rejects.toMatchObject({ statusCode: 403, code: "AUTH_FORBIDDEN" });
  });

  it("passes for active admin user", async () => {
    const token = jwt.sign({ type: "access", email: "admin@example.com" }, secret, {
      subject: "admin-1",
      expiresIn: 3600
    });
    const request = buildRequest(token);
    const usersRepo = {
      findById: vi.fn().mockResolvedValue({ id: "admin-1", is_admin: true, is_active: true })
    };
    const guard = requireAdminAuth({ jwtAccessSecret: secret }, usersRepo);

    await expect(guard(request)).resolves.toBeUndefined();
    expect(request.userAuth).toMatchObject({ userId: "admin-1", isAdmin: true });
  });
});
