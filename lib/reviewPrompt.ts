import AsyncStorage from '@react-native-async-storage/async-storage'
import * as StoreReview from 'expo-store-review'

const COMPLETION_COUNT_KEY = 'settlement_completion_count'
const LAST_PROMPT_DATE_KEY = 'last_review_prompt_date'

const MIN_COMPLETIONS = 3
const MIN_INTERVAL_MS = 30 * 24 * 60 * 60 * 1000

// 精算完了（ルームが自動保存された瞬間）を1回カウントし、条件を満たせばレビュー依頼を出す。
// 年3回までの表示制限は iOS 側が行うため、ここでは「依頼する」だけ。
export async function recordSettlementCompletion(): Promise<void> {
  try {
    const count = Number(await AsyncStorage.getItem(COMPLETION_COUNT_KEY) ?? '0') + 1
    await AsyncStorage.setItem(COMPLETION_COUNT_KEY, String(count))

    const lastPrompt = await AsyncStorage.getItem(LAST_PROMPT_DATE_KEY)
    const elapsed = lastPrompt ? Date.now() - new Date(lastPrompt).getTime() : Infinity
    const shouldPrompt = count >= MIN_COMPLETIONS && elapsed >= MIN_INTERVAL_MS
    if (__DEV__) {
      console.log('[reviewPrompt]', { count, lastPrompt, shouldPrompt })
    }
    if (!shouldPrompt) return
    if (!(await StoreReview.isAvailableAsync())) return

    await AsyncStorage.setItem(LAST_PROMPT_DATE_KEY, new Date().toISOString())
    await StoreReview.requestReview()
  } catch (e) {
    console.warn('[reviewPrompt] レビュー依頼に失敗しました', e)
  }
}
