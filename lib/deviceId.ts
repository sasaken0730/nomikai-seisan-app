import AsyncStorage from '@react-native-async-storage/async-storage'

const DEVICE_ID_KEY = 'nomikai_device_id'

export async function getDeviceId(): Promise<string> {
  const existing = await AsyncStorage.getItem(DEVICE_ID_KEY)
  if (existing) return existing
  const newId = Math.random().toString(36).substring(2) + Date.now().toString(36)
  await AsyncStorage.setItem(DEVICE_ID_KEY, newId)
  return newId
}
