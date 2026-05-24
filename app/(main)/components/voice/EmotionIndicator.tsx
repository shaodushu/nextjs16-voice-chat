'use client'

import { Emotion } from '@/types/voice'
import { cn } from '@/lib/utils/cn'

interface EmotionIndicatorProps {
  emotion: Emotion
  className?: string
}

const emotionConfig: Record<Emotion, { label: string; icon: string; bgClass: string }> = {
  [Emotion.Warm]: { label: '温暖', icon: '💛', bgClass: 'bg-amber-50 text-amber-700 border-amber-200' },
  [Emotion.Reassuring]: { label: '安心', icon: '💙', bgClass: 'bg-blue-50 text-blue-700 border-blue-200' },
  [Emotion.Gentle]: { label: '轻柔', icon: '💚', bgClass: 'bg-green-50 text-green-700 border-green-200' },
  [Emotion.Encouraging]: { label: '鼓励', icon: '💪', bgClass: 'bg-purple-50 text-purple-700 border-purple-200' },
  [Emotion.Attentive]: { label: '专注', icon: '👂', bgClass: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
  [Emotion.Neutral]: { label: '', icon: '', bgClass: 'hidden' },
}

export function EmotionIndicator({ emotion, className }: EmotionIndicatorProps) {
  if (emotion === Emotion.Neutral) return null

  const config = emotionConfig[emotion]
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border animate-fade-in',
        config.bgClass,
        className
      )}
    >
      <span>{config.icon}</span>
      <span>{config.label}</span>
    </span>
  )
}
