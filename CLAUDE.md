# CLAUDE.md

本文档用于指导 Claude Code 在该仓库中进行开发。

## 架构概览

语音对话应用，开发模式下同时运行 **4 个服务**：

| 服务 | 技术 | 端口 | 用途 |
|--------|------|------|------|
| Next.js | TS/React | 3000 | 前端页面 + API 路由 |
| WebSocket 中继 | `tsx watch` | 3001 | 音频/消息在浏览器与 ASR/LLM 间中转 |
| ASR | Python (HTTP 代理) | 3003 | SenseVoiceSmall 语音转文字（云端 API） |
| TTS | Python (HTTP 代理) | 3004 | IndexTTS-1.5 语音合成（云端 API） |

通过 `npm run dev` 同时启动全部 4 个服务。

> **云端 vs 本地**: 默认 ASR/TTS 走云端 API（`*-cloud-server.py`，调用 `ai-platform.xwfintech.com/v1`）。如需本地运行：`npm run dev:asr:local`（FunASR SenseVoice CPU）和 `npm run dev:tts:local`（Piper TTS ONNX zh_CN-huayan-medium）。

## 语音对话数据流

```
麦克风 → AudioCapture (Float32 PCM 分片)
  → ws-client.sendAudio() → WebSocket 二进制 → ws-server.ts 缓存 PCM 分片
  → VAD 检测到语音结束 → ws-client.send('asr.audio_end')
  → ws-server.ts: 合并 PCM → 加 WAV 头 → POST 到 ASR 服务器 (3003 端口)
  → ws-server.ts: ASR 结果返回后 → fetch DeepSeek API 开始流式对话

  ┏━ LLM SSE 流中按标点切句 → 每个完整句子立即 send('chat.sentence')
  ┃
  ┣━ [Opus 模式] 浏览器支持 WebCodecs AudioDecoder:
  ┃     page.tsx: 收到 chat.sentence → 跳过 HTTP TTS
  ┃     ws-server.ts: 异步调 TTS 服务器 → WAV → Opus 编码 (@discordjs/opus)
  ┃       → WebSocket 二进制帧 [textLen:4 LE][UTF-8 text][TLV Opus frames]
  ┃     page.tsx ws.onAudioData → OpusDecoder (WebCodecs) → AudioContext 播放
  ┃
  ┗━ [HTTP 模式] 浏览器不支持 Opus（回退）:
        page.tsx: 收到 chat.sentence → OllamaTTS.speakChunk(text)
        → fetch('/api/tts') → TTS 服务器 (3004) → WAV → AudioContext 播放
```

## 两条独立的 LLM 请求路径

| 路径 | 触发方式 | 数据流 | 用途 |
|------|---------|--------|------|
| **WebSocket 路径** | 语音对话（VAD 结束 → ASR → 自动触发） | `ws-server.ts` → `fetch(DeepSeek API)` → SSE 流式输出 + 切句 TTS | 语音对话主路径 |
| **HTTP 路径** | 文字输入（ChatPanel 发送） | `page.tsx` → `DeepSeekClient` → `/api/chat` → `@ai-sdk/deepseek` + Vercel AI SDK `streamText` → SSE | 文字聊天备选路径 |

两条路径互不依赖。WS 服务端直接调用 DeepSeek API，不经过 Next.js 路由。

### WebSocket 消息协议 (`lib/websocket/ws-types.ts`)

客户端和服务器间使用 JSON 消息 + 二进制帧通信：

- **客户端 → 服务端**: `chat.send` (触发 LLM 对话), `chat.abort` (中断), `ping` (心跳), `configure { tts: 'opus' }` (切换 Opus 模式), `asr.audio_end` (VAD 结束信号)
- **服务端 → 客户端**: `chat.delta` (LLM 流式增量), `chat.sentence` (完整句子触发 TTS), `chat.final` (LLM 完成), `emotion` (情绪检测), `asr.result` (ASR 转写结果)
- **二进制消息**: PCM 音频分片（客户端→服务器）和 Opus 编码 TTS 音频（服务器→客户端）
- **Opus 二进制帧格式**: `[textLen:4 LE][UTF-8 text][TLV: frameLen:2 LE + frameData 重复]`

## 关键源文件

