import { useState, useEffect } from 'react'
import { FaCircle } from 'react-icons/fa6'
import { checkGatewayHealth, checkServiceHealth } from '../api/health'

interface ServiceStatus {
  name: string
  port: number
  status: string
  latencyMs?: number
  uptime?: number
  error?: string
}

const SERVICES = [
  { name: 'Gateway', port: 3000 },
  { name: 'User Service', port: 3001 },
  { name: 'Library Service', port: 3002 },
  { name: 'File Storage Service', port: 3003 },
]

function StatusDot({ status }: { status: string }) {
  const color =
    status === 'up' ? 'text-green-500' : status === 'degraded' ? 'text-yellow-500' : 'text-red-500'

  return <FaCircle className={`inline-block text-xs mr-2 ${color}`} />
}

function ServiceCard({ service }: { service: ServiceStatus }) {
  return (
    <div className="min-w-[240px] rounded-xl border border-zinc-800 bg-zinc-900 p-6">
      <div className="mb-3 flex items-center">
        <StatusDot status={service.status} />
        <h3 className="text-sm font-semibold">{service.name}</h3>
      </div>
      <div className="space-y-1 text-xs text-zinc-400">
        <div>Port: {service.port}</div>
        <div>Status: {service.status || 'unknown'}</div>
        {service.latencyMs !== undefined && <div>Latency: {service.latencyMs}ms</div>}
        {service.uptime !== undefined && <div>Uptime: {Math.floor(service.uptime)}s</div>}
        {service.error && <div className="text-red-500">Error: {service.error}</div>}
      </div>
    </div>
  )
}

export default function HomePage() {
  const [statuses, setStatuses] = useState<ServiceStatus[]>(
    SERVICES.map((s) => ({ ...s, status: 'checking' })),
  )

  const fetchStatuses = async () => {
    const results = await Promise.allSettled(
      SERVICES.map(async (svc) => {
        try {
          if (svc.port === 3000) {
            const health = await checkGatewayHealth()
            return { ...svc, status: health.status, uptime: health.uptime }
          }
          const health = await checkServiceHealth(svc.port)
          const dbCheck = health.checks?.database
          return {
            ...svc,
            status: health.status,
            latencyMs: dbCheck?.latencyMs,
            uptime: health.uptime,
          }
        } catch (err) {
          return { ...svc, status: 'down', error: (err as Error).message }
        }
      }),
    )

    setStatuses(
      results.map((r, i) =>
        r.status === 'fulfilled'
          ? r.value
          : {
              name: SERVICES[i]!.name,
              port: SERVICES[i]!.port,
              status: 'down',
              error: 'Network error',
            },
      ),
    )
  }

  useEffect(() => {
    void fetchStatuses()
    const interval = setInterval(() => {
      void fetchStatuses()
    }, 5000)
    return () => clearInterval(interval)
  }, [])

  return (
    <div className="mx-auto max-w-screen-xl px-12 py-12">
      <header className="mb-12">
        <h1 className="mb-2 text-3xl font-bold">Photox</h1>
        <p className="text-base text-zinc-400">Personal photo &amp; video hosting</p>
      </header>

      <section>
        <h2 className="mb-6 text-xl font-semibold">Service Health</h2>
        <div className="flex flex-wrap gap-4">
          {statuses.map((svc) => (
            <ServiceCard key={svc.port} service={svc} />
          ))}
        </div>
      </section>
    </div>
  )
}
