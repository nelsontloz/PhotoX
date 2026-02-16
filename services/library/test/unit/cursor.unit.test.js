const { ApiError } = require("../../src/errors");
const { decodeTimelineCursor, encodeTimelineCursor } = require("../../src/timeline/cursor");

describe("timeline cursor", () => {
  it("encodes and decodes cursor values", () => {
    const cursor = encodeTimelineCursor({
      sortAt: "2026-02-16T10:00:00.000Z",
      id: "f8e57c4f-b4d7-4f3b-8f4c-ffde26f96d43"
    });

    const decoded = decodeTimelineCursor(cursor);
    expect(decoded).toEqual({
      sortAt: "2026-02-16T10:00:00.000Z",
      id: "f8e57c4f-b4d7-4f3b-8f4c-ffde26f96d43"
    });
  });

  it("throws validation error for malformed cursor", () => {
    expect(() => decodeTimelineCursor("not-a-valid-cursor")).toThrow(ApiError);
  });
});
