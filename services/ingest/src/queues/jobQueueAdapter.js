const amqplib = require("amqplib");

class RabbitQueueAdapter {
    constructor({ queueName, rabbitmqUrl, exchangeName, queuePrefix = "worker", logger = console }) {
        this.queueName = queueName;
        this.rabbitmqUrl = rabbitmqUrl;
        this.exchangeName = exchangeName;
        this.queuePrefix = queuePrefix;
        this.logger = logger;

        this.connection = null;
        this.channel = null;
        this.initialized = false;
    }

    get mainQueueName() {
        return `${this.queuePrefix}.${this.queueName}`;
    }

    get retryQueueName() {
        return `${this.mainQueueName}.retry`;
    }

    get dlqQueueName() {
        return `${this.mainQueueName}.dlq`;
    }

    async ensureInitialized() {
        if (this.initialized) {
            return;
        }

        this.connection = await amqplib.connect(this.rabbitmqUrl);
        this.channel = await this.connection.createConfirmChannel();

        await this.channel.assertExchange(this.exchangeName, "topic", { durable: true });
        await this.channel.assertQueue(this.mainQueueName, { durable: true });
        await this.channel.assertQueue(this.retryQueueName, {
            durable: true,
            arguments: {
                "x-dead-letter-exchange": this.exchangeName,
                "x-dead-letter-routing-key": this.queueName
            }
        });
        await this.channel.assertQueue(this.dlqQueueName, { durable: true });
        await this.channel.bindQueue(this.mainQueueName, this.exchangeName, this.queueName);

        this.initialized = true;
    }

    async add(name, payload, options = {}) {
        await this.ensureInitialized();

        const backoffDelay = Number(options?.backoff?.delay || 3000);
        const maxAttempts = Number(options?.attempts || 5);
        const messageId = options?.jobId || undefined;
        const headers = {
            attemptsMade: 0,
            maxAttempts,
            backoffDelay
        };

        this.channel.publish(this.exchangeName, name, Buffer.from(JSON.stringify(payload)), {
            persistent: true,
            contentType: "application/json",
            messageId,
            headers
        });

        await this.channel.waitForConfirms();
        return { id: messageId || null };
    }

    async close() {
        if (this.channel) {
            await this.channel.close();
            this.channel = null;
        }
        if (this.connection) {
            await this.connection.close();
            this.connection = null;
        }
        this.initialized = false;
    }
}

function createJobQueueAdapter({
    queueName,
    rabbitmqUrl,
    rabbitmqExchangeName,
    rabbitmqQueuePrefix,
    logger
}) {
    return new RabbitQueueAdapter({
        queueName,
        rabbitmqUrl,
        exchangeName: rabbitmqExchangeName,
        queuePrefix: rabbitmqQueuePrefix,
        logger
    });
}

module.exports = {
    createJobQueueAdapter
};
