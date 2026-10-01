import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { Dialog } from './Dialog'

afterEach(cleanup)

function renderDialog({ onClose, escapeKey }: { onClose: () => void; escapeKey?: boolean }) {
  return render(
    <Dialog title="Test dialog" onClose={onClose} escapeKey={escapeKey}>
      {null}
    </Dialog>,
  )
}

describe('Dialog keyboard shielding', () => {
  it('calls onClose once on Escape', () => {
    const onClose = vi.fn()
    renderDialog({ onClose })

    fireEvent.keyDown(document.body, { key: 'Escape' })

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('keeps window-level keydown listeners inert while open', () => {
    const onClose = vi.fn()
    const windowListener = vi.fn()
    window.addEventListener('keydown', windowListener)
    try {
      renderDialog({ onClose })

      fireEvent.keyDown(document.body, { key: 'ArrowRight' })

      expect(windowListener).not.toHaveBeenCalled()
    } finally {
      window.removeEventListener('keydown', windowListener)
    }
  })

  it('does not close on Escape when escapeKey is false, but still shields', () => {
    const onClose = vi.fn()
    const windowListener = vi.fn()
    window.addEventListener('keydown', windowListener)
    try {
      renderDialog({ onClose, escapeKey: false })

      fireEvent.keyDown(document.body, { key: 'Escape' })

      expect(onClose).not.toHaveBeenCalled()
      expect(windowListener).not.toHaveBeenCalled()
    } finally {
      window.removeEventListener('keydown', windowListener)
    }
  })
})
