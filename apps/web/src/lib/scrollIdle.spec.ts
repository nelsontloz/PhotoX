import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { whenScrollIdle } from './scrollIdle'

const scroll = () => window.dispatchEvent(new Event('scroll'))

describe('whenScrollIdle', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    // settle any pending gate so the module-level idle flag carries over cleanly
    vi.advanceTimersByTime(1000)
    vi.useRealTimers()
  })

  it('runs immediately while scrolling is settled', () => {
    const fired: number[] = []
    whenScrollIdle(() => fired.push(1))
    expect(fired).toEqual([1])
  })

  it('defers during scrolling and fires every waiter together after settling', () => {
    const fired: number[] = []
    scroll()
    whenScrollIdle(() => fired.push(1))
    whenScrollIdle(() => fired.push(2))
    expect(fired).toEqual([])
    vi.advanceTimersByTime(199)
    expect(fired).toEqual([])
    vi.advanceTimersByTime(1)
    expect(fired).toEqual([1, 2])
  })

  it('re-arms the settle window while scrolling continues', () => {
    const fired: number[] = []
    scroll()
    whenScrollIdle(() => fired.push(1))
    vi.advanceTimersByTime(100)
    scroll()
    vi.advanceTimersByTime(199)
    expect(fired).toEqual([])
    vi.advanceTimersByTime(1)
    expect(fired).toEqual([1])
  })

  it('cancel stops a deferred waiter', () => {
    const fired: number[] = []
    scroll()
    const cancel = whenScrollIdle(() => fired.push(1))
    cancel()
    vi.advanceTimersByTime(1000)
    expect(fired).toEqual([])
  })
})
