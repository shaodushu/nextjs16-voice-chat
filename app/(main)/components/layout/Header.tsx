'use client'

import { cn } from '@/lib/utils/cn'

interface HeaderProps {
  wsConnected: boolean
  mode: 'local' | 'cloud'
}

export function Header({ wsConnected, mode }: HeaderProps) {
  return (
    <header className="sticky top-0 z-10 bg-white/80 backdrop-blur-sm border-b border-gray-200 safe-area-bottom">
      <div className="max-w-lg mx-auto px-4 h-14 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center">
            <span className="text-white text-sm font-bold">小</span>
          </div>
          <h1 className="text-lg font-semibold text-gray-800">小慧管家</h1>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-xs">
            <div
              className={cn(
                'w-2 h-2 rounded-full',
                wsConnected ? 'bg-green-500' : 'bg-gray-300'
              )}
            />
            <span className="text-gray-500">{wsConnected ? '已连接' : '未连接'}</span>
          </div>

          <span
            className={cn(
              'text-xs px-2 py-0.5 rounded-full font-medium',
              mode === 'local'
                ? 'bg-blue-50 text-blue-600'
                : 'bg-purple-50 text-purple-600'
            )}
          >
            {mode === 'local' ? '本地' : '云端'}
          </span>
        </div>
      </div>
    </header>
  )
}
