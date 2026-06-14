import React, { useState, useEffect, useRef, useCallback } from 'react'
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, Alert, ActivityIndicator, Modal, Platform, Pressable,
} from 'react-native'
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker'
import type { CreateScreenProps } from '../navigation/types'
import { ROLES, ROLE_EQUIVALENT_YEARS } from '../lib/calculations'
import { createRoom, updateRoom, getSuggestions, getRecentMembers, type Suggestion } from '../lib/actions'
import { getDeviceId } from '../lib/deviceId'
import { supabase } from '../lib/supabase'

interface ParticipantState {
  name: string
  role: string
  tenure_years: string
  fixed_amount: string
  manual_multiplier: string
  attendances: boolean[]
}

interface EventState {
  name: string
  totalAmount: string
  splitMode: 'tilt' | 'equal'
  payerParticipantIdx: number | null
}

const EVENT_PRESETS = ['1次会', '2次会', '3次会', '4次会', 'タクシー代', 'プレゼント代']

function makeParticipant(evtCount: number): ParticipantState {
  return {
    name: '',
    role: 'その他役職',
    tenure_years: '',
    fixed_amount: '',
    manual_multiplier: '1.0',
    attendances: Array<boolean>(evtCount).fill(true),
  }
}

function defaultEventName(currentCount: number): string {
  const presets = ['2次会', '3次会', '4次会']
  return presets[currentCount - 1] ?? `項目${currentCount + 1}`
}

