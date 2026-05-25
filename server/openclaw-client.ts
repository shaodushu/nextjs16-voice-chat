import { spawn, ChildProcess } from 'child_process'

export interface OpenClawChatCallbacks {
  onFinal: (text: string) => void
  onError: (error: string) => void
}

interface OpenClawResult {
  payloads?: Array<{ text?: string }>
  result?: {
    payloads?: Array<{ text?: string }>
  }
}

export class OpenClawClient {
  private agentId: string
  private env: Record<string, string>

  constructor(agentId: string, env: Record<string, string> = {}) {
    this.agentId = agentId
    this.env = env
  }

  /** Run a chat turn via openclaw agent --local. Returns an abort handle. */
  chat(message: string, callbacks: OpenClawChatCallbacks): { abort: () => void } {
    let child: ChildProcess | null = null
    let aborted = false
    let stdout = ''

    const run = () => {
      child = spawn('openclaw', [
        'agent',
        '--agent', this.agentId,
        '--message', message,
        '--local',
        '--json',
      ], {
        env: { ...process.env, ...this.env },
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 30000,
      })

      child.stdout?.on('data', (chunk: Buffer) => {
        stdout += chunk.toString()
      })

      child.on('close', (code) => {
        if (aborted) return

        if (code !== 0) {
          callbacks.onError(`OpenClaw agent exited with code ${code}`)
          return
        }

        try {
          const data: OpenClawResult = JSON.parse(stdout)

          // Handle both gateway mode ({result: {payloads: [...]}}) and
          // local mode ({payloads: [...]}) output formats
          const payloads = data.result?.payloads ?? data.payloads ?? []
          const text = payloads.map((p) => p.text ?? '').join('').trim()

          if (text) {
            callbacks.onFinal(text)
          } else {
            callbacks.onError('OpenClaw returned empty response')
          }
        } catch (err) {
          callbacks.onError(`Failed to parse OpenClaw response: ${err instanceof Error ? err.message : 'unknown'}`)
        }
      })

      child.on('error', (err) => {
        if (aborted) return
        callbacks.onError(`OpenClaw agent failed: ${err.message}`)
      })
    }

    run()

    return {
      abort: () => {
        aborted = true
        child?.kill('SIGTERM')
      },
    }
  }

  close() {
    // No persistent connection to clean up
  }
}
