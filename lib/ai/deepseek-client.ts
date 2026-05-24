import type { ConversationTurn } from '@/types/voice'

interface StreamCallbacks {
  onDelta: (text: string, emotion?: string) => void
  onFinal: (text: string) => void
  onError: (error: Error) => void
}

export class DeepSeekClient {
  private abortController: AbortController | null = null

  async streamChat(
    message: string,
    history: ConversationTurn[],
    emotionHint: string,
    callbacks: StreamCallbacks
  ): Promise<void> {
    this.abortController = new AbortController()

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message,
          history: history.map((h) => ({
            role: h.role,
            content: h.text,
          })),
          emotionHint,
        }),
        signal: this.abortController.signal,
      })

      if (!res.ok) {
        const errText = await res.text().catch(() => 'Unknown error')
        throw new Error(`API error ${res.status}: ${errText}`)
      }

      const reader = res.body?.getReader()
      if (!reader) throw new Error('No response body')

      const decoder = new TextDecoder()
      let buffer = ''
      let fullText = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6)
            if (data === '[DONE]') {
              callbacks.onFinal(fullText)
              return
            }
            try {
              const parsed = JSON.parse(data)
              if (parsed.text) {
                fullText += parsed.text
                callbacks.onDelta(parsed.text, parsed.emotion)
              }
            } catch {
              // Skip unparseable lines
            }
          }
        }
      }

      callbacks.onFinal(fullText)
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return
      callbacks.onError(err instanceof Error ? err : new Error(String(err)))
    }
  }

  abort() {
    this.abortController?.abort()
    this.abortController = null
  }
}
