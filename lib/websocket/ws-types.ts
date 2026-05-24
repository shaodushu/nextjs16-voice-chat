export type WsFrameType = 'req' | 'res' | 'event'

export interface WsMessage {
  type: WsFrameType
  id: string
  method?: string
  payload?: unknown
  ok?: boolean
  error?: { code: string; message: string }
}

export interface ChatRequest {
  text: string
  features?: {
    emotion?: string
    prosody?: { speed: number; pitchVariation: number; energy: number }
    vadPattern?: string
  }
  conversationHistory?: Array<{ role: string; text: string }>
}

export interface ChatDelta {
  text: string
  emotion?: string
  seq?: number
}

export interface ChatSentence {
  text: string
  seq?: number
}

export interface ChatFinal {
  text: string
  emotion?: string
}

export interface EmotionEvent {
  emotion: string
  intensity: number
}

export const WS_METHODS = {
  CHAT_SEND: 'chat.send',
  CHAT_ABORT: 'chat.abort',
  CHAT_HISTORY: 'chat.history',
  PING: 'ping',
} as const
