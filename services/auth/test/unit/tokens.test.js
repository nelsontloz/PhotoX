const {
  createAccessToken,
  createRefreshToken,
  hashRefreshToken,
  verifyRefreshTokenHash,
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

  it("verifies refresh token hash", async () => {
    const token = "token-value";
    const hash = await hashRefreshToken(token);
    const valid = await verifyRefreshTokenHash(token, hash);
    const invalid = await verifyRefreshTokenHash("wrong-token", hash);

    expect(valid).toBe(true);
    expect(invalid).toBe(false);
  });

  it("generates argon2 hash for new refresh tokens", async () => {
    const token = "new-token";
    const hash = await hashRefreshToken(token);
    expect(hash.startsWith("$argon2")).toBe(true);
  });

  it("rejects non-argon2 refresh token hashes", async () => {
    const token = "token-value";
    const valid = await verifyRefreshTokenHash(token, "f".repeat(64));

    expect(valid).toBe(false);
  });
});
