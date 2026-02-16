const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { Readable } = require("node:stream");

const {
  assemblePartsToFile,
  buildMediaRelativePath,
  checksumFileSha256,
  checksumSha256,
  writeUploadPart
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
      payloadStream: Readable.from(Buffer.from("world", "utf8"))
    });
    await writeUploadPart({
      originalsRoot: root,
      uploadId: "upload-1",
      partNumber: 1,
      payloadStream: Readable.from(Buffer.from("hello ", "utf8"))
    });

    const outputPath = await assemblePartsToFile({
      originalsRoot: root,
      parts: [
        { relative_part_path: "_tmp/upload-1/part-1" },
        { relative_part_path: "_tmp/upload-1/part-2" }
      ],
      outputRelativePath: "user/2026/02/media-1.jpg"
    });

    const payload = await fs.readFile(outputPath, "utf8");
    expect(payload).toBe("hello world");
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
});
