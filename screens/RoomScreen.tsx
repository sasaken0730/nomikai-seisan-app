import React, { useState, useEffect, useLayoutEffect, useRef } from 'react'
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  ActivityIndicator, Alert, Platform,
} from 'react-native'
import * as Haptics from 'expo-haptics'
import * as Clipboard from 'expo-clipboard'
import type { RoomScreenProps } from '../navigation/types'
import { supabase } from '../lib/supabase'
import { applyRoundingPerEvent, ROLE_EQUIVALENT_YEARS, type ParticipantInput, type EventInput } from '../lib/calculations'
import { updateRoomSaved, saveTemplate, isSettlementComplete } from '../lib/actions'
import { getDeviceId } from '../lib/deviceId'
import { recordSettlementCompletion } from '../lib/reviewPrompt'
import { Colors } from '../theme/colors'

type Unit = 500 | 1000
type SaveStatus = 'not_ready' | 'saving' | 'saved' | 'error'

const AUTO_SAVE_DELAY_MS = 3000

function getRoleBadgeLabel(role: string, tenureYears: number | null): string {
  const displayRole = role === 'その他役職' ? 'その他' : role.replace('クラス', '')
  const years =
    role !== 'その他役職' && ROLE_EQUIVALENT_YEARS[role] != null
      ? ROLE_EQUIVALENT_YEARS[role]
      : (tenureYears ?? 1)
  return `${displayRole}・${years}年`
}

const COMPARISON_GRADIENTS = [1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0] as const

// 全角文字は半角2文字分として扱い、LINE/メモ帳などプロポーショナルフォントでも
// できるだけ列が揃って見えるようにパディングする
function displayWidth(str: string): number {
  let w = 0
  for (const ch of str) {
    const code = ch.codePointAt(0) ?? 0
    const isWide =
      (code >= 0x1100 && code <= 0x115f) ||
      (code >= 0x2e80 && code <= 0xa4cf) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6)
    w += isWide ? 2 : 1
  }
  return w
}

function padEnd(str: string, width: number): string {
  return str + ' '.repeat(Math.max(1, width - displayWidth(str)))
}

function padStart(str: string, width: number): string {
  return ' '.repeat(Math.max(1, width - displayWidth(str))) + str
}

interface RoomData {
  id: string
  event_date: string | null
  tilt_ratio: number
  manual_mode: boolean
  is_saved: boolean
  created_at: string
}

function computeSettlement(
  results: { id: string; name: string; payment: number }[],
  events: { id: string; amount: number }[],
  payerByEventId: Record<string, string | null>
): { from: string; to: string; amount: number }[] {
  const balances = results.map((p) => {
    const totalPaid = events.reduce(
      (sum, ev) => sum + (ev.amount > 0 && payerByEventId[ev.id] === p.id ? ev.amount : 0),
      0
    )
    return { id: p.id, name: p.name, net: totalPaid - p.payment }
  })

  const creditors = balances.filter((b) => b.net > 0.5).sort((a, b) => b.net - a.net).map((b) => ({ ...b, rem: b.net }))
  const debtors = balances.filter((b) => b.net < -0.5).sort((a, b) => a.net - b.net).map((b) => ({ ...b, rem: -b.net }))
  const transfers: { from: string; to: string; amount: number }[] = []
  let ci = 0; let di = 0
  while (ci < creditors.length && di < debtors.length) {
    const amount = Math.min(creditors[ci].rem, debtors[di].rem)
    const rounded = Math.round(amount)
    if (rounded > 0) transfers.push({ from: debtors[di].name, to: creditors[ci].name, amount: rounded })
    creditors[ci].rem -= amount
    debtors[di].rem -= amount
    if (creditors[ci].rem < 0.5) ci++
    if (debtors[di].rem < 0.5) di++
  }
  return transfers
}