### 前端页面 (app/)
- `app/page.tsx` — 主页面，组装 AudioCapture + VAD + WebSocket + TTS + Opus 解码
- `app/layout.tsx` — 根布局，标题"小慧管家"
- `app/(main)/components/chat/ChatPanel.tsx` — 聊天面板（文字对话入口）
- `app/(main)/components/chat/ConversationBubble.tsx` — 对话气泡
- `app/(main)/components/chat/StreamingText.tsx` — 流式文字渲染
- `app/(main)/components/voice/` — 语音相关 UI（麦克风按钮、音频可视化、情绪指示器、打断横幅）
- `app/(main)/components/layout/` — Header、StatusBar
- `app/api/chat/route.ts` — HTTP LLM 路径（AI SDK streamText + SSE）
- `app/api/tts/route.ts` — TTS 请求代理（HTTP 回退模式）
- `app/error.tsx` / `app/loading.tsx` — Next.js 错误/加载边界

### 客户端库 (lib/)
- `lib/audio/AudioCapture.ts` — 麦克风采集、ScriptProcessor PCM 捕获、音量检测
- `lib/audio/VADProcessor.ts` — 能量阈值 VAD（阈值 0.22，6 帧开始/8 帧结束）
- `lib/audio/AudioPlayer.ts` — 音频队列播放，支持淡出
- `lib/audio/OpusDecoder.ts` — 浏览器端 Opus 解码（WebCodecs AudioDecoder，TLV 格式）
- `lib/audio/OpusEncoder.ts` — 浏览器端 Opus 编码（WebCodecs AudioEncoder，预留）
- `lib/tts/ollama-tts.ts` — TTS 客户端：队列、fetch WAV、decodeAudioData、播放（HTTP 回退）
- `lib/tts/local-tts.ts` — 浏览器原生 SpeechSynthesis TTS（无服务器依赖，各情绪参数微调）
- `lib/websocket/ws-client.ts` — WebSocket 客户端（重连、心跳、二进制消息收发）
- `lib/websocket/ws-types.ts` — WebSocket 消息协议类型定义
- `lib/store/voice-store.ts` — Zustand 状态管理（音频状态机 + 对话记录）
- `lib/ai/intent-router.ts` — 关键词匹配，分类用户意图（问候/家居控制/查询等）
- `lib/ai/system-prompts.ts` — 家庭智能助理"小慧"的系统提示词（每次回复不超过 3 句）
- `lib/ai/deepseek-client.ts` — 浏览器端 HTTP SSE 读取器（文字聊天路径）
- `lib/ai/emotion-parser.ts` — 从 LLM 输出文本中提取并移除 `[warm]` 等情绪标签
- `lib/utils/cn.ts` — `clsx` + `tailwind-merge` 工具函数

### 服务端 (server/)
- `server/ws-server.ts` — WebSocket 中继：PCM 接收、DeepSeek 流式请求、句子级 TTS 切句触发、Opus TTS 编码推送
- `server/asr-cloud-server.py` — 云端 ASR HTTP 代理（POST 到 ai-platform 的 SenseVoiceSmall API）
- `server/tts-cloud-server.py` — 云端 TTS HTTP 代理（POST 到 ai-platform 的 IndexTTS-1.5 API）
- `server/asr-server.py` — 本地 FunASR SenseVoice CPU ASR（备选）
- `server/tts-server.py` — 本地 Piper TTS 子进程封装（备选）

### 其他
- `types/voice.ts` — 枚举（AudioState、Emotion、IntentType）和核心接口（Intent、ConversationTurn、AudioFeatures）
- `bin/piper/` — Piper TTS 二进制 + zh_CN-huayan-medium ONNX 模型 + espeak-ng 数据
- `src/app/` — 并行入口点（另一版本的页面/布局）
- `debug/` — TTS/WAV 调试文件

## 音频状态机

`app/page.tsx` 中的 AudioState 转换：
```
Idle → Recording (按麦克风按钮) → Processing (VAD 检测到结束) → Speaking (TTS 播放中) → Recording (TTS 播放完毕)
Recording → Interrupted → Recording (2 秒后恢复)
```

## 开发命令

