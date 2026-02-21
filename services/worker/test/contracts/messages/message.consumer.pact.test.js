const path = require("node:path");
const { MessageConsumerPact, MatchersV3 } = require("@pact-foundation/pact");

const { like, regex } = MatchersV3;

const UUID_REGEX = "^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$";
const TIMESTAMP_REGEX = "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{3})?Z$";
const SHA256_REGEX = "^[a-f0-9]{64}$";

describe("worker message consumer pacts", () => {
  it("accepts ingest media.process payload", async () => {
    const messagePact = new MessageConsumerPact({
      consumer: "worker-service",
      provider: "ingest-service",
      dir: path.resolve(__dirname, "../../../pacts")
    });

    await messagePact
      .expectsToReceive("a command to process a newly uploaded media file")
      .withMetadata({ contentType: "application/json" })
      .withContent({
        mediaId: regex(UUID_REGEX, "55555555-5555-4555-8555-555555555555"),
        ownerId: regex(UUID_REGEX, "11111111-1111-4111-8111-111111111111"),
        relativePath: like("11111111-1111-4111-8111-111111111111/2026/02/55555555-5555-4555-8555-555555555555.jpg"),
        checksumSha256: regex(SHA256_REGEX, "de4ecf4e0d0f157c8142fdb7f0e6f9f607c37d9b233830f70f7f83b4f04f9b69"),
        uploadedAt: regex(TIMESTAMP_REGEX, "2026-02-18T12:00:00.000Z")
      })
      .verify(async (message) => {
        expect(message.contents).toHaveProperty("mediaId");
        expect(message.contents).toHaveProperty("ownerId");
        expect(message.contents).toHaveProperty("relativePath");
        expect(message.contents).toHaveProperty("checksumSha256");
        expect(message.contents).toHaveProperty("uploadedAt");
      });
  });

  it("accepts library media.derivatives.generate payload", async () => {
    const messagePact = new MessageConsumerPact({
      consumer: "worker-service",
      provider: "library-service",
      dir: path.resolve(__dirname, "../../../pacts")
    });

    await messagePact
      .expectsToReceive("a command to generate thumbnails and variants for a media item")
      .withMetadata({ contentType: "application/json" })
      .withContent({
        mediaId: regex(UUID_REGEX, "55555555-5555-4555-8555-555555555555"),
        relativePath: like("11111111-1111-4111-8111-111111111111/2026/02/55555555-5555-4555-8555-555555555555.jpg"),
        ownerId: like("11111111-1111-4111-8111-111111111111"),
        requestedAt: regex(TIMESTAMP_REGEX, "2026-02-18T12:00:10.000Z")
      })
      .verify(async (message) => {
        expect(message.contents).toHaveProperty("mediaId");
        expect(message.contents).toHaveProperty("relativePath");
      });
  });

  it("accepts library media.cleanup payload", async () => {
    const messagePact = new MessageConsumerPact({
      consumer: "worker-service",
      provider: "library-service",
      dir: path.resolve(__dirname, "../../../pacts")
    });

    await messagePact
      .expectsToReceive("a command to permanently delete a soft-deleted media item")
      .withMetadata({ contentType: "application/json" })
      .withContent({
        mediaId: regex(UUID_REGEX, "55555555-5555-4555-8555-555555555555"),
        ownerId: regex(UUID_REGEX, "11111111-1111-4111-8111-111111111111"),
        hardDeleteAt: regex(TIMESTAMP_REGEX, "2026-03-20T12:00:00.000Z")
      })
      .verify(async (message) => {
        expect(message.contents).toHaveProperty("mediaId");
        expect(message.contents).toHaveProperty("ownerId");
        expect(message.contents).toHaveProperty("hardDeleteAt");
      });
  });
});
