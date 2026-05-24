import type { WsMessage } from './ws-types'

type MessageCallback = (msg: WsMessage) => void
type ConnectionCallback = (connected: boolean) => void
type ErrorCallback = (error: Event) => void
type AudioDataCallback = (data: ArrayBuffer, text: string) => void

export class VoiceWebSocket {
  private ws: WebSocket | null = null
  private url: string
  private reconnectAttempts = 0
  private maxReconnectAttempts = 5
  private reconnectBaseDelay = 3000
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null
  private messageQueue: Array<{ method: string; payload: unknown }> = []
  private messageId = 0
  private onMessageCb: MessageCallback | null = null
  private onConnectionCb: ConnectionCallback | null = null
  private onErrorCb: ErrorCallback | null = null
  private onAudioDataCb: AudioDataCallback | null = null
  private isDestroyed = false

  constructor(url: string) {
    this.url = url
  }

  set onMessage(cb: MessageCallback) {
    this.onMessageCb = cb
  }

  set onConnection(cb: ConnectionCallback) {
    this.onConnectionCb = cb
  }

  set onError(cb: ErrorCallback) {
    this.onErrorCb = cb
  }

  /** Callback for binary audio data from server (TTS streaming) */
  set onAudioData(cb: AudioDataCallback) {
    this.onAudioDataCb = cb
  }

  connect() {
    if (this.ws?.readyState === WebSocket.OPEN) return
    this.isDestroyed = false

    try {
      this.ws = new WebSocket(this.url)
    } catch (err) {
      console.error('WebSocket 创建失败:', err)
      this.scheduleReconnect()
      return
    }

    this.ws.onopen = () => {
      this.reconnectAttempts = 0
      this.onConnectionCb?.(true)
      this.flushQueue()
      this.startHeartbeat()
    }

    this.ws.onclose = (e) => {
      this.stopHeartbeat()
      this.onConnectionCb?.(false)
      if (e.code !== 1000 && !this.isDestroyed) {
        this.scheduleReconnect()
      }
    }

    this.ws.onerror = (e) => {
      this.onErrorCb?.(e)
    }

    this.ws.onmessage = (e) => {
      if (e.data instanceof ArrayBuffer || e.data instanceof Blob) {
        // Binary audio data from server (Phase 2 TTS streaming)
        this.handleBinaryMessage(e.data)
        return
      }
      try {
        const msg: WsMessage = JSON.parse(e.data)
        this.onMessageCb?.(msg)
      } catch {
        console.warn('无法解析 WebSocket 消息:', e.data)
      }
    }
  }

  /** Handle incoming binary audio data */
  private async handleBinaryMessage(data: ArrayBuffer | Blob) {
    if (!this.onAudioDataCb) return

    let buffer: ArrayBuffer
    if (data instanceof Blob) {
      buffer = await data.arrayBuffer()
    } else {
      buffer = data
    }

    // First 4 bytes: text length (Uint32)
    // Next N bytes: UTF-8 text
    // Remaining: audio data
    const dv = new DataView(buffer)
    const textLen = dv.getUint32(0, true)
    const text = new TextDecoder().decode(new Uint8Array(buffer, 4, textLen))
    const audioData = buffer.slice(4 + textLen)

    this.onAudioDataCb(audioData, text)
  }

  /** Send JSON text message */
  send(method: string, payload: unknown): string {
    const id = `msg_${++this.messageId}`
    if (this.ws?.readyState === WebSocket.OPEN) {
      const msg: WsMessage = { type: 'req', id, method, payload }
      this.ws.send(JSON.stringify(msg))
    } else {
      this.messageQueue.push({ method, payload })
    }
    return id
  }

  /** Send binary audio chunk (PCM16) */
  sendAudio(chunk: ArrayBufferLike): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(chunk)
    }
  }

  abort(reason?: string) {
    this.send('chat.abort', { reason: reason ?? 'user_interrupted' })
  }

  disconnect() {
    this.isDestroyed = true
    this.stopHeartbeat()
    this.messageQueue = []
    this.ws?.close(1000)
    this.ws = null
  }

  private scheduleReconnect() {
    if (this.isDestroyed || this.reconnectAttempts >= this.maxReconnectAttempts) return

    const delay = this.reconnectBaseDelay * Math.pow(1.5, this.reconnectAttempts)
    this.reconnectAttempts++

    setTimeout(() => {
      if (!this.isDestroyed) this.connect()
    }, delay)
  }

  private flushQueue() {
    while (this.messageQueue.length > 0) {
      const { method, payload } = this.messageQueue.shift()!
      this.send(method, payload)
    }
  }

  private startHeartbeat() {
    this.heartbeatInterval = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'req', id: 'ping', method: 'ping' }))
      }
    }, 30000)
  }

  private stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval)
      this.heartbeatInterval = null
    }
  }
}
