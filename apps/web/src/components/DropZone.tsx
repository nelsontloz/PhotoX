import { useState, useRef, type ReactNode } from 'react'
import { FaCloudArrowUp } from 'react-icons/fa6'
import { enqueueFiles } from '../lib/upload'

interface DropZoneProps {
  children: ReactNode
  className?: string
}

export function DropZone({ children, className }: DropZoneProps) {
  const [isDragging, setIsDragging] = useState(false)
  const dragCounter = useRef(0)

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault()
    dragCounter.current += 1
    if (dragCounter.current === 1) setIsDragging(true)
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    dragCounter.current -= 1
    if (dragCounter.current <= 0) {
      dragCounter.current = 0
      setIsDragging(false)
    }
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    dragCounter.current = 0
    setIsDragging(false)
    const files = Array.from(e.dataTransfer.files).filter(
      (f) => f.type.startsWith('image/') || f.type.startsWith('video/'),
    )
    enqueueFiles(files)
  }

  return (
    <div
      className={`relative h-full ${className ?? ''}`}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {children}
      {isDragging && (
        <div className="fixed top-16 bottom-0 right-0 left-[72px] lg:left-60 z-50 bg-background-dark/80 backdrop-blur-md flex items-center justify-center pointer-events-none">
          <div className="flex flex-col items-center gap-6 max-w-md px-10 py-10 bg-card-dark border border-border-dark rounded-2xl shadow-2xl shadow-primary/20">
            <div className="size-20 rounded-full bg-primary/15 border-2 border-primary/40 flex items-center justify-center">
              <FaCloudArrowUp className="text-5xl text-primary" />
            </div>
            <div className="flex flex-col items-center gap-2 text-center">
              <p className="text-xl font-bold text-slate-100">Drop files to upload</p>
              <p className="text-sm text-slate-400">
                Photos and videos will be added to your timeline
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
