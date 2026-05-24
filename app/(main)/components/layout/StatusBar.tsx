'use client'

import { AudioState } from '@/types/voice'
import { cn } from '@/lib/utils/cn'

interface StatusBarProps {
  audioState: AudioState
  mode: 'local' | 'cloud'
}

const stateLabels: Record<AudioState, string> = {
  [AudioState.Idle]: '待命',
  [AudioState.Recording]: '聆听中',
  [AudioState.Processing]: '处理中',
  [AudioState.Speaking]: '回复中',
  [AudioState.Interrupted]: '已打断',
}

export function StatusBar({ audioState, mode }: StatusBarProps) {
  return (
    <div className="flex items-center justify-center gap-2 py-2 px-4">
      <div className="flex items-center gap-1.5">
        <span
          className={cn(
            'w-1.5 h-1.5 rounded-full',
            audioState === AudioState.Recording
              ? 'bg-red-500 animate-pulse'
              : audioState === AudioState.Speaking
                ? 'bg-blue-500 animate-pulse'
                : 'bg-gray-400'
          )}
        />
        <span className="text-xs text-gray-400">{stateLabels[audioState]}</span>
      </div>
      <span className="text-gray-300">·</span>
      <span className="text-xs text-gray-400">
        模式: {mode === 'local' ? '本地快速' : '云端深度'}
      </span>
    </div>
  )
}
