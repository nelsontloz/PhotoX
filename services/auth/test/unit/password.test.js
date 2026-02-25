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

  it("rejects passwords shorter than 12 chars", () => {
    expect(validatePassword("short")).toEqual({
      ok: false,
      reason: "Password must be at least 12 characters"
    });
  });

  it("rejects passwords without uppercase", () => {
    expect(validatePassword("longpassword1!")).toEqual({
      ok: false,
      reason: "Password must contain at least one uppercase letter"
    });
  });

  it("rejects passwords without lowercase", () => {
    expect(validatePassword("LONGPASSWORD1!")).toEqual({
      ok: false,
      reason: "Password must contain at least one lowercase letter"
    });
  });

  it("rejects passwords without number", () => {
    expect(validatePassword("LongPassword!")).toEqual({
      ok: false,
      reason: "Password must contain at least one number"
    });
  });

  it("rejects passwords without special char", () => {
    expect(validatePassword("LongPassword1")).toEqual({
      ok: false,
      reason: "Password must contain at least one special character"
    });
  });

  it("hashes and verifies passwords", async () => {
    const passwordHash = await hashPassword("MyLongPassword1!");

    expect(passwordHash.startsWith("$argon2")).toBe(true);

    await expect(verifyPassword("MyLongPassword1!", passwordHash)).resolves.toBe(true);
    await expect(verifyPassword("WrongPassword1!", passwordHash)).resolves.toBe(false);
  });
});
