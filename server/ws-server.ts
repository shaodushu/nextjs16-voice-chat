import { createServer } from 'http'
import { WebSocketServer, WebSocket } from 'ws'
import path from 'path'
import fs from 'fs'
import { buildSystemPrompt } from '../lib/ai/system-prompts'

// Opus for TTS audio encoding (server → browser)
let OpusEncoder: new (rate: number, channels: number) => { encode: (buf: Buffer) => Buffer; decode: (buf: Buffer) => Buffer; destroy: () => void }
try {
  OpusEncoder = require('@discordjs/opus').OpusEncoder
} catch {
  console.warn('[WS] @discordjs/opus not available, TTS Opus streaming disabled')
}

// Load .env.local for tsx context (Next.js loads it automatically for API routes)
const envLocal = path.resolve(process.cwd(), '.env.local')
if (fs.existsSync(envLocal)) {
  const lines = fs.readFileSync(envLocal, 'utf-8').split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIndex = trimmed.indexOf('=')
    if (eqIndex > 0) {
      const key = trimmed.slice(0, eqIndex).trim()
      const value = trimmed.slice(eqIndex + 1).trim()
      if (!process.env[key]) {
        process.env[key] = value
      }
    }
  }
}

const WS_PORT = parseInt(process.env.WS_PORT ?? '3001', 10)
const ASR_SERVER = `http://localhost:${process.env.ASR_PORT ?? '3003'}`
const TTS_SERVER = `http://localhost:${process.env.TTS_PORT ?? '3004'}`

const httpServer = createServer()
const wss = new WebSocketServer({ server: httpServer })

interface Session {
  ws: WebSocket
  history: Array<{ role: string; content: string }>
  abortController: AbortController | null
  sentenceBuffer: string
  /** Accumulated raw Int16 PCM chunks for ASR */
  audioBuffer: Buffer[]
  /** Browser supports Opus TTS → send WebSocket binary instead of HTTP TTS */
  opusTTS: boolean
}

/** Maximum chars to accumulate before force-flushing a partial TTS sentence */
const MAX_PARTIAL_CHARS = 20
/** Emergency raw flush (no punctuation found) — very high to avoid choppy segments */
const MAX_EMERGENCY_CHARS = 35

function extractSentences(buffer: string): { complete: string[]; remainder: string } {
  const sentences: string[] = []
  const re = /[^。！？；\n\r]+[。！？；\n\r]+/g
  let match
  let lastIndex = 0
  while ((match = re.exec(buffer)) !== null) {
    sentences.push(match[0])
    lastIndex = match.index + match[0].length
  }
  let remainder = buffer.slice(lastIndex)

  if (sentences.length === 0 && remainder.length >= MAX_PARTIAL_CHARS) {
    const secondaryIdx = Math.max(
      remainder.lastIndexOf('，'),
      remainder.lastIndexOf('、'),
      remainder.lastIndexOf('：'),
      remainder.lastIndexOf('；'),
    )
    if (secondaryIdx > 0) {
      sentences.push(remainder.slice(0, secondaryIdx + 1))
      remainder = remainder.slice(secondaryIdx + 1)
    } else if (remainder.length >= MAX_EMERGENCY_CHARS) {
      sentences.push(remainder)
      remainder = ''
    }
  }

  return { complete: sentences, remainder }
}

