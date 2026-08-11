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
import { Colors } from '../theme/colors'

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
    return <View style={styles.center}><ActivityIndicator size="large" color={Colors.primary} /></View>
  }

  return (
    <FlatList
      data={items}
      keyExtractor={(item) => item.share_id}
      contentContainerStyle={items.length === 0 ? styles.emptyContainer : styles.listContent}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => loadHistory(true)} tintColor={Colors.primary} />}
      ListHeaderComponent={
        items.length > 0 ? (
          <View style={styles.guidanceBanner}>
            <Text style={styles.guidanceText}>📋 タップで結果確認、「コピーして作成」で同じメンバー構成の新規精算をすぐに始められます</Text>
          </View>
        ) : null
      }
      ListEmptyComponent={
        <View style={styles.emptyBox}>
          <Text style={styles.emptyIcon}>📋</Text>
          <Text style={styles.emptyTitle}>履歴がありません</Text>
          <Text style={styles.emptyDesc}>精算を作成して「履歴に保存」すると、ここから内容をコピーして新規精算をすぐに始められます</Text>
          <TouchableOpacity style={styles.emptyBtn} onPress={() => navigation.navigate('Create', {})}>
            <Text style={styles.emptyBtnText}>新規精算を作成</Text>
          </TouchableOpacity>
        </View>
      }
      renderItem={({ item }) => (
        <View style={styles.card}>
          <TouchableOpacity style={styles.cardMain} onPress={() => navigation.navigate('Room', { shareId: item.share_id })} activeOpacity={0.8}>
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
            <Text style={styles.cardCreated}>{new Date(item.created_at).toLocaleDateString('ja-JP')} 作成</Text>
          </TouchableOpacity>
          <View style={styles.cardBottom}>
            <TouchableOpacity
              style={styles.copyBtn}
              onPress={() => navigation.navigate('Create', { copyFromShareId: item.share_id })}
            >
              <Text style={styles.copyBtnText}>📋 コピーして新規作成</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.deleteBtn} onPress={() => handleDelete(item.share_id)}>
              <Text style={styles.deleteBtnText}>削除</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    />
  )
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.background },
  listContent: { padding: 16, gap: 12 },
  emptyContainer: { flex: 1, padding: 16 },
  guidanceBanner: { backgroundColor: Colors.successLight, borderRadius: 12, padding: 12, marginBottom: 4, borderWidth: 1, borderColor: Colors.success },
  guidanceText: { fontSize: 12, color: Colors.success, lineHeight: 18 },
  emptyBox: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingTop: 80 },
  emptyIcon: { fontSize: 48, marginBottom: 12 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: Colors.text, marginBottom: 8 },
  emptyDesc: { fontSize: 14, color: Colors.placeholder, textAlign: 'center', marginBottom: 24, paddingHorizontal: 20, lineHeight: 22 },
  emptyBtn: { backgroundColor: Colors.primary, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 24 },
  emptyBtnText: { color: Colors.textOnPrimary, fontSize: 15, fontWeight: '700' },
  card: { backgroundColor: Colors.card, borderRadius: 14, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 6, elevation: 2, overflow: 'hidden' },
  cardMain: { padding: 16 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 },
  cardInfo: { flex: 1 },
  cardDate: { fontSize: 15, fontWeight: '700', color: Colors.text, marginBottom: 4 },
  cardDateGray: { fontSize: 15, fontWeight: '700', color: Colors.placeholder, marginBottom: 4 },
  cardMeta: { fontSize: 12, color: Colors.placeholder },
  cardRight: { alignItems: 'flex-end' },
  cardTotal: { fontSize: 20, fontWeight: '800', color: Colors.primary },
  cardUnit: { fontSize: 12, fontWeight: '400', color: Colors.placeholder },
  cardCreated: { fontSize: 11, color: Colors.placeholder },
  cardBottom: { flexDirection: 'row', alignItems: 'center', borderTopWidth: 1, borderTopColor: Colors.border },
  copyBtn: { flex: 1, paddingVertical: 11, paddingHorizontal: 14, borderRightWidth: 1, borderRightColor: Colors.border },
  copyBtnText: { fontSize: 13, color: Colors.info, fontWeight: '600' },
  deleteBtn: { paddingVertical: 11, paddingHorizontal: 16 },
  deleteBtnText: { fontSize: 12, color: Colors.error, fontWeight: '600' },
})
