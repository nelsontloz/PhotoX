const { ApiError } = require("../errors");

function encodeTimelineCursor({ sortAt, id }) {
  const payload = JSON.stringify({ sortAt, id });
  return Buffer.from(payload, "utf8").toString("base64url");
}

function decodeTimelineCursor(cursor) {
  try {
    const raw = Buffer.from(cursor, "base64url").toString("utf8");
    const parsed = JSON.parse(raw);

    if (!parsed || typeof parsed !== "object") {
      throw new Error("Cursor payload is not an object");
    }

    if (typeof parsed.sortAt !== "string" || Number.isNaN(Date.parse(parsed.sortAt))) {
      throw new Error("Cursor sortAt is invalid");
    }

    if (typeof parsed.id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(parsed.id)) {
      throw new Error("Cursor id is invalid");
    }

    return {
      sortAt: parsed.sortAt,
      id: parsed.id
    };
  } catch (_err) {
    throw new ApiError(400, "VALIDATION_ERROR", "Invalid cursor value", {
      field: "cursor"
    });
  }
}

module.exports = {
  decodeTimelineCursor,
  encodeTimelineCursor
};
