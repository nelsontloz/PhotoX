import { BadRequestException } from '@nestjs/common';
import { AssetsController } from './assets.controller';
import type { AssetsService } from './assets.service';

describe('AssetsController trash transitions', () => {
  function makeTrashController() {
    const emptyTrash = vi.fn().mockResolvedValue(undefined);
    const del = vi.fn().mockResolvedValue(undefined);
    const restore = vi.fn().mockResolvedValue(undefined);
    return {
      emptyTrash,
      del,
      restore,
      controller: new AssetsController({
        emptyTrash,
        delete: del,
        restore,
      } as unknown as AssetsService),
    };
  }

  it('refuses to empty the trash unless the filter says so', async () => {
    const { controller, emptyTrash } = makeTrashController();

    await expect(controller.emptyTrash('u1', { isTrashed: false })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(emptyTrash).not.toHaveBeenCalled();

    await controller.emptyTrash('u1', { isTrashed: true });
    expect(emptyTrash).toHaveBeenCalledWith('u1');
  });

  it('routes permanent delete and restore by asset id', async () => {
    const { controller, del, restore } = makeTrashController();

    await controller.deleteTrashed('a-1', 'u1');
    await controller.restore('a-1', 'u1');

    expect(del).toHaveBeenCalledWith('u1', 'a-1');
    expect(restore).toHaveBeenCalledWith('u1', 'a-1');
  });
});
