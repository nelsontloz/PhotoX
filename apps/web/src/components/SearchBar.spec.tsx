import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { SearchInput } from './SearchBar'

function LocationProbe() {
  const location = useLocation()
  return <div data-testid="location">{location.pathname + location.search}</div>
}

function renderInput(initialUrl = '/') {
  return render(
    <MemoryRouter initialEntries={[initialUrl]}>
      <SearchInput />
      <LocationProbe />
    </MemoryRouter>,
  )
}

describe('SearchInput', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('navigates to /search with the debounced query', () => {
    renderInput('/')
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'beach' } })
    expect(screen.getByTestId('location').textContent).toBe('/')
    act(() => {
      vi.advanceTimersByTime(300)
    })
    expect(screen.getByTestId('location').textContent).toBe('/search?q=beach')
  })

  it('clearing on the search page drops the query without leaving the page', () => {
    renderInput('/search?q=beach')
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '' } })
    act(() => {
      vi.advanceTimersByTime(300)
    })
    expect(screen.getByTestId('location').textContent).toBe('/search')
  })

  it('Escape clears the field and the query', () => {
    renderInput('/search?q=beach')
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' })
    expect(screen.getByTestId('location').textContent).toBe('/search')
    expect(screen.getByRole<HTMLInputElement>('textbox').value).toBe('')
  })
})
