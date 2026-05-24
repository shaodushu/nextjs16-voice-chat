'use client'

import { cn } from '@/lib/utils/cn'
import type { ConversationTurn } from '@/types/voice'

interface ConversationBubbleProps {
  turn: ConversationTurn
  isStreaming?: boolean
}

export function ConversationBubble({ turn, isStreaming }: ConversationBubbleProps) {
  const isUser = turn.role === 'user'

  return (
    <div
      className={cn(
        'flex animate-fade-in',
        isUser ? 'justify-end' : 'justify-start'
      )}
    >
      <div
        className={cn(
          'max-w-[80%] rounded-2xl px-4 py-2.5',
          isUser
            ? 'bg-primary-500 text-white rounded-br-md'
            : 'bg-white text-gray-800 rounded-bl-md shadow-sm border border-gray-100'
        )}
      >
        <p className="text-sm leading-relaxed whitespace-pre-wrap">
          {turn.text}
          {isStreaming && (
            <span className="inline-block w-1.5 h-4 bg-primary-500 ml-0.5 animate-pulse align-text-bottom" />
          )}
        </p>
        {turn.emotion && !isUser && (
          <span className="text-xs text-gray-400 mt-1 block">
            {emotionLabel(turn.emotion)}
          </span>
        )}
      </div>
    </div>
  )
}

function emotionLabel(emotion: string): string {
  const labels: Record<string, string> = {
    warm: '💛 温暖',
    reassuring: '💙 安心',
    gentle: '💚 轻柔',
    encouraging: '💪 鼓励',
    attentive: '👂 专注',
  }
  return labels[emotion] ?? ''
}
