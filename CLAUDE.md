# CLAUDE.md

本文档用于指导 Claude Code 在该仓库中进行开发。

## 架构概览

语音对话应用，开发模式下同时运行 **4 个服务**：

| 服务 | 技术 | 端口 | 用途 |
|--------|------|------|------|
| Next.js | TS/React | 3000 | 前端页面 + API 路由 |
| WebSocket 中继 | `tsx watch` | 3001 | 音频/消息在浏览器与 ASR/LLM 间中转 |
| ASR | Python (FunASR) | 3003 | SenseVoice 语音转文字 |
| TTS | Python (子进程) | 3004 | 本地 Piper TTS (ONNX, zh_CN-huayan-medium) |

通过 `npm run dev` 同时启动全部 4 个服务。

## 语音对话数据流

```
麦克风 → AudioCapture (Float32 PCM 分片)
  → ws-client.sendAudio() → WebSocket 二进制 → ws-server.ts 缓存 PCM 分片
  → VAD 检测到语音结束 → ws-client.send('asr.audio_end')
  → ws-server.ts: 合并 PCM → 加 WAV 头 → POST 到 ASR 服务器 (3003 端口)
  → ws-server.ts: 自动启动 DeepSeek 流式对话

  ┏━ LLM SSE 流中按标点切句 → 每个完整句子立即 send('chat.sentence')
  ┃
  ┣━ [Opus 模式] 浏览器支持 WebCodecs AudioDecoder:
  ┃     page.tsx: 收到 chat.sentence → 跳过 HTTP TTS
  ┃     ws-server.ts: 异步调 Piper TTS → WAV → Opus 编码 (@discordjs/opus)
  ┃       → WebSocket 二进制帧 [textLen][text][TLV Opus frames]
  ┃     page.tsx ws.onAudioData → OpusDecoder (WebCodecs) → AudioContext 播放
  ┃
  ┗━ [HTTP 模式] 浏览器不支持 Opus（回退）:
        page.tsx: 收到 chat.sentence → OllamaTTS.speakChunk(text)
        → fetch('/api/tts') → TTS 服务器 (3004) → Piper → WAV → AudioContext 播放
```

## 关键源文件

### 前端 (app/)
- `app/page.tsx` — 主页面，组装 AudioCapture + VAD + WebSocket + TTS + Opus 解码
- `app/api/tts/route.ts` — 将 TTS 请求代理到 Python Piper 服务器（HTTP 回退模式）
- `app/api/asr/route.ts` — 当前流程中未使用（音频走 WebSocket）

### 客户端库 (lib/)
- `lib/audio/AudioCapture.ts` — 麦克风采集、ScriptProcessor PCM 捕获、音量检测
- `lib/audio/VADProcessor.ts` — 能量阈值 VAD（触发说话/沉默事件）
- `lib/audio/AudioPlayer.ts` — 音频队列播放，支持淡出
- `lib/audio/OpusDecoder.ts` — 浏览器端 Opus 解码器（WebCodecs AudioDecoder），TLV 格式解码
- `lib/audio/OpusEncoder.ts` — 浏览器端 Opus 编码器（WebCodecs AudioEncoder），预留
- `lib/tts/ollama-tts.ts` — TTS 客户端：队列、fetch WAV、decodeAudioData、播放（HTTP 回退）
- `lib/websocket/ws-client.ts` — WebSocket 客户端，支持重连、心跳、二进制消息
- `lib/store/voice-store.ts` — Zustand 状态管理（音频状态机 + 对话记录）
- `lib/ai/intent-router.ts` — 关键词匹配，检测用户情绪
- `lib/ai/system-prompts.ts` — 银行助理"小银"的系统提示词

### 服务端 (server/)
- `server/ws-server.ts` — WebSocket 中继：接收 PCM 音频、管理 DeepSeek 流式请求、
  句子级流式 TTS 切句、Opus TTS 编码（@discordjs/opus）、WebSocket 二进制推送
- `server/asr-server.py` — FunASR SenseVoice 批量 ASR（HTTP POST /asr）
- `server/tts-server.py` — Piper TTS 子进程封装（HTTP POST /tts）

### 其他
- `bin/piper/` — Piper TTS 二进制 + zh_CN-huayan-medium ONNX 模型 + espeak-ng 数据
- `types/voice.ts` — 枚举（AudioState、Emotion）和核心接口定义

## 音频状态机

