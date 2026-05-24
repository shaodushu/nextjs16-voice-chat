import { Emotion } from '@/types/voice'

interface SpeakOptions {
  emotion?: Emotion
  rate?: number
  pitch?: number
}

const EMOTION_PARAMS: Record<
  string,
  { rate: number; pitch: number }
> = {
  [Emotion.Warm]: { rate: 1.0, pitch: 1.1 },
  [Emotion.Reassuring]: { rate: 0.9, pitch: 1.0 },
  [Emotion.Gentle]: { rate: 0.85, pitch: 0.95 },
  [Emotion.Encouraging]: { rate: 1.05, pitch: 1.15 },
  [Emotion.Attentive]: { rate: 1.1, pitch: 1.0 },
  [Emotion.Neutral]: { rate: 1.0, pitch: 1.0 },
}

export class LocalTTS {
  private voices: SpeechSynthesisVoice[] = []
  private loaded = false

  async init(): Promise<void> {
    if (typeof window === 'undefined') return

    this.voices = window.speechSynthesis.getVoices()
    if (this.voices.length > 0) {
      this.loaded = true
      return
    }

    return new Promise((resolve) => {
      window.speechSynthesis.onvoiceschanged = () => {
        this.voices = window.speechSynthesis.getVoices()
        this.loaded = true
        resolve()
      }
    })
  }

  speak(text: string, options: SpeakOptions = {}): Promise<void> {
    return new Promise((resolve, reject) => {
      if (typeof window === 'undefined') return reject(new Error('Not in browser'))

      const utterance = new SpeechSynthesisUtterance(text)
      utterance.lang = 'zh-CN'

      const emotion = options.emotion ?? Emotion.Neutral
      const params = EMOTION_PARAMS[emotion] ?? EMOTION_PARAMS[Emotion.Neutral]
      utterance.rate = options.rate ?? params.rate
      utterance.pitch = options.pitch ?? params.pitch

      const zhVoice = this.voices.find(
        (v) => v.lang.startsWith('zh') && v.localService
      )
      if (zhVoice) utterance.voice = zhVoice

      utterance.onend = () => resolve()
      utterance.onerror = (e) => reject(e)

      window.speechSynthesis.speak(utterance)
    })
  }

  stop(): void {
    if (typeof window !== 'undefined') {
      window.speechSynthesis.cancel()
    }
  }

  get speaking(): boolean {
    if (typeof window === 'undefined') return false
    return window.speechSynthesis.speaking
  }
}
