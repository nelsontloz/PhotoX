import axios from 'axios'
import { createPact } from '../setup'

const fileStorageService = createPact('file-storage-service', 'cleanup')

const FILE_ID = '123e4567-e89b-12d3-a456-426614174000'
const TRANSCODE_FILE_ID = '987e6543-e21b-34f5-c678-526614174000'

describe('Worker → file-storage-service cleanup pact', () => {
  it('DELETE /v1/internal/files/:fileId — successful deletion', async () => {
    await fileStorageService
      .given('file ' + FILE_ID + ' exists')
      .uponReceiving('a request to delete a file')
      .withRequest({
        method: 'DELETE',
        path: `/v1/internal/files/${FILE_ID}`,
      })
      .willRespondWith({
        status: 204,
      })
      .executeTest(async (mockserver) => {
        const res = await axios.delete(`${mockserver.url}/v1/internal/files/${FILE_ID}`)
        expect(res.status).toBe(204)
      })
  })

  it('DELETE /v1/internal/files/:transcodeFileId — successful transcode cleanup', async () => {
    await fileStorageService
      .given('file ' + TRANSCODE_FILE_ID + ' exists')
      .uponReceiving('a request to delete a transcode file')
      .withRequest({
        method: 'DELETE',
        path: `/v1/internal/files/${TRANSCODE_FILE_ID}`,
      })
      .willRespondWith({
        status: 204,
      })
      .executeTest(async (mockserver) => {
        const res = await axios.delete(`${mockserver.url}/v1/internal/files/${TRANSCODE_FILE_ID}`)
        expect(res.status).toBe(204)
      })
  })

  it('DELETE /v1/internal/files/:fileId — file not found (idempotent no-op)', async () => {
    await fileStorageService
      .given('file does not exist')
      .uponReceiving('a request to delete a nonexistent file')
      .withRequest({
        method: 'DELETE',
        path: `/v1/internal/files/${FILE_ID}`,
      })
      .willRespondWith({
        status: 204,
      })
      .executeTest(async (mockserver) => {
        const res = await axios.delete(`${mockserver.url}/v1/internal/files/${FILE_ID}`)
        expect(res.status).toBe(204)
      })
  })
})
