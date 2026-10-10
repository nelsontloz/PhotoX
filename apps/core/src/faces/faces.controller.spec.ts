import { FacesController } from './faces.controller'
import type { FacesService } from './faces.service'

describe('FacesController identity resolution', () => {
  it('registerFaces scopes to the verified JWT identity', async () => {
    const registerFaces = vi.fn().mockResolvedValue([])
    const faces = { registerFaces } as unknown as FacesService
    const controller = new FacesController(faces)
    // ponytail: identity comes from the verified JWT — handler must scope by it, never undefined
    await controller.registerFaces('asset-1', { faces: [] }, 'u1')
    expect(registerFaces).toHaveBeenCalledWith('asset-1', 'u1', [], null)
  })
})
