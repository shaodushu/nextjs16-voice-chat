export class VADProcessor {
  private onSpeechStart: (() => void) | null = null
  private onSpeechEnd: (() => void) | null = null
  private speaking = false
  private silenceFrames = 0
  private speechFrames = 0
  private readonly minSpeechFrames: number
  private readonly minSilenceFrames: number

  // Adaptive threshold state
  private readonly baseThreshold: number
  private noiseFloor = 0.01
  private readonly noiseMultiplier: number
  private readonly maxThreshold: number
  private readonly minThreshold: number

  constructor(opts?: {
    /** Fixed threshold fallback when noise floor is unreliable (default 0.15) */
    baseThreshold?: number
    minSpeechFrames?: number
    minSilenceFrames?: number
    /** Adaptive threshold = max(baseThreshold, noiseFloor * noiseMultiplier) (default 3.0) */
    noiseMultiplier?: number
    /** Hard cap to prevent noise bursts from setting threshold too high (default 0.35) */
    maxThreshold?: number
    /** Hard floor to keep VAD sensitive in quiet environments (default 0.05) */
    minThreshold?: number
  }) {
    this.baseThreshold = opts?.baseThreshold ?? 0.15
    this.minSpeechFrames = opts?.minSpeechFrames ?? 5
    this.minSilenceFrames = opts?.minSilenceFrames ?? 10
    this.noiseMultiplier = opts?.noiseMultiplier ?? 3.0
    this.maxThreshold = opts?.maxThreshold ?? 0.35
    this.minThreshold = opts?.minThreshold ?? 0.05
  }

  setOnSpeechStart(cb: () => void) {
    this.onSpeechStart = cb
  }

  setOnSpeechEnd(cb: () => void) {
    this.onSpeechEnd = cb
  }

  /** Return the currently active VAD threshold (adaptive) */
  getThreshold(): number {
    const adaptive = Math.max(this.noiseFloor * this.noiseMultiplier, this.minThreshold)
    return Math.min(adaptive, this.maxThreshold)
  }

  processFrame(volume: number) {
    // Update noise floor estimate during silence
    // Fast attack (during silence), slow decay (during speech)
    if (!this.speaking) {
      if (volume < this.getThreshold()) {
        // Noise frame — track it
        this.noiseFloor += (volume - this.noiseFloor) * 0.02
      } else {
        // Possible speech onset that hasn't triggered yet — nudge up slowly
        this.noiseFloor += (volume - this.noiseFloor) * 0.002
      }
    } else {
      // During speech, let noise floor drift back up very slowly
      // This helps recover if the noise floor was pushed artificially low
      this.noiseFloor += (this.baseThreshold * 0.3 - this.noiseFloor) * 0.001
    }

    // Clamp noise floor to sensible range
    this.noiseFloor = Math.max(0.001, Math.min(this.noiseFloor, 0.1))

    const effectiveThreshold = this.getThreshold()

    if (volume > effectiveThreshold) {
      this.speechFrames++
      this.silenceFrames = 0
      if (!this.speaking && this.speechFrames >= this.minSpeechFrames) {
        this.speaking = true
        console.log(
          `[vad] SPEECH START (volume=${volume.toFixed(4)}, threshold=${effectiveThreshold.toFixed(4)}, noiseFloor=${this.noiseFloor.toFixed(4)}, speechFrames=${this.speechFrames})`
        )
        this.onSpeechStart?.()
      }
    } else {
      this.silenceFrames++
      this.speechFrames = 0
      if (this.speaking && this.silenceFrames >= this.minSilenceFrames) {
        this.speaking = false
        console.log(
          `[vad] SPEECH END (volume=${volume.toFixed(4)}, threshold=${effectiveThreshold.toFixed(4)}, noiseFloor=${this.noiseFloor.toFixed(4)}, silenceFrames=${this.silenceFrames})`
        )
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
