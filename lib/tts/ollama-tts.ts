export class OllamaTTS {
  private queue: Array<{ text: string; resolve: () => void }> = []
  private processing = false
  private abortController: AbortController | null = null
  private audioContext: AudioContext | null = null
  private currentSource: AudioBufferSourceNode | null = null

  /** Called when the TTS queue becomes completely idle */
  onIdle: (() => void) | null = null

  /** Ensure the AudioContext is ready for playback.
   *  Call `warmup()` from a user-gesture handler (mic button click) to
   *  create the context with a valid user activation — prevents autoplay
   *  policy from silencing the first TTS response. */
  warmup(): AudioContext {
    return this.ensureContext()
  }

  private ensureContext(): AudioContext {
    if (!this.audioContext) {
      this.audioContext = new AudioContext()
    }
    if (this.audioContext.state === 'suspended') {
      this.audioContext.resume()
    }
    return this.audioContext
  }

  /** Add a text chunk to the TTS queue. Plays in order. */
  speakChunk(text: string): Promise<void> {
    return new Promise((resolve) => {
      if (!text.trim()) {
        resolve()
        return
      }

      this.queue.push({ text, resolve })
      if (!this.processing) {
        this.processNext()
      }
    })
  }

  private processNext(): void {
    if (this.queue.length === 0) {
      this.processing = false
      this.onIdle?.()
      return
    }

    this.processing = true
    const { text, resolve } = this.queue.shift()!

    this.abortController = new AbortController()
    const ctx = this.ensureContext()

    fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
      signal: this.abortController.signal,
    })
      .then(async (res) => {
        if (!res.ok) {
          console.error(`TTS 错误 (${res.status}): ${await res.text().catch(() => '')}`)
          resolve()
          this.processNext()
          return null
        }
        return res.arrayBuffer()
      })
      .then((arrayBuffer) => {
        if (!arrayBuffer || arrayBuffer.byteLength === 0) {
          resolve()
          this.processNext()
          return null
        }
        return ctx.decodeAudioData(arrayBuffer)
      })
      .then((audioBuffer) => {
        if (!audioBuffer) return // handled in previous then

        const source = ctx.createBufferSource()
        source.buffer = audioBuffer
        source.connect(ctx.destination)
        this.currentSource = source

        source.onended = () => {
          this.currentSource = null
          resolve()
          this.processNext()
        }

        source.start()
      })
      .catch((err) => {
        this.currentSource = null
        if (err instanceof Error && err.name === 'AbortError') {
          this.queue = []
          resolve()
          this.processing = false
          this.onIdle?.()
          return
        }
        console.error('TTS 错误:', err)
        resolve()
        this.processNext()
      })
  }

  stop(): void {
    this.abortController?.abort()
    this.abortController = null
    this.queue = []

    if (this.currentSource) {
      try {
        this.currentSource.stop()
        this.currentSource.disconnect()
      } catch { /* already stopped */ }
      this.currentSource = null
    }

    this.processing = false
  }

  get isSpeaking(): boolean {
    return this.processing || this.currentSource !== null
  }

  get pendingCount(): number {
    return this.queue.length
  }
}
