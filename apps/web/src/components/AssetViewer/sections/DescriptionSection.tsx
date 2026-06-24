import { FaNoteSticky } from 'react-icons/fa6'
import type { Asset } from '@photox/shared-types'

interface DescriptionSectionProps {
  asset: Asset
}

export function DescriptionSection({ asset }: DescriptionSectionProps) {
  if (!asset.description) {
    return (
      <section>
        <div className="flex items-center gap-2 text-slate-400 mb-2">
          <FaNoteSticky className="text-[18px]" />
          <h4 className="text-xs font-bold uppercase tracking-wider">Description</h4>
        </div>
        <p className="text-sm text-slate-600 italic">No description</p>
      </section>
    )
  }

  return (
    <section>
      <div className="flex items-center gap-2 text-slate-400 mb-2">
        <FaNoteSticky className="text-[18px]" />
        <h4 className="text-xs font-bold uppercase tracking-wider">Description</h4>
      </div>
      <p className="text-sm text-slate-300 leading-relaxed whitespace-pre-wrap">
        {asset.description}
      </p>
    </section>
  )
}
