import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { ConfirmProvider, useConfirm } from './ConfirmProvider'

function Harness({ onResult }: { onResult: (value: boolean) => void }) {
  const confirm = useConfirm()
  return (
    <button
      type="button"
      onClick={() => {
        void confirm({ title: 'Delete this item?', destructive: true }).then(onResult)
      }}
    >
      ask
    </button>
  )
}

function renderHarness(onResult: (value: boolean) => void) {
  return render(
    <ConfirmProvider>
      <Harness onResult={onResult} />
    </ConfirmProvider>,
  )
}

afterEach(cleanup)

describe('ConfirmProvider', () => {
  it('resolves true when the confirm button is clicked', async () => {
    const onResult = vi.fn()
    renderHarness(onResult)

    fireEvent.click(screen.getByText('ask'))
    fireEvent.click(await screen.findByText('Confirm'))

    await waitFor(() => expect(onResult).toHaveBeenCalledWith(true))
  })

  it('resolves false when Cancel is clicked', async () => {
    const onResult = vi.fn()
    renderHarness(onResult)

    fireEvent.click(screen.getByText('ask'))
    fireEvent.click(await screen.findByText('Cancel'))

    await waitFor(() => expect(onResult).toHaveBeenCalledWith(false))
  })

  it('resolves false on Escape', async () => {
    const onResult = vi.fn()
    renderHarness(onResult)

    fireEvent.click(screen.getByText('ask'))
    await screen.findByText('Confirm')
    fireEvent.keyDown(document, { key: 'Escape' })

    await waitFor(() => expect(onResult).toHaveBeenCalledWith(false))
  })

  it('throws when useConfirm is used outside the provider', () => {
    expect(() => renderHook(() => useConfirm())).toThrow(
      'useConfirm must be used inside ConfirmProvider',
    )
  })
})
