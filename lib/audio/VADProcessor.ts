export class VADProcessor {
  private onSpeechStart: (() => void) | null = null
  private onSpeechEnd: (() => void) | null = null
  private speaking = false
  private silenceFrames = 0
  private speechFrames = 0
  private readonly threshold: number
  private readonly minSpeechFrames: number
  private readonly minSilenceFrames: number

  constructor(opts?: {
    threshold?: number
    minSpeechFrames?: number
    minSilenceFrames?: number
  }) {
    this.threshold = opts?.threshold ?? 0.15
    this.minSpeechFrames = opts?.minSpeechFrames ?? 5
    this.minSilenceFrames = opts?.minSilenceFrames ?? 10
  }

  setOnSpeechStart(cb: () => void) {
    this.onSpeechStart = cb
  }

  setOnSpeechEnd(cb: () => void) {
    this.onSpeechEnd = cb
  }

  processFrame(volume: number) {
    if (volume > this.threshold) {
      this.speechFrames++
      this.silenceFrames = 0
      if (!this.speaking && this.speechFrames >= this.minSpeechFrames) {
        this.speaking = true
        console.log(`[vad] SPEECH START (volume=${volume.toFixed(4)}, speechFrames=${this.speechFrames})`)
        this.onSpeechStart?.()
      }
    } else {
      this.silenceFrames++
      this.speechFrames = 0
      if (this.speaking && this.silenceFrames >= this.minSilenceFrames) {
        this.speaking = false
        console.log(`[vad] SPEECH END (volume=${volume.toFixed(4)}, silenceFrames=${this.silenceFrames})`)
        this.onSpeechEnd?.()
      }
    }
  }

  get isSpeaking() {
    return this.speaking
  }

  reset() {
    this.speaking = false
    this.silenceFrames = 0
    this.speechFrames = 0
  }
}
