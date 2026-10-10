import { FacesQueryController } from './faces-query.controller'
import type { FacesService } from './faces.service'

describe('FacesQueryController identity resolution', () => {
  it('list scopes to the verified JWT identity', async () => {
    const listForUser = vi.fn().mockResolvedValue([])
    const faces = { listForUser } as unknown as FacesService
    const controller = new FacesQueryController(faces)
    // ponytail: identity comes from the verified JWT — handler must scope by it, never undefined
    await controller.list(undefined, undefined, 'u1')
    expect(listForUser).toHaveBeenCalledWith('u1', false, false)
  })

  it('assignPerson resolves stripped body userId to identity', async () => {
    const assignPerson = vi.fn().mockResolvedValue(undefined)
    const faces = { assignPerson } as unknown as FacesService
    const controller = new FacesQueryController(faces)
    await controller.assignPerson('face-1', { personId: null }, 'u1')
    expect(assignPerson).toHaveBeenCalledWith('u1', 'face-1', null)
  })
})
