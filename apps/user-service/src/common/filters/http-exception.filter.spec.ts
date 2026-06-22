import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  ArgumentsHost,
  BadRequestException,
  HttpException,
  HttpStatus,
  UnauthorizedException,
} from '@nestjs/common'
import { HttpExceptionFilter } from './http-exception.filter'

function createMockHost() {
  const json = vi.fn()
  const status = vi.fn().mockReturnValue({ json })
  const response = { status, json }
  const getResponse = vi.fn().mockReturnValue(response)
  const getRequest = vi.fn().mockReturnValue({})
  const switchToHttp = vi.fn().mockReturnValue({ getResponse, getRequest })
  return { host: { switchToHttp } as unknown as ArgumentsHost, status, json }
}

describe('HttpExceptionFilter (user-service)', () => {
  let filter: HttpExceptionFilter
  let host: ArgumentsHost
  let status: ReturnType<typeof vi.fn>
  let json: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.spyOn(console, 'error').mockReturnValue(undefined)
    filter = new HttpExceptionFilter()
    const mock = createMockHost()
    host = mock.host
    status = mock.status
    json = mock.json
  })

  it('F-U1: HttpException with string body — status and json called with correct args', () => {
    filter.catch(new HttpException('Forbidden', HttpStatus.FORBIDDEN), host)
    expect(status).toHaveBeenCalledWith(HttpStatus.FORBIDDEN)
    expect(json).toHaveBeenCalledWith('Forbidden')
  })

  it('F-U2: HttpException with object body is preserved verbatim', () => {
    const body = { statusCode: 400, message: ['email must be an email'], error: 'Bad Request' }
    filter.catch(new BadRequestException(body), host)
    expect(status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST)
    expect(json).toHaveBeenCalledWith(body)
  })

  it('F-U3: UnauthorizedException default body is preserved as-is', () => {
    filter.catch(new UnauthorizedException(), host)
    expect(status).toHaveBeenCalledWith(HttpStatus.UNAUTHORIZED)
    const arg = json.mock.calls[0]?.[0] as Record<string, unknown>
    expect(arg).toMatchObject({ statusCode: 401, message: 'Unauthorized' })
  })

  it('F-U4: non-HttpException — 500 with generic body', () => {
    filter.catch(new Error('boom'), host)
    expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR)
    expect(json).toHaveBeenCalledWith({
      statusCode: 500,
      message: 'Internal server error',
    })
  })

  it('F-U5: status().json() chain is invoked exactly once per request', () => {
    filter.catch(new HttpException('x', 418), host)
    expect(status).toHaveBeenCalledTimes(1)
    expect(json).toHaveBeenCalledTimes(1)
  })
})
