import { FaSpinner } from 'react-icons/fa6'

export function TimelineSkeleton() {
  return (
    <div className="flex items-center justify-center py-32">
      <FaSpinner className="text-2xl text-primary animate-spin" />
    </div>
  )
}
