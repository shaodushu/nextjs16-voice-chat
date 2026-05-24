const ASR_SERVER = `http://localhost:${process.env.ASR_PORT ?? '3003'}`

export async function POST(req: Request) {
  try {
    const body = await req.arrayBuffer()
    const res = await fetch(`${ASR_SERVER}/asr`, {
      method: 'POST',
      headers: { 'Content-Type': req.headers.get('Content-Type') ?? 'audio/wav' },
      body,
    })

    const data = await res.json()
    return Response.json(data, { status: res.status })
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'ASR failed' },
      { status: 500 }
    )
  }
}
