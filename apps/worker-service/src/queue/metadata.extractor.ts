import { Injectable, Logger } from '@nestjs/common'
import ExifReader from 'exifreader'

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
