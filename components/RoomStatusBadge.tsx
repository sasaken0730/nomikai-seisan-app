import React from 'react'
import { View, Text, StyleSheet, type ViewStyle } from 'react-native'
import { Colors } from '../theme/colors'

export default function RoomStatusBadge({ isComplete, style }: { isComplete: boolean; style?: ViewStyle }) {
  return (
    <View style={[styles.badge, isComplete ? styles.badgeComplete : styles.badgeWip, style]}>
      <Text style={[styles.badgeText, isComplete ? styles.badgeTextComplete : styles.badgeTextWip]}>
        {isComplete ? '✓ 精算完了' : '作業中'}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  badge: { borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 },
  badgeComplete: { backgroundColor: Colors.primaryLight },
  badgeWip: { backgroundColor: Colors.background, borderWidth: 1, borderColor: Colors.border },
  badgeText: { fontSize: 11, fontWeight: '700' },
  badgeTextComplete: { color: Colors.primary },
  badgeTextWip: { color: Colors.textSecondary },
})
