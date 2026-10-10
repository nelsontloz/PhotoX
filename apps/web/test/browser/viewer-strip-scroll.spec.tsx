import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import type { Asset } from '@photox/shared-types'
import '../../src/app.css'
import { ViewerMedia } from '../../src/components/AssetViewer/ViewerMedia'

// Real-Chromium regression lane for the viewer thumbnail strip. jsdom has no layout, so the
// slide-into-view bug (scrollIntoView scrolling the overflow-hidden viewer column and dragging
// the whole stage sideways on narrow viewports) is only observable here.
afterEach(cleanup)

const must = <T,>(value: T | undefined, msg: string): T => {
  if (value === undefined) throw new Error(msg)
  return value
}

const assets: Asset[] = Array.from(
  { length: 10 },
  (_, i) => ({ id: `a${i}`, kind: 'photo', thumbnails: [] }) as Asset,
)

// Replica of AssetViewer's scroll chain (root → overflow-hidden column) at a phone width; the
// strip's 7-thumb row overflows that column, which is what made scrollIntoView reachable.
function Stage({ current }: { current: Asset }) {
  return (
    <div className="relative" style={{ width: 390, height: 740 }}>
      <div
        data-testid="viewer-root"
        className="absolute inset-0 z-50 flex overflow-hidden bg-black"
      >
        <div
          data-testid="viewer-column"
          className="relative flex-1 flex flex-col min-w-0 h-full overflow-hidden"
        >
          <ViewerMedia
            isVideo={false}
            videoSrc={null}
            videoFallbackSrc={undefined}
            videoPoster={undefined}
            videoTitle={undefined}
            imageUrl={null}
            imageAlt="Photo"
            loading={false}
            hasPrev={false}
            hasNext={false}
            infoOpen={false}
            asset={current}
            siblingAssets={assets}
            onSelectSibling={() => {}}
          />
        </div>
      </div>
    </div>
  )
}

describe('viewer thumbnail strip (headless Chromium)', () => {
  it('arriving at the last sibling does not scroll the viewer stage sideways', async () => {
    const view = render(<Stage current={must(assets[0], 'first asset missing')} />)
    const column = view.getByTestId('viewer-column')
    const root = view.getByTestId('viewer-root')

    view.rerender(<Stage current={must(assets.at(-1), 'last asset missing')} />)
    // pre-fix this used to smooth-scroll: give the animation time to settle before reading
    await new Promise((resolve) => setTimeout(resolve, 600))

    expect(column.scrollLeft).toBe(0)
    expect(root.scrollLeft).toBe(0)
  })
})
