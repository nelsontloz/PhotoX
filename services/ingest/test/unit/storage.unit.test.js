const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { Readable } = require("node:stream");

const {
  assemblePartsToFile,
  buildMediaRelativePath,
  checksumFileSha256,
  checksumSha256,
  writeUploadPart,
  writeUploadPartStream
} = require("../../src/upload/storage");

describe("upload storage helpers", () => {
  const root = path.join(os.tmpdir(), "photox-ingest-storage-unit-tests");

  beforeEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
    await fs.mkdir(root, { recursive: true });
  });

  afterAll(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("writes upload parts and assembles them in order", async () => {
    await writeUploadPart({
      originalsRoot: root,
      uploadId: "upload-1",
      partNumber: 2,
      payload: Buffer.from("world", "utf8")
    });
    await writeUploadPart({
      originalsRoot: root,
      uploadId: "upload-1",
      partNumber: 1,
      payload: Buffer.from("hello ", "utf8")
    });

    const { outputAbsolutePath, checksumSha256 } = await assemblePartsToFile({
      originalsRoot: root,
      parts: [
        { relative_part_path: "_tmp/upload-1/part-1" },
        { relative_part_path: "_tmp/upload-1/part-2" }
      ],
      outputRelativePath: "user/2026/02/media-1.jpg"
    });

    const payload = await fs.readFile(outputAbsolutePath, "utf8");
    expect(payload).toBe("hello world");
    expect(checksumSha256).toBeDefined(); // Or verify exact hash "hello world" -> "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9"
  });

  it("computes deterministic checksum for payload and file", async () => {
    const payload = Buffer.from("photo-content", "utf8");
    const payloadChecksum = checksumSha256(payload);

    const filePath = path.join(root, "checksum.txt");
    await fs.writeFile(filePath, payload);
    const fileChecksum = await checksumFileSha256(filePath);

    expect(fileChecksum).toBe(payloadChecksum);
  });

  it("builds media relative path with safe extension", () => {
    const fixedDate = new Date("2026-02-15T10:00:00.000Z");
    const relativePath = buildMediaRelativePath({
      userId: "user-123",
      mediaId: "media-999",
      fileName: "IMG_0001.JPG",
      now: fixedDate
    });

    expect(relativePath).toBe("user-123/2026/02/media-999.jpg");
  });

  it("writes upload part from stream and computes checksum", async () => {
    const payload = Buffer.from("streamed-part-payload", "utf8");
    const stream = Readable.from([payload.subarray(0, 8), payload.subarray(8)]);

    const result = await writeUploadPartStream({
      originalsRoot: root,
      uploadId: "upload-stream-1",
      partNumber: 1,
      payloadStream: stream,
      maxBytes: 1024
    });

    expect(result.byteSize).toBe(payload.length);
    expect(result.checksumSha256).toBe(checksumSha256(payload));

    const absolutePath = path.join(root, result.relativePartPath);
    const persisted = await fs.readFile(absolutePath);
    expect(persisted.equals(payload)).toBe(true);
  });

  it("rejects oversized streamed upload part", async () => {
    const payload = Buffer.from("oversized-stream", "utf8");

    await expect(
      writeUploadPartStream({
        originalsRoot: root,
        uploadId: "upload-stream-2",
        partNumber: 1,
        payloadStream: Readable.from([payload]),
        maxBytes: 4
      })
    ).rejects.toMatchObject({ code: "UPLOAD_PART_TOO_LARGE" });
  });
});
