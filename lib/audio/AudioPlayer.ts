export class AudioPlayer {
  private audioContext: AudioContext | null = null
  private gainNode: GainNode | null = null
  private currentSource: AudioBufferSourceNode | null = null
  private queue: AudioBuffer[] = []
  private isPlaying = false
  private interrupted = false

  private ensureContext() {
    if (!this.audioContext) {
      this.audioContext = new AudioContext()
      this.gainNode = this.audioContext.createGain()
      this.gainNode.connect(this.audioContext.destination)
    }
    if (this.audioContext.state === 'suspended') {
      this.audioContext.resume()
    }
  }

  enqueue(buffer: AudioBuffer): void {
    this.ensureContext()
    this.queue.push(buffer)
    if (!this.isPlaying) {
      this.playNext()
    }
  }

  private playNext(): void {
    if (this.queue.length === 0 || this.interrupted) {
      this.isPlaying = false
      return
    }

    this.isPlaying = true
    const buffer = this.queue.shift()!

    this.currentSource = this.audioContext!.createBufferSource()
    this.currentSource.buffer = buffer
    this.currentSource.connect(this.gainNode!)
    this.currentSource.start()
    this.currentSource.onended = () => {
      if (!this.interrupted) {
        this.playNext()
      }
    }
  }

  stop(): void {
    this.interrupted = true
    this.currentSource?.stop()
    this.currentSource?.disconnect()
    this.currentSource = null
    this.isPlaying = false
  }

  clearQueue(): void {
    this.queue = []
  }

  fadeOut(duration = 200): Promise<void> {
    this.ensureContext()
    if (!this.gainNode) return Promise.resolve()

    const now = this.audioContext!.currentTime
    this.gainNode.gain.setValueAtTime(this.gainNode.gain.value, now)
    this.gainNode.gain.linearRampToValueAtTime(0, now + duration / 1000)

    return new Promise((resolve) => setTimeout(resolve, duration))
  }

  resetGain(): void {
    if (this.gainNode) {
      this.gainNode.gain.value = 1
    }
  }

  get playing(): boolean {
    return this.isPlaying
  }

  destroy(): void {
    this.stop()
    this.queue = []
    this.audioContext?.close()
    this.audioContext = null
    this.gainNode = null
  }
}
