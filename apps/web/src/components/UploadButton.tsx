import { useRef, useCallback } from 'react'
import { FaCamera } from 'react-icons/fa6'
import { enqueueFiles } from '../lib/upload'

interface UploadButtonProps {
  variant?: 'default' | 'compact'
  onComplete?: () => void
}

export function UploadButton({ variant = 'default', onComplete }: UploadButtonProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  const open = useCallback(() => inputRef.current?.click(), [])

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? [])
      enqueueFiles(files, { onComplete })
      if (inputRef.current) inputRef.current.value = ''
    },
    [onComplete],
  )

  if (variant === 'compact') {
    return (
      <>
        <button
          onClick={open}
          className="hidden sm:flex items-center gap-2 bg-primary hover:bg-primary/90 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-all shadow-lg shadow-primary/20"
        >
          <FaCamera className="text-[14px]" />
          <span>Upload</span>
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/*,video/*"
          multiple
          className="hidden"
          onChange={handleChange}
        />
      </>
    )
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/*,video/*"
        multiple
        className="hidden"
        onChange={handleChange}
      />
      <button
        onClick={open}
        className="group inline-flex items-center gap-3 bg-primary text-white px-10 py-5 rounded-full font-bold text-lg shadow-2xl shadow-primary/30 hover:scale-105 active:scale-95 transition-transform"
      >
        <FaCamera className="text-2xl group-hover:-translate-y-0.5 transition-transform" />
        <span>Upload Photos</span>
      </button>
    </>
  )
}
