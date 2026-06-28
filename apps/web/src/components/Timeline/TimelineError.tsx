interface TimelineErrorProps {
  message: string
  onRetry: () => void
}

export function TimelineError({ message, onRetry }: TimelineErrorProps) {
  return (
    <div className="flex flex-col items-center justify-center py-32 gap-4">
      <p className="text-red-500 text-sm">{message}</p>
      <button onClick={onRetry} className="text-primary text-sm font-medium hover:underline">
        Retry
      </button>
    </div>
  )
}
