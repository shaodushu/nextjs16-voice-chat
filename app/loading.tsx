export default function Loading() {
  return (
    <div className="flex flex-col h-dvh max-w-lg mx-auto items-center justify-center">
      <div className="flex gap-1">
        <div className="w-2 h-2 rounded-full bg-primary-400 animate-bounce" style={{ animationDelay: '0ms' }} />
        <div className="w-2 h-2 rounded-full bg-primary-500 animate-bounce" style={{ animationDelay: '150ms' }} />
        <div className="w-2 h-2 rounded-full bg-primary-600 animate-bounce" style={{ animationDelay: '300ms' }} />
      </div>
      <p className="text-sm text-gray-400 mt-3">加载中...</p>
    </div>
  )
}
