const jwt = require("jsonwebtoken");

function verifyAccessToken(token, secret) {
  return jwt.verify(token, secret);
}

module.exports = {
  verifyAccessToken
};
