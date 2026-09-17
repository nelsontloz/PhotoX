import type { Request } from 'express'
import { FacesController } from './faces.controller'
import type { FacesService } from './faces.service'

describe('FacesController identity resolution', () => {
  it('registerFaces resolves stripped body userId to identity', async () => {
    const registerFaces = vi.fn().mockResolvedValue([])
    const faces = { registerFaces } as unknown as FacesService
    const controller = new FacesController(faces)
    const req = {
      user: { id: 'u1', email: 'u@example.com', role: 'user' },
    } as unknown as Request
    // ponytail: gateway strips body userId — handler must scope by verified identity, never undefined
    await controller.registerFaces('asset-1', { faces: [] } as never, req)
    expect(registerFaces).toHaveBeenCalledWith('asset-1', 'u1', [])
  })
})