`app/page.tsx` 中的 AudioState 转换：
```
Idle → Recording (按麦克风按钮) → Processing (VAD 检测到结束) → Speaking (TTS 播放中) → Recording (TTS 播放完毕)
Recording → Interrupted → Recording (2 秒后恢复)
```

## 开发命令

```bash
npm run dev       # 同时启动全部 4 个服务
npm run dev:next  # 仅 Next.js
npm run dev:ws    # 仅 WebSocket 服务器
npm run dev:asr   # 仅 ASR 服务器
npm run dev:tts   # 仅 TTS 服务器
npm run build     # Next.js 构建
```

## 环境变量

复制 `.env.local.example` 为 `.env.local` 并配置。必须设置：
- `DEEPSEEK_API_KEY` — DeepSeek 聊天 API 密钥

## 重要设计决策

- **句子级流式 TTS** — LLM 流式输出时，ws-server.ts 按中英文标点（。！？；）切句，
  每个完整句子立即发射 `chat.sentence` 事件。浏览器收到后立即触发 TTS 合成与播放，
  不等 LLM 全部生成完毕。见 `extractSentences()`。
- **Opus TTS 流** — 浏览器检测到 WebCodecs AudioDecoder 支持时，发送 `configure { tts: 'opus' }`
  到服务器。服务器将 Piper TTS 输出（WAV）解码后以 `@discordjs/opus` 编码为 Opus 帧，
  通过 WebSocket 二进制消息推送。浏览器用 AudioDecoder 解码后播放。格式：
  `[textLen:4 LE][UTF-8 text][TLV: frameLen:2 LE + frameData 重复]`。
  不支持 Opus 的浏览器自动回退到 HTTP TTS（默认）。Opus 二进制若 3 秒未送达也回退 HTTP TTS。
- **音频走 WebSocket 而非 HTTP**。录音时 PCM 分片持续发送；ASR 在服务端收到 `asr.audio_end` 后触发。
- **Piper TTS** 本地运行（2.5 秒音频约 0.37 秒生成），输出 22050Hz 16-bit 单声道 WAV。
- **LLM 输出不带情绪标签** — 系统提示词中去掉了 [warm] 等标记。
- **VAD 使用能量阈值**（非机器学习）。阈值 0.22，连续 6 帧判定开始说话，连续 8 帧判定结束（~130ms 沉默触发 ASR）。
- **Next.js 16.x** — 修改 Next.js 相关代码前先查看 `node_modules/next/dist/docs/` 中的变更说明。

## ASR 调优（影响准确率和速度）

当前 ASR 使用 FunASR SenseVoiceSmall（本地 CPU）+ 能量阈值 VAD。

**影响准确率的因素（按影响从大到小）**：

| 因素 | 现状 | 改进方向 |
|------|------|---------|
| ASR 模型 | SenseVoiceSmall（轻量） | 换用更大模型：`iic/speech_paraformer_asr-enhance` 或 `iic/speech_seaco_paraformer_large`（`npm run dev:asr -- --model iic/speech_paraformer_asr-enhance`） |
| ITN（数字格式化） | 启用 (`use_itn=True`) | 金融/地址场景可能转换错误，可关闭 (`--no-itn`) |
| 音频质量 | 16kHz Float32 浏览器采集 | 确认麦克风无遮挡、环境安静 |
| VAD 切音 | 能量阈值 0.22 | 阈值过高会切掉开头；过低会包含噪声 |

**影响速度的因素（按影响从大到小）**：

| 因素 | 现状 | 改进方向 |
|------|------|---------|
| VAD 静音等待 | 8 帧沉默触发 ASR（~130ms@60fps） | 减少 `minSilenceFrames` 到 5-6 可更快，但可能误断 |
| ASR 模型大小 | SenseVoiceSmall 已最快 | 换用大模型会变慢（速度-精度权衡） |
| HTTP 并发 | ThreadingHTTPServer（已修复） | 前面版本是单线程 |
| 内存 tempfile | 已去除（直接传 bytes） | — |

**推荐的云端 ASR 替代方案**（参考 XiaoZhi 支持列表）：
- 豆包 ASR（火山引擎）
- 阿里云语音识别
- 腾讯云语音识别
- Sherpa-ONNX（本地，支持 streaming）

## Piper TTS

`bin/piper/` 目录下的本地 ONNX TTS。模型：`zh_CN-huayan-medium.onnx`。通过子进程调用：
```
echo "text" | ./piper --model model.onnx --output_file - --espeak_data espeak-ng-data --quiet
```
输出 22050Hz、16-bit、单声道 WAV。
