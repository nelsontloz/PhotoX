import { describe, it, expect, vi, beforeEach } from 'vitest'
import ExifReader from 'exifreader'
import { MetadataExtractor } from './metadata.extractor'

vi.mock('exifreader', () => ({
  default: {
    load: vi.fn(),
  },
}))

describe('MetadataExtractor', () => {
  let extractor: MetadataExtractor

  beforeEach(() => {
    vi.resetAllMocks()
    extractor = new MetadataExtractor()
  })

  it('extracts full metadata from iPhone photo with GPS', () => {
    vi.mocked(ExifReader.load).mockReturnValue({
      exif: {
        Make: { value: ['Apple'], description: 'Apple' },
        Model: { value: ['iPhone 15 Pro'], description: 'iPhone 15 Pro' },
        LensModel: {
          value: ['iPhone 15 Pro back triple camera 6.86mm f/1.78'],
          description: 'iPhone 15 Pro back triple camera 6.86mm f/1.78',
        },
        DateTimeOriginal: {
          value: ['2024:06:15 14:30:00'],
          description: '2024:06:15 14:30:00',
        },
        FNumber: { value: [178, 100], computed: 1.78, description: 'f/1.8' },
        ExposureTime: { value: [1, 250], computed: 0.004, description: '1/250' },
        ISOSpeedRatings: { value: 64 },
        FocalLength: { value: [686, 100], computed: 6.86, description: '7 mm' },
        PixelXDimension: { value: 4032 },
        PixelYDimension: { value: 3024 },
        Orientation: { value: 1 },
      },
      gps: {
        Latitude: 40.75,
        Longitude: -73.99,
        Altitude: 10.5,
      },
      file: {
        'Image Width': { value: 4032 },
        'Image Height': { value: 3024 },
        MIMEType: { value: ['image/jpeg'], description: 'image/jpeg' },
      },
    } as unknown as ReturnType<typeof ExifReader.load>)

    const result = extractor.extract(Buffer.from('fake-jpeg'))

    expect(result.cameraMake).toBe('Apple')
    expect(result.cameraModel).toBe('iPhone 15 Pro')
    expect(result.lensModel).toBe('iPhone 15 Pro back triple camera 6.86mm f/1.78')
    expect(result.takenAt).toEqual(new Date('2024-06-15T14:30:00.000Z'))
    expect(result.fNumber).toBe(1.78)
    expect(result.exposureTime).toBe(0.004)
    expect(result.iso).toBe(64)
    expect(result.focalLength).toBe(6.86)
    expect(result.orientation).toBe(1)
    expect(result.width).toBe(4032)
    expect(result.height).toBe(3024)
    expect(result.latitude).toBe(40.75)
    expect(result.longitude).toBe(-73.99)
    expect(result.altitude).toBe(10.5)
    expect(result.raw).toBeTypeOf('object')
  })

  it('extracts EXIF fields but returns null GPS when none present', () => {
    vi.mocked(ExifReader.load).mockReturnValue({
      exif: {
        Make: { value: ['Samsung'], description: 'Samsung' },
        Model: { value: ['SM-S918B'], description: 'SM-S918B' },
        LensModel: { value: ['Samsung Galaxy S24 Ultra'], description: 'Samsung Galaxy S24 Ultra' },
        DateTimeOriginal: {
          value: ['2024:03:20 09:15:30'],
          description: '2024:03:20 09:15:30',
        },
        FNumber: { value: [17, 10], computed: 1.7, description: 'f/1.7' },
        ExposureTime: { value: [1, 125], computed: 0.008, description: '1/125' },
        ISOSpeedRatings: { value: [100, 200] },
        FocalLength: { value: [23, 1], computed: 23, description: '23 mm' },
        PixelXDimension: { value: 4000 },
        PixelYDimension: { value: 3000 },
        Orientation: { value: 6 },
      },
      gps: {},
      file: {
        'Image Width': { value: 4000 },
        'Image Height': { value: 3000 },
      },
    } as unknown as ReturnType<typeof ExifReader.load>)

    const result = extractor.extract(Buffer.from('fake-jpeg'))

    expect(result.cameraMake).toBe('Samsung')
    expect(result.cameraModel).toBe('SM-S918B')
    expect(result.lensModel).toBe('Samsung Galaxy S24 Ultra')
    expect(result.takenAt).toEqual(new Date('2024-03-20T09:15:30.000Z'))
    expect(result.latitude).toBeNull()
    expect(result.longitude).toBeNull()
    expect(result.altitude).toBeNull()
    expect(result.iso).toBe(100)
    expect(result.width).toBe(4000)
    expect(result.height).toBe(3000)
    expect(result.orientation).toBe(6)
    expect(result.raw).toBeTypeOf('object')
  })

  it('returns all null fields for JPEG with no EXIF data', () => {
    vi.mocked(ExifReader.load).mockReturnValue({} as unknown as ReturnType<typeof ExifReader.load>)

    const result = extractor.extract(Buffer.from('empty-jpeg'))

    expect(result.takenAt).toBeNull()
    expect(result.cameraMake).toBeNull()
    expect(result.cameraModel).toBeNull()
    expect(result.lensModel).toBeNull()
    expect(result.orientation).toBeNull()
    expect(result.width).toBeNull()
    expect(result.height).toBeNull()
    expect(result.latitude).toBeNull()
    expect(result.longitude).toBeNull()
    expect(result.altitude).toBeNull()
    expect(result.iso).toBeNull()
    expect(result.fNumber).toBeNull()
    expect(result.exposureTime).toBeNull()
    expect(result.focalLength).toBeNull()
    expect(result.raw).toEqual({})
  })

  it('returns empty metadata when ExifReader throws', () => {
    vi.mocked(ExifReader.load).mockImplementation(() => {
      throw new Error('invalid EXIF')
    })

    const result = extractor.extract(Buffer.from('corrupt'))

    expect(result.takenAt).toBeNull()
    expect(result.cameraMake).toBeNull()
    expect(result.cameraModel).toBeNull()
    expect(result.lensModel).toBeNull()
    expect(result.orientation).toBeNull()
    expect(result.width).toBeNull()
    expect(result.height).toBeNull()
    expect(result.latitude).toBeNull()
    expect(result.longitude).toBeNull()
    expect(result.altitude).toBeNull()
    expect(result.iso).toBeNull()
    expect(result.fNumber).toBeNull()
    expect(result.exposureTime).toBeNull()
    expect(result.focalLength).toBeNull()
    expect(result.raw).toBeNull()
  })
})
