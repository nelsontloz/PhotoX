import { describe, it, expect, beforeEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { UploadSidebarQueue } from './UploadNotification'
import { useUploadStore, type UploadItem } from '../store/upload-store'

let nextId = 0
function item(overrides: Partial<UploadItem> = {}): UploadItem {
  nextId += 1
  return {
    id: `test-${nextId}`,
    fileName: `photo-${nextId}.jpg`,
    sizeBytes: 1000,
    kind: 'photo',
    progress: 0,
    status: 'queued',
    ...overrides,
  }
}

describe('UploadSidebarQueue', () => {
  beforeEach(() => {
    useUploadStore.setState({ items: [], dismissed: false })
  })

  it('shows in-flight copy and completion totals', () => {
    useUploadStore.setState({
      items: [
        item({ status: 'done', progress: 100 }),
        item({ status: 'uploading', progress: 50 }),
        item({ status: 'queued' }),
        item({ status: 'error' }),
      ],
    })
    render(<UploadSidebarQueue />)
    expect(screen.getByText('Uploading 2 files')).toBeDefined()
    expect(screen.getByText(/1 of 4 completed/)).toBeDefined()
  })

  it('shows the all-done title', () => {
    useUploadStore.setState({
      items: [item({ status: 'done', progress: 100 }), item({ status: 'done', progress: 100 })],
    })
    render(<UploadSidebarQueue />)
    expect(screen.getByText('All 2 files uploaded')).toBeDefined()
  })

  it('shows failures when nothing is in flight', () => {
    useUploadStore.setState({
      items: [item({ status: 'done' }), item({ status: 'error' }), item({ status: 'error' })],
    })
    render(<UploadSidebarQueue />)
    expect(screen.getByText('2 uploads failed')).toBeDefined()
  })

  it('falls back to the queued title', () => {
    useUploadStore.setState({ items: [item(), item(), item()] })
    render(<UploadSidebarQueue />)
    expect(screen.getByText('3 files queued')).toBeDefined()
  })

  it('turns the rings green when all uploads finish', () => {
    useUploadStore.setState({
      items: [item({ status: 'done', progress: 100 }), item({ status: 'done', progress: 100 })],
    })
    const { container } = render(<UploadSidebarQueue />)
    expect(container.querySelectorAll('path.text-emerald-500').length).toBeGreaterThan(0)
  })

  it('renders every item without truncating, uploading first and done last', () => {
    useUploadStore.setState({
      items: [
        item({ fileName: 'done-a.jpg', status: 'done', progress: 100 }),
        item({ fileName: 'queued.jpg', status: 'queued' }),
        item({ fileName: 'done-b.jpg', status: 'done', progress: 100 }),
        item({ fileName: 'uploading.jpg', status: 'uploading', progress: 42 }),
        item({ fileName: 'error.jpg', status: 'error' }),
        item({ fileName: 'done-c.jpg', status: 'done', progress: 100 }),
      ],
    })
    render(<UploadSidebarQueue />)
    const rows = screen.getAllByRole('listitem')
    expect(rows).toHaveLength(6)
    expect(rows[0]?.textContent).toContain('uploading.jpg')
    expect(rows[1]?.textContent).toContain('queued.jpg')
    expect(rows[2]?.textContent).toContain('error.jpg')
    expect(rows[rows.length - 1]?.textContent).toContain('done-c.jpg')
  })

  it('dismisses and clears settled items', () => {
    useUploadStore.setState({ items: [item({ status: 'done', progress: 100 })] })
    render(<UploadSidebarQueue />)
    fireEvent.click(screen.getByText('Clear'))
    expect(useUploadStore.getState().items).toHaveLength(0)
    expect(useUploadStore.getState().dismissed).toBe(true)
  })
})
