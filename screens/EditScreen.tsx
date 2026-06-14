import React, { useEffect } from 'react'
import { View, ActivityIndicator, StyleSheet } from 'react-native'
import type { EditScreenProps } from '../navigation/types'

export default function EditScreen({ navigation, route }: EditScreenProps) {
  const { shareId } = route.params

  useEffect(() => {
    // CreateScreen に fromShareId を渡して編集モードで動かす
    navigation.replace('Create', { fromShareId: shareId })
  }, [])

  return (
    <View style={styles.center}>
      <ActivityIndicator size="large" color="#e97316" />
    </View>
  )
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f5f5f5' },
})
