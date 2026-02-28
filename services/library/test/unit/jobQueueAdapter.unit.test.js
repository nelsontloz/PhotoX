describe("jobQueueAdapter", () => {
    let channel;
    let connection;
    let createJobQueueAdapter;

    beforeEach(async () => {
        vi.resetModules();

        channel = {
            assertExchange: vi.fn().mockResolvedValue(undefined),
            assertQueue: vi.fn().mockResolvedValue(undefined),
            bindQueue: vi.fn().mockResolvedValue(undefined),
            publish: vi.fn().mockReturnValue(true),
            sendToQueue: vi.fn().mockReturnValue(true),
            waitForConfirms: vi.fn().mockResolvedValue(undefined),
            close: vi.fn().mockResolvedValue(undefined)
        };

        connection = {
            createConfirmChannel: vi.fn().mockResolvedValue(channel),
            close: vi.fn().mockResolvedValue(undefined)
        };

        const amqplib = require("amqplib");
        vi.spyOn(amqplib, "connect").mockResolvedValue(connection);

        ({ createJobQueueAdapter } = require("../../src/queues/jobQueueAdapter"));
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("publishes immediate jobs to exchange routing key", async () => {
        const queue = createJobQueueAdapter({
            queueName: "media.cleanup",
            rabbitmqUrl: "amqp://127.0.0.1:5672",
            rabbitmqExchangeName: "photox.media",
            rabbitmqQueuePrefix: "worker"
        });

        await queue.add("media.cleanup", { mediaId: "m1" }, {
            jobId: "job-1",
            attempts: 7,
            backoff: { delay: 4000 }
        });

        expect(channel.publish).toHaveBeenCalledTimes(1);
        expect(channel.publish).toHaveBeenCalledWith(
            "photox.media",
            "media.cleanup",
            expect.any(Buffer),
            expect.objectContaining({
                messageId: "job-1",
                contentType: "application/json",
                persistent: true,
                headers: {
                    attemptsMade: 0,
                    maxAttempts: 7,
                    backoffDelay: 4000
                }
            })
        );
        expect(channel.sendToQueue).not.toHaveBeenCalled();
    });

    it("routes delayed jobs to retry queue with TTL expiration", async () => {
        const queue = createJobQueueAdapter({
            queueName: "media.cleanup",
            rabbitmqUrl: "amqp://127.0.0.1:5672",
            rabbitmqExchangeName: "photox.media",
            rabbitmqQueuePrefix: "worker"
        });

        await queue.add("media.cleanup", { mediaId: "m2" }, {
            jobId: "job-2",
            delay: 60000,
            attempts: 5,
            backoff: { delay: 3000 }
        });

        expect(channel.sendToQueue).toHaveBeenCalledTimes(1);
        expect(channel.sendToQueue).toHaveBeenCalledWith(
            "worker.media.cleanup.retry",
            expect.any(Buffer),
            expect.objectContaining({
                messageId: "job-2",
                contentType: "application/json",
                persistent: true,
                expiration: "60000",
                headers: {
                    attemptsMade: 0,
                    maxAttempts: 5,
                    backoffDelay: 3000
                }
            })
        );
        expect(channel.publish).not.toHaveBeenCalled();
    });
});