/** Wrap raw Int16 PCM data in a WAV header (16kHz, 16-bit, mono) */
function pcmToWav(pcmData: Buffer): Buffer {
  const sampleRate = 16000
  const bitsPerSample = 16
  const numChannels = 1
  const byteRate = sampleRate * numChannels * bitsPerSample / 8
  const blockAlign = numChannels * bitsPerSample / 8
  const dataSize = pcmData.length
  const header = Buffer.alloc(44)

  header.write('RIFF', 0)
  header.writeUInt32LE(36 + dataSize, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)                    // PCM
  header.writeUInt16LE(numChannels, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(byteRate, 28)
  header.writeUInt16LE(blockAlign, 32)
  header.writeUInt16LE(bitsPerSample, 34)
  header.write('data', 36)
  header.writeUInt32LE(dataSize, 40)

  return Buffer.concat([header, pcmData])
}

/** Send audio to ASR server, return transcribed text */
async function transcribeAudio(wavData: Buffer): Promise<string> {
  const res = await fetch(`${ASR_SERVER}/asr`, {
    method: 'POST',
    headers: { 'Content-Type': 'audio/wav' },
    body: new Uint8Array(wavData),
    signal: AbortSignal.timeout(10000),
  })
  if (!res.ok) throw new Error(`ASR error ${res.status}`)
  const data = await res.json() as { text: string }
  return data.text ?? ''
}

/** Parse WAV bytes to get PCM Int16 data, sample rate, and channels.
 *  Searches for "data" chunk rather than assuming offset 44 (handles extra chunks). */
function parseWav(wavData: Buffer): { pcm: Int16Array; sampleRate: number; channels: number } {
  if (wavData.length < 44) throw new Error('WAV too short')

  const sampleRate = wavData.readUInt32LE(24)
  const channels = wavData.readUInt16LE(22)
  const bitsPerSample = wavData.readUInt16LE(34)

  // Walk RIFF chunks to find "data"
  let offset = 12 // skip "RIFF" + size + "WAVE"
  let dataOffset = -1
  let dataSize = 0

  while (offset + 8 <= wavData.length) {
    const chunkId = wavData.toString('ascii', offset, offset + 4)
    const chunkSize = wavData.readUInt32LE(offset + 4)
    if (chunkId === 'data') {
      dataOffset = offset + 8
      dataSize = chunkSize
      // Clamp dataSize to remaining bytes
      if (dataOffset + dataSize > wavData.length) {
        dataSize = wavData.length - dataOffset
      }
      break
    }
    // Move to next chunk (pad to even boundary per RIFF spec)
    offset += 8 + chunkSize + (chunkSize % 2)
  }

  if (dataOffset < 0) throw new Error('No data chunk found in WAV')

  if (bitsPerSample === 16) {
    const sampleCount = Math.floor(dataSize / 2)
    const pcm = new Int16Array(sampleCount)
    for (let i = 0; i < sampleCount; i++) {
      pcm[i] = wavData.readInt16LE(dataOffset + i * 2)
    }
    return { pcm, sampleRate, channels }
  }

  // 32-bit float WAV (Piper sometimes outputs this)
  if (bitsPerSample === 32) {
    const sampleCount = Math.floor(dataSize / 4)
    const pcm = new Int16Array(sampleCount)
    for (let i = 0; i < sampleCount; i++) {
      const s = wavData.readFloatLE(dataOffset + i * 4)
      pcm[i] = Math.max(-32768, Math.min(32767, Math.round(s * 32768)))
    }
    return { pcm, sampleRate, channels }
  }

  throw new Error(`Unsupported WAV format: ${bitsPerSample}-bit`)
}

/** Resample Int16 PCM from one sample rate to another (simple linear interpolation) */
function resamplePcm(pcm: Int16Array, fromRate: number, toRate: number): Int16Array {
  if (fromRate === toRate) return pcm
  const ratio = toRate / fromRate
  const outLen = Math.floor(pcm.length * ratio)
  const out = new Int16Array(outLen)
  for (let i = 0; i < outLen; i++) {
    const srcIdx = i / ratio
    const lo = Math.floor(srcIdx)
    const hi = Math.min(lo + 1, pcm.length - 1)
    const frac = srcIdx - lo
    out[i] = Math.round(pcm[lo] * (1 - frac) + pcm[hi] * frac)
  }
  return out
}

/** Call Piper TTS, encode output to Opus frames, return TLV-encoded Opus data.
 *  TLV format: [frameLen:2 LE][frameData] repeated for each frame.
 *  Returns null on failure (caller should fall back to HTTP TTS). */
async function synthesizeAndEncodeOpus(text: string): Promise<Buffer | null> {
  if (!OpusEncoder) return null

  try {
    const res = await fetch(`${TTS_SERVER}/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(30000),
    })
    if (!res.ok) return null

    const wavData = Buffer.from(await res.arrayBuffer())
    if (wavData.length < 44) return null

    const { pcm, sampleRate, channels } = parseWav(wavData)

    // Resample to 48kHz for Opus encoding (clean 20ms frames)
    const targetRate = 48000
    const resampled = resamplePcm(pcm, sampleRate, targetRate)

    const encoder = new OpusEncoder(targetRate, channels)
    const frameSamples = Math.floor(targetRate * 0.02) // 960 @ 48kHz
    const tlvParts: Buffer[] = []

    for (let offset = 0; offset + frameSamples <= resampled.length; offset += frameSamples) {
      const frameBuf = Buffer.alloc(frameSamples * 2)
      for (let i = 0; i < frameSamples; i++) {
        frameBuf.writeInt16LE(resampled[offset + i], i * 2)
      }
      const opusFrame = encoder.encode(frameBuf)

      // TLV: 2-byte frame length + frame data
      const lenHeader = Buffer.alloc(2)
      lenHeader.writeUInt16LE(opusFrame.length, 0)
      tlvParts.push(lenHeader, opusFrame)
    }

    encoder.destroy()
    return Buffer.concat(tlvParts)
  } catch (err) {
    console.error('[TTS-OPUS] Error:', (err as Error).message)
    return null
  }
}

/** Run DeepSeek streaming and send chat.delta/chat.sentence/chat.final events */
async function handleDeepSeekChat(
  session: Session,
  ws: WebSocket,
  text: string,
  features?: { emotion?: string; prosody?: { speed: number; pitchVariation: number; energy: number } },
): Promise<void> {
  session.history.push({ role: 'user', content: text })
  session.sentenceBuffer = ''

  const systemPrompt = buildSystemPrompt({
    emotion: features?.emotion,
    prosodyDescription: features?.prosody
      ? `语速${features.prosody.speed}，音调变化${features.prosody.pitchVariation}`
      : undefined,
  })

  const messages = [
    { role: 'system', content: systemPrompt },
    ...session.history.slice(-20),
  ]

  session.abortController?.abort()
  const ac = new AbortController()
  session.abortController = ac

  const deepseekRes = await fetch(
    `${process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com/v1'}/chat/completions`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({
        model: process.env.DEEPSEEK_MODEL ?? 'deepseek-chat',
        messages,
        stream: true,
      }),
      signal: ac.signal,
    }
  )

  if (!deepseekRes.ok) {
    const errText = await deepseekRes.text()
    throw new Error(`DeepSeek ${deepseekRes.status}: ${errText}`)
  }

  const reader = deepseekRes.body?.getReader()
  if (!reader) throw new Error('No response body')

  const decoder = new TextDecoder()
  let fullText = ''
  let seq = 0

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    const chunk = decoder.decode(value, { stream: true })
    const lines = chunk.split('\n').filter((l) => l.startsWith('data: '))

    for (const line of lines) {
      const data = line.slice(6)
      if (data === '[DONE]') continue

      try {
        const parsed = JSON.parse(data)
        const delta = parsed.choices?.[0]?.delta
        const deltaText = (delta?.content || delta?.reasoning_content || '').trimEnd()
        if (deltaText) {
          fullText += deltaText
          session.sentenceBuffer += deltaText
          seq++

          ws.send(JSON.stringify({
            type: 'event',
            event: 'chat.delta',
            payload: { text: deltaText, seq },
          }))

          // 句子级流式 TTS：从 buffer 提取完整句子，立即发送
          const { complete, remainder } = extractSentences(session.sentenceBuffer)
          for (const sentence of complete) {
            ws.send(JSON.stringify({
              type: 'event',
              event: 'chat.sentence',
              payload: { text: sentence, seq },
            }))

            // 异步 Opus TTS 流：编码后通过 WebSocket 二进制发送
            if (session.opusTTS) {
              synthesizeAndEncodeOpus(sentence).then(opusData => {
                if (opusData && ws.readyState === WebSocket.OPEN) {
                  const textBuf = Buffer.from(sentence, 'utf-8')
                  const textLen = Buffer.alloc(4)
                  textLen.writeUInt32LE(textBuf.length, 0)
                  ws.send(Buffer.concat([textLen, textBuf, opusData]))
                }
              })
            }
          }
          session.sentenceBuffer = remainder
        }
      } catch { /* skip unparseable */ }
    }
  }

  session.history.push({ role: 'assistant', content: fullText })

  // 冲刷剩余未发送的文本
  const leftover = session.sentenceBuffer.trim()
  if (leftover) {
    ws.send(JSON.stringify({
      type: 'event',
      event: 'chat.sentence',
      payload: { text: leftover, seq: ++seq },
    }))

    if (session.opusTTS) {
      synthesizeAndEncodeOpus(leftover).then(opusData => {
        if (opusData && ws.readyState === WebSocket.OPEN) {
          const textBuf = Buffer.from(leftover, 'utf-8')
          const textLen = Buffer.alloc(4)
          textLen.writeUInt32LE(textBuf.length, 0)
          ws.send(Buffer.concat([textLen, textBuf, opusData]))
        }
      })
    }
  }

  ws.send(JSON.stringify({
    type: 'event',
    event: 'chat.final',
    payload: { text: fullText },
  }))
}

