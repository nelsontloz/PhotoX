import { FacesQueryController } from './faces-query.controller';
import type { FacesService } from './faces.service';

describe('FacesQueryController identity resolution', () => {
  it('assignPerson resolves stripped body userId to identity', async () => {
    const assignPerson = vi.fn().mockResolvedValue(undefined);
    const faces = { assignPerson } as unknown as FacesService;
    const controller = new FacesQueryController(faces);
    await controller.assignPerson('face-1', { personId: null }, 'u1');
    expect(assignPerson).toHaveBeenCalledWith('u1', 'face-1', null);
  });
});
