const argon2 = require("argon2");

const DUMMY_PASSWORD_HASH =
  "$argon2id$v=19$m=65536,t=3,p=4$GPpy/pWjQLCKaoWZq3c/vQ$c5nWY87TeDUTvoqYaLi4kELCaeFQ/Ae0EAs2WppufD8";

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function validatePassword(password) {
  if (typeof password !== "string") {
    return {
      ok: false,
      reason: "Password must be a string"
    };
  }

  if (password.length < 12) {
    return {
      ok: false,
      reason: "Password must be at least 12 characters"
    };
  }

  if (!/[A-Z]/.test(password)) {
    return {
      ok: false,
      reason: "Password must contain at least one uppercase letter"
    };
  }

  if (!/[a-z]/.test(password)) {
    return {
      ok: false,
      reason: "Password must contain at least one lowercase letter"
    };
  }

  if (!/\d/.test(password)) {
    return {
      ok: false,
      reason: "Password must contain at least one number"
    };
  }

  if (!/[^A-Za-z0-9]/.test(password)) {
    return {
      ok: false,
      reason: "Password must contain at least one special character"
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
