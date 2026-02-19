const argon2 = require("argon2");

const DUMMY_PASSWORD_HASH =
  "$argon2id$v=19$m=65536,t=3,p=4$GPpy/pWjQLCKaoWZq3c/vQ$c5nWY87TeDUTvoqYaLi4kELCaeFQ/Ae0EAs2WppufD8";

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function validatePassword(password) {
  if (typeof password !== "string" || password.length < 8) {
    return {
      ok: false,
      reason: "Password must be at least 8 characters"
    };
  }
  return { ok: true };
}

async function hashPassword(password) {
  return argon2.hash(password, { type: argon2.argon2id });
}

async function verifyPassword(password, passwordHash) {
  if (typeof passwordHash !== "string" || !passwordHash.startsWith("$argon2")) {
    return false;
  }

  try {
    return await argon2.verify(passwordHash, password);
  } catch {
    return false;
  }
}

module.exports = {
  DUMMY_PASSWORD_HASH,
  hashPassword,
  normalizeEmail,
  validatePassword,
  verifyPassword
};
