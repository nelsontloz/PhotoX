import { useRef, useCallback } from 'react'
import { FaCamera } from 'react-icons/fa6'
import { enqueueFiles } from '../lib/upload'

interface UploadButtonProps {
  variant?: 'default' | 'compact'
}

export function UploadButton({ variant = 'default' }: UploadButtonProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  const open = useCallback(() => inputRef.current?.click(), [])

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    enqueueFiles(files)
    if (inputRef.current) inputRef.current.value = ''
  }, [])

  if (variant === 'compact') {
    return (
      <>
        <button
          onClick={open}
          aria-label="Upload"
          className="flex size-9 items-center justify-center rounded-full bg-primary text-white shadow-lg shadow-primary/20 hover:bg-primary/90 transition-colors sm:size-auto sm:gap-2 sm:rounded-lg sm:px-4 sm:py-2 sm:text-sm sm:font-semibold"
        >
          <FaCamera className="text-[15px] sm:text-[14px]" />
          <span className="hidden sm:inline">Upload</span>
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
