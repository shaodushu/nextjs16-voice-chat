const TTS_SERVER = `http://localhost:${process.env.TTS_PORT ?? '3004'}`

export async function POST(req: Request) {
  const { text } = await req.json()
  if (!text?.trim()) {
    return new Response(JSON.stringify({ error: 'text is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
    const res = await fetch(`${TTS_SERVER}/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
      signal: req.signal,
    })

    if (!res.ok) {
      const err = await res.json()
      return new Response(JSON.stringify(err), {
        status: res.status,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const audioData = await res.arrayBuffer()
    return new Response(audioData, {
      status: 200,
      headers: {
        'Content-Type': res.headers.get('Content-Type') ?? 'audio/mpeg',
        'Content-Length': audioData.byteLength.toString(),
      },
    })
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : 'TTS failed' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}
