import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { User } from '@photox/shared-types'
import { Sidebar } from './Sidebar'
import { useAuthStore } from '../store/auth-store'

afterEach(() => {
  cleanup()
  useAuthStore.setState({ user: null })
})

const adminUser = { id: 'u1', email: 'admin@test.local', role: 'admin' } as User

function renderAt(path: string) {
  useAuthStore.setState({ user: adminUser })
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Sidebar />
    </MemoryRouter>,
  )
}

function link(container: HTMLElement, href: string): HTMLAnchorElement {
  const el = container.querySelector<HTMLAnchorElement>(`a[href="${href}"]`)
  if (!el) throw new Error(`missing link ${href}`)
  return el
}

const highlighted = (container: HTMLElement): HTMLAnchorElement[] =>
  [...container.querySelectorAll<HTMLAnchorElement>('a[href]')].filter((a) =>
    a.className.includes('bg-primary/10'),
  )

describe('Sidebar active highlight', () => {
  it('highlights Trash — and nothing else — on /trash', () => {
    const { container } = renderAt('/trash')

    expect(link(container, '/trash').className).toContain('bg-primary/10')
    expect(link(container, '/admin').className).not.toContain('bg-primary/10')
    expect(highlighted(container)).toEqual([link(container, '/trash')])
  })

  it('highlights Admin on /admin', () => {
    const { container } = renderAt('/admin')

    expect(link(container, '/admin').className).toContain('bg-primary/10')
    expect(highlighted(container)).toEqual([link(container, '/admin')])
  })
})
