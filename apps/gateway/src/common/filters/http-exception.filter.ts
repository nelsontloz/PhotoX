import { Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common'

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown) {
    let status = HttpStatus.INTERNAL_SERVER_ERROR
    let message = 'Internal server error'

    if (exception instanceof HttpException) {
      status = exception.getStatus()
      const res = exception.getResponse()
      message = typeof res === 'string' ? res : ((res as { message?: string }).message ?? message)
    }

    console.error(`[ExceptionFilter] ${status}: ${message}`)
  }
}
