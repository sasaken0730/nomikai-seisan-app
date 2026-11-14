import AsyncStorage from '@react-native-async-storage/async-storage'

const DEVICE_ID_KEY = 'nomikai_device_id'

// 画面マウント時に複数の画面から同時に呼ばれるため、
// 「読む→無ければ作って書く」が並行実行されると別々のIDが生成され、
// ルームの保存に使われたIDと後続の検索に使うIDがずれてしまう
// （＝「過去のメンバー」が空になる）。
// 解決中のPromiseを共有し、解決後は値をキャッシュして常に同じIDを返す。
let cachedId: string | null = null
let inflight: Promise<string> | null = null

export async function getDeviceId(): Promise<string> {
  if (cachedId) return cachedId
  if (!inflight) {
    inflight = (async () => {
      const existing = await AsyncStorage.getItem(DEVICE_ID_KEY)
      if (existing) {
        cachedId = existing
        return existing
      }
      const newId = Math.random().toString(36).substring(2) + Date.now().toString(36)
      await AsyncStorage.setItem(DEVICE_ID_KEY, newId)
      cachedId = newId
      return newId
    })().finally(() => { inflight = null })
  }
  return inflight
}
