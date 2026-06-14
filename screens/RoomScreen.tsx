import React, { useState, useEffect } from 'react'
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, Share,
  ActivityIndicator, Alert, Platform,
} from 'react-native'
import type { RoomScreenProps } from '../navigation/types'
import { supabase } from '../lib/supabase'
import { applyRoundingPerEvent, type ParticipantInput, type EventInput } from '../lib/calculations'
import { updateRoomSaved, saveTemplate } from '../lib/actions'
import { getDeviceId } from '../lib/deviceId'

type Unit = 1 | 500 | 1000

interface RoomData {
  id: string
  event_date: string | null
  tilt_ratio: number
  manual_mode: boolean
  is_saved: boolean
  created_at: string
}

export default function RoomScreen({ navigation, route }: RoomScreenProps) {
  const { shareId } = route.params
  const [room, setRoom] = useState<RoomData | null>(null)
  const [participants, setParticipants] = useState<ParticipantInput[]>([])
  const [events, setEvents] = useState<EventInput[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [savingTemplate, setSavingTemplate] = useState(false)
  const [unit, setUnit] = useState<Unit>(500)
  const [activeTab, setActiveTab] = useState<'result' | 'detail'>('result')

  useEffect(() => {
    loadRoom()
  }, [shareId])

  async function loadRoom() {
    setLoading(true)
    try {
      const { data: roomData } = await supabase.from('nomikai_seisan_rooms').select('*').eq('share_id', shareId).single()
      if (!roomData) { Alert.alert('エラー', '精算ルームが見つかりません'); navigation.goBack(); return }

      const { data: rawParticipants } = await supabase.from('nomikai_seisan_participants').select('*').eq('room_id', roomData.id).order('created_at', { ascending: true })
      const { data: rawEvents } = await supabase.from('nomikai_seisan_events').select('*').eq('room_id', roomData.id).order('sort_order', { ascending: true })
      const eventIds = (rawEvents ?? []).map((e) => e.id as string)
      const { data: rawAttendances } = eventIds.length
        ? await supabase.from('nomikai_seisan_event_attendances').select('event_id, participant_id').in('event_id', eventIds)
        : { data: [] }

      setRoom({
        id: roomData.id as string,
        event_date: roomData.event_date as string | null,
        tilt_ratio: (roomData.tilt_ratio as number) ?? 2.0,
        manual_mode: (roomData.manual_mode as boolean) ?? false,
        is_saved: (roomData.is_saved as boolean) ?? false,
        created_at: roomData.created_at as string,
      })
      setParticipants((rawParticipants ?? []).map((p) => ({
        id: p.id as string,
        name: p.name as string,
        role: p.role as string,
        tenure_years: p.tenure_years as number | null,
        fixed_amount: p.fixed_amount as number | null,
        is_organizer: p.is_organizer as boolean,
        manual_multiplier: (p.manual_multiplier as number | null) ?? 1,
      })))
      setEvents((rawEvents ?? []).map((e) => ({
        id: e.id as string,
        name: e.event_name as string,
        amount: e.total_amount as number,
        splitMode: (e.split_mode as string) === 'equal' ? 'equal' : 'tilt',
        attendeeIds: (rawAttendances ?? []).filter((a) => a.event_id === e.id).map((a) => a.participant_id as string),
      })))
    } finally {
      setLoading(false)
    }
  }

  const handleShare = async () => {
    const webUrl = `https://nomikai-seisan.vercel.app/room/${shareId}`
    try {
      await Share.share({ message: `傾斜精算の結果\n${webUrl}`, url: webUrl })
    } catch {}
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      await updateRoomSaved(shareId)
      setRoom((r) => r ? { ...r, is_saved: true } : r)
      Alert.alert('保存しました', '履歴ページに表示されます')
    } catch (e) {
      Alert.alert('エラー', e instanceof Error ? e.message : '保存に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  const handleSaveTemplate = async () => {
    if (!room) return
    Alert.prompt(
      'テンプレート名',
      '保存するテンプレート名を入力してください',
      async (name) => {
        if (!name?.trim()) return
        setSavingTemplate(true)
        try {
          const deviceId = await getDeviceId()
          await saveTemplate({
            deviceId,
            templateName: name.trim(),
            tiltRatio: room.tilt_ratio,
            manualMode: room.manual_mode,
            participantsData: participants.map((p) => ({
              name: p.name,
              role: p.role,
              tenure_years: p.tenure_years,
              is_organizer: p.is_organizer,
              manual_multiplier: p.manual_multiplier ?? 1,
            })),
            eventsData: events.map((e) => ({ name: e.name, split_mode: e.splitMode ?? 'tilt' })),
          })
          Alert.alert('保存しました', 'テンプレートに保存しました')
        } catch (e) {
          Alert.alert('エラー', e instanceof Error ? e.message : '保存に失敗しました')
        } finally {
          setSavingTemplate(false)
        }
      },
      'plain-text',
      ''
    )
  }

  if (loading) {
    return <View style={styles.center}><ActivityIndicator size="large" color="#e97316" /></View>
  }

  if (!room || participants.length === 0) {
    return <View style={styles.center}><Text style={styles.emptyText}>データが見つかりません</Text></View>
  }

  const gradient = room.tilt_ratio
  const manualMode = room.manual_mode
  const results = applyRoundingPerEvent(participants, events, unit, gradient, manualMode)
  const grandTotal = events.reduce((s, e) => s + e.amount, 0)
  const activeEvents = events.filter((e) => e.amount > 0)

  const sortedResults = [...results].sort((a, b) => b.payment - a.payment)

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* ヘッダー */}
      <View style={styles.header}>
        <Text style={styles.headerIcon}>🎉</Text>
        <Text style={styles.headerTitle}>傾斜精算</Text>
        {room.event_date && <Text style={styles.headerSub}>📅 {room.event_date}</Text>}
        <Text style={styles.headerSub}>参加者 {participants.length}名</Text>
        <View style={styles.headerBadge}>
          <Text style={styles.headerBadgeText}>⚖️ 傾斜 {gradient.toFixed(1)}倍</Text>
        </View>
      </View>

      {/* 金額サマリー */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.summaryScroll}>
        <View style={styles.summaryRow}>
          {activeEvents.map((e) => (
            <View key={e.id} style={styles.summaryCard}>
              <Text style={styles.summaryLabel} numberOfLines={1}>{e.name}</Text>
              <Text style={styles.summaryAmount}>{e.amount.toLocaleString()}<Text style={styles.summaryUnit}>円</Text></Text>
            </View>
          ))}
          {activeEvents.length > 1 && (
            <View style={[styles.summaryCard, styles.summaryTotalCard]}>
              <Text style={styles.summaryLabel}>合計</Text>
              <Text style={[styles.summaryAmount, styles.summaryTotalAmount]}>{grandTotal.toLocaleString()}<Text style={styles.summaryUnit}>円</Text></Text>
            </View>
          )}
        </View>
      </ScrollView>

      {/* 丸め単位 */}
      <View style={styles.card}>
        <Text style={styles.cardLabel}>丸め単位</Text>
        <View style={styles.unitRow}>
          {([1, 500, 1000] as Unit[]).map((u) => (
            <TouchableOpacity key={u} style={[styles.unitBtn, unit === u && styles.unitBtnActive]} onPress={() => setUnit(u)}>
              <Text style={[styles.unitBtnText, unit === u && styles.unitBtnTextActive]}>{u === 1 ? '1円' : `${u}円`}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* タブ */}
      <View style={styles.tabRow}>
        <TouchableOpacity style={[styles.tab, activeTab === 'result' && styles.tabActive]} onPress={() => setActiveTab('result')}>
          <Text style={[styles.tabText, activeTab === 'result' && styles.tabTextActive]}>精算金額</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.tab, activeTab === 'detail' && styles.tabActive]} onPress={() => setActiveTab('detail')}>
          <Text style={[styles.tabText, activeTab === 'detail' && styles.tabTextActive]}>内訳</Text>
        </TouchableOpacity>
      </View>

      {activeTab === 'result' && (
        <View style={styles.card}>
          {sortedResults.map((r, idx) => (
            <View key={r.id} style={[styles.resultRow, idx < sortedResults.length - 1 && styles.resultRowBorder]}>
              <View style={styles.resultLeft}>
                {r.is_organizer && <Text style={styles.organizerBadge}>幹事</Text>}
                <Text style={styles.resultName}>{r.name}</Text>
                <Text style={styles.resultRole}>{r.role}</Text>
              </View>
              <View style={styles.resultRight}>
                <Text style={styles.resultAmount}>{r.payment.toLocaleString()}<Text style={styles.resultUnit}>円</Text></Text>
                {Math.abs(r.payment - r.rawPayment) > 0.5 && (
                  <Text style={styles.resultRaw}>（本来 {Math.round(r.rawPayment).toLocaleString()}円）</Text>
                )}
              </View>
            </View>
          ))}
        </View>
      )}

      {activeTab === 'detail' && events.length > 1 && (
        <View style={styles.card}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View>
              <View style={styles.tableRow}>
                <Text style={[styles.tableCell, styles.tableHeaderCell, styles.tableNameCell]}>名前</Text>
                {events.map((e) => (
                  <Text key={e.id} style={[styles.tableCell, styles.tableHeaderCell, styles.tableAmountCell]}>{e.name}</Text>
                ))}
                <Text style={[styles.tableCell, styles.tableHeaderCell, styles.tableAmountCell]}>合計</Text>
              </View>
              {results.map((r) => (
                <View key={r.id} style={styles.tableRow}>
                  <Text style={[styles.tableCell, styles.tableNameCell]} numberOfLines={1}>{r.name}</Text>
                  {r.perEventPayment.map((amt, idx) => (
                    <Text key={idx} style={[styles.tableCell, styles.tableAmountCell]}>{amt != null ? amt.toLocaleString() : '—'}</Text>
                  ))}
                  <Text style={[styles.tableCell, styles.tableAmountCell, styles.tableTotalCell]}>{r.payment.toLocaleString()}</Text>
                </View>
              ))}
            </View>
          </ScrollView>
        </View>
      )}

      {activeTab === 'detail' && events.length === 1 && (
        <View style={styles.card}>
          <Text style={styles.hint}>イベントが1つの場合は内訳表示はありません</Text>
        </View>
      )}

      {/* アクションボタン群 */}
      <View style={styles.actionsCard}>
        <Text style={styles.actionsTitle}>共有・保存</Text>
        <TouchableOpacity style={styles.actionBtn} onPress={handleShare}>
          <Text style={styles.actionBtnText}>🔗 URLを共有</Text>
        </TouchableOpacity>
        {!room.is_saved && (
          <TouchableOpacity style={[styles.actionBtn, styles.actionBtnSave]} onPress={handleSave} disabled={saving}>
            {saving ? <ActivityIndicator color="#fff" /> : <Text style={[styles.actionBtnText, styles.actionBtnSaveText]}>💾 履歴に保存</Text>}
          </TouchableOpacity>
        )}
        {room.is_saved && (
          <View style={[styles.actionBtn, styles.actionBtnSaved]}>
            <Text style={[styles.actionBtnText, styles.actionBtnSavedText]}>✓ 履歴に保存済み</Text>
          </View>
        )}
        {Platform.OS === 'ios' && (
          <TouchableOpacity style={[styles.actionBtn, styles.actionBtnTemplate]} onPress={handleSaveTemplate} disabled={savingTemplate}>
            {savingTemplate ? <ActivityIndicator color="#fff" /> : <Text style={[styles.actionBtnText, styles.actionBtnTemplateText]}>📑 テンプレートとして保存</Text>}
          </TouchableOpacity>
        )}
      </View>

      <TouchableOpacity style={styles.editBtn} onPress={() => navigation.navigate('Edit', { shareId })}>
        <Text style={styles.editBtnText}>✏️ 精算内容を更新する</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.newBtn} onPress={() => navigation.navigate('Create', {})}>
        <Text style={styles.newBtnText}>↩ 新しい精算を始める</Text>
      </TouchableOpacity>

      <View style={{ height: 40 }} />
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  content: { padding: 16 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyText: { color: '#6b7280', fontSize: 15 },
  header: { backgroundColor: '#e97316', borderRadius: 16, padding: 20, marginBottom: 14, alignItems: 'center' },
  headerIcon: { fontSize: 36, marginBottom: 4 },
  headerTitle: { fontSize: 22, fontWeight: '800', color: '#fff' },
  headerSub: { fontSize: 13, color: 'rgba(255,255,255,0.8)', marginTop: 4 },
  headerBadge: { backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 4, marginTop: 8 },
  headerBadgeText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  summaryScroll: { marginBottom: 14 },
  summaryRow: { flexDirection: 'row', gap: 10, paddingVertical: 4 },
  summaryCard: { backgroundColor: '#fff', borderRadius: 12, padding: 12, minWidth: 100, alignItems: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4, elevation: 1 },
  summaryTotalCard: { backgroundColor: '#fff7ed', borderWidth: 1, borderColor: '#fed7aa' },
  summaryLabel: { fontSize: 11, color: '#9ca3af', marginBottom: 4 },
  summaryAmount: { fontSize: 18, fontWeight: '700', color: '#e97316' },
  summaryTotalAmount: { color: '#dc2626' },
  summaryUnit: { fontSize: 12, fontWeight: '400', color: '#9ca3af' },
  card: { backgroundColor: '#fff', borderRadius: 16, padding: 16, marginBottom: 14, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 6, elevation: 2 },
  cardLabel: { fontSize: 13, fontWeight: '600', color: '#6b7280', marginBottom: 10 },
  unitRow: { flexDirection: 'row', gap: 8 },
  unitBtn: { flex: 1, borderWidth: 2, borderColor: '#e5e7eb', borderRadius: 8, paddingVertical: 8, alignItems: 'center' },
  unitBtnActive: { borderColor: '#e97316', backgroundColor: '#e97316' },
  unitBtnText: { fontSize: 14, fontWeight: '600', color: '#9ca3af' },
  unitBtnTextActive: { color: '#fff' },
  tabRow: { flexDirection: 'row', backgroundColor: '#fff', borderRadius: 12, marginBottom: 14, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 1 },
  tab: { flex: 1, paddingVertical: 12, alignItems: 'center' },
  tabActive: { backgroundColor: '#e97316' },
  tabText: { fontSize: 14, fontWeight: '600', color: '#9ca3af' },
  tabTextActive: { color: '#fff' },
  resultRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, justifyContent: 'space-between' },
  resultRowBorder: { borderBottomWidth: 1, borderBottomColor: '#f3f4f6' },
  resultLeft: { flex: 1 },
  organizerBadge: { fontSize: 10, color: '#d97706', fontWeight: '700', backgroundColor: '#fef3c7', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, alignSelf: 'flex-start', marginBottom: 2 },
  resultName: { fontSize: 16, fontWeight: '700', color: '#1a1a2e' },
  resultRole: { fontSize: 12, color: '#9ca3af', marginTop: 2 },
  resultRight: { alignItems: 'flex-end' },
  resultAmount: { fontSize: 22, fontWeight: '800', color: '#e97316' },
  resultUnit: { fontSize: 13, fontWeight: '400', color: '#9ca3af' },
  resultRaw: { fontSize: 11, color: '#9ca3af', marginTop: 2 },
  tableRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#f3f4f6' },
  tableCell: { paddingVertical: 10, paddingHorizontal: 8, fontSize: 13, color: '#374151' },
  tableHeaderCell: { fontWeight: '700', color: '#6b7280', fontSize: 12, backgroundColor: '#f9fafb' },
  tableNameCell: { width: 80 },
  tableAmountCell: { width: 80, textAlign: 'right' },
  tableTotalCell: { fontWeight: '700', color: '#e97316' },
  actionsCard: { backgroundColor: '#fff', borderRadius: 16, padding: 16, marginBottom: 14, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 6, elevation: 2 },
  actionsTitle: { fontSize: 14, fontWeight: '700', color: '#374151', marginBottom: 10 },
  actionBtn: { borderWidth: 1.5, borderColor: '#e5e7eb', borderRadius: 10, paddingVertical: 12, alignItems: 'center', marginBottom: 8 },
  actionBtnText: { fontSize: 14, fontWeight: '600', color: '#374151' },
  actionBtnSave: { backgroundColor: '#1a1a2e', borderColor: '#1a1a2e' },
  actionBtnSaveText: { color: '#fff' },
  actionBtnSaved: { backgroundColor: '#f0fdf4', borderColor: '#bbf7d0' },
  actionBtnSavedText: { color: '#16a34a' },
  actionBtnTemplate: { backgroundColor: '#7c3aed', borderColor: '#7c3aed' },
  actionBtnTemplateText: { color: '#fff' },
  editBtn: { backgroundColor: '#f59e0b', borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginBottom: 10 },
  editBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  newBtn: { borderWidth: 2, borderColor: '#fed7aa', borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginBottom: 14 },
  newBtnText: { color: '#e97316', fontSize: 15, fontWeight: '700' },
  hint: { fontSize: 13, color: '#9ca3af', textAlign: 'center' },
})
