import { Emotion } from '@/types/voice'

const EMOTION_TAGS: Array<{ tag: string; emotion: Emotion }> = [
  { tag: '[warm]', emotion: Emotion.Warm },
  { tag: '[reassuring]', emotion: Emotion.Reassuring },
  { tag: '[gentle]', emotion: Emotion.Gentle },
  { tag: '[encouraging]', emotion: Emotion.Encouraging },
  { tag: '[attentive]', emotion: Emotion.Attentive },
]

export interface ParsedEmotion {
  emotion: Emotion
  cleanText: string
}

export function parseEmotionTags(text: string): ParsedEmotion {
  let detectedEmotion = Emotion.Neutral
  let cleanText = text

  for (const { tag, emotion } of EMOTION_TAGS) {
    if (text.includes(tag)) {
      detectedEmotion = emotion
      cleanText = cleanText.replace(new RegExp(`\\${tag}`, 'g'), '').trim()
    }
  }

  return { emotion: detectedEmotion, cleanText }
}

export function extractEmotionFromStreaming(text: string): string | undefined {
  for (const { tag, emotion } of EMOTION_TAGS) {
    if (text.includes(tag)) {
      return emotion
    }
  }
  return undefined
}

export function removeEmotionTags(text: string): string {
  return EMOTION_TAGS.reduce(
    (acc, { tag }) => acc.replace(new RegExp(`\\${tag}`, 'g'), ''),
    text
  ).trim()
}
