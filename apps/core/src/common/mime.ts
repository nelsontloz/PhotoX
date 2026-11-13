import { open } from 'fs/promises';

// ponytail: header sniff only (no full decode) — enough to keep svg/html and unknown bytes out of
// storage while allowing the image/video whitelist; upgrade to a real decode scan (sharp/ffprobe)
// if uploads ever become publicly reachable. Each entry lists its latin1 byte signatures and
// offsets; every part must match.
const MIME_SNIFFERS: { mime: string; parts: [offset: number, sig: string][] }[] = [
  { mime: 'image/jpeg', parts: [[0, '\xff\xd8\xff']] },
  { mime: 'image/png', parts: [[0, '\x89PNG\r\n\x1a\n']] },
  { mime: 'image/gif', parts: [[0, 'GIF8']] },
  {
    mime: 'image/webp',
    parts: [
      [0, 'RIFF'],
      [8, 'WEBP'],
    ],
  },
  {
    mime: 'video/x-msvideo',
    parts: [
      [0, 'RIFF'],
      [8, 'AVI '],
    ],
  },
  { mime: 'video/webm', parts: [[0, '\x1a\x45\xdf\xa3']] },
];

// ISO-BMFF: `ftyp` box at offset 4, major brand at offset 8 decides the canonical type —
// heic family (iPhone photos), heif, avif and quicktime (iPhone .mov), everything else mp4.
const ISO_BMFF_MIME: Record<string, string> = {
  heic: 'image/heic',
  heix: 'image/heic',
  hevc: 'image/heic',
  hevx: 'image/heic',
  mif1: 'image/heif',
  msf1: 'image/heif',
  avif: 'image/avif',
  avis: 'image/avif',
  'qt  ': 'video/quicktime',
};

// exported for the upload-session complete path — the assembled head must be sniffed with this
// exact table, never with a client-supplied MIME hint
export async function sniffMime(path: string): Promise<string | null> {
  const buf = Buffer.alloc(12);
  const handle = await open(path, 'r');
  try {
    if ((await handle.read(buf, 0, buf.length, 0)).bytesRead < buf.length) return null;
  } finally {
    await handle.close();
  }
  if (buf.subarray(4, 8).toString('latin1') === 'ftyp') {
    return ISO_BMFF_MIME[buf.subarray(8, 12).toString('latin1')] ?? 'video/mp4';
  }
  return (
    MIME_SNIFFERS.find((s) =>
      s.parts.every(
        ([offset, sig]) => buf.subarray(offset, offset + sig.length).toString('latin1') === sig,
      ),
    )?.mime ?? null
  );
}

// pipeline decision, derived solely from the sniffed mime (never the client's `kind`): jpeg
// bytes with kind=video cannot enter the video pipeline. Exported so the upload-session
// complete path derives the same kind from the same stored mimeType.
export function kindFromMime(mimetype: string): 'photo' | 'video' | null {
  if (mimetype.startsWith('image/')) return 'photo';
  if (mimetype.startsWith('video/')) return 'video';
  return null;
}
