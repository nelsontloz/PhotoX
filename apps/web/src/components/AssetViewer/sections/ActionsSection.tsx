import { FaClock } from 'react-icons/fa6'

export function ActionsSection() {
  return (
    <section>
      <button className="w-full py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-lg transition-colors flex items-center justify-center gap-2">
        <FaClock className="text-[14px]" />
        View Revision History
      </button>
    </section>
  )
}
