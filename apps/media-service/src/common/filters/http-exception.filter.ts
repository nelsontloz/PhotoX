import {
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  type ArgumentsHost,
} from '@nestjs/common'
import type { Response } from 'express'

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp()
    const response = ctx.getResponse<Response>()

    let status = HttpStatus.INTERNAL_SERVER_ERROR
    let message = 'Internal server error'

    if (exception instanceof HttpException) {
      status = exception.getStatus()
      const res = exception.getResponse()
      message = typeof res === 'string' ? res : ((res as { message?: string }).message ?? message)
    } else {
      const err = exception instanceof Error ? exception : new Error(String(exception))
      console.error(`[ExceptionFilter] ${status}: ${err.stack ?? err.message}`)
      response.status(status).json({ statusCode: status, message: err.message })
      return
    }

    console.error(`[ExceptionFilter] ${status}: ${message}`)
    response.status(status).json({ statusCode: status, message })
  }
}
