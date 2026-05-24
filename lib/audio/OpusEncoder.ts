/**
 * Browser-side Opus encoder using WebCodecs AudioEncoder.
 * Input: Float32 PCM @ 16kHz mono (from microphone)
 * Internal: resamples to 48kHz for Opus encoding
 * Output: Uint8Array Opus frames (60ms each) via onFrame callback
 *
 * Falls back to passthrough (no-op) if WebCodecs is unavailable.
 */
export class OpusEncoder {
  private encoder: AudioEncoder | null = null
  private onFrame: ((frame: Uint8Array) => void) | null = null
  private sampleRate = 16000

  /** Whether this encoder is actually encoding (vs. passthrough fallback) */
  get isActive(): boolean {
    return this.encoder !== null
  }

  /**
   * @param onFrame Called with each encoded Opus frame (Uint8Array)
   */
  async init(onFrame: (frame: Uint8Array) => void): Promise<void> {
    this.onFrame = onFrame

    if (typeof AudioEncoder === 'undefined') {
      console.warn('[OpusEncoder] WebCodecs not available, Opus encoding disabled')
      return
    }

    let supported = false
    try {
      const config: AudioEncoderConfig = {
        codec: 'opus',
        sampleRate: 48000,
        numberOfChannels: 1,
        bitrate: 20000,
      }
      const result = await AudioEncoder.isConfigSupported(config)
      supported = result.supported ?? false
    } catch {
      supported = false
    }

    if (!supported) {
      console.warn('[OpusEncoder] Opus codec not supported, Opus encoding disabled')
      return
    }

    this.encoder = new AudioEncoder({
      output: (chunk) => {
        const buf = new Uint8Array(chunk.byteLength)
        chunk.copyTo(buf)
        this.onFrame?.(buf)
      },
      error: (err) => console.error('[OpusEncoder]', err),
    })

    this.encoder.configure({
      codec: 'opus',
      sampleRate: 48000,
      numberOfChannels: 1,
      bitrate: 20000,
    })
  }

  /**
   * Encode one chunk of PCM audio.
   * @param pcm Float32 PCM @ 16kHz mono. Length should be a multiple of 960 (60ms @ 16kHz).
   */
  encode(pcm: Float32Array): void {
    if (!this.encoder) {
      // Fallback: pass through raw PCM as "fake" Opus — handled by isActive check
      return
    }

    const targetSr = 48000
    const ratio = targetSr / this.sampleRate // 3x
    const frameSize = Math.floor(pcm.length * ratio)
    const resampled = new Float32Array(frameSize)

    // Linear interpolation: 16kHz → 48kHz
    for (let i = 0; i < frameSize; i++) {
      const srcIdx = i / ratio
      const lo = Math.floor(srcIdx)
      const hi = Math.min(lo + 1, pcm.length - 1)
      const frac = srcIdx - lo
      resampled[i] = pcm[lo] * (1 - frac) + pcm[hi] * frac
    }

    const audioData = new AudioData({
      format: 'f32',
      sampleRate: targetSr,
      numberOfFrames: frameSize,
      numberOfChannels: 1,
      timestamp: 0,
      data: resampled,
    })

    this.encoder.encode(audioData)
    audioData.close()
  }

  /** Flush any remaining encoded data. Call between utterances. */
  async flush(): Promise<void> {
    if (this.encoder) {
      await this.encoder.flush()
    }
  }

  /** Release resources */
  close(): void {
    this.encoder?.close()
    this.encoder = null
    this.onFrame = null
  }
}
