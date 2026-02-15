const {
  createAccessToken,
  createRefreshToken,
  hashRefreshToken,
  hashLegacyRefreshToken,
  verifyRefreshTokenHash,
  verifyStoredRefreshTokenHash,
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

  it("accepts legacy sha256 refresh token hashes", async () => {
    const token = "token-value";
    const legacyHash = hashLegacyRefreshToken(token);

    const valid = await verifyStoredRefreshTokenHash(token, legacyHash);
    const invalid = await verifyStoredRefreshTokenHash("wrong-token", legacyHash);

    expect(valid).toBe(true);
    expect(invalid).toBe(false);
  });
});