export default function CreateScreen({ navigation, route }: CreateScreenProps) {
  const { fromShareId, templateId, copyFromShareId } = route.params ?? {}
  const isEdit = !!fromShareId

  const [eventDate, setEventDate] = useState('')
  const [tiltRatio, setTiltRatio] = useState('2.0')
  const [manualMode, setManualMode] = useState(false)
  const [events, setEvents] = useState<EventState[]>([{ name: '1次会', totalAmount: '', splitMode: 'tilt', payerParticipantIdx: null }])
  const [participants, setParticipants] = useState<ParticipantState[]>([
    makeParticipant(1),
    makeParticipant(1),
  ])
  const [organizerIdx, setOrganizerIdx] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [initialLoading, setInitialLoading] = useState(false)
  const [error, setError] = useState('')

  const [suggestions, setSuggestions] = useState<{ idx: number; list: Suggestion[] } | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [memberPickerIdx, setMemberPickerIdx] = useState<number | null>(null)
  const [memberPickerList, setMemberPickerList] = useState<Suggestion[]>([])
  const [presetModalIdx, setPresetModalIdx] = useState<number | null>(null)
  const [tiltModalOpen, setTiltModalOpen] = useState(false)
  const [multiplierModalIdx, setMultiplierModalIdx] = useState<number | null>(null)
  const [roleModalIdx, setRoleModalIdx] = useState<number | null>(null)
  const [showDatePicker, setShowDatePicker] = useState(false)
  const [pickerDate, setPickerDate] = useState(new Date())

  useEffect(() => {
    if (fromShareId) {
      loadFromRoom(fromShareId)
    } else if (templateId) {
      loadFromTemplate(templateId)
    } else if (copyFromShareId) {
      loadFromRoomCopy(copyFromShareId)
    }
  }, [fromShareId, templateId, copyFromShareId])

  async function loadFromRoom(shareId: string) {
    setInitialLoading(true)
    try {
      const { data: room } = await supabase.from('nomikai_seisan_rooms').select('*').eq('share_id', shareId).single()
      if (!room) return
      const { data: rawParticipants } = await supabase.from('nomikai_seisan_participants').select('*').eq('room_id', room.id).order('created_at', { ascending: true })
      const { data: rawEvents } = await supabase.from('nomikai_seisan_events').select('*').eq('room_id', room.id).order('sort_order', { ascending: true })
      const eventIds = (rawEvents ?? []).map((e) => e.id as string)
      const { data: rawAttendances } = eventIds.length
        ? await supabase.from('nomikai_seisan_event_attendances').select('event_id, participant_id').in('event_id', eventIds)
        : { data: [] }
      const pData = rawParticipants ?? []
      const eData = rawEvents ?? []
      setTiltRatio(((room.tilt_ratio as number) ?? 2.0).toFixed(1))
      setManualMode((room.manual_mode as boolean) ?? false)
      setEvents(eData.length > 0 ? eData.map((e) => {
        const payerIdx = pData.findIndex((p) => p.id === e.payer_participant_id)
        return { name: e.event_name as string, totalAmount: '', splitMode: (e.split_mode as string) === 'equal' ? 'equal' : 'tilt', payerParticipantIdx: payerIdx >= 0 ? payerIdx : null }
      }) : [{ name: '1次会', totalAmount: '', splitMode: 'tilt', payerParticipantIdx: null }])
      const orgIdx = pData.findIndex((p) => p.is_organizer)
      setOrganizerIdx(orgIdx >= 0 ? orgIdx : null)
      setParticipants(pData.map((p, pIdx) => ({
        name: p.name as string,
        role: p.role as string,
        tenure_years: p.tenure_years != null ? String(p.tenure_years) : '',
        fixed_amount: '',
        manual_multiplier: String(p.manual_multiplier ?? '1.0'),
        attendances: eData.map((e) => (rawAttendances ?? []).some((a) => a.event_id === e.id && a.participant_id === pData[pIdx].id)),
      })))
    } finally {
      setInitialLoading(false)
    }
  }

  async function loadFromTemplate(tmplId: string) {
    setInitialLoading(true)
    try {
      const { data: tmpl } = await supabase.from('nomikai_seisan_templates').select('*').eq('id', tmplId).single()
      if (!tmpl) return
      const pData = (tmpl.participants_data as { name: string; role: string; tenure_years: number | null; is_organizer: boolean; manual_multiplier: number }[]) ?? []
      const eData = (tmpl.events_data as { name: string; split_mode: string; total_amount?: number; payer_participant_name?: string | null }[]) ?? []
      setTiltRatio(((tmpl.tilt_ratio as number) ?? 2.0).toFixed(1))
      setManualMode((tmpl.manual_mode as boolean) ?? false)
      const evtCount = eData.length || 1
      setEvents(eData.length > 0 ? eData.map((e) => {
        const payerIdx = e.payer_participant_name ? pData.findIndex((p) => p.name === e.payer_participant_name) : -1
        return {
          name: e.name,
          totalAmount: e.total_amount ? String(e.total_amount) : '',
          splitMode: e.split_mode === 'equal' ? 'equal' : 'tilt',
          payerParticipantIdx: payerIdx >= 0 ? payerIdx : null,
        }
      }) : [{ name: '1次会', totalAmount: '', splitMode: 'tilt', payerParticipantIdx: null }])
      const orgIdx = pData.findIndex((p) => p.is_organizer)
      setOrganizerIdx(orgIdx >= 0 ? orgIdx : null)
      setParticipants(pData.map((p) => ({ name: p.name, role: p.role, tenure_years: p.tenure_years != null ? String(p.tenure_years) : '', fixed_amount: '', manual_multiplier: String(p.manual_multiplier ?? 1.0), attendances: Array<boolean>(evtCount).fill(true) })))
    } finally {
      setInitialLoading(false)
    }
  }

  async function loadFromRoomCopy(shareId: string) {
    setInitialLoading(true)
    try {
      const { data: room } = await supabase.from('nomikai_seisan_rooms').select('*').eq('share_id', shareId).single()
      if (!room) return
      const { data: rawParticipants } = await supabase.from('nomikai_seisan_participants').select('*').eq('room_id', room.id).order('created_at', { ascending: true })
      const { data: rawEvents } = await supabase.from('nomikai_seisan_events').select('*').eq('room_id', room.id).order('sort_order', { ascending: true })
      const eventIds = (rawEvents ?? []).map((e) => e.id as string)
      const { data: rawAttendances } = eventIds.length
        ? await supabase.from('nomikai_seisan_event_attendances').select('event_id, participant_id').in('event_id', eventIds)
        : { data: [] }
      const pData = rawParticipants ?? []
      const eData = rawEvents ?? []
      setTiltRatio(((room.tilt_ratio as number) ?? 2.0).toFixed(1))
      setManualMode((room.manual_mode as boolean) ?? false)
      setEventDate('')
      setEvents(eData.length > 0 ? eData.map((e) => {
        const payerIdx = pData.findIndex((p) => p.id === e.payer_participant_id)
        return {
          name: e.event_name as string,
          totalAmount: e.total_amount ? String(e.total_amount as number) : '',
          splitMode: (e.split_mode as string) === 'equal' ? 'equal' : 'tilt',
          payerParticipantIdx: payerIdx >= 0 ? payerIdx : null,
        }
      }) : [{ name: '1次会', totalAmount: '', splitMode: 'tilt', payerParticipantIdx: null }])
      const orgIdx = pData.findIndex((p) => p.is_organizer)
      setOrganizerIdx(orgIdx >= 0 ? orgIdx : null)
      setParticipants(pData.map((p, pIdx) => ({
        name: p.name as string,
        role: p.role as string,
        tenure_years: p.tenure_years != null ? String(p.tenure_years) : '',
        fixed_amount: '',
        manual_multiplier: String(p.manual_multiplier ?? '1.0'),
        attendances: eData.map((e) => (rawAttendances ?? []).some((a) => a.event_id === e.id && a.participant_id === pData[pIdx].id)),
      })))
    } finally {
      setInitialLoading(false)
    }
  }

  const addEvent = () => {
    const name = defaultEventName(events.length)
    setEvents([...events, { name, totalAmount: '', splitMode: 'tilt', payerParticipantIdx: organizerIdx }])
    setParticipants(participants.map((p) => ({ ...p, attendances: [...p.attendances, true] })))
  }

  const removeEvent = (eIdx: number) => {
    setEvents(events.filter((_, i) => i !== eIdx))
    setParticipants(participants.map((p) => ({ ...p, attendances: p.attendances.filter((_, i) => i !== eIdx) })))
  }

  const updateEvent = (eIdx: number, field: keyof EventState, value: string) => {
    const next = [...events]
    next[eIdx] = { ...next[eIdx], [field]: value } as EventState
    setEvents(next)
  }

  const addParticipant = () => setParticipants([...participants, makeParticipant(events.length)])

  const removeParticipant = (i: number) => {
    if (participants.length <= 1) return
    setParticipants(participants.filter((_, idx) => idx !== i))
    if (organizerIdx === i) setOrganizerIdx(null)
    else if (organizerIdx !== null && organizerIdx > i) setOrganizerIdx(organizerIdx - 1)
    if (suggestions?.idx === i) setSuggestions(null)
    setEvents(events.map((ev) => ({
      ...ev,
      payerParticipantIdx:
        ev.payerParticipantIdx === i
          ? null
          : ev.payerParticipantIdx != null && ev.payerParticipantIdx > i
          ? ev.payerParticipantIdx - 1
          : ev.payerParticipantIdx,
    })))
  }

  const handleSetOrganizer = (newIdx: number | null) => {
    const prevIdx = organizerIdx
    setOrganizerIdx(newIdx)
    if (newIdx !== null) {
      setEvents((prev) => prev.map((ev) => {
        const payerIsUnset = ev.payerParticipantIdx == null
        const payerWasPrevOrganizer = ev.payerParticipantIdx === prevIdx
        return payerIsUnset || payerWasPrevOrganizer
          ? { ...ev, payerParticipantIdx: newIdx }
          : ev
      }))
    }
  }

  const updateParticipant = (i: number, field: keyof ParticipantState, value: string | boolean[]) => {
    const next = [...participants]
    next[i] = { ...next[i], [field]: value }
    setParticipants(next)
  }

  const updateAttendance = (pIdx: number, eIdx: number, value: boolean) => {
    const next = [...participants]
    const att = [...(next[pIdx].attendances ?? [])]
    att[eIdx] = value
    next[pIdx] = { ...next[pIdx], attendances: att }
    setParticipants(next)
  }

  const handleNameChange = useCallback((i: number, value: string) => {
    const next = [...participants]
    next[i] = { ...next[i], name: value }
    setParticipants(next)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (value.trim().length < 1) { setSuggestions(null); return }
    debounceRef.current = setTimeout(async () => {
      const list = await getSuggestions(value.trim())
      setSuggestions(list.length > 0 ? { idx: i, list } : null)
    }, 300)
  }, [participants])

  const applySuggestion = (i: number, s: Suggestion) => {
    const next = [...participants]
    next[i] = { ...next[i], name: s.name, role: s.role, tenure_years: s.tenure_years?.toString() ?? '' }
    setParticipants(next)
    setSuggestions(null)
  }

  const handleDatePickerChange = (event: DateTimePickerEvent, selectedDate?: Date) => {
    if (event.type === 'set' && selectedDate) {
      const d = selectedDate
      const yyyy = d.getFullYear()
      const mm = String(d.getMonth() + 1).padStart(2, '0')
      const dd = String(d.getDate()).padStart(2, '0')
      const yyyymmdd = `${yyyy}${mm}${dd}`
      const withoutDate = eventDate.replace(/^\d{8}\s*/, '').trim()
      setEventDate(withoutDate ? `${yyyymmdd} ${withoutDate}` : `${yyyymmdd} `)
      setPickerDate(selectedDate)
      setShowDatePicker(false)
    } else if (event.type === 'dismissed') {
      setShowDatePicker(false)
    }
  }

  const handleSubmit = async () => {
    setError('')
    if (!Number(events[0]?.totalAmount) || Number(events[0].totalAmount) <= 0) {
      setError('1次会の総額を入力してください')
      return
    }
    const validEntries = participants.map((p, idx) => ({ p, idx })).filter(({ p }) => p.name.trim() !== '')
    if (validEntries.length < 1) {
      setError('参加者を1人以上入力してください')
      return
    }
    setLoading(true)
    try {
      const deviceId = await getDeviceId()
      const input = {
        event_date: eventDate.trim() || null,
        tilt_ratio: parseFloat(tiltRatio) || 2.0,
        manual_mode: manualMode,
        device_id: isEdit ? undefined : deviceId,
        events: events.map((ev, i) => {
          const payerValidIdx = (() => {
            const rawIdx = ev.payerParticipantIdx ?? null
            if (rawIdx === null) return null
            const validIdx = validEntries.findIndex(({ idx }) => idx === rawIdx)
            return validIdx >= 0 ? validIdx : null
          })()
          return {
            name: ev.name.trim() || `${i + 1}次会`,
            total_amount: Number(ev.totalAmount) || 0,
            sort_order: i,
            split_mode: ev.splitMode ?? 'tilt',
            payer_participant_idx: payerValidIdx,
          }
        }),
        participants: validEntries.map(({ p, idx }) => ({
          name: p.name.trim(),
          role: p.role,
          tenure_years: p.role === 'その他役職' && p.tenure_years ? Number(p.tenure_years) : null,
          fixed_amount: p.fixed_amount ? Number(p.fixed_amount) : null,
          is_organizer: idx === organizerIdx,
          manual_multiplier: parseFloat(p.manual_multiplier) || 1.0,
        })),
        attendances: validEntries.map(({ p }) => events.map((_, eIdx) => p.attendances[eIdx] ?? true)),
      }
      if (isEdit && fromShareId) {
        await updateRoom(fromShareId, input)
        navigation.replace('Room', { shareId: fromShareId })
      } else {
        const newShareId = await createRoom(input)
        navigation.replace('Room', { shareId: newShareId })
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '保存に失敗しました')
    } finally {
      setLoading(false)
    }
  }

  if (initialLoading) {
    return <View style={styles.center}><ActivityIndicator size="large" color="#e97316" /></View>
  }

  return (
    <>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        onScrollBeginDrag={() => setSuggestions(null)}
      >
        <Pressable onPress={() => suggestions !== null && setSuggestions(null)}>

          {/* イベント名 */}
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>飲み会・イベント名</Text>
            <View style={styles.eventDateRow}>
              <TouchableOpacity style={styles.calendarBtn} onPress={() => setShowDatePicker(true)}>
                <Text style={styles.calendarBtnText}>📅</Text>
              </TouchableOpacity>
              <TextInput
                style={[styles.input, styles.flex1]}
                value={eventDate}
                onChangeText={setEventDate}
                placeholder={`例：${new Date().getFullYear()}${String(new Date().getMonth()+1).padStart(2,'0')}${String(new Date().getDate()).padStart(2,'0')} 部署飲み`}
                placeholderTextColor="#9ca3af"
              />
            </View>
          </View>

          {/* 傾斜設定 */}
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>傾斜設定</Text>
            <View style={styles.modeRow}>
              <TouchableOpacity style={[styles.modeBtn, !manualMode && styles.modeBtnActive]} onPress={() => setManualMode(false)}>
                <Text style={[styles.modeBtnLabel, !manualMode && styles.modeBtnLabelActive]}>自動</Text>
                <Text style={[styles.modeBtnSub, !manualMode && styles.modeBtnSubActive]}>役職・年次から計算</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.modeBtn, manualMode && styles.modeBtnActive]} onPress={() => setManualMode(true)}>
                <Text style={[styles.modeBtnLabel, manualMode && styles.modeBtnLabelActive]}>手動</Text>
                <Text style={[styles.modeBtnSub, manualMode && styles.modeBtnSubActive]}>倍率を直接指定</Text>
              </TouchableOpacity>
            </View>
            {!manualMode && (
              <TouchableOpacity style={styles.selector} onPress={() => setTiltModalOpen(true)}>
                <Text style={styles.selectorText}>{tiltRatio}倍{tiltRatio === '2.0' ? '（推奨）' : ''}</Text>
                <Text style={styles.selectorArrow}>▼</Text>
              </TouchableOpacity>
            )}
            {manualMode && <Text style={styles.hint}>各参加者の倍率は参加者カードで設定してください</Text>}
          </View>

          {/* 会カード */}
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>お会計</Text>
            {events.map((ev, eIdx) => (
              <View key={eIdx} style={styles.eventCard}>
                <View style={styles.row}>
                  <TouchableOpacity style={styles.eventNameRow} onPress={() => setPresetModalIdx(eIdx)}>
                    <TextInput
                      style={[styles.input, styles.flex1]}
                      value={ev.name}
                      onChangeText={(v) => updateEvent(eIdx, 'name', v)}
                      placeholder="例：1次会"
                      placeholderTextColor="#9ca3af"
                    />
                    <Text style={styles.dropArrow}>▼</Text>
                  </TouchableOpacity>
                  {eIdx > 0 && (
                    <TouchableOpacity onPress={() => removeEvent(eIdx)} style={styles.removeBtn}>
                      <Text style={styles.removeBtnText}>✕</Text>
                    </TouchableOpacity>
                  )}
                </View>
                <View style={styles.amountRow}>
                  <TextInput
                    style={[styles.input, styles.flex1]}
                    value={ev.totalAmount}
                    onChangeText={(v) => updateEvent(eIdx, 'totalAmount', v)}
                    placeholder="例: 30000"
                    placeholderTextColor="#9ca3af"
                    keyboardType="numeric"
                  />
                  <Text style={styles.unit}>円</Text>
                </View>
                {eIdx === 0 && <Text style={styles.required}>※ 1次会は必須です</Text>}
                <View style={styles.splitRow}>
                  <TouchableOpacity style={[styles.splitBtn, ev.splitMode !== 'equal' && styles.splitBtnTiltActive]} onPress={() => updateEvent(eIdx, 'splitMode', 'tilt')}>
                    <Text style={[styles.splitBtnText, ev.splitMode !== 'equal' && styles.splitBtnTextActive]}>傾斜配分</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.splitBtn, ev.splitMode === 'equal' && styles.splitBtnEqualActive]} onPress={() => updateEvent(eIdx, 'splitMode', 'equal')}>
                    <Text style={[styles.splitBtnText, ev.splitMode === 'equal' && styles.splitBtnEqualTextActive]}>均等割り</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))}
            <TouchableOpacity style={styles.addBtn} onPress={addEvent}>
              <Text style={styles.addBtnText}>＋ 会を追加</Text>
            </TouchableOpacity>
          </View>

          {/* 参加者リスト */}
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>参加者</Text>
            {participants.map((p, i) => (
              <View key={i} style={[styles.participantCard, organizerIdx === i && styles.participantCardOrganizer]}>
                {/* 名前行 */}
                <View style={styles.nameRow}>
                  <View style={styles.flex1}>
                    <View style={styles.nameInputRow}>
                      <TextInput
                        style={[styles.input, styles.flex1]}
                        value={p.name}
                        onChangeText={(v) => handleNameChange(i, v)}
                        onBlur={() => setTimeout(() => { if (suggestions?.idx === i) setSuggestions(null) }, 200)}
                        placeholder={`参加者${i + 1}の名前`}
                        placeholderTextColor="#9ca3af"
                      />
                      <TouchableOpacity
                        style={styles.memberPickerBtn}
                        onPress={async () => {
                          const list = await getRecentMembers()
                          setMemberPickerList(list)
                          setMemberPickerIdx(i)
                        }}
                      >
                        <Text style={styles.memberPickerBtnText}>👥</Text>
                      </TouchableOpacity>
                    </View>
                    {suggestions?.idx === i && suggestions.list.length > 0 && (
                      <View style={styles.suggestionsBox}>
                        {suggestions.list.map((s) => (
                          <TouchableOpacity key={s.name} style={styles.suggestionItem} onPress={() => applySuggestion(i, s)}>
                            <Text style={styles.suggestionName}>{s.name}</Text>
                            <Text style={styles.suggestionSub}>{s.role}{s.tenure_years ? ` ${s.tenure_years}年目` : ''}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    )}
                  </View>
                  <TouchableOpacity style={[styles.organizerBtn, organizerIdx === i && styles.organizerBtnActive]} onPress={() => handleSetOrganizer(organizerIdx === i ? null : i)}>
                    <Text style={styles.organizerBtnText}>{organizerIdx === i ? '👑' : '🎤'} 幹事</Text>
                  </TouchableOpacity>
                  {participants.length > 1 && (
                    <TouchableOpacity onPress={() => removeParticipant(i)} style={styles.removeBtn}>
                      <Text style={styles.removeBtnText}>✕</Text>
                    </TouchableOpacity>
                  )}
                </View>

                {/* 役職 or 倍率 */}
                {!manualMode ? (
                  <TouchableOpacity style={styles.selector} onPress={() => setRoleModalIdx(i)}>
                    <Text style={styles.selectorText}>{p.role}{ROLE_EQUIVALENT_YEARS[p.role] ? `（${ROLE_EQUIVALENT_YEARS[p.role]}年換算）` : '（年次入力）'}</Text>
                    <Text style={styles.selectorArrow}>▼</Text>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity style={styles.selector} onPress={() => setMultiplierModalIdx(i)}>
                    <Text style={styles.selectorText}>{p.manual_multiplier}倍</Text>
                    <Text style={styles.selectorArrow}>▼</Text>
                  </TouchableOpacity>
                )}

                {/* 年次（その他役職時） */}
                {!manualMode && p.role === 'その他役職' && (
                  <View style={styles.tenureRow}>
                    <TextInput
                      style={[styles.input, styles.tenureInput]}
                      value={p.tenure_years}
                      onChangeText={(v) => updateParticipant(i, 'tenure_years', v)}
                      placeholder="年次"
                      placeholderTextColor="#9ca3af"
                      keyboardType="numeric"
                    />
                    <Text style={styles.unit}>年目</Text>
                    <TextInput
                      style={[styles.input, styles.flex1]}
                      value={p.fixed_amount}
                      onChangeText={(v) => updateParticipant(i, 'fixed_amount', v)}
                      placeholder="固定額（省略可）"
                      placeholderTextColor="#9ca3af"
                      keyboardType="numeric"
                    />
                    <Text style={styles.unit}>円固定</Text>
                  </View>
                )}
                {(manualMode || p.role !== 'その他役職') && (
                  <View style={styles.tenureRow}>
                    <TextInput
                      style={[styles.input, styles.flex1]}
                      value={p.fixed_amount}
                      onChangeText={(v) => updateParticipant(i, 'fixed_amount', v)}
                      placeholder="固定額（省略可）"
                      placeholderTextColor="#9ca3af"
                      keyboardType="numeric"
                    />
                    <Text style={styles.unit}>円固定</Text>
                  </View>
                )}
              </View>
            ))}
            <TouchableOpacity style={styles.addBtn} onPress={addParticipant}>
              <Text style={styles.addBtnText}>＋ 参加者を追加</Text>
            </TouchableOpacity>
          </View>

          {/* 出席管理・立替者（マトリクス表） */}
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>出席管理・立替者</Text>
            <Text style={styles.hint}>セルタップで出席切替　💳 タップで立替者設定（1会につき1人）</Text>
            {participants.some((p) => p.name) ? (
              <View style={styles.matrixTable}>
                {/* 固定名前列 */}
                <View style={styles.matrixNameCol}>
                  <View style={styles.matrixHeaderCell}>
                    <Text style={styles.matrixHeaderText}>メンバー</Text>
                  </View>
                  {participants.map((p, pIdx) => {
                    if (!p.name) return null
                    return (
                      <View key={pIdx} style={styles.matrixNameDataCell}>
                        <Text style={styles.matrixNameText} numberOfLines={1}>{p.name}</Text>
                        {pIdx === organizerIdx && <Text style={styles.matrixOrgMark}>👑</Text>}
                      </View>
                    )
                  })}
                </View>
                {/* イベント列（横スクロール） */}
                <ScrollView horizontal showsHorizontalScrollIndicator={false} nestedScrollEnabled>
                  <View>
                    <View style={styles.matrixHeaderRow}>
                      {events.map((ev, eIdx) => (
                        <View key={eIdx} style={styles.matrixEventHeaderCell}>
                          <Text style={styles.matrixHeaderText} numberOfLines={2}>{ev.name || `${eIdx + 1}次会`}</Text>
                        </View>
                      ))}
                    </View>
                    {participants.map((p, pIdx) => {
                      if (!p.name) return null
                      return (
                        <View key={pIdx} style={styles.matrixDataRow}>
                          {events.map((ev, eIdx) => {
                            const isAttending = p.attendances[eIdx] ?? true
                            const isPayer = ev.payerParticipantIdx === pIdx
                            return (
                              <Pressable
                                key={eIdx}
                                style={styles.matrixCell}
                                onPress={() => updateAttendance(pIdx, eIdx, !isAttending)}
                              >
                                <View style={[styles.matrixCheckBox, isAttending && styles.matrixCheckBoxChecked]}>
                                  {isAttending && <Text style={styles.matrixCheckMark}>✓</Text>}
                                </View>
                                <TouchableOpacity
                                  style={[styles.matrixPayerBtn, isPayer && styles.matrixPayerBtnActive]}
                                  onPress={() => {
                                    const next = [...events]
                                    next[eIdx] = { ...next[eIdx], payerParticipantIdx: isPayer ? null : pIdx }
                                    setEvents(next)
                                  }}
                                  hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                                >
                                  <Text style={styles.matrixPayerBtnText}>💳</Text>
                                </TouchableOpacity>
                              </Pressable>
                            )
                          })}
                        </View>
                      )
                    })}
                  </View>
                </ScrollView>
              </View>
            ) : (
              <Text style={[styles.hint, { marginTop: 8 }]}>参加者を入力すると表示されます</Text>
            )}
          </View>

          {error ? <Text style={styles.errorText}>{error}</Text> : null}

          <TouchableOpacity style={[styles.submitBtn, loading && styles.submitBtnDisabled]} onPress={handleSubmit} disabled={loading}>
            {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitBtnText}>精算内容を確定してURLを発行</Text>}
          </TouchableOpacity>

          <View style={{ height: 40 }} />
        </Pressable>
      </ScrollView>

      {/* 傾斜倍率モーダル */}
      <Modal visible={tiltModalOpen} transparent animationType="slide" onRequestClose={() => setTiltModalOpen(false)}>
        <TouchableOpacity style={styles.modalOverlay} onPress={() => setTiltModalOpen(false)} activeOpacity={1}>
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>傾斜倍率を選択</Text>
            {[1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 5.0].map((v) => (
              <TouchableOpacity key={v} style={[styles.modalOption, tiltRatio === v.toFixed(1) && styles.modalOptionSelected]} onPress={() => { setTiltRatio(v.toFixed(1)); setTiltModalOpen(false) }}>
                <Text style={[styles.modalOptionText, tiltRatio === v.toFixed(1) && styles.modalOptionTextSelected]}>{v.toFixed(1)}倍{v === 2.0 ? '（推奨）' : ''}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>

      {/* 役職モーダル */}
      <Modal visible={roleModalIdx !== null} transparent animationType="slide" onRequestClose={() => setRoleModalIdx(null)}>
        <TouchableOpacity style={styles.modalOverlay} onPress={() => setRoleModalIdx(null)} activeOpacity={1}>
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>役職を選択</Text>
            {ROLES.map((r) => {
              const selected = roleModalIdx !== null && participants[roleModalIdx]?.role === r
              return (
                <TouchableOpacity key={r} style={[styles.modalOption, selected && styles.modalOptionSelected]} onPress={() => { if (roleModalIdx !== null) updateParticipant(roleModalIdx, 'role', r); setRoleModalIdx(null) }}>
                  <Text style={[styles.modalOptionText, selected && styles.modalOptionTextSelected]}>{r}{ROLE_EQUIVALENT_YEARS[r] ? `（${ROLE_EQUIVALENT_YEARS[r]}年換算）` : '（年次入力）'}</Text>
                </TouchableOpacity>
              )
            })}
          </View>
        </TouchableOpacity>
      </Modal>

      {/* 倍率モーダル */}
      <Modal visible={multiplierModalIdx !== null} transparent animationType="slide" onRequestClose={() => setMultiplierModalIdx(null)}>
        <TouchableOpacity style={styles.modalOverlay} onPress={() => setMultiplierModalIdx(null)} activeOpacity={1}>
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>倍率を選択</Text>
            {[1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0].map((v) => {
              const selected = multiplierModalIdx !== null && participants[multiplierModalIdx]?.manual_multiplier === String(v)
              return (
                <TouchableOpacity key={v} style={[styles.modalOption, selected && styles.modalOptionSelected]} onPress={() => { if (multiplierModalIdx !== null) updateParticipant(multiplierModalIdx, 'manual_multiplier', String(v)); setMultiplierModalIdx(null) }}>
                  <Text style={[styles.modalOptionText, selected && styles.modalOptionTextSelected]}>{v.toFixed(1)}倍</Text>
                </TouchableOpacity>
              )
            })}
          </View>
        </TouchableOpacity>
      </Modal>

      {/* プリセットモーダル */}
      <Modal visible={presetModalIdx !== null} transparent animationType="slide" onRequestClose={() => setPresetModalIdx(null)}>
        <TouchableOpacity style={styles.modalOverlay} onPress={() => setPresetModalIdx(null)} activeOpacity={1}>
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>項目名を選択</Text>
            {EVENT_PRESETS.map((preset) => (
              <TouchableOpacity key={preset} style={styles.modalOption} onPress={() => { if (presetModalIdx !== null) updateEvent(presetModalIdx, 'name', preset); setPresetModalIdx(null) }}>
                <Text style={styles.modalOptionText}>{preset}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>

      {/* メンバー選択モーダル */}
      <Modal visible={memberPickerIdx !== null} transparent animationType="slide" onRequestClose={() => setMemberPickerIdx(null)}>
        <TouchableOpacity style={styles.modalOverlay} onPress={() => setMemberPickerIdx(null)} activeOpacity={1}>
          <View style={styles.memberPickerSheet} onStartShouldSetResponder={() => true}>
            {/* 固定ヘッダー */}
            <View style={styles.memberPickerHeader}>
              <Text style={styles.memberPickerTitle}>過去のメンバーから選択</Text>
              <TouchableOpacity onPress={() => setMemberPickerIdx(null)} style={styles.memberPickerCloseBtn}>
                <Text style={styles.memberPickerCloseText}>✕ 閉じる</Text>
              </TouchableOpacity>
            </View>
            {/* スクロールリスト */}
            {memberPickerList.length === 0 ? (
              <Text style={[styles.hint, { textAlign: 'center', paddingVertical: 24 }]}>過去のメンバーがいません</Text>
            ) : (
              <ScrollView style={styles.memberPickerList}>
                {memberPickerList.map((s) => (
                  <TouchableOpacity
                    key={s.name}
                    style={styles.modalOption}
                    onPress={() => {
                      if (memberPickerIdx !== null) applySuggestion(memberPickerIdx, s)
                      setMemberPickerIdx(null)
                    }}
                  >
                    <Text style={styles.modalOptionText}>{s.name}</Text>
                    <Text style={styles.memberPickerSub}>{s.role}{s.tenure_years ? ` ${s.tenure_years}年目` : ''}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}
          </View>
        </TouchableOpacity>
      </Modal>

      {/* 日付ピッカーモーダル（インラインカレンダー） */}
      <Modal visible={showDatePicker} transparent animationType="fade" onRequestClose={() => setShowDatePicker(false)}>
        <TouchableOpacity style={styles.calendarOverlay} onPress={() => setShowDatePicker(false)} activeOpacity={1}>
          <View style={styles.calendarCard} onStartShouldSetResponder={() => true}>
            <View style={styles.datePickerHeader}>
              <Text style={styles.datePickerTitle}>📅 日付を選択</Text>
              <TouchableOpacity onPress={() => setShowDatePicker(false)}>
                <Text style={styles.datePickerCancel}>✕</Text>
              </TouchableOpacity>
            </View>
            {Platform.OS === 'ios' && (
              <DateTimePicker
                value={pickerDate}
                mode="date"
                display="inline"
                onChange={handleDatePickerChange}
                locale="ja-JP"
                accentColor="#e97316"
                themeVariant="light"
                style={{ alignSelf: 'center', width: '100%' }}
              />
            )}
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  content: { padding: 16 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  card: { backgroundColor: '#fff', borderRadius: 16, padding: 16, marginBottom: 14, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 6, elevation: 2 },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: '#1a1a2e', marginBottom: 12 },
  input: { borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: '#111', backgroundColor: '#fff' },
  flex1: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  modeRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  modeBtn: { flex: 1, borderWidth: 2, borderColor: '#e5e7eb', borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
  modeBtnActive: { borderColor: '#e97316', backgroundColor: '#e97316' },
  modeBtnLabel: { fontSize: 14, fontWeight: '700', color: '#9ca3af' },
  modeBtnLabelActive: { color: '#fff' },
  modeBtnSub: { fontSize: 11, color: '#d1d5db', marginTop: 2 },
  modeBtnSubActive: { color: 'rgba(255,255,255,0.8)' },
  selector: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: '#fff' },
  selectorText: { fontSize: 14, color: '#111', flex: 1 },
  selectorArrow: { fontSize: 12, color: '#9ca3af', marginLeft: 8 },
  hint: { fontSize: 12, color: '#9ca3af', marginTop: 4 },
  eventCard: { borderWidth: 1, borderColor: '#fed7aa', borderRadius: 12, padding: 12, marginBottom: 10, backgroundColor: '#fff7ed' },
  eventNameRow: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  dropArrow: { position: 'absolute', right: 10, color: '#9ca3af', fontSize: 12 },
  removeBtn: { padding: 6 },
  removeBtnText: { color: '#d1d5db', fontSize: 16 },
  amountRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  unit: { fontSize: 13, color: '#6b7280', minWidth: 36 },
  required: { fontSize: 11, color: '#fb923c', marginTop: 4 },
  splitRow: { flexDirection: 'row', gap: 6, marginTop: 8 },
  splitBtn: { flex: 1, borderWidth: 2, borderColor: '#e5e7eb', borderRadius: 8, paddingVertical: 6, alignItems: 'center' },
  splitBtnTiltActive: { borderColor: '#e97316', backgroundColor: '#e97316' },
  splitBtnEqualActive: { borderColor: '#3b82f6', backgroundColor: '#3b82f6' },
  splitBtnText: { fontSize: 12, fontWeight: '600', color: '#9ca3af' },
  splitBtnTextActive: { color: '#fff' },
  splitBtnEqualTextActive: { color: '#fff' },
  addBtn: { borderWidth: 2, borderStyle: 'dashed', borderColor: '#fed7aa', borderRadius: 10, paddingVertical: 12, alignItems: 'center', marginTop: 4 },
  addBtnText: { color: '#fb923c', fontSize: 14 },
  participantCard: { borderWidth: 2, borderColor: '#f3f4f6', borderRadius: 12, padding: 12, marginBottom: 10, backgroundColor: '#f9fafb' },
  participantCardOrganizer: { borderColor: '#fb923c', backgroundColor: '#fff7ed' },
  nameRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 8 },
  organizerBtn: { borderWidth: 2, borderColor: '#e5e7eb', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 8, backgroundColor: '#fff' },
  organizerBtnActive: { borderColor: '#fbbf24', backgroundColor: '#fbbf24' },
  organizerBtnText: { fontSize: 12, fontWeight: '700', color: '#374151' },
  tenureRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  tenureInput: { width: 64, textAlign: 'center' },
  suggestionsBox: { position: 'absolute', top: 44, left: 0, right: 0, backgroundColor: '#fff', borderWidth: 1, borderColor: '#fed7aa', borderRadius: 10, zIndex: 100, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.12, shadowRadius: 8, elevation: 8 },
  suggestionItem: { padding: 12, borderBottomWidth: 1, borderBottomColor: '#f3f4f6' },
  suggestionName: { fontSize: 14, fontWeight: '600', color: '#111' },
  suggestionSub: { fontSize: 12, color: '#9ca3af', marginTop: 2 },
  // 名前入力行（👥ボタン付き）
  nameInputRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  memberPickerBtn: { width: 38, height: 38, borderRadius: 8, borderWidth: 1, borderColor: '#e5e7eb', backgroundColor: '#f9fafb', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  memberPickerBtnText: { fontSize: 16 },
  memberPickerSub: { fontSize: 12, color: '#9ca3af', marginTop: 2 },
  memberPickerSheet: { backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingTop: 0, paddingBottom: 40, maxHeight: '70%' },
  memberPickerHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: '#f3f4f6' },
  memberPickerTitle: { fontSize: 16, fontWeight: '700', color: '#1a1a2e' },
  memberPickerCloseBtn: { paddingHorizontal: 4, paddingVertical: 4 },
  memberPickerCloseText: { fontSize: 13, color: '#9ca3af', fontWeight: '600' },
  memberPickerList: { flexGrow: 0 },
  // 出席管理（マトリクス表）
  matrixTable: { flexDirection: 'row', marginTop: 10, borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 10, overflow: 'hidden' },
  matrixNameCol: { width: 100, borderRightWidth: 1, borderRightColor: '#e5e7eb' },
  matrixHeaderCell: { height: 40, backgroundColor: '#f3f4f6', justifyContent: 'center', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#e5e7eb', paddingHorizontal: 8 },
  matrixNameDataCell: { height: 52, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, gap: 4, borderBottomWidth: 1, borderBottomColor: '#f3f4f6' },
  matrixHeaderRow: { flexDirection: 'row', height: 40, backgroundColor: '#f3f4f6', borderBottomWidth: 1, borderBottomColor: '#e5e7eb' },
  matrixEventHeaderCell: { width: 80, height: 40, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 4, borderRightWidth: 1, borderRightColor: '#e5e7eb' },
  matrixHeaderText: { fontSize: 11, fontWeight: '700', color: '#6b7280', textAlign: 'center' },
  matrixNameText: { flex: 1, fontSize: 13, fontWeight: '500', color: '#111' },
  matrixOrgMark: { fontSize: 12 },
  matrixDataRow: { flexDirection: 'row', height: 52, borderBottomWidth: 1, borderBottomColor: '#f3f4f6' },
  matrixCell: { width: 80, height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, borderRightWidth: 1, borderRightColor: '#f3f4f6' },
  matrixCheckBox: { width: 22, height: 22, borderRadius: 5, borderWidth: 2, borderColor: '#d1d5db', backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  matrixCheckBoxChecked: { borderColor: '#e97316', backgroundColor: '#e97316' },
  matrixCheckMark: { color: '#fff', fontSize: 12, fontWeight: '700' },
  matrixPayerBtn: { paddingHorizontal: 3, paddingVertical: 2, borderRadius: 4, borderWidth: 1, borderColor: '#e5e7eb', opacity: 0.4 },
  matrixPayerBtnActive: { borderColor: '#f59e0b', backgroundColor: '#fef3c7', opacity: 1 },
  matrixPayerBtnText: { fontSize: 12 },
  errorText: { color: '#dc2626', fontSize: 14, textAlign: 'center', marginBottom: 12 },
  submitBtn: { backgroundColor: '#e97316', borderRadius: 12, paddingVertical: 16, alignItems: 'center', marginTop: 8 },
  submitBtnDisabled: { opacity: 0.6 },
  submitBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  eventDateRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  calendarBtn: { width: 44, height: 44, borderWidth: 2, borderColor: '#fed7aa', backgroundColor: '#fff7ed', borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  calendarBtnText: { fontSize: 20 },
  calendarOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  calendarCard: { backgroundColor: '#fff', borderRadius: 20, overflow: 'hidden', width: '100%', alignItems: 'center' },
  datePickerHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#f3f4f6', width: '100%' },
  datePickerTitle: { fontSize: 15, fontWeight: '700', color: '#1a1a2e' },
  datePickerCancel: { fontSize: 18, color: '#9ca3af', paddingHorizontal: 4 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingTop: 20, paddingBottom: 40 },
  modalTitle: { fontSize: 16, fontWeight: '700', color: '#1a1a2e', textAlign: 'center', marginBottom: 12, paddingHorizontal: 20 },
  modalOption: { paddingVertical: 14, paddingHorizontal: 24, borderBottomWidth: 1, borderBottomColor: '#f3f4f6' },
  modalOptionSelected: { backgroundColor: '#fff7ed' },
  modalOptionText: { fontSize: 15, color: '#374151' },
  modalOptionTextSelected: { color: '#e97316', fontWeight: '700' },
})
