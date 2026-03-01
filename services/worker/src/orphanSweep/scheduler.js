class OrphanSweepScheduler {
    constructor({
        enabled = true,
        intervalMs,
        run,
        logger,
        now = () => new Date(),
        initialRun = true
    }) {
        this.enabled = Boolean(enabled);
        this.intervalMs = intervalMs;
        this.run = run;
        this.logger = logger;
        this.now = now;
        this.initialRun = Boolean(initialRun);

        this.timer = null;
        this.running = false;
    }

    async executeTick(trigger) {
        if (this.running) {
            this.logger?.warn({ trigger }, "orphan sweep scheduler tick skipped because previous tick is still running");
            return;
        }

        this.running = true;
        try {
            await this.run({
                trigger,
                requestedAt: this.now()
            });
        } catch (err) {
            this.logger?.error({ trigger, err }, "orphan sweep scheduler tick failed");
        } finally {
            this.running = false;
        }
    }

    async start() {
        if (!this.enabled || this.timer) {
            return;
        }

        if (this.initialRun) {
            await this.executeTick("startup");
        }

        this.timer = setInterval(() => {
            this.executeTick("interval");
        }, this.intervalMs);
    }

    async close() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }
}

module.exports = {
    OrphanSweepScheduler
};
