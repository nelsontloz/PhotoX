import { FaImage, FaMountain, FaWandMagicSparkles } from 'react-icons/fa6'
import { UploadButton } from '../UploadButton'

interface TimelineEmptyProps {
  onUploadComplete?: () => void
}

export function TimelineEmpty({ onUploadComplete }: TimelineEmptyProps) {
  return (
    <div className="flex flex-col items-center justify-center py-24 px-4 text-center max-w-lg mx-auto">
      <div className="mb-12 relative w-64 h-64 flex items-center justify-center">
        <div className="absolute inset-0 bg-primary/5 blur-[100px] rounded-full animate-pulse" />
        <div className="relative w-32 h-32">
          <div className="absolute inset-0 rounded-[32px] bg-[#272a32] border border-[#424754]/20 rotate-12 shadow-2xl flex items-center justify-center">
            <FaImage className="text-6xl text-primary opacity-20" />
          </div>
          <div className="absolute -top-4 -left-4 w-32 h-32 rounded-[32px] bg-[#1d1f27] border border-[#424754]/20 -rotate-6 shadow-2xl flex items-center justify-center">
            <FaMountain className="text-6xl text-primary opacity-40" />
          </div>
          <div className="absolute -top-8 left-2 w-32 h-32 rounded-[32px] bg-[#32353d] border border-primary/30 shadow-2xl flex items-center justify-center">
            <FaWandMagicSparkles className="text-6xl text-primary" />
          </div>
        </div>
      </div>
      <h1 className="text-4xl md:text-5xl font-black tracking-tighter text-slate-100 mb-6">
        No memories yet
      </h1>
      <p className="text-slate-400 text-lg leading-relaxed max-w-sm mx-auto mb-10">
        Your timeline is currently empty. Start preserving your life's moments by uploading your
        first batch of photos.
      </p>
      <UploadButton onComplete={onUploadComplete} />
    </div>
  )
}
