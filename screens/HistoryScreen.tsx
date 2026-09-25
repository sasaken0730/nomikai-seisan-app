import React, { useState, useCallback } from 'react'
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity,
  ActivityIndicator, Alert, RefreshControl,
} from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import type { HistoryScreenProps } from '../navigation/types'
import { getDeviceId } from '../lib/deviceId'
import { deleteRoom, getRecentRooms, type RoomSummary } from '../lib/actions'
import { Colors } from '../theme/colors'
import RoomStatusBadge from '../components/RoomStatusBadge'

const HISTORY_LIMIT = 100

export default function HistoryScreen({ navigation }: HistoryScreenProps) {
  const [items, setItems] = useState<RoomSummary[]>([])
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
      setItems(await getRecentRooms(deviceId, HISTORY_LIMIT))
    } catch (e) {
      console.warn('[history] 履歴の取得に失敗しました', e)
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

  // 精算完了のルームは結果画面へ、作業中のルームは入力画面で再開
  const openRoom = (item: RoomSummary) => {
    if (item.isComplete) navigation.navigate('Room', { shareId: item.share_id })
    else navigation.navigate('Create', { resumeDraftShareId: item.share_id })
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
            <Text style={styles.guidanceText}>📋 タップで結果確認、「👥 このメンバーをベースに新しく作る」で同じメンバーの新規精算をすぐに始められます</Text>
          </View>
        ) : null
      }
      ListEmptyComponent={
        <View style={styles.emptyBox}>
          <Text style={styles.emptyIcon}>📋</Text>
          <Text style={styles.emptyTitle}>履歴がありません</Text>
          <Text style={styles.emptyDesc}>作成した精算はここに一覧表示され、同じメンバーで新しい精算をすぐに始められます</Text>
          <TouchableOpacity style={styles.emptyBtn} onPress={() => navigation.navigate('Create', {})}>
            <Text style={styles.emptyBtnText}>新規精算を作成</Text>
          </TouchableOpacity>
        </View>
      }
      renderItem={({ item }) => (
        <View style={styles.card}>
          <TouchableOpacity style={styles.cardMain} onPress={() => openRoom(item)} activeOpacity={0.8}>
            <View style={styles.cardTop}>
              <View style={styles.cardInfo}>
                {item.event_date ? (
                  <Text style={styles.cardDate}>{item.event_date}</Text>
                ) : (
                  <Text style={styles.cardDateGray}>日付なし</Text>
                )}
                <Text style={styles.cardMeta}>{item.participantCount}名 · 傾斜{item.tilt_ratio.toFixed(1)}倍</Text>
                <RoomStatusBadge isComplete={item.isComplete} style={styles.cardBadge} />
              </View>
              <View style={styles.cardRight}>
                <Text style={styles.cardTotal}>{item.grandTotal.toLocaleString()}<Text style={styles.cardUnit}>円</Text></Text>
              </View>
            </View>
            <Text style={styles.cardCreated}>{new Date(item.created_at).toLocaleDateString('ja-JP')} 作成</Text>
          </TouchableOpacity>
          {item.participantCount > 0 && (
            <TouchableOpacity
              style={styles.baseMembersBtn}
              onPress={() => navigation.navigate('Create', { baseMembersFromShareId: item.share_id })}
            >
              <Text style={styles.baseMembersBtnText}>👥 このメンバーをベースに新しく作る</Text>
            </TouchableOpacity>
          )}
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
  cardBadge: { alignSelf: 'flex-start', marginTop: 6 },
  baseMembersBtn: { marginHorizontal: 16, marginBottom: 12, backgroundColor: Colors.primary, borderRadius: 10, paddingVertical: 11, alignItems: 'center' },
  baseMembersBtnText: { fontSize: 14, color: Colors.textOnPrimary, fontWeight: '700' },
  cardBottom: { flexDirection: 'row', alignItems: 'center', borderTopWidth: 1, borderTopColor: Colors.border },
  copyBtn: { flex: 1, paddingVertical: 11, paddingHorizontal: 14, borderRightWidth: 1, borderRightColor: Colors.border },
  copyBtnText: { fontSize: 13, color: Colors.info, fontWeight: '600' },
  deleteBtn: { paddingVertical: 11, paddingHorizontal: 16 },
  deleteBtnText: { fontSize: 12, color: Colors.error, fontWeight: '600' },
})
