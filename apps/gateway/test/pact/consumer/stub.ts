import axios from 'axios'

interface ForwardOpts {
  method: string
  path: string
  body?: unknown
  headers?: Record<string, string>
  query?: Record<string, string>
  timeout?: number
}

export interface StubProxy {
  targetUrl: string
  calls: ForwardOpts[]
  forward<T = unknown>(serviceUrl: string, opts: ForwardOpts): Promise<{ status: number; data: T }>
}

export function createStubProxy(): StubProxy {
  const stub: StubProxy = {
    targetUrl: '',
    calls: [],
    forward: async <T = unknown>(_serviceUrl: string, opts: ForwardOpts) => {
      stub.calls.push(opts)
      const url = `${stub.targetUrl}/${opts.path}`
      const res = await axios.request<T>({
        method: opts.method,
        url,
        data: opts.body,
        params: opts.query,
        headers: opts.headers,
        validateStatus: () => true,
        timeout: opts.timeout,
      })
      return { status: res.status, data: res.data }
    },
  }
  return stub
}
