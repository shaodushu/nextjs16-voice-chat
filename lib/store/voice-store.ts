import { create } from 'zustand'
import type { ConversationTurn } from '@/types/voice'
import { AudioState, Emotion } from '@/types/voice'

interface VoiceStore {
  mode: 'local' | 'cloud'
  audioState: AudioState
  messages: ConversationTurn[]
  isRecording: boolean
  transcript: string
  currentEmotion: Emotion
  isInterrupted: boolean
  wsConnected: boolean
  streamingText: string
  setMode: (mode: 'local' | 'cloud') => void
  setAudioState: (state: AudioState) => void
  setIsRecording: (v: boolean) => void
  setTranscript: (t: string) => void
  addMessage: (msg: ConversationTurn) => void
  setCurrentEmotion: (e: Emotion) => void
  setIsInterrupted: (v: boolean) => void
  setWsConnected: (v: boolean) => void
  setStreamingText: (t: string) => void
  appendStreamingText: (t: string) => void
}

export const useVoiceStore = create<VoiceStore>((set) => ({
  mode: 'local',
  audioState: AudioState.Idle,
  messages: [],
  isRecording: false,
  transcript: '',
  currentEmotion: Emotion.Neutral,
  isInterrupted: false,
  wsConnected: false,
  streamingText: '',
  setMode: (mode) => set({ mode }),
  setAudioState: (audioState) => set({ audioState }),
  setIsRecording: (isRecording) => set({ isRecording }),
  setTranscript: (transcript) => set({ transcript }),
  addMessage: (msg) => set((s) => ({ messages: [...s.messages, msg] })),
  setCurrentEmotion: (currentEmotion) => set({ currentEmotion }),
  setIsInterrupted: (isInterrupted) => set({ isInterrupted }),
  setWsConnected: (wsConnected) => set({ wsConnected }),
  setStreamingText: (streamingText) => set({ streamingText }),
  appendStreamingText: (t) => set((s) => ({ streamingText: s.streamingText + t })),
}))
