import { useEffect, useState } from 'react'
import type { Asset, FaceDto, PersonDto } from '@photox/shared-types'
import { getPerson, getPersonAssets } from '../api/persons'
import { getAsset } from '../api/assets'

export function usePersonDetail(id: string | undefined) {
  const [person, setPerson] = useState<PersonDto | null>(null)
  const [assets, setAssets] = useState<Asset[]>([])
  const [faceMap, setFaceMap] = useState<Map<string, FaceDto>>(new Map())
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!id) return
    void (async () => {
      try {
        const [p, personAssets] = await Promise.all([
          getPerson(id),
          getPersonAssets(id, { limit: 100 }),
        ])
        setPerson(p)
        setTotal(personAssets.total)
        // ponytail: fetch full assets in parallel to get faces (for box overlay) + original dims
        const fetched = await Promise.all(
          personAssets.items.map((item) => getAsset(item.assetId).catch(() => null)),
        )
        const valid = fetched.filter((a): a is Asset => a !== null)
        const fm = new Map<string, FaceDto>()
        personAssets.items.forEach((item, i) => {
          const a = fetched[i]
          if (!a?.faces) return
          const face = a.faces.find((f) => f.id === item.faceId)
          if (face) fm.set(item.assetId, face)
        })
        setAssets(valid)
        setFaceMap(fm)
      } catch {
        /* ponytail: silent fail */
      } finally {
        setLoading(false)
      }
    })()
  }, [id])

  return { person, setPerson, assets, faceMap, total, loading }
}
