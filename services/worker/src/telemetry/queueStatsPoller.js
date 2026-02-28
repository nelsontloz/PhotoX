const amqplib = require("amqplib");

class QueueStatsPoller {
  constructor({ queueNames, rabbitmqUrl, exchangeName = "photox.media", queuePrefix = "worker", intervalMs = 5000, logger }) {
    this.queueNames = queueNames;
    this.rabbitmqUrl = rabbitmqUrl;
    this.exchangeName = exchangeName;
    this.queuePrefix = queuePrefix;
    this.intervalMs = intervalMs;
    this.logger = logger;
    this.timer = null;
    this.queueCounts = {};
    this.queues = new Map();
    this.rabbitConnection = null;
    this.rabbitChannel = null;
  }

  async start() {
    if (this.timer) {
      return;
    }

    this.rabbitConnection = await amqplib.connect(this.rabbitmqUrl);
    this.rabbitChannel = await this.rabbitConnection.createChannel();
    await this.rabbitChannel.assertExchange(this.exchangeName, "topic", { durable: true });

    for (const queueName of this.queueNames) {
      const mainQueueName = `${this.queuePrefix}.${queueName}`;
      const retryQueueName = `${mainQueueName}.retry`;
      await this.rabbitChannel.assertQueue(mainQueueName, { durable: true });
      await this.rabbitChannel.assertQueue(retryQueueName, {
        durable: true,
        arguments: {
          "x-dead-letter-exchange": this.exchangeName,
          "x-dead-letter-routing-key": queueName
        }
      });
      await this.rabbitChannel.bindQueue(mainQueueName, this.exchangeName, queueName);
      this.queues.set(queueName, {
        mainQueueName,
        retryQueueName
      });

      this.queueCounts[queueName] = {
        waiting: 0,
        active: 0,
        completed: 0,
        failed: 0,
        delayed: 0
      };
    }

    await this.poll();
    this.timer = setInterval(() => {
      this.poll().catch((err) => {
        this.logger.warn({ err }, "worker telemetry queue poll failed");
      });
    }, this.intervalMs);
  }

  async poll() {
    const promises = [];

    for (const [queueName, queue] of this.queues.entries()) {
      promises.push(
        Promise.all([
          this.rabbitChannel.checkQueue(queue.mainQueueName),
          this.rabbitChannel.checkQueue(queue.retryQueueName)
        ]).then(([mainStats, retryStats]) => {
          this.queueCounts[queueName] = {
            waiting: Number(mainStats?.messageCount || 0),
            active: Number(mainStats?.consumerCount || 0),
            completed: 0,
            failed: 0,
            delayed: Number(retryStats?.messageCount || 0)
          };
        })
      );
    }

    await Promise.all(promises);
  }

  getSnapshot() {
    return JSON.parse(JSON.stringify(this.queueCounts));
  }

  async close() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    if (this.rabbitChannel) {
      await this.rabbitChannel.close();
      this.rabbitChannel = null;
    }
    if (this.rabbitConnection) {
      await this.rabbitConnection.close();
      this.rabbitConnection = null;
    }

    this.queues.clear();
  }
}

module.exports = {
  QueueStatsPoller
};
