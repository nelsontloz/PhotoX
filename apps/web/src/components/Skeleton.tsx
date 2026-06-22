interface SkeletonProps {
  className?: string
  style?: React.CSSProperties
}

export function Skeleton({ className = '', style }: SkeletonProps) {
  return <div className={`animate-pulse bg-slate-700/50 rounded ${className}`} style={style} />
}
