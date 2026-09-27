import { describe, it, expect, vi, beforeEach } from 'vitest'

const patchMock = vi.hoisted(() => vi.fn())

vi.mock('./client', () => ({ api: { patch: patchMock } }))

import { assignFace } from './faces'

describe('assignFace', () => {
  beforeEach(() => vi.clearAllMocks())

  it('patches the face person endpoint with the target personId', async () => {
    await assignFace('face-1', 'person-1')
    expect(patchMock).toHaveBeenCalledWith('/v1/faces/face-1/person', { personId: 'person-1' })
  })

  it('sends personId null to unassign', async () => {
    await assignFace('face-1', null)
    expect(patchMock).toHaveBeenCalledWith('/v1/faces/face-1/person', { personId: null })
  })
})
