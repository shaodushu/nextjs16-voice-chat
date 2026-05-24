'use client'

import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils/cn'

interface InterruptionBannerProps {
  isInterrupted: boolean
  className?: string
}

export function InterruptionBanner({ isInterrupted, className }: InterruptionBannerProps) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (isInterrupted) {
      setVisible(true)
      const timer = setTimeout(() => setVisible(false), 1500)
      return () => clearTimeout(timer)
    }
  }, [isInterrupted])

  if (!visible) return null

  return (
    <div
      className={cn(
        'fixed top-20 left-1/2 -translate-x-1/2 z-20',
        'bg-indigo-50 text-indigo-700 border border-indigo-200',
        'rounded-full px-4 py-1.5 text-sm shadow-lg',
        'animate-fade-in',
        className
      )}
    >
      👂 已打断，您请说
    </div>
  )
}
