import React, { useState, useCallback } from 'react'
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import * as Haptics from 'expo-haptics'
import type { HomeScreenProps } from '../navigation/types'
import { getDeviceId } from '../lib/deviceId'
import { getRecentRooms, type RoomSummary } from '../lib/actions'
import { Colors } from '../theme/colors'
import RoomStatusBadge from '../components/RoomStatusBadge'

const RECENT_ROOM_LIMIT = 10

export default function HomeScreen({ navigation }: HomeScreenProps) {
  const [recentRooms, setRecentRooms] = useState<RoomSummary[]>([])

  useFocusEffect(
    useCallback(() => {
      let cancelled = false
      ;(async () => {
        try {
          const deviceId = await getDeviceId()
          const rooms = await getRecentRooms(deviceId, RECENT_ROOM_LIMIT)
          if (!cancelled) setRecentRooms(rooms)
        } catch (e) {
          console.warn('[home] 最近のルームの取得に失敗しました', e)
        }
      })()
      return () => { cancelled = true }
    }, [])
  )

  const goTo = (screen: 'Create' | 'History' | 'Templates') => {
    Haptics.selectionAsync()
    if (screen === 'Create') navigation.navigate('Create', {})
    else navigation.navigate(screen)
  }

  // 精算完了のルームは結果画面へ、作業中のルームは従来どおり入力画面で再開
  const openRoom = (room: RoomSummary) => {
    Haptics.selectionAsync()
    if (room.isComplete) navigation.navigate('Room', { shareId: room.share_id })
    else navigation.navigate('Create', { resumeDraftShareId: room.share_id })
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.hero}>
        <Text style={styles.title}>⚖️ 傾斜精算くん</Text>
        <Text style={styles.subtitle}>役職・年次に応じた飲み会精算</Text>
      </View>

      <View style={styles.grid}>
        <TouchableOpacity style={[styles.card, styles.primaryCard]} onPress={() => goTo('Create')}>
          <Text style={styles.cardIcon}>＋</Text>
          <Text style={styles.cardTitle}>新規精算</Text>
          <Text style={styles.cardDesc}>参加者とイベントを入力して精算</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.card} onPress={() => goTo('History')}>
          <Text style={[styles.cardIcon, styles.darkIcon]}>📋</Text>
          <Text style={[styles.cardTitle, styles.darkTitle]}>履歴</Text>
          <Text style={styles.cardDescDark}>これまでの精算をすべて確認</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.card} onPress={() => goTo('Templates')}>
          <Text style={[styles.cardIcon, styles.darkIcon]}>📂</Text>
          <Text style={[styles.cardTitle, styles.darkTitle]}>テンプレート</Text>
          <Text style={styles.cardDescDark}>よく使う設定を再利用</Text>
        </TouchableOpacity>
      </View>

      {recentRooms.length > 0 && (
        <View style={styles.recentSection}>
          <Text style={styles.recentTitle}>最近のルーム</Text>
          <View style={styles.recentList}>
            {recentRooms.map((room, idx) => (
              <TouchableOpacity
                key={room.share_id}
                style={[styles.recentRow, idx < recentRooms.length - 1 && styles.recentRowBorder]}
                onPress={() => openRoom(room)}
                activeOpacity={0.7}
              >
                <View style={styles.flex1}>
                  <Text style={[styles.recentName, !room.event_date && styles.recentNameGray]} numberOfLines={1}>
                    {room.event_date || '名前なし'}
                  </Text>
                  <Text style={styles.recentMeta}>
                    {new Date(room.created_at).toLocaleDateString('ja-JP')} · {room.participantCount}名
                    {room.grandTotal > 0 ? ` · ${room.grandTotal.toLocaleString()}円` : ''}
                  </Text>
                </View>
                <RoomStatusBadge isComplete={room.isComplete} />
                <Text style={styles.recentArrow}>›</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  content: {
    padding: 20,
    paddingBottom: 40,
  },
  hero: {
    alignItems: 'center',
    paddingVertical: 32,
  },
  title: {
    fontSize: 32,
    fontWeight: '800',
    color: Colors.primary,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 15,
    color: Colors.textSecondary,
    marginTop: 6,
  },
  grid: {
    gap: 14,
  },
  flex1: { flex: 1 },
  recentSection: { marginTop: 24 },
  recentTitle: { fontSize: 14, fontWeight: '700', color: Colors.text, marginBottom: 8, paddingHorizontal: 4 },
  recentList: {
    backgroundColor: Colors.card, borderRadius: 16, paddingHorizontal: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.07, shadowRadius: 8, elevation: 2,
  },
  recentRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, gap: 8 },
  recentRowBorder: { borderBottomWidth: 1, borderBottomColor: Colors.border },
  recentName: { fontSize: 14, fontWeight: '700', color: Colors.text },
  recentNameGray: { color: Colors.placeholder },
  recentMeta: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  recentArrow: { fontSize: 20, color: Colors.placeholder, fontWeight: '700' },
  card: {
    backgroundColor: Colors.card,
    borderRadius: 16,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07,
    shadowRadius: 8,
    elevation: 2,
  },
  primaryCard: {
    backgroundColor: Colors.primary,
  },
  cardIcon: {
    fontSize: 28,
    color: Colors.textOnPrimary,
    marginBottom: 8,
  },
  darkIcon: {
    fontSize: 28,
    color: Colors.primary,
    marginBottom: 8,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.textOnPrimary,
    marginBottom: 4,
  },
  darkTitle: {
    color: Colors.primary,
  },
  cardDesc: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.7)',
  },
  cardDescDark: {
    fontSize: 13,
    color: Colors.textSecondary,
  },
})
