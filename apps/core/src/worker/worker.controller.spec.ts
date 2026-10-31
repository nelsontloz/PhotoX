import type { AssetsService } from '../assets/assets.service';
import type { UserFilesService } from '../files/user/user-files.service';
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
  purge: ReturnType<typeof vi.fn> = vi.fn(),
): WorkerController {
  const svc = { register } as unknown as EmbeddingsService;
  return new WorkerController(
    {} as AssetsService,
    {} as UserFilesService,
    {} as FacesService,
    {} as PersonsService,
    svc,
    { register } as unknown as DetectionsService,
    { purge } as unknown as UserDeleteService,
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

describe('WorkerController purgeUser', () => {
  it('purges the job user, never another account named in the path', async () => {
    const purge = vi.fn().mockResolvedValue({});
    const controller = controllerWith(vi.fn(), purge);
    await controller.purgeUser(USER_ID, { backupPrefix: 'p/' }, USER_ID);
    expect(purge).toHaveBeenCalledWith(USER_ID, 'p/');
  });

  it('refuses a path target other than the job user', async () => {
    const purge = vi.fn();
    const controller = controllerWith(vi.fn(), purge);
    await expect(
      controller.purgeUser('44444444-4444-4444-8444-444444444444', { backupPrefix: 'p/' }, USER_ID),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(purge).not.toHaveBeenCalled();
  });
});
