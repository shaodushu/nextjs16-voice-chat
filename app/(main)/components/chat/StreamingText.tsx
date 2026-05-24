'use client'

import { cn } from '@/lib/utils/cn'

interface StreamingTextProps {
  text: string
  className?: string
}

export function StreamingText({ text, className }: StreamingTextProps) {
  if (!text) return null

  return (
    <p className={cn('text-sm leading-relaxed', className)}>
      {text}
      <span className="inline-block w-1.5 h-4 bg-primary-500 ml-0.5 animate-pulse align-text-bottom" />
    </p>
  )
}
