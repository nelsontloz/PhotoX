const HLS_CONTENT_TYPES: Record<string, string> = {
  '.m3u8': 'application/vnd.apple.mpegurl',
  '.m4s': 'video/iso.segment',
  '.ts': 'video/mp2t',
  '.mp4': 'video/mp4',
}

export function contentTypeFor(path: string): string {
  const dot = path.lastIndexOf('.')
  const ext = dot >= 0 ? path.slice(dot) : ''
  return HLS_CONTENT_TYPES[ext] ?? 'application/octet-stream'
}
