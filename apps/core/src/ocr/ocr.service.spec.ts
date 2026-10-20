import { NotFoundException, UnprocessableEntityException } from '@nestjs/common'
import type { Repository } from 'typeorm'
import { Asset } from '../database/entities'
import { AssetOcr } from '../database/entities/asset-ocr.entity'
import type { RegisterOcrDto } from './dto/register-ocr.dto'
import { OcrService } from './ocr.service'

function makeService(owned = true) {
  const upsert = vi.fn().mockResolvedValue({})
  const findOne = vi.fn().mockResolvedValue(owned ? { id: 'asset-1', userId: 'u1' } : null)
  const service = new OcrService(
    { upsert } as unknown as Repository<AssetOcr>,
    { findOne } as unknown as Repository<Asset>,
  )
  return { service, upsert, findOne }
}

function validDto(): RegisterOcrDto {
  return { text: 'passport number 12345' }
}

describe('OcrService.register', () => {
  it('404s an asset the token does not own and writes nothing', async () => {
    const { service, upsert } = makeService(false)
    await expect(service.register('asset-1', 'u1', validDto())).rejects.toBeInstanceOf(
      NotFoundException,
    )
    expect(upsert).not.toHaveBeenCalled()
  })

  it('upserts one trimmed row per asset on the assetId primary key', async () => {
    const { service, upsert } = makeService()
    await expect(
      service.register('asset-1', 'u1', { ...validDto(), text: '  hello  ' }),
    ).resolves.toEqual({ ok: true })
    expect(upsert).toHaveBeenCalledWith([{ assetId: 'asset-1', text: 'hello' }], ['assetId'])
  })

  const invalid: [string, RegisterOcrDto][] = [
    ['empty text', { ...validDto(), text: '' }],
    ['whitespace-only text', { ...validDto(), text: '   \n\t' }],
    ['oversized text', { ...validDto(), text: 'x'.repeat(50_001) }],
  ]

  it.each(invalid)('422s %s without writing', async (_label, dto) => {
    const { service, upsert } = makeService()
    await expect(service.register('asset-1', 'u1', dto)).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    )
    expect(upsert).not.toHaveBeenCalled()
  })
})
