import { Injectable, Logger } from '@nestjs/common'
import ExifReader from 'exifreader'
import { runFfprobeJson, type FfprobeResult } from './ffmpeg'

export interface ExtractedMetadata {
  takenAt: Date | null
  cameraMake: string | null
  cameraModel: string | null
  lensModel: string | null
  orientation: number | null
  width: number | null
  height: number | null
  latitude: number | null
  longitude: number | null
  altitude: number | null
  iso: number | null
  fNumber: number | null
  exposureTime: number | null
  focalLength: number | null
  raw: Record<string, unknown> | null
}

const EMPTY: ExtractedMetadata = {
  takenAt: null,
  cameraMake: null,
  cameraModel: null,
  lensModel: null,
  orientation: null,
  width: null,
  height: null,
  latitude: null,
  longitude: null,
  altitude: null,
  iso: null,
  fNumber: null,
  exposureTime: null,
  focalLength: null,
  raw: null,
}

const DATE_RE = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/

function readNumber(tag: Record<string, unknown> | undefined): number | null {
  if (!tag) return null
  if (typeof tag.computed === 'number') return tag.computed
  if (typeof tag.value === 'number') return tag.value
  if (
    Array.isArray(tag.value) &&
    tag.value.length === 2 &&
    typeof tag.value[0] === 'number' &&
    typeof tag.value[1] === 'number' &&
    tag.value[1] !== 0
  ) {
    return tag.value[0] / tag.value[1]
  }
  return null
}

function readString(tag: Record<string, unknown> | undefined): string | null {
  if (!tag) return null
  if (Array.isArray(tag.value) && tag.value.length > 0) {
    const first: unknown = tag.value[0]
    if (typeof first === 'string') return first
  }
  if (typeof tag.value === 'string') return tag.value
  if (typeof tag.description === 'string') return tag.description
  return null
}

function readFirstNumber(tag: Record<string, unknown> | undefined): number | null {
  if (!tag) return null
  if (typeof tag.value === 'number') return tag.value
  if (Array.isArray(tag.value) && typeof tag.value[0] === 'number') return tag.value[0]
  return null
}

@Injectable()
export class MetadataExtractor {
  private readonly logger = new Logger(MetadataExtractor.name)

  extract(buffer: Buffer): ExtractedMetadata {
    let raw: Record<string, unknown>
    try {
      raw = ExifReader.load(buffer, {
        expanded: true,
        computed: true,
        excludeTags: { mpf: true },
      }) as unknown as Record<string, unknown>
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.logger.warn(`EXIF extraction failed: ${message}`)
      return { ...EMPTY }
    }

    const exif = (raw.exif as Record<string, unknown>) ?? {}
    const gps = (raw.gps as Record<string, unknown>) ?? {}
    const file = (raw.file as Record<string, unknown>) ?? {}

    let takenAt: Date | null = null
    const dateTimeOriginal = readString(
      exif.DateTimeOriginal as Record<string, unknown> | undefined,
    )
    if (dateTimeOriginal) {
      const m = DATE_RE.exec(dateTimeOriginal)
      if (m) {
        const [, year, month, day, hour, min, sec] = m
        takenAt = new Date(
          Date.UTC(
            Number(year),
            Number(month) - 1,
            Number(day),
            Number(hour),
            Number(min),
            Number(sec),
          ),
        )
      }
    }

    const width =
      readNumber(exif.PixelXDimension as Record<string, unknown> | undefined) ??
      readNumber(exif.ExifImageWidth as Record<string, unknown> | undefined) ??
      readNumber(file['Image Width'] as Record<string, unknown> | undefined)

    const height =
      readNumber(exif.PixelYDimension as Record<string, unknown> | undefined) ??
      readNumber(exif.ExifImageHeight as Record<string, unknown> | undefined) ??
      readNumber(file['Image Height'] as Record<string, unknown> | undefined)

    return {
      takenAt,
      cameraMake: readString(exif.Make as Record<string, unknown> | undefined),
      cameraModel: readString(exif.Model as Record<string, unknown> | undefined),
      lensModel: readString(exif.LensModel as Record<string, unknown> | undefined),
      orientation: readFirstNumber(exif.Orientation as Record<string, unknown> | undefined),
      width,
      height,
      latitude: typeof gps.Latitude === 'number' ? gps.Latitude : null,
      longitude: typeof gps.Longitude === 'number' ? gps.Longitude : null,
      altitude: typeof gps.Altitude === 'number' ? gps.Altitude : null,
      iso: readFirstNumber(exif.ISOSpeedRatings as Record<string, unknown> | undefined),
      fNumber: readNumber(exif.FNumber as Record<string, unknown> | undefined),
      exposureTime: readNumber(exif.ExposureTime as Record<string, unknown> | undefined),
      focalLength: readNumber(exif.FocalLength as Record<string, unknown> | undefined),
      raw,
    }
  }
}

