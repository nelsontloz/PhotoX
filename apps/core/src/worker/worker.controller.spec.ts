import type { AssetsService } from '../assets/assets.service'
import type { UserFilesService } from '../files/user/user-files.service'
import type { FacesService } from '../faces/faces.service'
import type { PersonsService } from '../persons/persons.service'
import type { EmbeddingsService } from '../embeddings/embeddings.service'
import type { OcrService } from '../ocr/ocr.service'
import type { DetectionsService } from '../detections/detections.service'
import { WorkerController } from './worker.controller'

function controllerWith(register: ReturnType<typeof vi.fn>): WorkerController {
  const svc = { register } as unknown as EmbeddingsService
  return new WorkerController(
    {} as AssetsService,
    {} as UserFilesService,
    {} as FacesService,
    {} as PersonsService,
    svc,
    { register } as unknown as OcrService,
    { register } as unknown as DetectionsService,
  )
}

describe('WorkerController identity resolution', () => {
  it('scopes worker writes to the verified JWT identity, never the body', async () => {
    const register = vi.fn().mockResolvedValue({ ok: true })
    const controller = controllerWith(register)
    // ponytail: identity comes from the verified JWT — handler must scope by it, never the body
    const embedding = { kind: 'image', model: 'm', embedding: [] }
    await controller.registerEmbedding('asset-1', embedding, 'u1')
    expect(register).toHaveBeenCalledWith('asset-1', 'u1', embedding)
    const ocr = { text: 'hello', lang: 'eng', confidence: 0.9 }
    await controller.registerOcr('asset-1', ocr, 'u1')
    expect(register).toHaveBeenCalledWith('asset-1', 'u1', ocr)
    const detections = { detections: [] }
    await controller.registerDetections('asset-1', detections, 'u1')
    expect(register).toHaveBeenCalledWith('asset-1', 'u1', detections)
  })
})
