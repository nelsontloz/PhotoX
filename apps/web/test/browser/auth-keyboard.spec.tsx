import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { page, userEvent } from '@vitest/browser/context'
import { MemoryRouter } from 'react-router-dom'
import '../../src/app.css'
import LoginPage from '../../src/pages/login/index'
import RegisterPage from '../../src/pages/register/index'

// Real-Chromium keyboard lane: every focus assertion is a document.activeElement identity check
// after an actual Tab / Shift+Tab key press (userEvent.tab → Playwright page.keyboard.press), and
// visibility is read from getComputedStyle. No global afterEach registers in this lane (its config
// drops the base test block), so unmount explicitly. Rendering is network-free: the auth store
// starts 'idle', so no page in this file calls the API.
afterEach(cleanup)

function must<T>(value: T | null | undefined, msg: string): T {
  if (value === null || value === undefined) throw new Error(msg)
  return value
}

const query = <T extends Element>(root: ParentNode, selector: string): T =>
  must(root.querySelector<T>(selector), `missing element: ${selector}`)

const loginPage = () =>
  render(
    <MemoryRouter>
      <LoginPage />
    </MemoryRouter>,
  )

const registerPage = () =>
  render(
    <MemoryRouter>
      <RegisterPage />
    </MemoryRouter>,
  )

/** The Nth eye toggle in the form, in DOM (and therefore tab) order. */
const eyeToggleOf = (container: HTMLElement, index = 0): HTMLButtonElement =>
  must(
    container.querySelectorAll<HTMLButtonElement>('form button[type="button"]')[index],
    `eye toggle #${index} missing`,
  )

/** Click to hand the iframe focus to the page, then walk `steps` real Tab presses. */
async function tabFrom(element: Element, steps: number, shift = false) {
  await userEvent.click(element)
  for (let i = 0; i < steps; i++) await userEvent.tab({ shift })
}

describe('auth keyboard (headless Chromium)', () => {
  it('login: Tab walks email → password → eye toggle → submit → footer link', async () => {
    const { container } = loginPage()
    const email = query<HTMLInputElement>(container, '#email')
    const password = query<HTMLInputElement>(container, '#password')
    const toggle = eyeToggleOf(container)
    const submit = query<HTMLButtonElement>(container, 'button[type="submit"]')
    const footerLink = query<HTMLAnchorElement>(container, 'a[href="/register"]')

    await userEvent.click(email)
    expect(document.activeElement).toBe(email)

    await userEvent.tab()
    expect(document.activeElement).toBe(password)

    await userEvent.tab()
    expect(document.activeElement).toBe(toggle)

    await userEvent.tab()
    expect(document.activeElement).toBe(submit)

    await userEvent.tab()
    expect(document.activeElement).toBe(footerLink)

    // Shift+Tab retraces the same order.
    await userEvent.tab({ shift: true })
    expect(document.activeElement).toBe(submit)
  })

  it('register: Tab walks fullName → email → password → toggle → confirm → toggle → submit → link', async () => {
    const { container } = registerPage()
    const fullName = query<HTMLInputElement>(container, '#fullName')
    const email = query<HTMLInputElement>(container, '#email')
    const password = query<HTMLInputElement>(container, '#password')
    const confirm = query<HTMLInputElement>(container, '#confirmPassword')
    const passwordToggle = eyeToggleOf(container, 0)
    const confirmToggle = eyeToggleOf(container, 1)
    const submit = query<HTMLButtonElement>(container, 'button[type="submit"]')
    const footerLink = query<HTMLAnchorElement>(container, 'a[href="/login"]')

    await userEvent.click(fullName)
    expect(document.activeElement).toBe(fullName)

    await userEvent.tab()
    expect(document.activeElement).toBe(email)

    await userEvent.tab()
    expect(document.activeElement).toBe(password)

    await userEvent.tab()
    expect(document.activeElement).toBe(passwordToggle)

    await userEvent.tab()
    expect(document.activeElement).toBe(confirm)

    await userEvent.tab()
    expect(document.activeElement).toBe(confirmToggle)

    await userEvent.tab()
    expect(document.activeElement).toBe(submit)

    await userEvent.tab()
    expect(document.activeElement).toBe(footerLink)
  })

  it('eye toggle flips the password input type when activated with Enter', async () => {
    const { container } = loginPage()
    const password = query<HTMLInputElement>(container, '#password')
    const toggle = eyeToggleOf(container)

    await tabFrom(query<HTMLInputElement>(container, '#email'), 2)
    expect(document.activeElement).toBe(toggle)
    expect(password.type).toBe('password')

    await userEvent.keyboard('{Enter}')
    await expect.poll(() => password.type).toBe('text')

    await userEvent.keyboard('{Enter}')
    await expect.poll(() => password.type).toBe('password')
  })

  it('eye toggle has an accessible name that reflects the password visibility', async () => {
    const { container } = loginPage()
    const toggle = eyeToggleOf(container)

    // Computed accessible name, not just the attribute: an icon-only control must be named.
    expect(page.getByRole('button', { name: 'Show password' }).query()).toBe(toggle)

    await tabFrom(query<HTMLInputElement>(container, '#email'), 2)
    expect(document.activeElement).toBe(toggle)

    await userEvent.keyboard('{Enter}')
    await expect
      .poll(() => page.getByRole('button', { name: 'Hide password' }).query())
      .toBe(toggle)
  })

  it('eye toggle shows a visible focus indicator when reached by keyboard', async () => {
    const { container } = loginPage()
    const toggle = eyeToggleOf(container)

    await tabFrom(query<HTMLInputElement>(container, '#email'), 2)
    expect(document.activeElement).toBe(toggle)

    // Tailwind's ring renders as a box-shadow. The pre-fix button had focus:outline-none with no
    // replacement, so this computed to 'none' — the regression this assertion pins.
    expect(getComputedStyle(toggle).boxShadow).not.toBe('none')
  })
})
