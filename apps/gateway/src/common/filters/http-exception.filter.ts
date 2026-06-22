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
    let body: unknown = { statusCode: status, message: 'Internal server error' }

    if (exception instanceof HttpException) {
      status = exception.getStatus()
      body = exception.getResponse()
    }

    console.error(`[ExceptionFilter] ${status}: ${JSON.stringify(body)}`)
    response.status(status).json(body)
  }
}
