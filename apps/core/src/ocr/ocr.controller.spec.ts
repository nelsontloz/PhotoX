import { OcrController } from './ocr.controller'
import type { OcrService } from './ocr.service'

describe('OcrController identity resolution', () => {
  it('registerOcr scopes to the verified JWT identity', async () => {
    const register = vi.fn().mockResolvedValue({ ok: true })
    const ocr = { register } as unknown as OcrService
    const controller = new OcrController(ocr)
    const dto = { text: 'hello', lang: 'eng', confidence: 0.9 }
    // ponytail: identity comes from the verified JWT — handler must scope by it, never the body
    await controller.registerOcr('asset-1', dto, 'u1')
    expect(register).toHaveBeenCalledWith('asset-1', 'u1', dto)
  })
})
