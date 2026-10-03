import type { Request } from 'express'
import { EmbeddingsController } from './embeddings.controller'
import type { EmbeddingsService } from './embeddings.service'

describe('EmbeddingsController identity resolution', () => {
  it('registerEmbedding scopes to the verified JWT identity', async () => {
    const register = vi.fn().mockResolvedValue({ ok: true })
    const embeddings = { register } as unknown as EmbeddingsService
    const controller = new EmbeddingsController(embeddings)
    const req = {
      user: { id: 'u1', email: 'u@example.com', role: 'user' },
    } as unknown as Request
    const dto = { kind: 'image', model: 'siglip2-b16-224', embedding: [0.1] }
    // ponytail: identity comes from the verified JWT — handler must scope by it, never the body
    await controller.registerEmbedding('asset-1', dto, req)
    expect(register).toHaveBeenCalledWith('asset-1', 'u1', dto)
  })
})