const sessions = new Map<string, Session>()

wss.on('connection', (ws) => {
  const sessionId = `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const session: Session = { ws, history: [], abortController: null, sentenceBuffer: '', audioBuffer: [], opusTTS: false }
  sessions.set(sessionId, session)

  ws.on('message', async (raw, isBinary) => {
    try {
      // Binary audio chunk from browser
      if (isBinary) {
        session.audioBuffer.push(Buffer.isBuffer(raw) ? raw : Buffer.from(new Uint8Array(raw as ArrayBuffer)))
        return
      }

      const msg = JSON.parse(raw.toString())

      if (msg.method === 'ping') {
        ws.send(JSON.stringify({ type: 'res', id: msg.id, ok: true }))
        return
      }

      if (msg.method === 'configure') {
        const { tts } = msg.payload ?? {}
        session.opusTTS = tts === 'opus'
        ws.send(JSON.stringify({ type: 'res', id: msg.id, ok: true }))
        return
      }

      if (msg.method === 'chat.send') {
        const { text, features } = msg.payload ?? {}
        try {
          await handleDeepSeekChat(session, ws, text, features)
          ws.send(JSON.stringify({ type: 'res', id: msg.id, ok: true }))
        } catch (err) {
          if (err instanceof Error && err.name === 'AbortError') {
            session.abortController = null
            return
          }
          ws.send(JSON.stringify({
            type: 'res',
            id: msg.id,
            ok: false,
            error: { code: 'STREAM_ERROR', message: err instanceof Error ? err.message : 'Unknown error' },
          }))
        }
        return
      }

      if (msg.method === 'asr.audio_end') {
        try {
          const pcmData = Buffer.concat(session.audioBuffer)
          session.audioBuffer = []

          if (pcmData.length < 320) { // Less than 10ms of audio
            ws.send(JSON.stringify({ type: 'event', event: 'asr.final', payload: { text: '' } }))
            return
          }

          const wavData = pcmToWav(pcmData)
          const text = await transcribeAudio(wavData)

          ws.send(JSON.stringify({
            type: 'event',
            event: 'asr.final',
            payload: { text },
          }))

          // Auto-start LLM if we got text
          if (text.trim()) {
            handleDeepSeekChat(session, ws, text, msg.payload?.features).catch((err) => {
              if (err instanceof Error && err.name !== 'AbortError') {
                console.error('[WS] DeepSeek error after ASR:', err)
              }
            })
          }
        } catch (err) {
          console.error('[WS] ASR error:', err)
          ws.send(JSON.stringify({
            type: 'event',
            event: 'asr.final',
            payload: { text: '', error: err instanceof Error ? err.message : 'ASR failed' },
          }))
        }
        return
      }

      if (msg.method === 'chat.abort') {
        session.abortController?.abort()
        session.abortController = null
        return
      }
    } catch (err) {
      console.error('WS message error:', err)
    }
  })

  ws.on('close', () => {
    sessions.delete(sessionId)
  })

  ws.send(JSON.stringify({
    type: 'event',
    event: 'connected',
    payload: { sessionId },
  }))
})

httpServer.listen(WS_PORT, () => {
  console.log(`WebSocket 服务器运行在 ws://localhost:${WS_PORT}`)
})
