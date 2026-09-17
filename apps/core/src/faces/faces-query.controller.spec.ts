import type { Request } from 'express'
import { FacesQueryController } from './faces-query.controller'
import type { FacesService } from './faces.service'

function authedReq(): Request {
  return { user: { id: 'u1', email: 'u@example.com', role: 'user' } } as unknown as Request
}

describe('FacesQueryController identity resolution', () => {
  it('list resolves stripped query userId to identity', async () => {
    const listForUser = vi.fn().mockResolvedValue([])
    const faces = { listForUser } as unknown as FacesService
    const controller = new FacesQueryController(faces)
    // ponytail: gateway strips ?userId= — handler must scope by verified identity, never undefined
    await controller.list(undefined, undefined, authedReq())
    expect(listForUser).toHaveBeenCalledWith('u1', false)
  })

  it('assignPerson resolves stripped body userId to identity', async () => {
    const assignPerson = vi.fn().mockResolvedValue(undefined)
    const faces = { assignPerson } as unknown as FacesService
    const controller = new FacesQueryController(faces)
    await controller.assignPerson('face-1', { personId: null } as never, authedReq())
    expect(assignPerson).toHaveBeenCalledWith('u1', 'face-1', null)
  })
})
