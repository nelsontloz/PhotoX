import { describe, it, expect } from 'vitest'
import { parsePactUrls } from './pact-coverage'

describe('parsePactUrls', () => {
  it('extracts single pact filename', () => {
    const content = `pactUrls: [path.join(PACT_DIR, 'gateway-user-service.json')],`
    expect(parsePactUrls(content)).toEqual(['gateway-user-service.json'])
  })

  it('extracts multiple pact filenames', () => {
    const content = [
      'pactUrls: [',
      "  path.join(PACT_DIR, 'gateway-user-service.json'),",
      "  path.join(PACT_DIR, 'gateway-media-service.json'),",
      '],',
    ].join('\n')
    expect(parsePactUrls(content)).toEqual([
      'gateway-user-service.json',
      'gateway-media-service.json',
    ])
  })

  it('returns empty array when no pactUrls match', () => {
    expect(parsePactUrls('no pact urls here')).toEqual([])
  })

  it('handles empty pactUrls array', () => {
    expect(parsePactUrls('pactUrls: [],')).toEqual([])
  })

  it('ignores path.join outside pactUrls context', () => {
    const content = [
      'import path from "node:path"',
      'export const PACT_DIR = path.resolve(__dirname, "../../../../../pacts")',
      '',
      'it("validates", async () => {',
      "  pactUrls: [path.join(PACT_DIR, 'gateway-user-service.json')],",
      '})',
    ].join('\n')
    expect(parsePactUrls(content)).toEqual(['gateway-user-service.json'])
  })

  it('handles spaces and formatting variations', () => {
    const content = `pactUrls:[path.join(PACT_DIR,'gateway-user-service.json')],`
    expect(parsePactUrls(content)).toEqual(['gateway-user-service.json'])
  })

  it('handles double quotes', () => {
    const content = `pactUrls: [path.join(PACT_DIR, "gateway-user-service.json")],`
    expect(parsePactUrls(content)).toEqual(['gateway-user-service.json'])
  })
})
