import { createDeepSeek } from '@ai-sdk/deepseek'
import { streamText } from 'ai'
import { buildSystemPrompt } from '@/lib/ai/system-prompts'

const deepseek = createDeepSeek({
  apiKey: process.env.DEEPSEEK_API_KEY!,
  baseURL: process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com/v1',
})

export async function POST(req: Request) {
  const { message, history, emotionHint } = await req.json()

  const systemPrompt = buildSystemPrompt(
    emotionHint ? { emotion: emotionHint } : undefined
  )

  const result = streamText({
    model: deepseek(process.env.DEEPSEEK_MODEL ?? 'deepseek-chat'),
    messages: [
      { role: 'system', content: systemPrompt },
      ...(history ?? []),
      { role: 'user', content: message },
    ],
  })

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const part of result.fullStream) {
          if (part.type === 'text-delta') {
            const data = JSON.stringify({
              text: part.text,
              emotion: detectEmotion(part.text),
            })
            controller.enqueue(encoder.encode(`data: ${data}\n\n`))
          }
        }
        controller.enqueue(encoder.encode('data: [DONE]\n\n'))
      } catch (err) {
        console.error('Stream error:', err)
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}

function detectEmotion(text: string): string | undefined {
  const tagMatch = text.match(/\[(warm|reassuring|gentle|encouraging)\]/)
  return tagMatch?.[1]
}
