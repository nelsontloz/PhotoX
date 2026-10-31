import { DetectionsController } from './detections.controller';
import type { DetectionsService } from './detections.service';

describe('DetectionsController identity resolution', () => {
  it('listDetections scopes to the verified JWT identity', async () => {
    const list = vi.fn().mockResolvedValue({ detections: [] });
    const detections = { list } as unknown as DetectionsService;
    const controller = new DetectionsController(detections);
    await controller.listDetections('asset-1', 'u1');
    expect(list).toHaveBeenCalledWith('u1', 'asset-1');
  });
});
