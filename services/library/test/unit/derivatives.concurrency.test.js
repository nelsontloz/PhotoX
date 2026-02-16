const path = require("node:path");
const fs = require("node:fs/promises");

// Helper to mock sharp via require cache
// This ensures that we can mock the CJS export of sharp reliably
function mockSharp() {
  const sharpInstance = {
    rotate: vi.fn().mockReturnThis(),
    resize: vi.fn().mockReturnThis(),
    webp: vi.fn().mockReturnThis(),
    toFile: vi.fn().mockResolvedValue(),
  };
  const sharpMock = vi.fn(() => sharpInstance);

  try {
    const sharpPath = require.resolve("sharp");
    require.cache[sharpPath] = {
      id: sharpPath,
      filename: sharpPath,
      loaded: true,
      exports: sharpMock,
    };
    return sharpMock;
  } catch (e) {
    // If sharp is not installed, we can't fully test this, but in CI it should be present.
    // For this environment if we cleaned up node_modules, this might fail,
    // but we assume tests run in an environment with dependencies.
    console.error("Could not resolve sharp to mock it", e);
    throw e;
  }
}

// We invoke this before requiring the module under test
const sharpMock = mockSharp();

const { ensureWebpDerivative } = require("../../src/media/derivatives");

describe("ensureWebpDerivative concurrency", () => {
  const mediaRow = {
    id: "test-media-id",
    relative_path: "user/2023/photo.jpg",
  };
  const originalsRoot = "/tmp/originals";
  const derivedRoot = "/tmp/derived";
  const variant = "thumb";

  const fsAccessSpy = vi.spyOn(fs, "access");
  const fsMkdirSpy = vi.spyOn(fs, "mkdir");

  beforeEach(() => {
    vi.clearAllMocks();
    sharpMock.mockClear();
    // Re-apply mock in case it was overwritten or cache cleared (though unlikely in same test file)
    mockSharp();
  });

  it("coalesces concurrent requests for the same derivative", async () => {
    // Setup fs.access to fail (file does not exist)
    fsAccessSpy.mockRejectedValue(new Error("ENOENT"));
    // Setup fs.mkdir to succeed
    fsMkdirSpy.mockResolvedValue(undefined);

    // Setup sharp to hold execution until we release it
    let resolveProcessing;
    const processingPromise = new Promise((resolve) => {
      resolveProcessing = resolve;
    });

    const sharpInstance = {
      rotate: vi.fn().mockReturnThis(),
      resize: vi.fn().mockReturnThis(),
      webp: vi.fn().mockReturnThis(),
      toFile: vi.fn().mockImplementation(async () => {
        await processingPromise;
      }),
    };

    sharpMock.mockImplementation(() => sharpInstance);

    // Launch 3 concurrent requests
    const p1 = ensureWebpDerivative({ originalsRoot, derivedRoot, mediaRow, variant });
    const p2 = ensureWebpDerivative({ originalsRoot, derivedRoot, mediaRow, variant });
    const p3 = ensureWebpDerivative({ originalsRoot, derivedRoot, mediaRow, variant });

    // Wait a tick to let them all start and reach the critical section
    await new Promise((r) => setTimeout(r, 10));

    // Release the processing
    resolveProcessing();

    await Promise.all([p1, p2, p3]);

    // Expect sharp to be called ONLY ONCE
    expect(sharpMock).toHaveBeenCalledTimes(1);
  });

  it("cleans up pending derivatives map after completion", async () => {
    // Setup fs.access to fail first time
    fsAccessSpy.mockRejectedValueOnce(new Error("ENOENT"));
    fsMkdirSpy.mockResolvedValue(undefined);

    const sharpInstance = {
      rotate: vi.fn().mockReturnThis(),
      resize: vi.fn().mockReturnThis(),
      webp: vi.fn().mockReturnThis(),
      toFile: vi.fn().mockResolvedValue(),
    };
    sharpMock.mockImplementation(() => sharpInstance);

    await ensureWebpDerivative({ originalsRoot, derivedRoot, mediaRow, variant });
    expect(sharpMock).toHaveBeenCalledTimes(1);

    sharpMock.mockClear();
    fsAccessSpy.mockRejectedValueOnce(new Error("ENOENT"));

    await ensureWebpDerivative({ originalsRoot, derivedRoot, mediaRow, variant });
    expect(sharpMock).toHaveBeenCalledTimes(1);
  });
});
