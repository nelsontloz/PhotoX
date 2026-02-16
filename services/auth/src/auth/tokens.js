const crypto = require("node:crypto");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");

async function hashRefreshToken(token) {
  // Use fast SHA-256 for tokens since they are high entropy and verified by signature too
  return crypto.createHash("sha256").update(token).digest("hex");
}

async function verifyRefreshTokenHash(token, hash) {
  return bcrypt.compare(token, hash);
}

function hashLegacyRefreshToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function constantTimeEqual(a, b) {
  if (a.length !== b.length) {
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

async function verifyStoredRefreshTokenHash(token, storedHash) {
  if (typeof storedHash !== "string" || storedHash.length === 0) {
    return false;
  }

  if (/^[a-f0-9]{64}$/i.test(storedHash)) {
    return constantTimeEqual(hashLegacyRefreshToken(token), storedHash);
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
