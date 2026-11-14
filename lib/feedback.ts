import AsyncStorage from '@react-native-async-storage/async-storage'
import { Platform } from 'react-native'
import Constants from 'expo-constants'
import { supabase } from './supabase'
import { getDeviceId } from './deviceId'

const LAST_SUBMITTED_KEY = 'feedback_last_submitted_at'
// 一度送ってくれた人に毎回出すとしつこいので、しばらく出さない
const SUPPRESS_MS = 90 * 24 * 60 * 60 * 1000

export interface FeedbackInput {
  /** 1〜5。未選択なら null（コメントだけでも送れる）。 */
  rating: number | null
  comment: string
  roomId?: string | null
}

/** 直近に送信済みならフォームを出さない。読み取りに失敗したときは出す側に倒す。 */
export async function shouldShowFeedbackForm(): Promise<boolean> {
  try {
    const last = await AsyncStorage.getItem(LAST_SUBMITTED_KEY)
    if (!last) return true
    return Date.now() - new Date(last).getTime() >= SUPPRESS_MS
  } catch {
    return true
  }
}

/**
 * 評価・改善要望を送信する。評価とコメントのどちらか一方だけでも送れる。
 * RLS で anon は INSERT のみ許可されているため、結果の読み戻し（.select()）はしない。
 */
export async function submitFeedback(input: FeedbackInput): Promise<void> {
  const comment = input.comment.trim()
  if (input.rating == null && comment === '') {
    throw new Error('評価か内容のどちらかを入力してください')
  }

  const { error } = await supabase.from('nomikai_seisan_feedback').insert({
    device_id: await getDeviceId(),
    room_id: input.roomId ?? null,
    rating: input.rating,
    comment: comment || null,
    app_version: Constants.expoConfig?.version ?? null,
    platform: Platform.OS,
  })
  if (error) throw new Error(error.message)

  await AsyncStorage.setItem(LAST_SUBMITTED_KEY, new Date().toISOString())
}
