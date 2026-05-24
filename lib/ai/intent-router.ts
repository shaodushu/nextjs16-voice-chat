import { Emotion, IntentType } from '@/types/voice'
import type { Intent } from '@/types/voice'

const simplePatterns: Array<{ patterns: RegExp[]; emotion: Emotion }> = [
  { patterns: [/你好/i, /您好/i, /嗨/i, /hi/i, /hello/i, /早上好/i, /晚上好/i, /下午好/i], emotion: Emotion.Warm },
  { patterns: [/嗯$/i, /哦$/i, /好的$/i, /知道了$/i, /明白$/i, /对$/i, /是$/i], emotion: Emotion.Attentive },
  { patterns: [/谢谢/i, /多谢/i, /感谢/i], emotion: Emotion.Warm },
  { patterns: [/再见/i, /拜拜/i, /回头见/i, /bye/i], emotion: Emotion.Warm },
  { patterns: [/在吗/i, /在不在/i, /小慧/i], emotion: Emotion.Attentive },
]

const complexPatterns: RegExp[] = [
  /为什么/i, /怎么/i, /什么/i, /如何/i, /多少/i,
  /帮我/i, /推荐/i, /建议/i, /提醒/i, /设置/i,
  /如果/i, /假如/i, /要是/i,
  /天气/i, /时间/i, /今天/i, /明天/i, /星期/i,
  /灯/i, /空调/i, /电视/i, /窗帘/i, /开关/i, /温度/i,
  /音乐/i, /播放/i, /声音/i, /音量/i,
  /闹钟/i, /计时/i, /提醒/i, /日程/i, /备忘/i,
]

export function classifyIntent(text: string): Intent {
  const trimmed = text.trim()
  if (!trimmed) return { text: '', type: IntentType.Simple, confidence: 0, emotion: Emotion.Neutral }

  // If it matches a complex keyword → cloud DeepSeek
  const matched = complexPatterns.filter((re) => re.test(trimmed))
  if (matched.length > 0) {
    return {
      text: trimmed,
      type: IntentType.Complex,
      confidence: Math.min(0.7 + matched.length * 0.05, 0.95),
      emotion: detectNegativeEmotion(trimmed),
    }
  }

  // Simple greeting → still go to DeepSeek for natural response
  for (const p of simplePatterns) {
    if (p.patterns.some((re) => re.test(trimmed))) {
      return {
        text: trimmed,
        type: IntentType.Complex,
        confidence: 0.85,
        emotion: p.emotion,
      }
    }
  }

  // Everything else → DeepSeek
  return {
    text: trimmed,
    type: IntentType.Complex,
    confidence: 0.8,
    emotion: Emotion.Neutral,
  }
}

function detectNegativeEmotion(text: string): Emotion {
  if (/贵|高|贵了|太高|担心|怕|害怕|犹豫/i.test(text)) return Emotion.Reassuring
  if (/不满意|差|不好|生气|烦/i.test(text)) return Emotion.Gentle
  return Emotion.Neutral
}
