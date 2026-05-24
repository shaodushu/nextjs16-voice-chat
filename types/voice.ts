export enum AudioState {
  Idle = 'idle',
  Recording = 'recording',
  Processing = 'processing',
  Speaking = 'speaking',
  Interrupted = 'interrupted',
}

export enum Emotion {
  Neutral = 'neutral',
  Warm = 'warm',
  Reassuring = 'reassuring',
  Gentle = 'gentle',
  Encouraging = 'encouraging',
  Attentive = 'attentive',
}

export enum IntentType {
  Simple = 'simple',
  Complex = 'complex',
}

export interface Intent {
  text: string
  type: IntentType
  confidence: number
  emotion: Emotion
}

export interface ConversationTurn {
  id: string
  role: 'user' | 'assistant'
  text: string
  emotion?: Emotion
  timestamp: number
}

export interface AudioFeatures {
  emotion: Emotion
  prosody: {
    speed: number
    pitchVariation: number
    energy: number
  }
  vadPattern: 'normal' | 'long_pauses' | 'fast'
}
