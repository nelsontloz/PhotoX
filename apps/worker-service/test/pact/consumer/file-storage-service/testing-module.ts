import { Test } from '@nestjs/testing'
import { HttpModule, HttpService } from '@nestjs/axios'

export async function setupFileStorageServicePactModule() {
  const module = await Test.createTestingModule({
    imports: [HttpModule],
  }).compile()

  const httpService = module.get(HttpService)
  return { httpService }
}
