import { api } from './client'

export async function downloadFaceThumb(
  faceId: string,
  size?: number,
  signal?: AbortSignal,
): Promise<Blob> {
  const { data } = await api.get<Blob>(`/v1/faces/${faceId}/thumb`, {
    responseType: 'blob',
    signal,
    params: size ? { size } : undefined,
  })
  return data
}