```bash
npm run dev            # 同时启动全部 4 个服务（默认云端 ASR/TTS）
npm run dev:next       # 仅 Next.js
npm run dev:ws         # 仅 WebSocket 服务器
npm run dev:asr        # 仅 ASR（云端 API）
npm run dev:tts        # 仅 TTS（云端 API）
npm run dev:asr:local  # 仅 ASR（本地 FunASR CPU）
npm run dev:tts:local  # 仅 TTS（本地 Piper ONNX）
npm run build          # Next.js 构建
npm run start          # 生产模式启动
npm run lint           # ESLint
```

## 环境变量

复制 `.env.local.example` 为 `.env.local` 并配置。必须设置：

```bash
# DeepSeek 聊天 API（必需）
DEEPSEEK_API_KEY=sk-...
DEEPSEEK_API_URL=http://ai-platform.xwfintech.com/v1
DEEPSEEK_MODEL=Code/DeepSeek-V4-Flash

# 云端 ASR（默认 dev 使用）
ASR_API_URL=http://ai-platform.xwfintech.com/v1
ASR_API_KEY=sk-...
ASR_MODEL=SenseVoiceSmall

# 云端 TTS（默认 dev 使用）
TTS_API_URL=http://ai-platform.xwfintech.com/v1
TTS_API_KEY=sk-...
TTS_MODEL=IndexTTS-1.5
TTS_VOICE=杜小雯
```

## 重要设计决策

- **角色设定"小慧"** — 家庭智能助理，温暖亲切。每次回复不超过 3 句，短句口语化，不用 Markdown 和表情符号。家居场景（灯光、空调、电视、窗帘、闹钟、音乐等）直接回应。
- **句子级流式 TTS** — LLM 流式输出时，ws-server.ts 按中英文标点（。！？；）切句，每个完整句子立即发射 `chat.sentence` 事件。浏览器收到后立即触发 TTS 合成与播放，不等 LLM 全部生成完毕。见 `extractSentences()`。
- **Opus TTS 流** — 浏览器支持 WebCodecs AudioDecoder 时，发送 `configure { tts: 'opus' }` 到服务器。服务器将 TTS 输出 WAV 用 `@discordjs/opus` 编码为 Opus 帧推送。不支持 Opus 的浏览器自动回退到 HTTP TTS。Opus 二进制若 3 秒未送达也回退 HTTP TTS。
- **音频走 WebSocket 而非 HTTP**。录音时 PCM 分片持续发送；ASR 在服务端收到 `asr.audio_end` 后触发。
- **Piper TTS（本地备选）** — 2.5 秒音频约 0.37 秒生成，输出 22050Hz 16-bit 单声道 WAV。
- **LLM 输出不带情绪标签** — 系统提示词中去掉了 `[warm]` 等标记，但 `emotion-parser.ts` 仍保留解析逻辑以防模型输出标签。
- **VAD 使用能量阈值**（非机器学习）。阈值 0.22，连续 6 帧判定开始说话，连续 8 帧判定结束（~130ms 沉默触发 ASR）。
- **Next.js 16.x** — 修改 Next.js 相关代码前先查看 `node_modules/next/dist/docs/` 中的变更说明。

## ASR 调优（影响准确率和速度）

当前 ASR 使用云端 SenseVoiceSmall API + 能量阈值 VAD。本地备选为 FunASR SenseVoiceSmall（CPU）。

**影响准确率的因素（按影响从大到小）**：

| 因素 | 现状 | 改进方向 |
|------|------|---------|
| ASR 模型 | SenseVoiceSmall（轻量） | 换用更大模型（本地方案）：`iic/speech_paraformer_asr-enhance` |
| ITN（数字格式化） | 启用 | 金融/地址场景可能转换错误，可关闭 |
| 音频质量 | 16kHz Float32 浏览器采集 | 确认麦克风无遮挡、环境安静 |
| VAD 切音 | 能量阈值 0.22 | 阈值过高会切掉开头；过低会包含噪声 |

**影响速度的因素（按影响从大到小）**：

| 因素 | 现状 | 改进方向 |
|------|------|---------|
| VAD 静音等待 | 8 帧沉默触发 ASR（~130ms@60fps） | 减少 `minSilenceFrames` 到 5-6 可更快，但可能误断 |
| ASR 网络延迟 | 云端 API（HTTP 请求） | 使用本地 ASR 可降低延迟（速度-精度权衡） |