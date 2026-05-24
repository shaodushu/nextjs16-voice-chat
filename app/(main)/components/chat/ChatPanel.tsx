'use client'

import { useRef, useEffect } from 'react'
import { ConversationBubble } from './ConversationBubble'
import { StreamingText } from './StreamingText'
import type { ConversationTurn } from '@/types/voice'
import { cn } from '@/lib/utils/cn'

interface ChatPanelProps {
  messages: ConversationTurn[]
  streamingText: string
  className?: string
}

export function ChatPanel({ messages, streamingText, className }: ChatPanelProps) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingText])

  return (
    <div className={cn('flex-1 overflow-y-auto hide-scrollbar px-4 py-4 space-y-3', className)}>
      {messages.length === 0 && !streamingText && (
        <div className="flex flex-col items-center justify-center h-full text-gray-400">
          <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center mb-3">
            <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"
              />
            </svg>
          </div>
          <p className="text-sm">点击下方麦克风开始语音对话</p>
          <p className="text-xs mt-1">支持打断，情感语音回复</p>
        </div>
      )}

      {messages.map((turn) => (
        <div key={turn.id} className="animate-slide-up">
          <ConversationBubble turn={turn} />
        </div>
      ))}

      {streamingText && (
        <div className="flex justify-start animate-fade-in">
          <div className="max-w-[80%] rounded-2xl rounded-bl-md px-4 py-2.5 bg-white shadow-sm border border-gray-100">
            <StreamingText text={streamingText} />
          </div>
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  )
}
