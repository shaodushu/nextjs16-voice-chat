'use client'

import { Mic, MicOff, Loader2 } from 'lucide-react'
import { AudioState } from '@/types/voice'
import { cn } from '@/lib/utils/cn'

interface MicrophoneButtonProps {
  audioState: AudioState
  isRecording: boolean
  onToggle: () => void
}

export function MicrophoneButton({ audioState, isRecording, onToggle }: MicrophoneButtonProps) {
  const disabled = audioState === AudioState.Processing

  return (
    <button
      onClick={onToggle}
      disabled={disabled}
      className={cn(
        'w-16 h-16 rounded-full flex items-center justify-center transition-all duration-300',
        'shadow-lg shadow-black/10 active:scale-95',
        isRecording
          ? 'bg-red-500 text-white shadow-red-500/30'
          : 'bg-white text-gray-600 hover:bg-gray-50',
        disabled && 'opacity-50 cursor-not-allowed'
      )}
      aria-label={isRecording ? '停止录音' : '开始录音'}
    >
      {disabled ? (
        <Loader2 className="w-7 h-7 animate-spin" />
      ) : isRecording ? (
        <MicOff className="w-7 h-7" />
      ) : (
        <Mic className="w-7 h-7" />
      )}
    </button>
  )
}
