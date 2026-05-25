export class AudioCapture {
  private stream: MediaStream | null = null
  private audioContext: AudioContext | null = null
  private analyser: AnalyserNode | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private highpassFilter: BiquadFilterNode | null = null
  private scriptProcessor: ScriptProcessorNode | null = null
  private animationId: number | null = null
  private onVolume: ((volume: number) => void) | null = null
  /** Callback fired for each PCM chunk during capture (Float32Array, 16kHz) */
  private onAudioChunk: ((chunk: Float32Array) => void) | null = null

  // PCM capture for ASR
  private pcmChunks: Float32Array[] = []
  private isCapturingPcm = false

  // Noise reduction state
  private noiseFloor = 0.01
  private readonly noiseGateMultiplier = 2.0
  private readonly targetRms = 0.12
  private readonly maxGain = 2.0

  setOnVolume(cb: (volume: number) => void) {
    this.onVolume = cb
  }

  setOnAudioChunk(cb: (chunk: Float32Array) => void) {
    this.onAudioChunk = cb
  }

  async start() {
    // Create AudioContext before async getUserMedia — user gesture is still active
    // (AudioContext created after await may be suspended, breaking VAD volume meter)
    this.audioContext = new AudioContext({ sampleRate: 16000 })

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        sampleRate: 16000,
        echoCancellation: true,
        noiseSuppression: true,
        channelCount: 1,
      },
    })
    this.source = this.audioContext.createMediaStreamSource(this.stream)

    // Highpass filter: remove sub-80Hz rumble (AC, fans, road noise)
    this.highpassFilter = this.audioContext.createBiquadFilter()
    this.highpassFilter.type = 'highpass'
    this.highpassFilter.frequency.value = 80
    this.highpassFilter.Q.value = 0.7
    this.source.connect(this.highpassFilter)

    // Analyser for VAD volume
    this.analyser = this.audioContext.createAnalyser()
    this.analyser.fftSize = 256
    this.highpassFilter.connect(this.analyser)

    // ScriptProcessor for raw PCM capture (deprecated but universally supported)
    this.scriptProcessor = this.audioContext.createScriptProcessor(4096, 1, 1)
    this.scriptProcessor.onaudioprocess = (e) => {
      const raw = e.inputBuffer.getChannelData(0)
      const chunk = new Float32Array(raw.length)

      // Step 1: Noise gate — zero out frames below noise floor
      // Step 2: Gain normalization — bring average RMS toward target
      let sumSq = 0
      for (let i = 0; i < raw.length; i++) {
        let sample = raw[i]
        // Noise gate
        if (Math.abs(sample) < this.noiseFloor) {
          sample = 0
        }
        chunk[i] = sample
        sumSq += sample * sample
      }

      // Adaptive noise floor tracking (update during silence)
      const rms = Math.sqrt(sumSq / raw.length)
      if (rms < this.noiseFloor * this.noiseGateMultiplier) {
        // Slowly decay noise floor toward current RMS
        this.noiseFloor += (rms - this.noiseFloor) * 0.01
        this.noiseFloor = Math.max(0.001, Math.min(this.noiseFloor, 0.05))
      }

      // Gain normalization — only boost when there's meaningful signal
      if (rms > this.noiseFloor * this.noiseGateMultiplier && rms < this.targetRms) {
        const gain = Math.min(this.targetRms / (rms || 0.001), this.maxGain)
        for (let i = 0; i < chunk.length; i++) {
          chunk[i] = Math.max(-1, Math.min(1, chunk[i] * gain))
        }
      }

      // Always stream to server via WebSocket (independent of VAD state)
      this.onAudioChunk?.(chunk)
      // Local PCM backup for HTTP fallback
      if (this.isCapturingPcm) {
        this.pcmChunks.push(chunk)
      }
    }
    this.highpassFilter.connect(this.scriptProcessor)
    this.scriptProcessor.connect(this.audioContext.destination)

    this.startVolumeMeter()
  }

  /** Begin accumulating raw PCM for ASR */
  startPcmCapture() {
    this.pcmChunks = []
    this.isCapturingPcm = true
  }

  /** Stop PCM capture and return WAV blob, or null if no audio captured */
  stopPcmCapture(): Blob | null {
    this.isCapturingPcm = false
    if (this.pcmChunks.length === 0) return null

    const totalLen = this.pcmChunks.reduce((sum, arr) => sum + arr.length, 0)
    const combined = new Float32Array(totalLen)
    let offset = 0
    for (const arr of this.pcmChunks) {
      combined.set(arr, offset)
      offset += arr.length
    }

    return this.float32ToWav(combined)
  }

  private float32ToWav(samples: Float32Array): Blob {
    const numChannels = 1
    const sampleRate = this.audioContext?.sampleRate ?? 16000
    const bitsPerSample = 16
    const byteRate = sampleRate * numChannels * bitsPerSample / 8
    const blockAlign = numChannels * bitsPerSample / 8
    const dataSize = samples.length * blockAlign
    const buffer = new ArrayBuffer(44 + dataSize)
    const dv = new DataView(buffer)

    const writeStr = (off: number, s: string) => {
      for (let i = 0; i < s.length; i++) dv.setUint8(off + i, s.charCodeAt(i))
    }

    writeStr(0, 'RIFF')
    dv.setUint32(4, 36 + dataSize, true)
    writeStr(8, 'WAVE')
    writeStr(12, 'fmt ')
    dv.setUint32(16, 16, true)       // chunk size
    dv.setUint16(20, 1, true)        // PCM
    dv.setUint16(22, numChannels, true)
    dv.setUint32(24, sampleRate, true)
    dv.setUint32(28, byteRate, true)
    dv.setUint16(32, blockAlign, true)
    dv.setUint16(34, bitsPerSample, true)
    writeStr(36, 'data')
    dv.setUint32(40, dataSize, true)

    // Write PCM samples (float32 -> int16)
    const offset = 44
    for (let i = 0; i < samples.length; i++) {
      const s = Math.max(-1, Math.min(1, samples[i]))
      dv.setInt16(offset + i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true)
    }

    return new Blob([buffer], { type: 'audio/wav' })
  }

  private startVolumeMeter() {
    const dataArray = new Uint8Array(this.analyser!.fftSize)

    let frameCount = 0
    const tick = () => {
      this.analyser!.getByteTimeDomainData(dataArray)
      let sumSq = 0
      for (let i = 0; i < dataArray.length; i++) {
        const normalized = (dataArray[i] - 128) / 128
        sumSq += normalized * normalized
      }
      const rms = Math.sqrt(sumSq / dataArray.length)
      if (frameCount < 5) {
        console.log(`[audio] volume frame ${frameCount}: rms=${rms.toFixed(4)} ctx.state=${this.audioContext?.state}`)
        frameCount++
      }
      this.onVolume?.(rms)
      this.animationId = requestAnimationFrame(tick)
    }
    tick()
    console.log(`[audio] volume meter started, fftSize=${this.analyser!.fftSize}, ctx.state=${this.audioContext?.state}`)
  }

  stop() {
    this.isCapturingPcm = false
    this.pcmChunks = []
    if (this.scriptProcessor) {
      this.scriptProcessor.disconnect()
      this.scriptProcessor = null
    }
    if (this.highpassFilter) {
      this.highpassFilter.disconnect()
      this.highpassFilter = null
    }
    this.stream?.getTracks().forEach((t) => t.stop())
    this.audioContext?.close()
    if (this.animationId != null) cancelAnimationFrame(this.animationId)
    this.stream = null
    this.audioContext = null
    this.analyser = null
    this.source = null
    this.animationId = null
  }
}
