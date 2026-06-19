import { healthApi } from './client'

interface HealthCheck {
  status: string
  service: string
  uptime: number
  timestamp: string
  checks?: Record<string, { status: string; latencyMs?: number }>
}

export async function checkGatewayHealth(): Promise<HealthCheck> {
  const { data } = await healthApi.get<HealthCheck>('/health')
  return data
}

export async function checkServiceHealth(port: number): Promise<HealthCheck> {
  const { data } = await healthApi.get<HealthCheck>(`http://localhost:${port}/health`)
  return data
}
