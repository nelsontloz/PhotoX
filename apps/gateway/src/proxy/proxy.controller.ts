import { All, Controller, Req, Res } from '@nestjs/common'
import type { Request, Response } from 'express'
import { ProxyService } from './proxy.service'

@Controller()
export class ProxyController {
  constructor(private readonly proxyService: ProxyService) {}

  // ponytail: Express 5 named splat (a bare `*` throws under path-to-regexp v8);
  // the target URL is rebuilt from req.originalUrl, params are unused
  @All('/api/*splat')
  forward(@Req() req: Request, @Res() res: Response): Promise<void> {
    return this.proxyService.forward(req, res)
  }
}
