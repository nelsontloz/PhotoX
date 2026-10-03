import { NotFoundException, UnprocessableEntityException } from '@nestjs/common'
import type { DataSource, Repository } from 'typeorm'
import { Asset } from '../database/entities'
import { AssetDetection } from '../database/entities/asset-detection.entity'
import type { DetectedObjectDto, RegisterDetectionsDto } from './dto/register-detections.dto'
import { DetectionsService } from './detections.service'

function box(x = 1, y = 2, w = 10, h = 20) {
  return { x, y, w, h }
}

function makeService(owned = true) {
  const deleteFn = vi.fn().mockResolvedValue({})
  const insertFn = vi.fn().mockResolvedValue({})
  const em = { delete: deleteFn, insert: insertFn }
  const transaction = vi.fn((cb: (manager: typeof em) => Promise<unknown>) => cb(em))
  const find = vi.fn().mockResolvedValue([])
  const findOne = vi.fn().mockResolvedValue(owned ? { id: 'asset-1', userId: 'u1' } : null)
  const service = new DetectionsService(
    { find } as unknown as Repository<AssetDetection>,
    { findOne } as unknown as Repository<Asset>,
    { transaction } as unknown as DataSource,
  )
  return { service, deleteFn, insertFn, transaction, find }
}

function validDto(): RegisterDetectionsDto {
  return {
    detections: [
      { label: 'person', confidence: 0.9, box: box() },
      { label: 'car', confidence: 0.7, box: box(5, 6, 30, 40) },
    ],
  }
}

describe('DetectionsService.register', () => {
  it('404s an asset the token does not own and writes nothing', async () => {
    const { service, transaction } = makeService(false)
    await expect(service.register('asset-1', 'u1', validDto())).rejects.toBeInstanceOf(
      NotFoundException,
    )
    expect(transaction).not.toHaveBeenCalled()
  })

  it('replaces the row set in a transaction, trimming labels', async () => {
    const { service, deleteFn, insertFn } = makeService()
    await expect(
      service.register('asset-1', 'u1', {
        detections: [{ label: '  person  ', confidence: 0.9, box: box() }],
      }),
    ).resolves.toEqual({ ok: true })
    expect(deleteFn).toHaveBeenCalledWith(AssetDetection, { assetId: 'asset-1' })
    expect(insertFn).toHaveBeenCalledWith(AssetDetection, [
      { assetId: 'asset-1', label: 'person', confidence: 0.9, box: box() },
    ])
  })

  it('clears stale rows when the new set is empty', async () => {
    const { service, deleteFn, insertFn } = makeService()
    await expect(service.register('asset-1', 'u1', { detections: [] })).resolves.toEqual({
      ok: true,
    })
    expect(deleteFn).toHaveBeenCalledWith(AssetDetection, { assetId: 'asset-1' })
    expect(insertFn).not.toHaveBeenCalled()
  })

  const invalid: [string, RegisterDetectionsDto][] = [
    [
      'more than 200 detections',
      {
        detections: Array.from(
          { length: 201 },
          (): DetectedObjectDto => ({
            label: 'person',
            confidence: 0.9,
            box: box(),
          }),
        ),
      },
    ],
    ['an empty label', { detections: [{ label: '', confidence: 0.9, box: box() }] }],
    ['a whitespace label', { detections: [{ label: '   ', confidence: 0.9, box: box() }] }],
    [
      'an oversized label',
      { detections: [{ label: 'x'.repeat(65), confidence: 0.9, box: box() }] },
    ],
    ['confidence above 1', { detections: [{ label: 'car', confidence: 1.5, box: box() }] }],
    ['confidence below 0', { detections: [{ label: 'car', confidence: -0.1, box: box() }] }],
    ['zero-width box', { detections: [{ label: 'car', confidence: 0.5, box: box(1, 1, 0, 10) }] }],
    [
      'negative-height box',
      { detections: [{ label: 'car', confidence: 0.5, box: box(1, 1, 10, -1) }] },
    ],
    [
      'non-finite box coordinate',
      { detections: [{ label: 'car', confidence: 0.5, box: box(Number.NaN, 1, 10, 10) }] },
    ],
  ]

  it.each(invalid)('422s %s without writing', async (_label, dto) => {
    const { service, transaction } = makeService()
    await expect(service.register('asset-1', 'u1', dto)).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    )
    expect(transaction).not.toHaveBeenCalled()
  })
})

describe('DetectionsService.list', () => {
  it('404s a cross-user asset', async () => {
    const { service } = makeService(false)
    await expect(service.list('u1', 'asset-1')).rejects.toBeInstanceOf(NotFoundException)
  })

  it('returns rows ordered by confidence desc', async () => {
    const { service, find } = makeService()
    find.mockResolvedValue([
      { label: 'person', confidence: 0.9, box: box() },
      { label: 'car', confidence: 0.4, box: box(5, 6, 30, 40) },
    ])
    await expect(service.list('u1', 'asset-1')).resolves.toEqual({
      detections: [
        { label: 'person', confidence: 0.9, box: box() },
        { label: 'car', confidence: 0.4, box: box(5, 6, 30, 40) },
      ],
    })
    expect(find).toHaveBeenCalledWith({
      where: { assetId: 'asset-1' },
      order: { confidence: 'DESC' },
    })
  })
})
