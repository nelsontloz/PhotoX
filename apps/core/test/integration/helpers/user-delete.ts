import request from 'supertest';
import { expect } from 'vitest';
import { sweepUserStorage } from '@photox/shared-config';
import { apiServer } from '../helpers';
import type { ApiTestApp } from '../helpers';

/**
 * Plays the worker's `user-delete` consumer: the queue consumer lives in the worker-service,
 * which is not booted in core integration runs, so the harness reads the enqueued job, drives
 * core's bounded steps with that job's own identity + binding, sweeps the bytes exactly as the
 * worker does, and reports the terminal state.
 */
export async function runQueuedDelete(
  t: ApiTestApp,
  userId: string,
  opts?: { stopAfterSteps?: number },
): Promise<{ steps: string[]; sweep: { deleted: number; failed: number } }> {
  const job = await t.getQueue('user-delete').getJob(`user-delete-${userId}`);
  expect(job).not.toBeNull();
  const data = job!.data as { backupPrefix: string; sig: string };
  const workerAuth = t.authHeader(
    t.signWorkerToken({ id: userId, email: 'worker@internal', role: 'user' }, { act: true }),
  );
  const phases: string[] = [];
  let done = false;
  for (let i = 0; i < 200; i++) {
    const step = await request(apiServer(t))
      .post(`/worker/users/${userId}/purge/step`)
      .set(workerAuth)
      .set('X-Job-Signature', data.sig)
      .send({ backupPrefix: data.backupPrefix });
    expect(step.status).toBe(200);
    const body = step.body as { done: boolean; phase: string; deleted: number };
    phases.push(body.phase);
    done = body.done;
    if (done) break;
    if (opts?.stopAfterSteps !== undefined && phases.length >= opts.stopAfterSteps) break;
  }
  // the phase trail makes a stuck wipe diagnosable instead of just "not done"
  expect(done, `steps: ${phases.slice(0, 12).join(' > ')}`).toBe(true);

  const sweep = await sweepUserStorage(t.storage, userId);
  const finish = await request(apiServer(t))
    .post(`/worker/users/${userId}/purge/finish`)
    .set(workerAuth)
    .set('X-Job-Signature', data.sig)
    .send({
      backupPrefix: data.backupPrefix,
      filesDeleted: sweep.deleted,
      filesFailed: sweep.failed,
      ...(sweep.firstError ? { firstError: sweep.firstError } : {}),
    });
  expect(finish.status).toBe(200);
  // the real consumer was enqueued with removeOnComplete, so the record is gone afterwards
  await job!.remove();
  return { steps: phases, sweep };
}

/** Polls the delete-status endpoint until the run is terminal; returns the last state seen. */
export async function waitForDeleteState(
  t: ApiTestApp,
  adminAuth: Record<string, string>,
  userId: string,
): Promise<string> {
  let state = '';
  for (let i = 0; i < 80; i++) {
    const status = await request(apiServer(t))
      .get(`/api/v1/admin/users/${userId}/delete-status`)
      .set(adminAuth);
    expect(status.status).toBe(200);
    state = (status.body as { state: string }).state;
    if (state === 'completed' || state === 'partial' || state === 'failed') return state;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return state;
}
