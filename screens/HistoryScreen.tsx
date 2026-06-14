import React, { useState, useCallback } from 'react'
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity,
  ActivityIndicator, Alert, RefreshControl,
} from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import type { HistoryScreenProps } from '../navigation/types'
import { supabase } from '../lib/supabase'
import { getDeviceId } from '../lib/deviceId'
import { deleteRoom } from '../lib/actions'

interface HistoryItem {
  share_id: string
  event_date: string | null
  tilt_ratio: number
  created_at: string
  participantCount: number
  grandTotal: number
}

export default function HistoryScreen({ navigation }: HistoryScreenProps) {
  const [items, setItems] = useState<HistoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  useFocusEffect(
    useCallback(() => {
      loadHistory()
    }, [])
  )

  async function loadHistory(isRefresh = false) {
    if (isRefresh) setRefreshing(true)
    else setLoading(true)
    try {
      const deviceId = await getDeviceId()
      const { data: rooms } = await supabase
        .from('nomikai_seisan_rooms')
        .select('id, share_id, event_date, tilt_ratio, created_at')
        .eq('created_by_device_id', deviceId)
        .eq('is_saved', true)
        .order('created_at', { ascending: false })
        .limit(50)

      if (!rooms) { setItems([]); return }

      const enriched: HistoryItem[] = await Promise.all(
        rooms.map(async (room) => {
          const [{ count: participantCount }, { data: events }] = await Promise.all([
            supabase.from('nomikai_seisan_participants').select('*', { count: 'exact', head: true }).eq('room_id', room.id),
            supabase.from('nomikai_seisan_events').select('total_amount').eq('room_id', room.id),
          ])
          const grandTotal = (events ?? []).reduce((s, e) => s + (e.total_amount as number), 0)
          return {
            share_id: room.share_id as string,
            event_date: room.event_date as string | null,
            tilt_ratio: (room.tilt_ratio as number) ?? 2.0,
            created_at: room.created_at as string,
            participantCount: participantCount ?? 0,
            grandTotal,
          }
        })
      )
      setItems(enriched)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  const handleDelete = (shareId: string) => {
    Alert.alert('削除確認', 'この精算を削除しますか？', [
      { text: 'キャンセル', style: 'cancel' },
      {
        text: '削除', style: 'destructive', onPress: async () => {
          try {
            await deleteRoom(shareId)
            setItems((prev) => prev.filter((i) => i.share_id !== shareId))
          } catch (e) {
            Alert.alert('エラー', e instanceof Error ? e.message : '削除に失敗しました')
          }
        },
      },
    ])
  }

  if (loading) {
    return <View style={styles.center}><ActivityIndicator size="large" color="#e97316" /></View>
  }

  return (
    <FlatList
      data={items}
      keyExtractor={(item) => item.share_id}
      contentContainerStyle={items.length === 0 ? styles.emptyContainer : styles.listContent}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => loadHistory(true)} tintColor="#e97316" />}
      ListEmptyComponent={
        <View style={styles.emptyBox}>
          <Text style={styles.emptyIcon}>📋</Text>
          <Text style={styles.emptyTitle}>履歴がありません</Text>
          <Text style={styles.emptyDesc}>精算を作成して「履歴に保存」すると表示されます</Text>
          <TouchableOpacity style={styles.emptyBtn} onPress={() => navigation.navigate('Create', {})}>
            <Text style={styles.emptyBtnText}>新規精算を作成</Text>
          </TouchableOpacity>
        </View>
      }
      renderItem={({ item }) => (
        <TouchableOpacity style={styles.card} onPress={() => navigation.navigate('Room', { shareId: item.share_id })} activeOpacity={0.8}>
          <View style={styles.cardTop}>
            <View style={styles.cardInfo}>
              {item.event_date ? (
                <Text style={styles.cardDate}>{item.event_date}</Text>
              ) : (
                <Text style={styles.cardDateGray}>日付なし</Text>
              )}
              <Text style={styles.cardMeta}>{item.participantCount}名 · 傾斜{item.tilt_ratio.toFixed(1)}倍</Text>
            </View>
            <View style={styles.cardRight}>
              <Text style={styles.cardTotal}>{item.grandTotal.toLocaleString()}<Text style={styles.cardUnit}>円</Text></Text>
            </View>
          </View>
          <View style={styles.cardBottom}>
            <Text style={styles.cardCreated}>{new Date(item.created_at).toLocaleDateString('ja-JP')} 作成</Text>
            <TouchableOpacity style={styles.deleteBtn} onPress={() => handleDelete(item.share_id)}>
              <Text style={styles.deleteBtnText}>削除</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      )}
    />
  )
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f5f5f5' },
  listContent: { padding: 16, gap: 12 },
  emptyContainer: { flex: 1, padding: 16 },
  emptyBox: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingTop: 80 },
  emptyIcon: { fontSize: 48, marginBottom: 12 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: '#374151', marginBottom: 8 },
  emptyDesc: { fontSize: 14, color: '#9ca3af', textAlign: 'center', marginBottom: 24, paddingHorizontal: 20 },
  emptyBtn: { backgroundColor: '#e97316', borderRadius: 12, paddingVertical: 12, paddingHorizontal: 24 },
  emptyBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  card: { backgroundColor: '#fff', borderRadius: 14, padding: 16, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 6, elevation: 2 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 },
  cardInfo: { flex: 1 },
  cardDate: { fontSize: 15, fontWeight: '700', color: '#1a1a2e', marginBottom: 4 },
  cardDateGray: { fontSize: 15, fontWeight: '700', color: '#9ca3af', marginBottom: 4 },
  cardMeta: { fontSize: 12, color: '#9ca3af' },
  cardRight: { alignItems: 'flex-end' },
  cardTotal: { fontSize: 20, fontWeight: '800', color: '#e97316' },
  cardUnit: { fontSize: 12, fontWeight: '400', color: '#9ca3af' },
  cardBottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderTopWidth: 1, borderTopColor: '#f3f4f6', paddingTop: 10 },
  cardCreated: { fontSize: 11, color: '#d1d5db' },
  deleteBtn: { paddingVertical: 4, paddingHorizontal: 10 },
  deleteBtnText: { fontSize: 12, color: '#dc2626', fontWeight: '600' },
})