export default function RoomScreen({ navigation, route }: RoomScreenProps) {
  const { shareId } = route.params
  const [room, setRoom] = useState<RoomData | null>(null)
  const [participants, setParticipants] = useState<ParticipantInput[]>([])
  const [events, setEvents] = useState<EventInput[]>([])
  const [payerByEventId, setPayerByEventId] = useState<Record<string, string | null>>({})
  const [loading, setLoading] = useState(true)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('not_ready')
  const [savingTemplate, setSavingTemplate] = useState(false)
  const [unit, setUnit] = useState<Unit>(1000)
  const [selectedGradient, setSelectedGradient] = useState<number | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const showToast = (message: string) => {
    setToast(message)
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    toastTimerRef.current = setTimeout(() => setToast(null), 1800)
  }

  useEffect(() => {
    loadRoom()
  }, [shareId])

  // 精算が成立したら（参加者2人以上・合計金額 > 0）自動で履歴に保存する。
  // 保存済みのルームでは走らないので、開き直しても再保存・再カウントされない。
  const isReadyToSave =
    events.length >= 1 &&
    isSettlementComplete(participants.length, events.reduce((s, e) => s + e.amount, 0))

  useEffect(() => {
    if (!room) return
    if (room.is_saved) { setSaveStatus('saved'); return }
    if (!isReadyToSave) { setSaveStatus('not_ready'); return }
    setSaveStatus('saving')
    const timer = setTimeout(handleSave, AUTO_SAVE_DELAY_MS)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room?.is_saved, isReadyToSave])

  useLayoutEffect(() => {
    navigation.setOptions({
      headerLeft: () => (
        <TouchableOpacity
          onPress={() => navigation.navigate('Edit', { shareId })}
          style={{ paddingHorizontal: 8, paddingVertical: 4 }}
        >
          <Text style={{ color: Colors.textOnPrimary, fontSize: 14, fontWeight: '600' }}>← 編集に戻る</Text>
        </TouchableOpacity>
      ),
    })
  }, [navigation, shareId])

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
      const eventsData = (rawEvents ?? []).map((e) => ({
        id: e.id as string,
        name: e.event_name as string,
        amount: e.total_amount as number,
        splitMode: ((e.split_mode as string) === 'equal' ? 'equal' : 'tilt') as 'tilt' | 'equal',
        attendeeIds: (rawAttendances ?? []).filter((a) => a.event_id === e.id).map((a) => a.participant_id as string),
      }))
      setEvents(eventsData)
      const payerMap: Record<string, string | null> = {}
      ;(rawEvents ?? []).forEach((e) => {
        payerMap[e.id as string] = (e.payer_participant_id as string | null) ?? null
      })
      setPayerByEventId(payerMap)
    } finally {
      setLoading(false)
    }
  }

  // 自動保存本体。UIからは保存失敗時の再試行でのみ呼ばれる（サイレント実行、Alert/Hapticなし）
  async function handleSave() {
    setSaveStatus('saving')
    try {
      await updateRoomSaved(shareId)
      setRoom((r) => r ? { ...r, is_saved: true } : r)
      setSaveStatus('saved')
      recordSettlementCompletion()
    } catch (e) {
      console.error('[autoSave] 履歴への保存に失敗しました', e)
      setSaveStatus('error')
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
          const eventsData = events.map((e) => {
            const payerId = payerByEventId[e.id]
            const payerName = payerId ? (participants.find((p) => p.id === payerId)?.name ?? null) : null
            return { name: e.name, split_mode: e.splitMode ?? 'tilt', total_amount: e.amount, payer_participant_name: payerName }
          })
          console.log('[saveTemplate] eventsData:', JSON.stringify(eventsData.map((e) => ({ name: e.name, payer: e.payer_participant_name }))))
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
            eventsData,
          })
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
          Alert.alert('保存しました', 'テンプレートに保存しました')
        } catch (e) {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
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
    return <View style={styles.center}><ActivityIndicator size="large" color={Colors.primary} /></View>
  }

  if (!room || participants.length === 0) {
    return <View style={styles.center}><Text style={styles.emptyText}>データが見つかりません</Text></View>
  }

  const gradient = selectedGradient ?? room.tilt_ratio
  const manualMode = room.manual_mode
  const results = applyRoundingPerEvent(participants, events, unit, gradient, manualMode)
  const grandTotal = events.reduce((s, e) => s + e.amount, 0)
  const activeEvents = events.filter((e) => e.amount > 0)

  const sortedResults = [...results].sort((a, b) => b.payment - a.payment)

  function splitModeLabel(ev: EventInput): string {
    if (ev.splitMode === 'equal') return '均等割'
    return manualMode ? '手動配分' : `傾斜${gradient.toFixed(1)}倍`
  }

  const buildResultText = (): string => {
    const lines: string[] = []
    lines.push(`【傾斜精算 結果】${room.event_date ?? ''}`.trimEnd())
    lines.push('')
    lines.push('■ 合計')
    results.forEach((r) => {
      lines.push(`${r.name}（${getRoleBadgeLabel(r.role, r.tenure_years)}）　¥${r.payment.toLocaleString()}`)
    })
    lines.push('―'.repeat(21))
    lines.push(`総額　¥${grandTotal.toLocaleString()}`)
    const average = participants.length > 0 ? Math.round(grandTotal / participants.length) : 0
    lines.push(`一人平均　¥${average.toLocaleString()}`)
    lines.push('')

    if (events.length <= 1 && events[0]) {
      const ev = events[0]
      lines.push('■ 内訳')
      lines.push(`・${ev.name}（¥${ev.amount.toLocaleString()}、${splitModeLabel(ev)}）`)
      results.forEach((r) => {
        lines.push(`${r.name}　¥${r.payment.toLocaleString()}`)
      })
    } else if (events.length > 1) {
      lines.push('■ 内訳（マトリクス表）')
      const nameWidth = Math.max(...results.map((r) => displayWidth(r.name)), displayWidth('名前'), displayWidth('合計')) + 1
      const colWidths = events.map((ev, idx) =>
        Math.max(
          displayWidth(ev.name),
          ...results.map((r) => {
            const amt = r.perEventPayment[idx]
            return displayWidth(amt != null ? `¥${amt.toLocaleString()}` : '-')
          }),
          displayWidth(`¥${ev.amount.toLocaleString()}`)
        ) + 1
      )
      const totalColWidth = Math.max(displayWidth('合計'), ...results.map((r) => displayWidth(`¥${r.payment.toLocaleString()}`)), displayWidth(`¥${grandTotal.toLocaleString()}`)) + 1

      lines.push(
        padEnd('名前', nameWidth) +
          events.map((ev, i) => padStart(ev.name, colWidths[i])).join('') +
          padStart('合計', totalColWidth)
      )
      results.forEach((r) => {
        const cells = events.map((_, i) => {
          const amt = r.perEventPayment[i]
          return padStart(amt != null ? `¥${amt.toLocaleString()}` : '-', colWidths[i])
        })
        lines.push(padEnd(r.name, nameWidth) + cells.join('') + padStart(`¥${r.payment.toLocaleString()}`, totalColWidth))
      })
      const totalWidth = nameWidth + colWidths.reduce((s, w) => s + w, 0) + totalColWidth
      lines.push('―'.repeat(Math.max(10, Math.round(totalWidth / 2))))
      lines.push(
        padEnd('合計', nameWidth) +
          events.map((ev, i) => padStart(`¥${ev.amount.toLocaleString()}`, colWidths[i])).join('') +
          padStart(`¥${grandTotal.toLocaleString()}`, totalColWidth)
      )
      lines.push(`（${events.map((ev) => `${ev.name}：${splitModeLabel(ev)}`).join('、')}）`)
    }

    return lines.join('\n')
  }

  const handleCopyResult = async () => {
    await Clipboard.setStringAsync(buildResultText())
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    showToast('コピーしました')
  }

  // 傾斜パターン比較（manualMode 時は傾斜倍率が効かないので非表示）
  const comparisonResults = !manualMode
    ? COMPARISON_GRADIENTS.reduce<Record<number, ReturnType<typeof applyRoundingPerEvent>>>((acc, g) => {
        acc[g] = applyRoundingPerEvent(participants, events, unit, g, false)
        return acc
      }, {})
    : null

  return (
    <View style={{ flex: 1 }}>
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* ヘッダー */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>傾斜精算</Text>
        {room.event_date && <Text style={styles.headerSub}>📅 {room.event_date}</Text>}
        <Text style={styles.headerSub}>参加者 {participants.length}名</Text>
        <View style={styles.headerBadge}>
          <Text style={styles.headerBadgeText}>
            ⚖️ 傾斜 {gradient.toFixed(1)}倍{selectedGradient !== null && Math.abs(selectedGradient - room.tilt_ratio) > 0.05 ? ' ★仮' : ''}
          </Text>
        </View>
      </View>

      {/* 保存ステータス（自動保存の状態表示。タップできるのは保存失敗時の再試行のみ） */}
      <TouchableOpacity
        style={[styles.saveStatusCard, saveStatusCardStyles[saveStatus]]}
        onPress={handleSave}
        disabled={saveStatus !== 'error'}
        activeOpacity={0.85}
      >
        {saveStatus === 'not_ready' && (
          <Text style={[styles.saveStatusTitle, styles.saveStatusTitleMuted]}>まだ精算が完了していません（保存されません）</Text>
        )}
        {saveStatus === 'saving' && (
          <View style={styles.saveStatusRow}>
            <ActivityIndicator size="small" color={Colors.primary} />
            <View style={styles.saveStatusTextCol}>
              <Text style={[styles.saveStatusTitle, styles.saveStatusTitlePrimary]}>保存中...</Text>
              <Text style={[styles.saveStatusSub, styles.saveStatusSubPrimary]}>完了後に履歴画面から確認できます</Text>
            </View>
          </View>
        )}
        {saveStatus === 'saved' && (
          <>
            <Text style={[styles.saveStatusTitle, styles.saveStatusTitleOnPrimary]}>✓ 履歴に保存済み</Text>
            <Text style={[styles.saveStatusSub, styles.saveStatusSubOnPrimary]}>いつでも履歴画面から確認できます</Text>
          </>
        )}
        {saveStatus === 'error' && (
          <Text style={[styles.saveStatusTitle, styles.saveStatusTitleError]}>⚠️ 保存に失敗しました（タップで再試行）</Text>
        )}
      </TouchableOpacity>

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
          {([500, 1000] as Unit[]).map((u) => (
            <TouchableOpacity key={u} style={[styles.unitBtn, unit === u && styles.unitBtnActive]} onPress={() => setUnit(u)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={[styles.unitBtnText, unit === u && styles.unitBtnTextActive]}>{u}円</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* 💰 精算金額 */}
      <Text style={styles.resultSectionTitle}>💰 精算金額</Text>
      <View style={styles.card}>
        {sortedResults.map((r, idx) => (
          <View key={r.id} style={[styles.resultRow, idx < sortedResults.length - 1 && styles.resultRowBorder]}>
            <View style={styles.resultLeft}>
              {r.is_organizer && <Text style={styles.organizerBadge}>幹事</Text>}
              <Text style={styles.resultName}>{r.name}</Text>
              <View style={styles.roleBadge}>
                <Text style={styles.roleBadgeText}>{getRoleBadgeLabel(r.role, r.tenure_years)}</Text>
              </View>
            </View>
            <View style={styles.resultRight}>
              <Text style={styles.resultAmount}>{r.payment.toLocaleString()}<Text style={styles.resultUnit}>円</Text></Text>
            </View>
          </View>
        ))}
      </View>

      {/* 📊 内訳 */}
      {events.length > 1 && (
        <>
          <Text style={styles.resultSectionTitle}>📊 内訳</Text>
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
                    <View style={[styles.tableNameCell, styles.tableNameCellView]}>
                      <Text style={styles.tableNamePrimary} numberOfLines={1}>{r.name}</Text>
                      <Text style={styles.tableNameSub} numberOfLines={1}>{getRoleBadgeLabel(r.role, r.tenure_years)}</Text>
                    </View>
                    {r.perEventPayment.map((amt, idx) => (
                      <Text key={idx} style={[styles.tableCell, styles.tableAmountCell]}>{amt != null ? amt.toLocaleString() : '—'}</Text>
                    ))}
                    <Text style={[styles.tableCell, styles.tableAmountCell, styles.tableTotalCell]}>{r.payment.toLocaleString()}</Text>
                  </View>
                ))}
              </View>
            </ScrollView>
          </View>
        </>
      )}

      {/* ⚖️ 傾斜パターン比較 */}
      {comparisonResults && (
        <>
          <Text style={styles.resultSectionTitle}>⚖️ 傾斜パターン比較</Text>
          <View style={styles.card}>
            <View style={styles.compHintRow}>
              <Text style={[styles.hint, { flex: 1, textAlign: 'left' }]}>
                {selectedGradient !== null && Math.abs(selectedGradient - room.tilt_ratio) > 0.05
                  ? `${selectedGradient.toFixed(1)}倍で表示中`
                  : '列タップで倍率を切替・上段も即時更新'}
              </Text>
              {selectedGradient !== null && Math.abs(selectedGradient - room.tilt_ratio) > 0.05 && (
                <TouchableOpacity onPress={() => setSelectedGradient(null)} style={styles.resetGradBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Text style={styles.resetGradBtnText}>↩ {room.tilt_ratio.toFixed(1)}倍に戻す</Text>
                </TouchableOpacity>
              )}
            </View>
            <View style={[styles.compTable, { marginTop: 10 }]}>
              {/* 固定名前列 */}
              <View style={styles.compNameCol}>
                <View style={styles.compHeaderCell}>
                  <Text style={styles.compHeaderText}>名前</Text>
                </View>
                {sortedResults.map((r) => (
                  <View key={r.id} style={styles.compNameDataCell}>
                    <Text style={styles.compNameText} numberOfLines={1}>{r.name}</Text>
                    {r.is_organizer && <Text style={styles.compOrgLabel}>幹事</Text>}
                    <Text style={styles.compRoleSub} numberOfLines={1}>{getRoleBadgeLabel(r.role, r.tenure_years)}</Text>
                  </View>
                ))}
              </View>
              {/* スクロール傾斜列 */}
              <ScrollView horizontal showsHorizontalScrollIndicator={false} nestedScrollEnabled>
                <View>
                  <View style={styles.compHeaderRow}>
                    {COMPARISON_GRADIENTS.map((g) => {
                      const isCurrent = Math.abs(g - gradient) < 0.05
                      const isDefault = Math.abs(g - room.tilt_ratio) < 0.05
                      return (
                        <TouchableOpacity
                          key={g}
                          style={[styles.compGradientHeaderCell, isCurrent && styles.compCurrentGradientHeaderCell]}
                          onPress={() => {
                            const alreadySelected = selectedGradient !== null && Math.abs(g - selectedGradient) < 0.05
                            setSelectedGradient(alreadySelected || isDefault ? null : g)
                          }}
                          activeOpacity={0.7}
                          hitSlop={{ top: 6, bottom: 6, left: 2, right: 2 }}
                        >
                          <Text style={[styles.compHeaderText, isCurrent && styles.compCurrentHeaderText]}>
                            {g === 1.0 ? '均等' : `${g.toFixed(1)}倍`}
                          </Text>
                          {isCurrent && <Text style={styles.compCurrentLabel}>{isDefault ? '▼ 現在' : '▼ 選択中'}</Text>}
                        </TouchableOpacity>
                      )
                    })}
                  </View>
                  {sortedResults.map((r) => (
                    <View key={r.id} style={styles.compDataRow}>
                      {COMPARISON_GRADIENTS.map((g) => {
                        const isCurrent = Math.abs(g - gradient) < 0.05
                        const compResult = comparisonResults[g]?.find((rr) => rr.id === r.id)
                        return (
                          <View key={g} style={[styles.compCell, isCurrent && styles.compCurrentCell]}>
                            <Text style={[styles.compCellText, isCurrent && styles.compCurrentCellText]}>
                              {compResult != null ? `${compResult.payment.toLocaleString()}` : '—'}
                            </Text>
                          </View>
                        )
                      })}
                    </View>
                  ))}
                </View>
              </ScrollView>
            </View>
          </View>
        </>
      )}

      {/* 支払い調整（立替者が設定されている場合のみ） */}
      {Object.values(payerByEventId).some((v) => v !== null) && (() => {
        const transfers = computeSettlement(sortedResults, events, payerByEventId)
        if (transfers.length === 0) return null
        return (
          <View style={styles.settlementCard}>
            <Text style={styles.settlementTitle}>💸 支払い調整</Text>
            <Text style={styles.settlementSub}>立替者への支払いをまとめました</Text>
            <View style={styles.payerBadgeRow}>
              {events.filter((ev) => ev.amount > 0 && payerByEventId[ev.id]).map((ev) => {
                const payer = sortedResults.find((r) => r.id === payerByEventId[ev.id])
                if (!payer) return null
                return (
                  <View key={ev.id} style={styles.payerBadge}>
                    <Text style={styles.payerBadgeText}>{ev.name}：{payer.name}が立替</Text>
                  </View>
                )
              })}
            </View>
            {transfers.map((t, i) => (
              <View key={i} style={styles.transferRow}>
                <View style={styles.transferLeft}>
                  <Text style={styles.transferFrom}>{t.from}</Text>
                  <Text style={styles.transferArrow}> → </Text>
                  <Text style={styles.transferTo}>{t.to}</Text>
                </View>
                <Text style={styles.transferAmount}>{t.amount.toLocaleString()}<Text style={styles.transferUnit}>円</Text></Text>
              </View>
            ))}
          </View>
        )
      })()}

      {/* アクションボタン群 */}
      <View style={styles.actionsCard}>
        <Text style={styles.actionsTitle}>共有・保存</Text>
        <TouchableOpacity style={[styles.actionBtn, styles.actionBtnCopy]} onPress={handleCopyResult}>
          <Text style={[styles.actionBtnText, styles.actionBtnCopyText]}>📋 精算結果をコピー</Text>
        </TouchableOpacity>
        {Platform.OS === 'ios' && (
          <TouchableOpacity style={[styles.actionBtn, styles.actionBtnTemplate]} onPress={handleSaveTemplate} disabled={savingTemplate}>
            {savingTemplate ? <ActivityIndicator color={Colors.textOnPrimary} /> : <Text style={[styles.actionBtnText, styles.actionBtnTemplateText]}>📑 テンプレートとして保存</Text>}
          </TouchableOpacity>
        )}
      </View>

      <TouchableOpacity
        style={styles.newBtn}
        onPress={() => navigation.reset({ index: 0, routes: [{ name: 'Home' }] })}
      >
        <Text style={styles.newBtnText}>↩ 新しい精算を始める</Text>
      </TouchableOpacity>

      <View style={{ height: 40 }} />
      </ScrollView>
      {toast && (
        <View style={styles.toast} pointerEvents="none">
          <Text style={styles.toastText}>{toast}</Text>
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: 16 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyText: { color: Colors.textSecondary, fontSize: 15 },
  header: { backgroundColor: Colors.primary, borderRadius: 16, paddingVertical: 22, paddingHorizontal: 20, marginBottom: 14, alignItems: 'center' },
  headerTitle: { fontSize: 22, fontWeight: '800', color: Colors.textOnPrimary },
  headerSub: { fontSize: 13, color: 'rgba(255,255,255,0.8)', marginTop: 4 },
  headerBadge: { backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 4, marginTop: 8, borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)' },
  headerBadgeText: { color: Colors.textOnPrimary, fontSize: 12, fontWeight: '600' },
  saveStatusCard: { borderRadius: 14, paddingVertical: 14, paddingHorizontal: 16, alignItems: 'center', marginBottom: 14, borderWidth: 1 },
  saveStatusRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  saveStatusTextCol: { alignItems: 'flex-start' },
  saveStatusTitle: { fontSize: 14, fontWeight: '700', textAlign: 'center' },
  saveStatusTitleMuted: { color: Colors.textSecondary, fontWeight: '600' },
  saveStatusTitlePrimary: { color: Colors.primary },
  saveStatusTitleOnPrimary: { color: Colors.textOnPrimary, fontSize: 15 },
  saveStatusTitleError: { color: Colors.error },
  saveStatusSub: { fontSize: 12, marginTop: 2 },
  saveStatusSubPrimary: { color: Colors.primary, opacity: 0.75 },
  saveStatusSubOnPrimary: { color: 'rgba(255,255,255,0.85)', textAlign: 'center' },
  summaryScroll: { marginBottom: 14 },
  summaryRow: { flexDirection: 'row', gap: 10, paddingVertical: 4 },
  summaryCard: { backgroundColor: Colors.card, borderRadius: 12, padding: 12, minWidth: 100, alignItems: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4, elevation: 1 },
  summaryTotalCard: { backgroundColor: Colors.accentLight, borderWidth: 1, borderColor: Colors.accentLight },
  summaryLabel: { fontSize: 11, color: Colors.placeholder, marginBottom: 4 },
  summaryAmount: { fontSize: 18, fontWeight: '700', color: Colors.primary },
  summaryTotalAmount: { color: Colors.error },
  summaryUnit: { fontSize: 12, fontWeight: '400', color: Colors.placeholder },
  card: { backgroundColor: Colors.card, borderRadius: 16, padding: 16, marginBottom: 14, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 6, elevation: 2 },
  cardLabel: { fontSize: 13, fontWeight: '600', color: Colors.textSecondary, marginBottom: 10 },
  unitRow: { flexDirection: 'row', gap: 8 },
  unitBtn: { flex: 1, borderWidth: 2, borderColor: Colors.border, borderRadius: 8, paddingVertical: 8, alignItems: 'center' },
  unitBtnActive: { borderColor: Colors.primary, backgroundColor: Colors.primary },
  unitBtnText: { fontSize: 14, fontWeight: '600', color: Colors.placeholder },
  unitBtnTextActive: { color: Colors.textOnPrimary },
  resultSectionTitle: { fontSize: 14, fontWeight: '700', color: Colors.text, marginBottom: 8, paddingHorizontal: 4 },
  resultRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, justifyContent: 'space-between' },
  resultRowBorder: { borderBottomWidth: 1, borderBottomColor: Colors.border },
  resultLeft: { flex: 1 },
  organizerBadge: { fontSize: 10, color: Colors.warning, fontWeight: '700', backgroundColor: Colors.accentLight, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, alignSelf: 'flex-start', marginBottom: 2 },
  resultName: { fontSize: 16, fontWeight: '700', color: Colors.text },
  roleBadge: { flexDirection: 'row', alignSelf: 'flex-start', backgroundColor: Colors.accentLight, borderWidth: 1, borderColor: Colors.accentLight, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2, marginTop: 4 },
  roleBadgeText: { fontSize: 11, color: Colors.warning, fontWeight: '500' },
  resultRight: { alignItems: 'flex-end' },
  resultAmount: { fontSize: 22, fontWeight: '800', color: Colors.primary },
  resultUnit: { fontSize: 13, fontWeight: '400', color: Colors.placeholder },
  resultRaw: { fontSize: 11, color: Colors.placeholder, marginTop: 2 },
  tableRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: Colors.border },
  tableCell: { paddingVertical: 10, paddingHorizontal: 8, fontSize: 13, color: Colors.text },
  tableHeaderCell: { fontWeight: '700', color: Colors.textSecondary, fontSize: 12, backgroundColor: Colors.background },
  tableNameCell: { width: 110 },
  tableNameCellView: { paddingVertical: 8, paddingHorizontal: 8, justifyContent: 'center' },
  tableNamePrimary: { fontSize: 13, color: Colors.text, fontWeight: '500' },
  tableNameSub: { fontSize: 10, color: Colors.warning, marginTop: 2 },
  tableAmountCell: { width: 80, textAlign: 'right' },
  tableTotalCell: { fontWeight: '700', color: Colors.primary },
  // 傾斜パターン比較表
  compTable: { flexDirection: 'row', borderWidth: 1, borderColor: Colors.border, borderRadius: 10, overflow: 'hidden' },
  compNameCol: { width: 104, borderRightWidth: 1, borderRightColor: Colors.border, backgroundColor: Colors.background },
  compHeaderCell: { height: 48, justifyContent: 'center', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: Colors.border, backgroundColor: Colors.background, paddingHorizontal: 6 },
  compNameDataCell: { minHeight: 58, justifyContent: 'center', paddingHorizontal: 8, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: Colors.border },
  compNameText: { fontSize: 12, fontWeight: '600', color: Colors.text },
  compOrgLabel: { fontSize: 9, color: Colors.warning, fontWeight: '700' },
  compRoleSub: { fontSize: 10, color: Colors.warning, marginTop: 2 },
  compHeaderRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: Colors.border },
  compGradientHeaderCell: { width: 70, height: 48, justifyContent: 'center', alignItems: 'center', borderRightWidth: 1, borderRightColor: Colors.border, backgroundColor: Colors.background, paddingHorizontal: 4 },
  compCurrentGradientHeaderCell: { backgroundColor: Colors.accentLight, borderRightColor: Colors.accentLight },
  compHeaderText: { fontSize: 11, fontWeight: '700', color: Colors.textSecondary, textAlign: 'center' },
  compCurrentHeaderText: { color: Colors.primary },
  compCurrentLabel: { fontSize: 9, color: Colors.primary, fontWeight: '600', textAlign: 'center', marginTop: 1 },
  compDataRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: Colors.border },
  compCell: { width: 70, minHeight: 58, justifyContent: 'center', alignItems: 'center', borderRightWidth: 1, borderRightColor: Colors.border, paddingHorizontal: 4 },
  compCurrentCell: { backgroundColor: Colors.accentLight },
  compCellText: { fontSize: 12, fontWeight: '500', color: Colors.text, textAlign: 'center' },
  compCurrentCellText: { fontWeight: '700', color: Colors.primary },
  settlementCard: { backgroundColor: Colors.infoLight, borderRadius: 16, padding: 16, marginBottom: 14, borderWidth: 1, borderColor: Colors.info },
  settlementTitle: { fontSize: 15, fontWeight: '700', color: Colors.info, marginBottom: 2 },
  settlementSub: { fontSize: 12, color: Colors.textSecondary, marginBottom: 10 },
  payerBadgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10 },
  payerBadge: { backgroundColor: Colors.infoLight, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 3 },
  payerBadgeText: { fontSize: 11, color: Colors.info },
  transferRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: Colors.card, borderRadius: 12, padding: 12, marginBottom: 6 },
  transferLeft: { flexDirection: 'row', alignItems: 'center', flex: 1, flexWrap: 'wrap' },
  transferFrom: { fontSize: 14, fontWeight: '600', color: Colors.text },
  transferArrow: { fontSize: 14, color: Colors.placeholder },
  transferTo: { fontSize: 14, fontWeight: '600', color: Colors.info },
  transferAmount: { fontSize: 18, fontWeight: '700', color: Colors.info, marginLeft: 8 },
  transferUnit: { fontSize: 12, fontWeight: '400', color: Colors.placeholder },
  actionsCard: { backgroundColor: Colors.card, borderRadius: 16, padding: 16, marginBottom: 14, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 6, elevation: 2 },
  actionsTitle: { fontSize: 14, fontWeight: '700', color: Colors.text, marginBottom: 10 },
  actionBtn: { borderWidth: 1.5, borderColor: Colors.border, borderRadius: 10, paddingVertical: 12, alignItems: 'center', marginBottom: 8 },
  actionBtnText: { fontSize: 14, fontWeight: '600', color: Colors.text },
  actionBtnCopy: { backgroundColor: Colors.infoLight, borderColor: Colors.info },
  actionBtnCopyText: { color: Colors.info },
  actionBtnTemplate: { backgroundColor: Colors.info, borderColor: Colors.info },
  actionBtnTemplateText: { color: Colors.textOnPrimary },
  newBtn: { borderWidth: 2, borderColor: Colors.accentLight, borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 10, marginBottom: 14 },
  newBtnText: { color: Colors.primary, fontSize: 15, fontWeight: '700' },
  hint: { fontSize: 13, color: Colors.placeholder, textAlign: 'center' },
  compHintRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 0 },
  resetGradBtn: { backgroundColor: Colors.background, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4, borderWidth: 1, borderColor: Colors.border },
  resetGradBtnText: { fontSize: 11, color: Colors.textSecondary, fontWeight: '600' },
  toast: {
    position: 'absolute', bottom: 32, left: 24, right: 24, alignItems: 'center',
    backgroundColor: 'rgba(22,41,140,0.92)', borderRadius: 24, paddingVertical: 12, paddingHorizontal: 20,
  },
  toastText: { color: Colors.textOnPrimary, fontSize: 14, fontWeight: '600' },
})

const saveStatusCardStyles = StyleSheet.create({
  not_ready: { backgroundColor: Colors.background, borderColor: Colors.border },
  saving: { backgroundColor: Colors.primaryLight, borderColor: Colors.primaryLight },
  saved: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  error: { backgroundColor: Colors.errorLight, borderColor: Colors.error },
})
