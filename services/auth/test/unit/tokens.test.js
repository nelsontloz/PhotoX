const {
  createAccessToken,
  createRefreshToken,
  hashToken,
  verifyAccessToken,
  verifyRefreshToken
} = require("../../src/auth/tokens");

describe("token utilities", () => {
  it("creates and verifies access token", () => {
    const accessToken = createAccessToken({
      user: { id: "user-1", email: "user@example.com" },
      secret: "test-secret",
      expiresInSeconds: 60
    });

    const payload = verifyAccessToken(accessToken, "test-secret");
    expect(payload.sub).toBe("user-1");
    expect(payload.type).toBe("access");
  });

  it("creates and verifies refresh token with sid", () => {
    const { refreshToken } = createRefreshToken({
      userId: "user-1",
      sessionId: "session-1",
      secret: "refresh-secret",
      expiresInDays: 1
    });

    const payload = verifyRefreshToken(refreshToken, "refresh-secret");
    expect(payload.sub).toBe("user-1");
    expect(payload.sid).toBe("session-1");
    expect(payload.type).toBe("refresh");
  });

  it("hashToken is deterministic", () => {
    const one = hashToken("token-value");
    const two = hashToken("token-value");
    const three = hashToken("another-token");

    expect(one).toBe(two);
    expect(one).not.toBe(three);
  });
});
