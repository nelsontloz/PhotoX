import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { FaceDetectionSettings } from '@photox/shared-types';

const api = vi.hoisted(() => ({
  getFaceDetection: vi.fn(),
  reprocessPipeline: vi.fn(),
  getPipelineStatus: vi.fn(),
  reclusterFaces: vi.fn(),
}));

vi.mock('../../api/admin', () => api);

import { FacialDetectionCard } from './ai';

const settings = (over: Partial<FaceDetectionSettings> = {}): FaceDetectionSettings => ({
  modelAvailable: true,
  ...over,
});

const drained = {
  lastRun: null,
  queue: { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 },
};

beforeEach(() => {
  api.getFaceDetection.mockResolvedValue(settings());
  api.getPipelineStatus.mockResolvedValue(drained);
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe('FacialDetectionCard (fixed detector)', () => {
  it('presents SCRFD 10G as a read-only fact instead of a detector switcher', async () => {
    render(<FacialDetectionCard />);

    // the strip row names the fixed detector; no radio group survives
    expect(await screen.findByText('Active detector')).toBeTruthy();
    expect(screen.getByText('SCRFD 10G')).toBeTruthy();
    expect(screen.queryByRole('radio')).toBeNull();
    expect(screen.queryByRole('group')).toBeNull();
  });

  it('reports Online with no model warning when the SCRFD model is provisioned', async () => {
    render(<FacialDetectionCard />);

    expect(await screen.findByText('Online')).toBeTruthy();
    expect(screen.queryByText(/isn't installed/)).toBeNull();
  });

  it('warns that face detection cannot run when the SCRFD model is missing', async () => {
    api.getFaceDetection.mockResolvedValue(settings({ modelAvailable: false }));

    render(<FacialDetectionCard />);

    expect(
      await screen.findByText(
        "The SCRFD 10G model isn't installed — face detection cannot run until it is provisioned.",
      ),
    ).toBeTruthy();
    expect(screen.getByText('Model missing')).toBeTruthy();
    expect(screen.getByText('pnpm --filter @photox/worker-service face-model')).toBeTruthy();
  });
});

describe('FacialDetectionCard (reprocess)', () => {
  it('confirms the reprocess dialog, POSTs, then renders polled progress', async () => {
    api.getPipelineStatus.mockResolvedValueOnce(drained).mockResolvedValueOnce({
      lastRun: {
        startedAt: '2026-10-01T00:00:00.000Z',
        total: 5,
        enqueued: 5,
      },
      queue: { waiting: 1, active: 1, completed: 4, failed: 0, delayed: 0 },
    });
    api.reprocessPipeline.mockResolvedValue({ enqueued: 5, total: 5 });

    render(<FacialDetectionCard />);
    await screen.findByText('No face reprocess runs yet.');

    fireEvent.click(screen.getByRole('button', { name: 'Reprocess all faces' }));
    expect(screen.getByText('Reprocess all faces?')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() => expect(api.reprocessPipeline).toHaveBeenCalledWith('faces'));
    expect(await screen.findByText('Queued 5 face jobs for 5 photos.')).toBeTruthy();

    // progress counts come from waiting+active, never queue.completed (which is 4 here)
    const bar = await screen.findByRole('progressbar');
    expect(bar.getAttribute('aria-valuenow')).toBe('3');
    expect(bar.getAttribute('aria-valuemax')).toBe('5');
    expect(screen.getByText('2 of 5 remaining · 60%')).toBeTruthy();
  });

  it('shows the last-run summary when the queue is drained, ignoring queue.completed', async () => {
    api.getPipelineStatus.mockResolvedValue({
      lastRun: {
        startedAt: '2026-10-01T00:00:00.000Z',
        total: 8,
        enqueued: 5,
      },
      queue: { waiting: 0, active: 0, completed: 5, failed: 0, delayed: 0 },
    });

    render(<FacialDetectionCard />);

    expect(await screen.findByText(/5 of 8 photos\s+queued\./)).toBeTruthy();
    expect(screen.queryByText(/SCRFD 10G detector/)).toBeNull();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('warns in the confirm dialog when the model is missing, and still allows confirm', async () => {
    api.getFaceDetection.mockResolvedValue(settings({ modelAvailable: false }));
    api.reprocessPipeline.mockResolvedValue({ enqueued: 5, total: 5 });

    render(<FacialDetectionCard />);
    await screen.findByText('No face reprocess runs yet.');

    fireEvent.click(screen.getByRole('button', { name: 'Reprocess all faces' }));

    // the card banner and the dialog both carry the warning
    expect(screen.getAllByText(/The SCRFD 10G model isn't installed/)).toHaveLength(2);
    expect(
      screen.getAllByText('pnpm --filter @photox/worker-service face-model').length,
    ).toBeGreaterThan(0);

    // warn, don't block — a reprocess can still be queued for later
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(api.reprocessPipeline).toHaveBeenCalledWith('faces'));
  });

  it('shows no model warning in the confirm dialog when the model is installed', async () => {
    render(<FacialDetectionCard />);
    await screen.findByText('No face reprocess runs yet.');

    fireEvent.click(screen.getByRole('button', { name: 'Reprocess all faces' }));

    expect(screen.getByText('Reprocess all faces?')).toBeTruthy();
    expect(screen.queryByText(/isn't installed/)).toBeNull();
    expect(screen.queryAllByText('pnpm --filter @photox/worker-service face-model')).toHaveLength(
      0,
    );
  });

  it('reclusters users and renders the queued result', async () => {
    api.reclusterFaces.mockResolvedValue({ enqueued: 2 });

    render(<FacialDetectionCard />);
    await screen.findByText('No face reprocess runs yet.');

    fireEvent.click(screen.getByRole('button', { name: 'Recluster users' }));

    await waitFor(() => expect(api.reclusterFaces).toHaveBeenCalled());
    expect(await screen.findByText('Clustering queued for 2 users.')).toBeTruthy();
  });

  it('renders the recluster empty state when no users have faces', async () => {
    api.reclusterFaces.mockResolvedValue({ enqueued: 0 });

    render(<FacialDetectionCard />);
    await screen.findByText('No face reprocess runs yet.');

    fireEvent.click(screen.getByRole('button', { name: 'Recluster users' }));

    expect(await screen.findByText('Nothing to cluster — no faces yet.')).toBeTruthy();
  });
});
