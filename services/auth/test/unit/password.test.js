const {
  hashPassword,
  normalizeEmail,
  validatePassword,
  verifyPassword
} = require("../../src/auth/password");

describe("password utilities", () => {
  it("normalizes emails to lowercase and trims", () => {
    expect(normalizeEmail("  USER@Example.COM ")).toBe("user@example.com");
  });

  it("rejects passwords shorter than 8 chars", () => {
    expect(validatePassword("short")).toEqual({
      ok: false,
      reason: "Password must be at least 8 characters"
    });
  });

  it("hashes and verifies passwords", async () => {
    const passwordHash = await hashPassword("my-long-password");

    expect(passwordHash.startsWith("$argon2")).toBe(true);

    await expect(verifyPassword("my-long-password", passwordHash)).resolves.toBe(true);
    await expect(verifyPassword("wrong-password", passwordHash)).resolves.toBe(false);
  });
});
