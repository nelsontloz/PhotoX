type AccessGetter = () => string | null
type Refresher = () => Promise<void>

let getter: AccessGetter = () => null
let refresher: Refresher | null = null

export function registerAuthAccess(g: AccessGetter, r: Refresher): void {
  getter = g
  refresher = r
}

export function getAccessToken(): string | null {
  return getter()
}

export function refreshAuth(): Promise<void> {
  return refresher ? refresher() : Promise.resolve()
}
