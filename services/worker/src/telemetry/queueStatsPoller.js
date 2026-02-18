const { Queue } = require("bullmq");

function redisConnectionFromUrl(redisUrl) {
  const parsed = new URL(redisUrl);
  const dbNumber = Number.parseInt(parsed.pathname.replace("/", ""), 10);

  return {
    host: parsed.hostname,
    port: Number.parseInt(parsed.port || "6379", 10),
    username: parsed.username || undefined,
    password: parsed.password || undefined,
    db: Number.isNaN(dbNumber) ? 0 : dbNumber
  };
}

class QueueStatsPoller {
  constructor({ queueNames, redisUrl, intervalMs = 5000, logger }) {
    this.queueNames = queueNames;
    this.redisUrl = redisUrl;
    this.intervalMs = intervalMs;
    this.logger = logger;
    this.timer = null;
    this.queueCounts = {};
    this.queues = new Map();
  }

  async start() {
    if (this.timer) {
      return;
    }

    for (const queueName of this.queueNames) {
      const queue = new Queue(queueName, {
        connection: redisConnectionFromUrl(this.redisUrl)
      });
      this.queues.set(queueName, queue);
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
        queue.getJobCounts("waiting", "active", "completed", "failed", "delayed").then((counts) => {
          this.queueCounts[queueName] = {
            waiting: Number(counts.waiting || 0),
            active: Number(counts.active || 0),
            completed: Number(counts.completed || 0),
            failed: Number(counts.failed || 0),
            delayed: Number(counts.delayed || 0)
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

    for (const queue of this.queues.values()) {
      await queue.close();
    }
    this.queues.clear();
  }
}

module.exports = {
  QueueStatsPoller
};
