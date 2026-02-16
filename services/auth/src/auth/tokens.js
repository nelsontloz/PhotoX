const crypto = require("node:crypto");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const argon2 = require("argon2");

async function hashRefreshToken(token) {
  return argon2.hash(token);
}

async function verifyRefreshTokenHash(token, hash) {
  if (hash.startsWith("$argon2")) {
    return argon2.verify(hash, token);
  }
  return bcrypt.compare(token, hash);
}

function hashLegacyRefreshToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

async function verifyStoredRefreshTokenHash(token, storedHash) {
  if (typeof storedHash !== "string" || storedHash.length === 0) {
    return false;
  }

  if (/^[a-f0-9]{64}$/i.test(storedHash)) {
    return hashLegacyRefreshToken(token) === storedHash;
  }

  return verifyRefreshTokenHash(token, storedHash);
}

function createAccessToken({ user, secret, expiresInSeconds }) {
  return jwt.sign(
    {
      type: "access",
      email: user.email
    },
    secret,
    {
      subject: user.id,
      expiresIn: expiresInSeconds
    }
  );
}

function createRefreshToken({ userId, sessionId, secret, expiresInDays }) {
  const refreshToken = jwt.sign(
    {
      type: "refresh",
      sid: sessionId,
      jti: crypto.randomUUID()
    },
    secret,
    {
      subject: userId,
      expiresIn: `${expiresInDays}d`
    }
  );

  return {
    refreshToken,
    refreshExpiresAt: new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000)
  };
}

function verifyAccessToken(token, secret) {
  return jwt.verify(token, secret);
}

function verifyRefreshToken(token, secret) {
  return jwt.verify(token, secret);
}

function verifyRefreshTokenIgnoringExpiration(token, secret) {
  return jwt.verify(token, secret, { ignoreExpiration: true });
}

module.exports = {
  createAccessToken,
  createRefreshToken,
  hashRefreshToken,
  hashLegacyRefreshToken,
  verifyRefreshTokenHash,
  verifyStoredRefreshTokenHash,
  verifyAccessToken,
  verifyRefreshToken,
  verifyRefreshTokenIgnoringExpiration
};
