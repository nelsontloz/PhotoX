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

  it("rejects weak passwords", () => {
    expect(validatePassword("short")).toEqual({
      ok: false,
      reason: "Password must be between 12 and 128 characters"
    });

    expect(validatePassword("longpasswordwithoutnumbers")).toEqual({
      ok: false,
      reason: "Password must contain at least one uppercase letter"
    });

    expect(validatePassword("LONGPASSWORDWITHOUTLOWERCASE")).toEqual({
      ok: false,
      reason: "Password must contain at least one lowercase letter"
    });

    expect(validatePassword("LongPasswordWithoutNumbers")).toEqual({
      ok: false,
      reason: "Password must contain at least one number"
    });

    expect(validatePassword("LongPassword123WithoutSpecial")).toEqual({
      ok: false,
      reason: "Password must contain at least one special character"
    });
  });

  it("accepts strong passwords", () => {
     expect(validatePassword("Correct-Horse-Battery-Staple-123")).toEqual({
      ok: true
    });
  });

  it("hashes and verifies passwords", async () => {
    const password = "Correct-Horse-Battery-Staple-123";
    const passwordHash = await hashPassword(password);

    expect(passwordHash.startsWith("$argon2")).toBe(true);

    await expect(verifyPassword(password, passwordHash)).resolves.toBe(true);
    await expect(verifyPassword("wrong-password", passwordHash)).resolves.toBe(false);
  });
});
