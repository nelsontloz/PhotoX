import type { Asset } from '@photox/shared-types'

interface DescriptionSectionProps {
  asset: Asset
}

export function DescriptionSection({ asset }: DescriptionSectionProps) {
  return (
    <section>
      <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">
        Description
      </h4>
      {asset.description ? (
        <p className="text-sm text-slate-300 leading-relaxed">{asset.description}</p>
      ) : (
        <p className="text-sm text-slate-600 italic">No description</p>
      )}
    </section>
  )
}
