/**
 * Browser-side Opus decoder using WebCodecs AudioDecoder.
 * Input: TLV-formatted Opus frames (2-byte frame length + frame data, repeated)
 * Output: Complete decoded PCM via decodeAndPlay callback
 *
 * If WebCodecs is unavailable, sets opusSupported=false (caller falls back to HTTP TTS).
 */
export class OpusDecoder {
  private decoder: AudioDecoder | null = null
  private onDecoded: ((pcm: Float32Array) => void) | null = null
  private pendingFrames = 0

  /** Whether this decoder initialized successfully */
  opusSupported = false

  /**
   * @param onDecoded Called with each decoded PCM frame (Float32Array, 48kHz mono)
   */
  async init(onDecoded: (pcm: Float32Array) => void): Promise<void> {
    this.onDecoded = onDecoded

    if (typeof AudioDecoder === 'undefined') {
      console.warn('[OpusDecoder] WebCodecs not available')
      return
    }

    try {
      const config: AudioDecoderConfig = { codec: 'opus', sampleRate: 48000, numberOfChannels: 1 }
      const result = await AudioDecoder.isConfigSupported(config)
      if (!result.supported) return
    } catch {
      return
    }

    this.decoder = new AudioDecoder({
      output: (audioData) => {
        const pcm = new Float32Array(audioData.numberOfFrames)
        audioData.copyTo(pcm, { planeIndex: 0 })
        this.pendingFrames--
        this.onDecoded?.(pcm)
        audioData.close()
      },
      error: (err) => console.error('[OpusDecoder]', err),
    })

    this.decoder.configure({ codec: 'opus', sampleRate: 48000, numberOfChannels: 1 })
    this.opusSupported = true
  }

  /**
   * Decode TLV-formatted Opus data.
   * TLV format: [frameLen:2 LE][frameData] repeated.
   * Frames are decoded sequentially; output arrives via onDecoded callback.
   */
  decodeTlv(tlvData: ArrayBuffer): void {
    if (!this.decoder) return

    const view = new DataView(tlvData)
    let offset = 0
    let frameIndex = 0

    while (offset + 2 <= tlvData.byteLength) {
      const frameLen = view.getUint16(offset, true)
      offset += 2
      if (offset + frameLen > tlvData.byteLength) break

      const frameData = new Uint8Array(tlvData, offset, frameLen)
      offset += frameLen

      const chunk = new EncodedAudioChunk({
        type: 'key',
        timestamp: frameIndex * 60_000, // 60ms per frame
        duration: 60_000,
        data: frameData,
      })
      this.decoder.decode(chunk)
      this.pendingFrames++
      frameIndex++
    }
  }

  /** Wait for all pending decoded frames to be output */
  async flush(): Promise<void> {
    if (this.decoder && this.pendingFrames > 0) {
      await this.decoder.flush()
      this.pendingFrames = 0
    }
  }

  /** Release resources */
  close(): void {
    this.decoder?.close()
    this.decoder = null
    this.onDecoded = null
    this.pendingFrames = 0
  }
}
