import { ApiClientError, isRetriableMediaProcessingError } from "../../lib/api";

describe("api helpers", () => {
  it("returns true for retriable playback derivative not ready errors", () => {
    const err = new ApiClientError(503, "PLAYBACK_DERIVATIVE_NOT_READY", "retry later", {
      retriable: true,
      queued: true
    });

    expect(isRetriableMediaProcessingError(err)).toBe(true);
  });

  it("returns false for non-retriable api errors", () => {
    const err = new ApiClientError(400, "VALIDATION_ERROR", "bad input", {});
    expect(isRetriableMediaProcessingError(err)).toBe(false);
  });
});

