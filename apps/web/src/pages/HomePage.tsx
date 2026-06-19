import { useState, useEffect } from 'react'
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
  const color = status === 'up' ? '#22c55e' : status === 'degraded' ? '#eab308' : '#ef4444'
  return (
    <span
      style={{
        display: 'inline-block',
        width: 12,
        height: 12,
        borderRadius: '50%',
        backgroundColor: color,
        marginRight: 8,
      }}
    />
  )
}

function ServiceCard({ service }: { service: ServiceStatus }) {
  return (
    <div
      style={{
        background: '#1a1a1a',
        borderRadius: 12,
        padding: 24,
        border: '1px solid #333',
        minWidth: 240,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
        <StatusDot status={service.status} />
        <h3 style={{ fontSize: 16, fontWeight: 600 }}>{service.name}</h3>
      </div>
      <div style={{ fontSize: 13, color: '#999', lineHeight: 1.8 }}>
        <div>Port: {service.port}</div>
        <div>Status: {service.status || 'unknown'}</div>
        {service.latencyMs !== undefined && <div>Latency: {service.latencyMs}ms</div>}
        {service.uptime !== undefined && <div>Uptime: {Math.floor(service.uptime)}s</div>}
        {service.error && <div style={{ color: '#ef4444' }}>Error: {service.error}</div>}
      </div>
    </div>
  )
}

export function HomePage() {
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
        r.status === 'fulfilled' ? r.value : { ...SERVICES[i], status: 'down', error: 'Network error' },
      ),
    )
  }

  useEffect(() => {
    fetchStatuses()
    const interval = setInterval(fetchStatuses, 5000)
    return () => clearInterval(interval)
  }, [])

  return (
    <div style={{ padding: 48, maxWidth: 1200, margin: '0 auto' }}>
      <header style={{ marginBottom: 48 }}>
        <h1 style={{ fontSize: 32, fontWeight: 700, marginBottom: 8 }}>Photox</h1>
        <p style={{ fontSize: 16, color: '#999' }}>Personal photo & video hosting</p>
      </header>

      <section>
        <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 24 }}>Service Health</h2>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          {statuses.map((svc) => (
            <ServiceCard key={svc.port} service={svc} />
          ))}
        </div>
      </section>
    </div>
  )
}
