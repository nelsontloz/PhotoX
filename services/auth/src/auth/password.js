const bcrypt = require("bcryptjs");

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

async function hashPassword(password, rounds) {
  return bcrypt.hash(password, rounds);
}

async function verifyPassword(password, passwordHash) {
  return bcrypt.compare(password, passwordHash);
}

module.exports = {
  hashPassword,
  normalizeEmail,
  validatePassword,
  verifyPassword
};
