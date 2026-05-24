'use client'

import { useRef, useEffect } from 'react'
import { cn } from '@/lib/utils/cn'

interface AudioVisualizerProps {
  volume: number
  isActive: boolean
  className?: string
}

const BAR_COUNT = 32

export function AudioVisualizer({ volume, isActive, className }: AudioVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    canvas.width = rect.width * dpr
    canvas.height = rect.height * dpr
    ctx.scale(dpr, dpr)

    const barWidth = rect.width / BAR_COUNT
    const height = rect.height

    ctx.clearRect(0, 0, rect.width, height)

    for (let i = 0; i < BAR_COUNT; i++) {
      const amp = isActive ? volume * (0.3 + Math.random() * 0.7) : 0.05
      const barHeight = Math.max(2, amp * height * 0.8)
      const x = i * barWidth + 1
      const y = (height - barHeight) / 2

      const gradient = ctx.createLinearGradient(x, y, x, y + barHeight)
      if (isActive) {
        gradient.addColorStop(0, '#4ade80')
        gradient.addColorStop(1, '#22c55e')
      } else {
        gradient.addColorStop(0, '#d1d5db')
        gradient.addColorStop(1, '#9ca3af')
      }

      ctx.fillStyle = gradient
      ctx.beginPath()
      ctx.roundRect(x, y, Math.max(1, barWidth - 2), barHeight, 2)
      ctx.fill()
    }
  }, [volume, isActive])

  return (
    <canvas
      ref={canvasRef}
      className={cn('w-full h-16 rounded-lg', className)}
    />
  )
}
