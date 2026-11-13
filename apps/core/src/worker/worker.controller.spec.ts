import type { AssetsService } from '../assets/assets.service';
import type { UserFilesService } from '../ingest/user-files.service';
import type { FacesService } from '../faces/faces.service';
import type { PersonsService } from '../persons/persons.service';
import type { EmbeddingsService } from '../embeddings/embeddings.service';
import type { DetectionsService } from '../detections/detections.service';
import type { UserDeleteService } from '../users/admin/user-delete.service';
import { ForbiddenException } from '@nestjs/common';
import { WorkerController } from './worker.controller';

const USER_ID = '33333333-3333-4333-8333-333333333333';

function controllerWith(
  register: ReturnType<typeof vi.fn>,
  deletes: Record<string, ReturnType<typeof vi.fn>> = {},
): WorkerController {
  const svc = { register } as unknown as EmbeddingsService;
  return new WorkerController(
    {} as AssetsService,
    {} as UserFilesService,
    {} as FacesService,
    {} as PersonsService,
    svc,
    { register } as unknown as DetectionsService,
    deletes as unknown as UserDeleteService,
  );
}

describe('WorkerController identity resolution', () => {
  it('scopes worker writes to the verified JWT identity, never the body', async () => {
    const register = vi.fn().mockResolvedValue({ ok: true });
    const controller = controllerWith(register);
    // ponytail: identity comes from the verified JWT — handler must scope by it, never the body
    const embedding = { kind: 'image', model: 'm', embedding: [] };
    await controller.registerEmbedding('asset-1', embedding, 'u1');
    expect(register).toHaveBeenCalledWith('asset-1', 'u1', embedding);
    const detections = { detections: [] };
    await controller.registerDetections('asset-1', detections, 'u1');
    expect(register).toHaveBeenCalledWith('asset-1', 'u1', detections);
  });
});

describe('WorkerController purge', () => {
  it('runs one step for the job user, never another account named in the path', async () => {
    const step = vi.fn().mockResolvedValue({ done: false, phase: 'assets', deleted: 2 });
    const controller = controllerWith(vi.fn(), { step });
    await expect(
      controller.purgeUserStep(USER_ID, { backupPrefix: 'p/' }, USER_ID),
    ).resolves.toMatchObject({ phase: 'assets', deleted: 2 });
    expect(step).toHaveBeenCalledWith(USER_ID, 'p/');
  });

  it('refuses a step path target other than the job user', async () => {
    const step = vi.fn();
    const controller = controllerWith(vi.fn(), { step });
    await expect(
      controller.purgeUserStep(
        '44444444-4444-4444-8444-444444444444',
        { backupPrefix: 'p/' },
        USER_ID,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(step).not.toHaveBeenCalled();
  });

  it('reports the finish counters for the job user and echoes the durable state', async () => {
    const finish = vi.fn().mockResolvedValue(undefined);
    const getProgress = vi.fn().mockResolvedValue({ state: 'partial' });
    const controller = controllerWith(vi.fn(), { finish, getProgress });
    await expect(
      controller.purgeUserFinish(
        USER_ID,
        { backupPrefix: 'p/', filesDeleted: 3, filesFailed: 1, firstError: 'EACCES' },
        USER_ID,
      ),
    ).resolves.toEqual({ state: 'partial' });
    expect(finish).toHaveBeenCalledWith(
      USER_ID,
      expect.objectContaining({ filesDeleted: 3, filesFailed: 1 }),
    );
  });

  it('refuses a finish path target other than the job user', async () => {
    const finish = vi.fn();
    const controller = controllerWith(vi.fn(), { finish });
    await expect(
      controller.purgeUserFinish(
        '44444444-4444-4444-8444-444444444444',
        { backupPrefix: 'p/', filesDeleted: 0, filesFailed: 0 },
        USER_ID,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(finish).not.toHaveBeenCalled();
  });
});
