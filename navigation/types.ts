import type { NativeStackScreenProps } from '@react-navigation/native-stack'

export type RootStackParamList = {
  Home: undefined
  Create: { fromShareId?: string; templateId?: string; copyFromShareId?: string }
  Room: { shareId: string }
  Edit: { shareId: string }
  History: undefined
  Templates: undefined
}

export type HomeScreenProps = NativeStackScreenProps<RootStackParamList, 'Home'>
export type CreateScreenProps = NativeStackScreenProps<RootStackParamList, 'Create'>
export type RoomScreenProps = NativeStackScreenProps<RootStackParamList, 'Room'>
export type EditScreenProps = NativeStackScreenProps<RootStackParamList, 'Edit'>
export type HistoryScreenProps = NativeStackScreenProps<RootStackParamList, 'History'>
export type TemplatesScreenProps = NativeStackScreenProps<RootStackParamList, 'Templates'>
