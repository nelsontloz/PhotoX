import { createHmac, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { BullMqService } from '../../src/queue/bullmq.service';
import { TEST_WORKER_SECRET } from './test-setup';
import {
  closeTestApp,
  createTestApp,
  resetTestApp,
  seedOriginal,
  signJob,
  waitForJob,
  type TestApp,
} from './helpers';

describe('Job binding (H1 ingress verification)', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await createTestApp();
  }, 120_000);

  afterAll(async () => {
    await closeTestApp(testApp);
  });

  beforeEach(async () => {
    await resetTestApp(testApp);
  });

  async function seedPhoto(userId: string) {
    const imageBuffer = await sharp({
      create: { width: 64, height: 64, channels: 3, background: 'red' },
    })
      .png()
      .toBuffer();
    return seedOriginal(testApp, { userId, bytes: imageBuffer, mimeType: 'image/png', ext: 'png' });
  }

  it.each([
    {
      queue: 'process-thumbnail',
      jobName: 'thumbnail',
      sigKind: 'sig-less thumbnail',
      makePayload: (ctx: { victim: string; assetId: string; fileId: string }) => ({
        assetId: ctx.assetId,
        fileId: ctx.fileId,
        size: 'sm',
        userId: ctx.victim,
      }),
    },
    {
      queue: 'process-thumbnail',
      jobName: 'thumbnail',
      sigKind: 'wrong-scope sig',
      makePayload: (ctx: { victim: string; assetId: string; fileId: string }) => ({
        assetId: ctx.assetId,
        fileId: ctx.fileId,
        size: 'sm',
        userId: ctx.victim,
        // signed by the real secret but bound to another scope — not this asset
        sig: createHmac('sha256', TEST_WORKER_SECRET)
          .update(`${ctx.victim}:${randomUUID()}`)
          .digest('hex'),
      }),
    },
    {
      queue: 'process-faces-cluster',
      jobName: 'cluster',
      sigKind: 'sig-less cluster',
      makePayload: (ctx: { victim: string }) => ({ userId: ctx.victim }),
    },
  ])(
    'rejects a $sigKind job without touching core',
    async ({ queue: queueName, jobName, makePayload }) => {
      const victim = randomUUID();
      const { record, asset } = await seedPhoto(victim);

      const queue = testApp.getQueue(queueName);
      const job = await queue.add(
        jobName,
        makePayload({ victim, assetId: asset.id, fileId: record.id }),
      );

      expect(await waitForJob(queue, job.id!)).toBe('failed');
      expect((await queue.getJob(job.id!))?.failedReason).toContain('job signature');
      expect(testApp.fake.calls).toHaveLength(0);
    },
  );

  it('processes a validly signed job and threads the binding into reads', async () => {
    const userId = randomUUID();
    const { record, asset } = await seedPhoto(userId);
    const payload = signJob({ assetId: asset.id, fileId: record.id, size: 'sm' as const, userId });

    const queue = testApp.getQueue('process-thumbnail');
    const job = await queue.add('thumbnail', payload);

    expect(await waitForJob(queue, job.id!)).toBe('completed');
    expect(testApp.fake.callsOf('getFile')[0]).toMatchObject({
      binding: { sig: payload.sig, scope: asset.id },
    });
    expect(testApp.fake.callsOf('getAsset')[0]).toMatchObject({
      binding: { sig: payload.sig, scope: asset.id },
    });
  });

  it('worker re-enqueue keeps a carried sig instead of re-stamping', async () => {
    const bullMq = testApp.app.get(BullMqService);
    const payload = signJob({ assetId: randomUUID(), fileId: randomUUID(), userId: randomUUID() });

    // process-sig-probe has no worker in any harness mode, so the probe job just sits there
    await bullMq.enqueue('process-sig-probe', 'probe', payload, { jobId: 'sig-carry-probe' });
    const stored = await bullMq.getQueue('process-sig-probe').getJob('sig-carry-probe');

    expect(stored?.data).toMatchObject({ sig: payload.sig });
    await stored?.remove();
  });

  it('worker re-enqueue stamps an unsigned payload with a verifiable sig', async () => {
    const bullMq = testApp.app.get(BullMqService);
    const unsigned = { assetId: randomUUID(), fileId: randomUUID(), userId: randomUUID() };

    await bullMq.enqueue('process-sig-probe', 'probe', unsigned, { jobId: 'sig-stamp-probe' });
    const stored = await bullMq.getQueue('process-sig-probe').getJob('sig-stamp-probe');

    expect(stored?.data).toMatchObject({ sig: signJob(unsigned).sig });
    await stored?.remove();
  });
});
