'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import { Header } from './(main)/components/layout/Header'
import { StatusBar } from './(main)/components/layout/StatusBar'
import { ChatPanel } from './(main)/components/chat/ChatPanel'
import { AudioVisualizer } from './(main)/components/voice/AudioVisualizer'
import { MicrophoneButton } from './(main)/components/voice/MicrophoneButton'
import { InterruptionBanner } from './(main)/components/voice/InterruptionBanner'
import { AudioCapture } from '@/lib/audio/AudioCapture'
import { VADProcessor } from '@/lib/audio/VADProcessor'
import { AudioPlayer } from '@/lib/audio/AudioPlayer'
import { OllamaTTS } from '@/lib/tts/ollama-tts'
import { classifyIntent } from '@/lib/ai/intent-router'
import { parseEmotionTags } from '@/lib/ai/emotion-parser'
import { VoiceWebSocket } from '@/lib/websocket/ws-client'
import { OpusDecoder } from '@/lib/audio/OpusDecoder'
import { useVoiceStore } from '@/lib/store/voice-store'
import { AudioState, Emotion } from '@/types/voice'

const WS_URL = `ws://localhost:${process.env.NEXT_PUBLIC_WS_PORT ?? '3001'}`

export default function VoiceChatPage() {
  const {
    mode,
    audioState,
    messages,
    isRecording,
    streamingText,
    isInterrupted,
    wsConnected,
    setAudioState,
    setIsRecording,
    setIsInterrupted,
    addMessage,
    setMode,
    setStreamingText,
    setWsConnected,
    setCurrentEmotion,
  } = useVoiceStore()

  const [volume, setVolume] = useState(0)
  const audioCaptureRef = useRef<AudioCapture | null>(null)
  const vadRef = useRef<VADProcessor | null>(null)
  const audioPlayerRef = useRef<AudioPlayer | null>(null)
  const localTTSRef = useRef<OllamaTTS | null>(null)
  const wsRef = useRef<VoiceWebSocket | null>(null)
  const lastInterruptRef = useRef(0)
  const opusDecoderRef = useRef<OpusDecoder | null>(null)
  const opusEnabledRef = useRef(false)
  const opusPcmQueueRef = useRef<Float32Array[]>([])
  const opusSourceRef = useRef<AudioBufferSourceNode | null>(null)
  const opusPendingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSentenceTextRef = useRef('')

  // Init audio, TTS, Opus decoder, and WebSocket on mount
  useEffect(() => {
    const audioCtx = new AudioContext()
    audioPlayerRef.current = new AudioPlayer()
    const tts = new OllamaTTS()
    tts.onIdle = () => {
      useVoiceStore.getState().setAudioState(AudioState.Recording)
    }
    localTTSRef.current = tts

    // Init Opus decoder (reserved for future WebSocket TTS streaming)
    // Currently disabled — always uses HTTP TTS for reliability.
    // To enable: uncomment the connect block below and configure { tts: 'opus' }.
    // const opusDec = new OpusDecoder()
    // opusDec.init((pcm) => {
    //   opusPcmQueueRef.current.push(pcm)
    // }).then(() => {
    //   if (opusDec.opusSupported) {
    //     opusDecoderRef.current = opusDec
    //     opusEnabledRef.current = true
    //     console.log('[Opus] WebCodecs Opus decoder ready')
    //   }
    // })

    const ws = new VoiceWebSocket(WS_URL)
    ws.onConnection = (connected) => setWsConnected(connected)
    ws.onMessage = (msg) => {
      if (msg.type === 'event') {
        const event = msg as unknown as {
          event: string
          payload: { text: string; seq?: number; emotion?: string; error?: string }
        }
        const store = useVoiceStore.getState()

        // ASR result from server-side transcription
        if (event.event === 'asr.final') {
          const { text, error } = event.payload
          console.log(`[page] asr.final received: text="${text}" error="${error ?? ''}"`)
          if (!text?.trim()) {
            store.setAudioState(AudioState.Recording)
            return
          }
          const turnId = `user-${Date.now()}`
          store.addMessage({ id: turnId, role: 'user', text, timestamp: Date.now() })
          const intent = classifyIntent(text)
          store.setMode('cloud')
          store.setCurrentEmotion(intent.emotion)
          store.setStreamingText('')
          store.setAudioState(AudioState.Speaking)
          return
        }

        if (event.event === 'chat.delta' && event.payload.text) {
          store.setStreamingText(store.streamingText + event.payload.text)
        }

        // Sentence received — send to TTS immediately for streaming playback
        if (event.event === 'chat.sentence' && event.payload.text) {
          const text = event.payload.text
          lastSentenceTextRef.current = text

          // Always start HTTP TTS (reliable path)
          const tts = localTTSRef.current
          if (tts) {
            tts.speakChunk(text)
          }

          // If Opus enabled, set fallback timeout — if binary doesn't arrive in 3s,
          // the HTTP TTS already has it covered
          if (opusEnabledRef.current) {
            if (opusPendingTimeoutRef.current) {
              clearTimeout(opusPendingTimeoutRef.current)
            }
            opusPendingTimeoutRef.current = setTimeout(() => {
              opusPendingTimeoutRef.current = null
              // HTTP TTS is already playing, no action needed
            }, 3000)
          }

          if (store.audioState !== AudioState.Speaking) {
            store.setAudioState(AudioState.Speaking)
          }
        }

        if (event.event === 'chat.final' && event.payload.text) {
          const parsed = parseEmotionTags(event.payload.text)
          store.setStreamingText('')
          store.setCurrentEmotion(parsed.emotion)
          store.addMessage({
            id: `ai-${Date.now()}`,
            role: 'assistant',
            text: parsed.cleanText,
            emotion: parsed.emotion,
            timestamp: Date.now(),
          })
        }
      }
    }

    // Handle binary Opus TTS audio from server (via WebSocket)
    ws.onAudioData = async (audioData: ArrayBuffer, _text: string) => {
      const dec = opusDecoderRef.current
      if (!dec) return

      // Cancel pending Opus timeout
      if (opusPendingTimeoutRef.current) {
        clearTimeout(opusPendingTimeoutRef.current)
        opusPendingTimeoutRef.current = null
      }

      // Stop HTTP TTS — this triggers onIdle → Recording, but we'll reset below
      localTTSRef.current?.stop()

      // Reset to Speaking state (HTTP TTS's onIdle would have set Recording)
      useVoiceStore.getState().setAudioState(AudioState.Speaking)

      // Stop any previous Opus playback
      if (opusSourceRef.current) {
        try {
          opusSourceRef.current.stop()
          opusSourceRef.current.disconnect()
        } catch { /* already stopped */ }
        opusSourceRef.current = null
      }

      opusPcmQueueRef.current = []
      dec.decodeTlv(audioData)
      await dec.flush()

      const chunks = opusPcmQueueRef.current
      if (chunks.length === 0) return

      // Concatenate all decoded PCM frames
      const totalLen = chunks.reduce((s, c) => s + c.length, 0)
      const completePcm = new Float32Array(totalLen)
      let offset = 0
      for (const chunk of chunks) {
        completePcm.set(chunk, offset)
        offset += chunk.length
      }
      opusPcmQueueRef.current = []

      // Play via AudioContext
      try {
        const buffer = audioCtx.createBuffer(1, completePcm.length, 48000)
        buffer.getChannelData(0).set(completePcm)
        const source = audioCtx.createBufferSource()
        source.buffer = buffer
        source.connect(audioCtx.destination)
        opusSourceRef.current = source
        source.start()
        source.onended = () => {
          opusSourceRef.current = null
          useVoiceStore.getState().setAudioState(AudioState.Recording)
        }
      } catch (err) {
        console.error('[Opus] Playback error:', err)
      }
    }

    ws.connect()
    wsRef.current = ws

    // Notify server if Opus is ready (delay to let init complete)
    setTimeout(() => {
      if (opusEnabledRef.current && wsRef.current) {
        wsRef.current.send('configure', { tts: 'opus' })
        console.log('[Opus] Enabled Opus TTS streaming')
      }
    }, 1000)

    return () => {
      audioPlayerRef.current?.destroy()
      opusDecoderRef.current?.close()
      wsRef.current?.disconnect()
      audioCtx.close()
    }
  }, [])

  const handleInterrupt = useCallback(() => {
    const ap = audioPlayerRef.current
    const tts = localTTSRef.current
    const ws = wsRef.current

    lastInterruptRef.current = Date.now()
    ap?.stop()
    ap?.clearQueue()
    tts?.stop()

    // Stop Opus TTS playback
    if (opusSourceRef.current) {
      try {
        opusSourceRef.current.stop()
        opusSourceRef.current.disconnect()
      } catch { /* already stopped */ }
      opusSourceRef.current = null
    }

    setIsInterrupted(true)
    setAudioState(AudioState.Interrupted)
    ws?.abort('user_interrupted')
    setTimeout(() => setIsInterrupted(false), 2000)
  }, [setAudioState, setIsInterrupted])

  const handleTranscript = useCallback(
    async (text: string) => {
      if (!text.trim()) {
        setAudioState(AudioState.Recording)
        return
      }

      const turnId = `user-${Date.now()}`
      addMessage({ id: turnId, role: 'user', text, timestamp: Date.now() })

      const intent = classifyIntent(text)
      setMode('cloud')
      setCurrentEmotion(intent.emotion)
      setAudioState(AudioState.Speaking)
      setStreamingText('')

      wsRef.current?.send('chat.send', {
        text,
        features: {
          emotion: intent.emotion,
          prosody: { speed: 1.0, pitchVariation: 0.5, energy: 0.5 },
          vadPattern: 'normal',
        },
      })
    },
    [addMessage, setAudioState, setMode, setStreamingText, setCurrentEmotion]
  )

  const handleSpeechEnd = useCallback(async () => {
    setAudioState(AudioState.Processing)
    const wavBlob = audioCaptureRef.current?.stopPcmCapture()
    if (!wavBlob) {
      setAudioState(AudioState.Recording)
      return
    }
    try {
      const res = await fetch('/api/asr', {
        method: 'POST',
        headers: { 'Content-Type': 'audio/wav' },
        body: wavBlob,
      })
      const data = await res.json()
      if (data.text) {
        handleTranscript(data.text)
      } else {
        setAudioState(AudioState.Recording)
      }
    } catch (err) {
      console.error('ASR 错误:', err)
      setAudioState(AudioState.Recording)
    }
  }, [setAudioState, handleTranscript])

  const handleToggleMic = useCallback(async () => {
    if (isRecording) {
      audioCaptureRef.current?.stopPcmCapture()
      audioCaptureRef.current?.stop()
      audioCaptureRef.current = null
      setIsRecording(false)
      setAudioState(AudioState.Idle)
      return
    }

    try {
      const capture = new AudioCapture()
      const vad = new VADProcessor({ threshold: 0.12, minSpeechFrames: 6, minSilenceFrames: 25 })
      capture.setOnVolume(setVolume)

      // Stream PCM chunks to server during recording
      capture.setOnAudioChunk((chunk: Float32Array) => {
        const int16 = new Int16Array(chunk.length)
        for (let i = 0; i < chunk.length; i++) {
          const s = Math.max(-1, Math.min(1, chunk[i]))
          int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF
        }
        wsRef.current?.sendAudio(int16.buffer)
      })

      vad.setOnSpeechStart(() => {
        // Guard: skip if interrupted within last 2s (prevents rapid re-triggering)
        if (Date.now() - lastInterruptRef.current < 2000) return

        const currentState = useVoiceStore.getState().audioState
        if (currentState === AudioState.Speaking || currentState === AudioState.Processing) {
          handleInterrupt()
        }
        setAudioState(AudioState.Recording)

        // Start local PCM capture for ASR (also streams via onAudioChunk)
        audioCaptureRef.current?.startPcmCapture()
      })

      vad.setOnSpeechEnd(() => {
        // Send end-of-speech signal — server will transcribe and auto-start LLM
        audioCaptureRef.current?.stopPcmCapture()
        const wsState = wsRef.current
        console.log(`[page] sending asr.audio_end, ws.readyState=${wsState ? 'exists' : 'null'}`)
        wsRef.current?.send('asr.audio_end', {
          features: { emotion: 'neutral', prosody: { speed: 1.0, pitchVariation: 0.5, energy: 0.5 } },
        })
        setAudioState(AudioState.Processing)
      })

      await capture.start()
      // Warm up TTS AudioContext while we have user gesture (prevents autoplay policy from silencing TTS)
      localTTSRef.current?.warmup()
      audioCaptureRef.current = capture
      vadRef.current = vad
      setIsRecording(true)
      setAudioState(AudioState.Recording)
    } catch (err) {
      console.error('麦克风启动失败:', err)
      setAudioState(AudioState.Idle)
    }
  }, [isRecording, handleSpeechEnd, handleTranscript, handleInterrupt, setAudioState, setIsRecording])

  // Volume → VAD processing
  useEffect(() => {
    if (isRecording) {
      vadRef.current?.processFrame(volume)
    }
  }, [volume, isRecording])

  // Debug: log recording state transitions
  useEffect(() => {
    console.log(`[page] recording=${isRecording} audioState=${audioState} wsConnected=${wsConnected}`)
  }, [isRecording, audioState, wsConnected])

  return (
    <div className="flex flex-col h-dvh max-w-lg mx-auto">
      <InterruptionBanner isInterrupted={isInterrupted} />
      <Header wsConnected={wsConnected} mode={mode} />
      <StatusBar audioState={audioState} mode={mode} />
      <ChatPanel messages={messages} streamingText={streamingText} />
      <AudioVisualizer
        volume={volume}
        isActive={isRecording || audioState === AudioState.Speaking}
        className="px-4"
      />
      <div className="flex items-center justify-center gap-6 px-4 py-4 safe-area-bottom">
        <MicrophoneButton
          audioState={audioState}
          isRecording={isRecording}
          onToggle={handleToggleMic}
        />
      </div>
    </div>
  )
}
