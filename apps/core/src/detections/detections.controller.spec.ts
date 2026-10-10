import { DetectionsController } from './detections.controller'
import type { DetectionsService } from './detections.service'

describe('DetectionsController identity resolution', () => {
  it('registerDetections scopes to the verified JWT identity', async () => {
    const register = vi.fn().mockResolvedValue({ ok: true })
    const detections = { register } as unknown as DetectionsService
    const controller = new DetectionsController(detections)
    const dto = { detections: [] }
    // ponytail: identity comes from the verified JWT — handler must scope by it, never the body
    await controller.registerDetections('asset-1', dto, 'u1')
    expect(register).toHaveBeenCalledWith('asset-1', 'u1', dto)
  })

  it('listDetections scopes to the verified JWT identity', async () => {
    const list = vi.fn().mockResolvedValue({ detections: [] })
    const detections = { list } as unknown as DetectionsService
    const controller = new DetectionsController(detections)
    await controller.listDetections('asset-1', 'u1')
    expect(list).toHaveBeenCalledWith('u1', 'asset-1')
  })
})