export interface VideoMetadataPatch {
  durationSeconds: number | null
  width: number | null
  height: number | null
  codec: string | null
  fps: number | null
  hasAudio: boolean | null
  orientation: number | null
  takenAt: Date | null
  cameraMake: string | null
  cameraModel: string | null
  lensModel: string | null
  latitude: number | null
  longitude: number | null
  altitude: number | null
  metadata: Record<string, unknown> | null
  metadataStatus: 'ready'
  metadataExtractedAt: Date
}

function readOrientation(result: FfprobeResult): number | null {
  for (const stream of result.streams) {
    if (stream.codec_type !== 'video') continue
    if (stream.tags?.rotate) {
      const rot = Number(stream.tags.rotate)
      if (Number.isFinite(rot)) return rot
    }
    if (stream.side_data_list) {
      for (const sd of stream.side_data_list) {
        if (sd.rotation !== undefined) {
          const rot = Number(sd.rotation)
          if (Number.isFinite(rot)) return rot
        }
      }
    }
  }
  return null
}

function parseIso6709(
  s: string,
): { latitude: number; longitude: number; altitude: number | null } | null {
  const m = /^([+-][\d.]+)([+-][\d.]+)(?:([+-][\d.]+))?\//.exec(s)
  if (!m) return null
  const lat = Number.parseFloat(m[1]!)
  const lon = Number.parseFloat(m[2]!)
  const alt = m[3] ? Number.parseFloat(m[3]) : null
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
  return {
    latitude: lat,
    longitude: lon,
    altitude: alt !== null && Number.isFinite(alt) ? alt : null,
  }
}

@Injectable()
export class VideoMetadataExtractor {
  private readonly logger = new Logger(VideoMetadataExtractor.name)

  async extract(inputPath: string): Promise<VideoMetadataPatch> {
    let result: FfprobeResult
    try {
      result = await runFfprobeJson(inputPath)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.logger.warn(`ffprobe failed for ${inputPath}: ${message}`)
      return {
        durationSeconds: null,
        width: null,
        height: null,
        codec: null,
        fps: null,
        hasAudio: null,
        orientation: null,
        takenAt: null,
        cameraMake: null,
        cameraModel: null,
        lensModel: null,
        latitude: null,
        longitude: null,
        altitude: null,
        metadata: null,
        metadataStatus: 'ready',
        metadataExtractedAt: new Date(),
      }
    }

    const videoStream = result.streams.find((s) => s.codec_type === 'video')
    const hasAudio = result.streams.some((s) => s.codec_type === 'audio')

    const duration = result.format.duration ? Number.parseFloat(result.format.duration) : null

    let takenAt: Date | null = null
    const creationTime = result.format.tags?.creation_time
    if (creationTime) {
      const d = new Date(creationTime)
      if (Number.isFinite(d.getTime()) && d.getFullYear() >= 1990) {
        takenAt = d
      }
    }

    const cameraMake =
      result.format.tags?.make?.trim() ??
      videoStream?.tags?.['com.apple.quicktime.make']?.trim() ??
      videoStream?.tags?.make?.trim() ??
      null
    const cameraModel =
      result.format.tags?.model?.trim() ??
      videoStream?.tags?.['com.apple.quicktime.model']?.trim() ??
      videoStream?.tags?.model?.trim() ??
      null
    const lensModel =
      videoStream?.tags?.['com.apple.quicktime.lensmodel']?.trim() ??
      videoStream?.tags?.lensmodel?.trim() ??
      null

    const locationTag = result.format.tags?.location
    const location = locationTag ? parseIso6709(locationTag) : null

    return {
      durationSeconds:
        duration !== null && Number.isFinite(duration) ? Math.round(duration * 1000) / 1000 : null,
      width: videoStream?.width ?? null,
      height: videoStream?.height ?? null,
      codec: videoStream?.codec_name ?? null,
      fps: (() => {
        const rate = videoStream?.avg_frame_rate
        if (!rate || typeof rate !== 'string') return null
        const parts = rate.split('/')
        if (parts.length !== 2) return null
        const num = Number(parts[0])
        const den = Number(parts[1])
        if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) return null
        const fps = num / den
        return Number.isFinite(fps) && fps > 0 ? Math.round(fps * 100) / 100 : null
      })(),
      hasAudio,
      orientation: readOrientation(result),
      takenAt,
      cameraMake,
      cameraModel,
      lensModel,
      latitude: location?.latitude ?? null,
      longitude: location?.longitude ?? null,
      altitude: location?.altitude ?? null,
      metadata: result as unknown as Record<string, unknown>,
      metadataStatus: 'ready',
      metadataExtractedAt: new Date(),
    }
  }
}
