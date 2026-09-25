import React, { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react'
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, Alert, ActivityIndicator, Modal, Platform, Pressable,
  Keyboard, InputAccessoryView,
} from 'react-native'
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker'
import * as Haptics from 'expo-haptics'
import AsyncStorage from '@react-native-async-storage/async-storage'
import type { CreateScreenProps } from '../navigation/types'
import { ROLES, ROLE_EQUIVALENT_YEARS } from '../lib/calculations'
import { createRoom, updateRoom, saveTemplate, updateTemplate, deleteTemplate, getSuggestions, getRecentMembers, type Suggestion, type TemplateParticipant, type TemplateEvent } from '../lib/actions'
import { getDeviceId } from '../lib/deviceId'
import { supabase } from '../lib/supabase'
import { Colors } from '../theme/colors'

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
const NUMERIC_ACCESSORY_ID = 'createScreenNumericDone'
const TILT_INTRO_SEEN_KEY = 'has_seen_tilt_intro'
// 参加者を入れたまま金額が入らない状態がこの時間続いたらヒントを出す
const AMOUNT_HINT_DELAY_MS = 5 * 60 * 1000

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
  const { fromShareId, templateId, copyFromShareId, baseMembersFromShareId, templateEditId, resumeDraftShareId } = route.params ?? {}
  const isEdit = !!fromShareId
  const isTemplateEdit = !!templateEditId

  const [templateName, setTemplateName] = useState('')
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
  const [tiltHelpOpen, setTiltHelpOpen] = useState(false)
  const [multiplierModalIdx, setMultiplierModalIdx] = useState<number | null>(null)
  const [roleModalIdx, setRoleModalIdx] = useState<number | null>(null)
  const [showDatePicker, setShowDatePicker] = useState(false)
  const [pickerDate, setPickerDate] = useState(new Date())
  const [deviceId, setDeviceId] = useState<string | null>(null)

  // オートセーブ（下書き）用：一度作成した下書きルームのshareIdを保持し、以降はそれをupdateし続ける
  const draftShareIdRef = useRef<string | null>(null)
  const draftDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const autosaveChainRef = useRef<Promise<void>>(Promise.resolve())
  const [draftSaving, setDraftSaving] = useState(false)

  // 傾斜精算の初回説明（1回のみ）
  const [tiltIntroOpen, setTiltIntroOpen] = useState(false)
  const tiltIntroSeenRef = useRef(true)
  // 金額未入力の救済ヒント
  const [amountHintVisible, setAmountHintVisible] = useState(false)
  const [amountHintDismissed, setAmountHintDismissed] = useState(false)

  useEffect(() => {
    getDeviceId().then(setDeviceId)
    AsyncStorage.getItem(TILT_INTRO_SEEN_KEY)
      .then((v) => { tiltIntroSeenRef.current = v === 'true' })
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (fromShareId) {
      loadFromRoom(fromShareId)
    } else if (templateId) {
      loadFromTemplate(templateId)
    } else if (copyFromShareId) {
      loadFromRoomCopy(copyFromShareId)
    } else if (baseMembersFromShareId) {
      loadFromRoomCopy(baseMembersFromShareId, { membersOnly: true })
    } else if (templateEditId) {
      loadForTemplateEdit(templateEditId)
    } else if (resumeDraftShareId) {
      draftShareIdRef.current = resumeDraftShareId
      loadFromRoom(resumeDraftShareId)
    }
  }, [fromShareId, templateId, copyFromShareId, baseMembersFromShareId, templateEditId, resumeDraftShareId])

  useLayoutEffect(() => {
    if (isTemplateEdit) {
      navigation.setOptions({ title: 'テンプレートを編集' })
    } else if (isEdit) {
      navigation.setOptions({ title: '精算を編集' })
    }
  }, [isTemplateEdit, isEdit, navigation])

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
      setEventDate((room.event_date as string | null) ?? '')
      setEvents(eData.length > 0 ? eData.map((e) => {
        const rawAmt = e.total_amount as number | null
        const payerIdx = pData.findIndex((p) => p.id === e.payer_participant_id)
        return { name: e.event_name as string, totalAmount: rawAmt != null && rawAmt > 0 ? String(rawAmt) : '', splitMode: (e.split_mode as string) === 'equal' ? 'equal' : 'tilt', payerParticipantIdx: payerIdx >= 0 ? payerIdx : null }
      }) : [{ name: '1次会', totalAmount: '', splitMode: 'tilt', payerParticipantIdx: null }])
      const orgIdx = pData.findIndex((p) => p.is_organizer)
      setOrganizerIdx(orgIdx >= 0 ? orgIdx : null)
      setParticipants(pData.map((p, pIdx) => ({
        name: p.name as string,
        role: p.role as string,
        tenure_years: p.tenure_years != null ? String(p.tenure_years) : '',
        fixed_amount: p.fixed_amount != null ? String(p.fixed_amount) : '',
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
      // orgIdx を先に確定（フォールバック立替者として使うため）
      const orgIdx = pData.findIndex((p) => p.is_organizer)
      console.log('[loadFromTemplate] 元データ:', JSON.stringify(eData.map((e) => ({ name: e.name, amount: e.total_amount, payer: e.payer_participant_name }))))
      console.log('[loadFromTemplate] orgIdx:', orgIdx, orgIdx >= 0 ? `(${pData[orgIdx]?.name})` : '(幹事なし)')
      setTiltRatio(((tmpl.tilt_ratio as number) ?? 2.0).toFixed(1))
      setManualMode((tmpl.manual_mode as boolean) ?? false)
      const evtCount = eData.length || 1
      const newEvents: EventState[] = eData.length > 0 ? eData.map((e) => {
        let payerIdx = -1
        if (e.payer_participant_name != null) {
          payerIdx = pData.findIndex((p) => p.name === e.payer_participant_name)
          if (payerIdx === -1) {
            // 名前が一致するメンバーがいない → 幹事にフォールバック
            console.log(`[loadFromTemplate] "${e.name}": payer "${e.payer_participant_name}" 不在 → 幹事(idx=${orgIdx})にフォールバック`)
          } else {
            console.log(`[loadFromTemplate] "${e.name}": payer "${e.payer_participant_name}" → idx=${payerIdx}`)
          }
        } else {
          // 旧テンプレート等で payer_participant_name 未保存 → 幹事にフォールバック
          console.log(`[loadFromTemplate] "${e.name}": payer_participant_name 未設定 → 幹事(idx=${orgIdx})にフォールバック`)
        }
        // 立替者が特定できなかった場合は幹事をデフォルト立替者にセット
        const resolvedPayerIdx = payerIdx >= 0 ? payerIdx : (orgIdx >= 0 ? orgIdx : null)
        return {
          name: e.name,
          totalAmount: e.total_amount != null && e.total_amount > 0 ? String(e.total_amount) : '',
          splitMode: e.split_mode === 'equal' ? 'equal' : 'tilt' as const,
          payerParticipantIdx: resolvedPayerIdx,
        }
      }) : [{ name: '1次会', totalAmount: '', splitMode: 'tilt' as const, payerParticipantIdx: orgIdx >= 0 ? orgIdx : null }]
      console.log('[loadFromTemplate] セット後:', JSON.stringify(newEvents.map((e) => ({ name: e.name, totalAmount: e.totalAmount, payerIdx: e.payerParticipantIdx }))))
      setEvents(newEvents)
      setOrganizerIdx(orgIdx >= 0 ? orgIdx : null)
      setParticipants(pData.map((p) => ({ name: p.name, role: p.role, tenure_years: p.tenure_years != null ? String(p.tenure_years) : '', fixed_amount: '', manual_multiplier: String(p.manual_multiplier ?? 1.0), attendances: Array<boolean>(evtCount).fill(true) })))
    } finally {
      setInitialLoading(false)
    }
  }

  // membersOnly: 参加者（役職・年次・幹事・倍率）と傾斜設定だけを引き継ぎ、お会計は空の1次会から始める
  async function loadFromRoomCopy(shareId: string, { membersOnly = false }: { membersOnly?: boolean } = {}) {
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
      console.log('[loadFromRoomCopy] 元データ 金額・立替:', JSON.stringify(eData.map((e) => ({ name: e.event_name, amount: e.total_amount, payerId: e.payer_participant_id }))))
      const newEvents: EventState[] = eData.length > 0 ? eData.map((e) => {
        const rawPayerId = e.payer_participant_id as string | null
        const payerIdx = rawPayerId != null
          ? pData.findIndex((p) => (p.id as string) === rawPayerId)
          : -1
        const rawAmount = e.total_amount as number | null
        return {
          name: e.event_name as string,
          totalAmount: rawAmount != null && rawAmount > 0 ? String(rawAmount) : '',
          splitMode: (e.split_mode as string) === 'equal' ? 'equal' : 'tilt' as const,
          payerParticipantIdx: payerIdx >= 0 ? payerIdx : null,
        }
      }) : [{ name: '1次会', totalAmount: '', splitMode: 'tilt' as const, payerParticipantIdx: null }]
      console.log('[loadFromRoomCopy] セット後 金額・立替:', JSON.stringify(newEvents.map((e) => ({ name: e.name, totalAmount: e.totalAmount, payerIdx: e.payerParticipantIdx }))))
      setTiltRatio(((room.tilt_ratio as number) ?? 2.0).toFixed(1))
      setManualMode((room.manual_mode as boolean) ?? false)
      setEventDate('')
      const orgIdx = pData.findIndex((p) => p.is_organizer)
      setOrganizerIdx(orgIdx >= 0 ? orgIdx : null)
      if (membersOnly) {
        setEvents([{ name: '1次会', totalAmount: '', splitMode: 'tilt', payerParticipantIdx: orgIdx >= 0 ? orgIdx : null }])
      } else {
        setEvents(newEvents)
      }
      setParticipants(pData.map((p, pIdx) => ({
        name: p.name as string,
        role: p.role as string,
        tenure_years: p.tenure_years != null ? String(p.tenure_years) : '',
        fixed_amount: '',
        manual_multiplier: String(p.manual_multiplier ?? '1.0'),
        attendances: membersOnly
          ? [true]
          : eData.map((e) => (rawAttendances ?? []).some((a) => a.event_id === e.id && a.participant_id === pData[pIdx].id)),
      })))
    } finally {
      setInitialLoading(false)
    }
  }

  async function loadForTemplateEdit(tmplId: string) {
    setInitialLoading(true)
    try {
      const { data: tmpl } = await supabase.from('nomikai_seisan_templates').select('*').eq('id', tmplId).single()
      if (!tmpl) return
      const pData = (tmpl.participants_data as TemplateParticipant[]) ?? []
      const eData = (tmpl.events_data as TemplateEvent[]) ?? []
      setTemplateName(tmpl.template_name as string ?? '')
      setTiltRatio(((tmpl.tilt_ratio as number) ?? 2.0).toFixed(1))
      setManualMode((tmpl.manual_mode as boolean) ?? false)
      const evtCount = eData.length || 1
      const orgIdx = pData.findIndex((p) => p.is_organizer)
      const newEvents: EventState[] = eData.length > 0 ? eData.map((e) => {
        const payerIdx = e.payer_participant_name != null
          ? pData.findIndex((p) => p.name === e.payer_participant_name)
          : -1
        return {
          name: e.name,
          totalAmount: e.total_amount != null && e.total_amount > 0 ? String(e.total_amount) : '',
          splitMode: e.split_mode === 'equal' ? 'equal' : 'tilt' as const,
          payerParticipantIdx: payerIdx >= 0 ? payerIdx : (orgIdx >= 0 ? orgIdx : null),
        }
      }) : [{ name: '1次会', totalAmount: '', splitMode: 'tilt' as const, payerParticipantIdx: orgIdx >= 0 ? orgIdx : null }]
      setEvents(newEvents)
      setOrganizerIdx(orgIdx >= 0 ? orgIdx : null)
      setParticipants(pData.map((p) => ({
        name: p.name,
        role: p.role,
        tenure_years: p.tenure_years != null ? String(p.tenure_years) : '',
        fixed_amount: '',
        manual_multiplier: String(p.manual_multiplier ?? 1.0),
        attendances: p.attendances ?? Array<boolean>(evtCount).fill(true),
      })))
    } finally {
      setInitialLoading(false)
    }
  }

  function buildTemplateData() {
    const validEntries = participants.map((p, idx) => ({ p, idx })).filter(({ p }) => p.name.trim() !== '')
    const participantsData: TemplateParticipant[] = validEntries.map(({ p, idx }) => ({
      name: p.name.trim(),
      role: p.role,
      tenure_years: p.role === 'その他役職' && p.tenure_years ? Number(p.tenure_years) : null,
      is_organizer: idx === organizerIdx,
      manual_multiplier: parseFloat(p.manual_multiplier) || 1.0,
      attendances: events.map((_, eIdx) => p.attendances[eIdx] ?? true),
    }))
    const eventsData: TemplateEvent[] = events.map((ev, i) => {
      const rawIdx = ev.payerParticipantIdx ?? null
      const payerName = rawIdx !== null && participants[rawIdx]?.name.trim()
        ? participants[rawIdx].name.trim()
        : null
      return {
        name: ev.name.trim() || `${i + 1}次会`,
        total_amount: Number(ev.totalAmount) || 0,
        split_mode: ev.splitMode ?? 'tilt',
        payer_participant_name: payerName,
      }
    })
    return { participantsData, eventsData, validEntries }
  }

  const handleSaveTemplateEdit = async () => {
    if (!templateEditId) return
    setError('')
    if (!templateName.trim()) { setError('テンプレート名を入力してください'); return }
    const { validEntries } = buildTemplateData()
    if (validEntries.length < 1) { setError('参加者を1人以上入力してください'); return }
    setLoading(true)
    try {
      const { participantsData, eventsData } = buildTemplateData()
      await updateTemplate(templateEditId, {
        templateName: templateName.trim(),
        tiltRatio: parseFloat(tiltRatio) || 2.0,
        manualMode,
        participantsData,
        eventsData,
      })
      navigation.goBack()
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存に失敗しました')
    } finally {
      setLoading(false)
    }
  }

  const handleSaveAsNewTemplate = async () => {
    Alert.prompt('別名で保存', '新しいテンプレート名を入力してください', async (name) => {
      if (!name?.trim()) return
      setLoading(true)
      try {
        const deviceId = await getDeviceId()
        const { participantsData, eventsData } = buildTemplateData()
        await saveTemplate({
          deviceId,
          templateName: name.trim(),
          tiltRatio: parseFloat(tiltRatio) || 2.0,
          manualMode,
          participantsData,
          eventsData,
        })
        Alert.alert('保存しました', '新しいテンプレートとして保存しました', [
          { text: 'OK', onPress: () => navigation.goBack() },
        ])
      } catch (e) {
        Alert.alert('エラー', e instanceof Error ? e.message : '保存に失敗しました')
      } finally {
        setLoading(false)
      }
    }, 'plain-text', templateName)
  }

  const handleDeleteTemplateEdit = () => {
    if (!templateEditId) return
    Alert.alert('削除確認', `「${templateName || 'このテンプレート'}」を削除しますか？`, [
      { text: 'キャンセル', style: 'cancel' },
      {
        text: '削除', style: 'destructive', onPress: async () => {
          setLoading(true)
          try {
            await deleteTemplate(templateEditId)
            navigation.goBack()
          } catch (e) {
            Alert.alert('エラー', e instanceof Error ? e.message : '削除に失敗しました')
          } finally {
            setLoading(false)
          }
        },
      },
    ])
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
      if (!deviceId) { setSuggestions(null); return }
      const list = await getSuggestions(value.trim(), deviceId)
      setSuggestions(list.length > 0 ? { idx: i, list } : null)
    }, 300)
  }, [participants, deviceId])

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

  // createRoom/updateRoom共通の入力データを構築（device_idは呼び出し側で付与）
  function buildRoomInput() {
    const validEntries = participants.map((p, idx) => ({ p, idx })).filter(({ p }) => p.name.trim() !== '')
    return {
      event_date: eventDate.trim() || null,
      tilt_ratio: parseFloat(tiltRatio) || 2.0,
      manual_mode: manualMode,
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
  }

  // オートセーブ対象か（下書きが空のまま部屋を乱造しないための最低条件）
  const hasMinimalDraftContent = () =>
    participants.some((p) => p.name.trim() !== '') || Number(events[0]?.totalAmount) > 0

  // 手動の「確定」保存と競合しないよう、下書き保存は常に直列実行する
  const queueAutosave = () => {
    autosaveChainRef.current = autosaveChainRef.current.then(async () => {
      if (!hasMinimalDraftContent()) return
      setDraftSaving(true)
      try {
        const input = buildRoomInput()
        if (draftShareIdRef.current) {
          await updateRoom(draftShareIdRef.current, input)
        } else {
          const draftDeviceId = await getDeviceId()
          draftShareIdRef.current = await createRoom({ ...input, device_id: draftDeviceId })
        }
      } catch (e) {
        console.warn('[autosave] 下書きの保存に失敗しました', e)
      } finally {
        setDraftSaving(false)
      }
    })
  }

  useEffect(() => {
    if (isEdit || isTemplateEdit || initialLoading) return
    if (draftDebounceRef.current) clearTimeout(draftDebounceRef.current)
    draftDebounceRef.current = setTimeout(queueAutosave, 800)
    return () => {
      if (draftDebounceRef.current) clearTimeout(draftDebounceRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [participants, events, eventDate, tiltRatio, manualMode, isEdit, isTemplateEdit, initialLoading])

  const namedParticipantCount = participants.filter((p) => p.name.trim() !== '').length
  const hasAnyAmount = events.some((ev) => Number(ev.totalAmount) > 0)

  // 参加者が2人以上になったら「傾斜精算とは？」を初回だけ表示する。
  // 名前の入力途中でキーボードを奪わないよう、入力が1.5秒止まってから出す
  useEffect(() => {
    if (isEdit || isTemplateEdit || initialLoading) return
    if (tiltIntroSeenRef.current || namedParticipantCount < 2) return
    const timer = setTimeout(() => {
      if (tiltIntroSeenRef.current) return
      tiltIntroSeenRef.current = true
      Keyboard.dismiss()
      setTiltIntroOpen(true)
    }, 1500)
    return () => clearTimeout(timer)
  }, [participants, namedParticipantCount, isEdit, isTemplateEdit, initialLoading])

  const closeTiltIntro = () => {
    setTiltIntroOpen(false)
    AsyncStorage.setItem(TILT_INTRO_SEEN_KEY, 'true').catch(() => {})
  }

  // 参加者2人以上・金額0のまま5分経ったら、金額入力を促すヒントを出す（金額が入れば自動で消える）
  const needsAmountHint = !isTemplateEdit && !initialLoading && namedParticipantCount >= 2 && !hasAnyAmount
  useEffect(() => {
    if (!needsAmountHint) { setAmountHintVisible(false); return }
    const timer = setTimeout(() => setAmountHintVisible(true), AMOUNT_HINT_DELAY_MS)
    return () => clearTimeout(timer)
  }, [needsAmountHint])

  const handleSubmit = async () => {
    setError('')
    if (!Number(events[0]?.totalAmount) || Number(events[0].totalAmount) <= 0) {
      setError('1次会の総額を入力してください')
      return
    }
    const validEntries = participants.map((p) => p).filter((p) => p.name.trim() !== '')
    if (validEntries.length < 1) {
      setError('参加者を1人以上入力してください')
      return
    }
    setLoading(true)
    try {
      // 進行中/待機中のオートセーブと同じ部屋を同時更新しないよう完了を待つ
      if (draftDebounceRef.current) clearTimeout(draftDebounceRef.current)
      await autosaveChainRef.current
      const input = buildRoomInput()
      if (isEdit && fromShareId) {
        await updateRoom(fromShareId, input)
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
        navigation.replace('Room', { shareId: fromShareId })
      } else if (draftShareIdRef.current) {
        await updateRoom(draftShareIdRef.current, input)
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
        navigation.replace('Room', { shareId: draftShareIdRef.current })
      } else {
        const deviceId = await getDeviceId()
        const newShareId = await createRoom({ ...input, device_id: deviceId })
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
        navigation.replace('Room', { shareId: newShareId })
      }
    } catch (e: unknown) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
      setError(e instanceof Error ? e.message : '保存に失敗しました')
    } finally {
      setLoading(false)
    }
  }

  if (initialLoading) {
    return <View style={styles.center}><ActivityIndicator size="large" color={Colors.primary} /></View>
  }

  return (
    <View style={styles.flex1}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        onScrollBeginDrag={() => setSuggestions(null)}
      >
        <Pressable onPress={() => { if (suggestions !== null) setSuggestions(null); Keyboard.dismiss() }}>

          {!isEdit && !isTemplateEdit && draftSaving && (
            <View style={styles.draftSavingRow}>
              <ActivityIndicator size="small" color={Colors.placeholder} />
              <Text style={styles.draftSavingText}>保存中...</Text>
            </View>
          )}

          {/* テンプレート名（テンプレート編集モードのみ） */}
          {isTemplateEdit && (
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>テンプレート名</Text>
              <TextInput
                style={styles.input}
                value={templateName}
                onChangeText={setTemplateName}
                placeholder="テンプレート名"
                placeholderTextColor={Colors.placeholder}
              />
            </View>
          )}

          {/* イベント名 */}
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>飲み会・イベント名</Text>
            <View style={styles.eventDateRow}>
              <TouchableOpacity style={styles.calendarBtn} onPress={() => setShowDatePicker(true)} hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }}>
                <Text style={styles.calendarBtnText}>📅</Text>
              </TouchableOpacity>
              <TextInput
                style={[styles.input, styles.flex1]}
                value={eventDate}
                onChangeText={setEventDate}
                placeholder={`例：${new Date().getFullYear()}${String(new Date().getMonth()+1).padStart(2,'0')}${String(new Date().getDate()).padStart(2,'0')} 部署飲み`}
                placeholderTextColor={Colors.placeholder}
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
              <>
                <TouchableOpacity style={styles.selector} onPress={() => setTiltModalOpen(true)} hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }}>
                  <Text style={styles.selectorText}>{tiltRatio}倍{tiltRatio === '2.0' ? '（推奨）' : ''}</Text>
                  <Text style={styles.selectorArrow}>▼</Text>
                </TouchableOpacity>
                <View style={styles.tiltExplainRow}>
                  <Text style={styles.tiltExplainText}>
                    {tiltRatio}倍：一番年次が高い人が、一番若い人の{tiltRatio}倍を目安に払います
                  </Text>
                  <TouchableOpacity onPress={() => setTiltHelpOpen(true)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Text style={styles.tiltExplainLink}>詳しく見る</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
            {manualMode && <Text style={styles.hint}>各参加者の倍率は参加者カードで設定してください</Text>}
          </View>

          {/* 会カード */}
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>お会計</Text>
            {events.map((ev, eIdx) => (
              <View key={eIdx} style={styles.eventCard}>
                <View style={styles.row}>
                  <View style={styles.eventNameRow}>
                    <TextInput
                      style={styles.eventNameInput}
                      value={ev.name}
                      onChangeText={(v) => updateEvent(eIdx, 'name', v)}
                      placeholder="例：1次会"
                      placeholderTextColor={Colors.placeholder}
                    />
                    <TouchableOpacity
                      style={styles.dropArrowBtn}
                      onPress={() => setPresetModalIdx(eIdx)}
                      hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }}
                    >
                      <Text style={styles.dropArrow}>▼</Text>
                    </TouchableOpacity>
                  </View>
                  {eIdx > 0 && (
                    <TouchableOpacity onPress={() => removeEvent(eIdx)} style={styles.removeBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
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
                    placeholderTextColor={Colors.placeholder}
                    keyboardType="numeric"
                    inputAccessoryViewID={Platform.OS === 'ios' ? NUMERIC_ACCESSORY_ID : undefined}
                  />
                  <Text style={styles.unit}>円</Text>
                </View>
                {eIdx === 0 && !isTemplateEdit && <Text style={styles.required}>※ 1次会は必須です</Text>}
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
                        placeholderTextColor={Colors.placeholder}
                      />
                      <TouchableOpacity
                        style={styles.memberPickerBtn}
                        hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }}
                        onPress={async () => {
                          if (!deviceId) return
                          const list = await getRecentMembers(deviceId)
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
                    <TouchableOpacity onPress={() => removeParticipant(i)} style={styles.removeBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                      <Text style={styles.removeBtnText}>✕</Text>
                    </TouchableOpacity>
                  )}
                </View>

                {/* 役職 or 倍率 */}
                {!manualMode ? (
                  <TouchableOpacity style={styles.selector} onPress={() => setRoleModalIdx(i)} hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }}>
                    <Text style={styles.selectorText}>{p.role}{ROLE_EQUIVALENT_YEARS[p.role] ? `（${ROLE_EQUIVALENT_YEARS[p.role]}年換算）` : '（年次入力）'}</Text>
                    <Text style={styles.selectorArrow}>▼</Text>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity style={styles.selector} onPress={() => setMultiplierModalIdx(i)} hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }}>
                    <Text style={styles.selectorText}>{p.manual_multiplier}倍</Text>
                    <Text style={styles.selectorArrow}>▼</Text>
                  </TouchableOpacity>
                )}

                {/* 年次（その他役職時） */}
                {!manualMode && p.role === 'その他役職' && (
                  <>
                    <View style={styles.tenureRow}>
                      <TextInput
                        style={[styles.input, styles.tenureInput]}
                        value={p.tenure_years}
                        onChangeText={(v) => updateParticipant(i, 'tenure_years', v)}
                        placeholder="例: 3年目"
                        placeholderTextColor={Colors.placeholder}
                        keyboardType="numeric"
                        inputAccessoryViewID={Platform.OS === 'ios' ? NUMERIC_ACCESSORY_ID : undefined}
                      />
                      <Text style={styles.unit}>年目</Text>
                    </View>
                    <Text style={styles.tenureNote}>※未入力の人は1年目扱い（全員未入力だと等分計算）になります</Text>
                  </>
                )}
                <View style={styles.tenureRow}>
                  <TextInput
                    style={[styles.input, styles.flex1]}
                    value={p.fixed_amount}
                    onChangeText={(v) => updateParticipant(i, 'fixed_amount', v)}
                    placeholder="固定額（省略可）"
                    placeholderTextColor={Colors.placeholder}
                    keyboardType="numeric"
                    inputAccessoryViewID={Platform.OS === 'ios' ? NUMERIC_ACCESSORY_ID : undefined}
                  />
                  <Text style={styles.unit}>円固定</Text>
                </View>
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

          {isTemplateEdit ? (
            <View>
              <TouchableOpacity style={[styles.submitBtn, loading && styles.submitBtnDisabled]} onPress={handleSaveTemplateEdit} disabled={loading}>
                {loading ? <ActivityIndicator color={Colors.textOnPrimary} /> : <Text style={styles.submitBtnText}>💾 保存（上書き）</Text>}
              </TouchableOpacity>
              <TouchableOpacity style={[styles.submitBtn, styles.templateSaveAsBtn, loading && styles.submitBtnDisabled]} onPress={handleSaveAsNewTemplate} disabled={loading}>
                <Text style={styles.submitBtnText}>📋 別名で保存</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.submitBtn, styles.templateDeleteBtn, loading && styles.submitBtnDisabled]} onPress={handleDeleteTemplateEdit} disabled={loading}>
                <Text style={styles.submitBtnText}>🗑 削除</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.submitBtn, styles.templateCancelBtn]} onPress={() => navigation.goBack()} disabled={loading}>
                <Text style={[styles.submitBtnText, styles.templateCancelBtnText]}>キャンセル</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity style={[styles.submitBtn, loading && styles.submitBtnDisabled]} onPress={handleSubmit} disabled={loading}>
              {loading ? <ActivityIndicator color={Colors.textOnPrimary} /> : <Text style={styles.submitBtnText}>精算内容を確定してURLを発行</Text>}
            </TouchableOpacity>
          )}

          {/* 下部ヒント表示中は確定ボタンが隠れないよう余白を広げる */}
          <View style={{ height: amountHintVisible && !amountHintDismissed ? 100 : 40 }} />
        </Pressable>
      </ScrollView>

      {/* 金額未入力のまま放置されたときの救済ヒント */}
      {amountHintVisible && !amountHintDismissed && (
        <View style={styles.amountHint}>
          <Text style={styles.amountHintText}>💡 合計金額を入力すると精算が始まります</Text>
          <TouchableOpacity onPress={() => setAmountHintDismissed(true)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Text style={styles.amountHintClose}>✕</Text>
          </TouchableOpacity>
        </View>
      )}

      {Platform.OS === 'ios' && (
        <InputAccessoryView nativeID={NUMERIC_ACCESSORY_ID}>
          <View style={styles.keyboardDoneBar}>
            <TouchableOpacity onPress={() => Keyboard.dismiss()}>
              <Text style={styles.keyboardDoneBarText}>完了</Text>
            </TouchableOpacity>
          </View>
        </InputAccessoryView>
      )}

      {/* 傾斜設定の説明モーダル */}
      <Modal visible={tiltHelpOpen} transparent animationType="slide" onRequestClose={() => setTiltHelpOpen(false)}>
        <TouchableOpacity style={styles.modalOverlay} onPress={() => setTiltHelpOpen(false)} activeOpacity={1}>
          <View style={styles.modalSheet} onStartShouldSetResponder={() => true}>
            <Text style={styles.modalTitle}>傾斜設定とは？</Text>
            <View style={{ paddingHorizontal: 24, paddingBottom: 8 }}>
              <Text style={styles.tiltHelpBody}>
                役職や年次が高い人ほど多く払う「傾斜配分」の度合いを倍率で決めます。
              </Text>
              <Text style={styles.tiltHelpBody}>
                例えば2.0倍を選ぶと、参加者の中で一番年次が高い人は、一番若い人のおよそ2倍の金額を払う計算になります。年次が中間の人はその間の金額になります。
              </Text>
              <Text style={styles.tiltHelpBody}>
                倍率を大きくするほど、若手の負担は軽く・年次が高い人の負担は重くなります。1.0倍にすると全員均等割りと同じになります。
              </Text>
              <Text style={styles.tiltHelpBody}>
                迷ったら「2.0倍（推奨）」がバランスの良い目安です。
              </Text>
            </View>
            <TouchableOpacity style={styles.tiltHelpCloseBtn} onPress={() => setTiltHelpOpen(false)}>
              <Text style={styles.tiltHelpCloseBtnText}>閉じる</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* 傾斜精算の初回説明（オンボーディング、1回のみ） */}
      <Modal visible={tiltIntroOpen} transparent animationType="fade" onRequestClose={closeTiltIntro}>
        <View style={styles.introOverlay}>
          <View style={styles.introCard}>
            <Text style={styles.introEmoji}>⚖️</Text>
            <Text style={styles.introTitle}>傾斜精算とは？</Text>
            <Text style={styles.introHeading}>傾斜比率</Text>
            <Text style={styles.introBody}>
              年次が高い人ほど多めに払う割り勘です。「2.0倍」なら、一番年次が高い人が一番若い人のおよそ2倍を払います。
            </Text>
            <Text style={styles.introHeading}>若手にやさしい精算</Text>
            <Text style={styles.introBody}>
              収入の差を反映して、若手の負担を軽くできます。「先輩が多めに出す」をスマートに、揉めずに計算できます。
            </Text>
            <Text style={styles.introHeading}>年次の入力がポイント</Text>
            <Text style={styles.introBody}>
              各参加者の役職か年次を入れることで傾斜がかかります。未入力のままだと全員同じ扱い（等分）になるので、ぜひ入力してください。
            </Text>
            <TouchableOpacity style={styles.introBtn} onPress={closeTiltIntro}>
              <Text style={styles.introBtnText}>わかりました</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

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
                accentColor={Colors.primary}
                themeVariant="light"
                style={{ alignSelf: 'center', width: '100%' }}
              />
            )}
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: 16 },
  keyboardDoneBar: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 8, backgroundColor: Colors.background, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.border },
  draftSavingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 6, marginBottom: 8 },
  draftSavingText: { fontSize: 12, color: Colors.placeholder },
  keyboardDoneBarText: { color: Colors.primary, fontSize: 16, fontWeight: '700' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  card: { backgroundColor: Colors.card, borderRadius: 16, padding: 16, marginBottom: 14, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 6, elevation: 2 },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: Colors.primary, marginBottom: 12 },
  input: { borderWidth: 1, borderColor: Colors.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: Colors.text, backgroundColor: Colors.card },
  flex1: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  modeRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  modeBtn: { flex: 1, borderWidth: 2, borderColor: Colors.border, borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
  modeBtnActive: { borderColor: Colors.primary, backgroundColor: Colors.primary },
  modeBtnLabel: { fontSize: 14, fontWeight: '700', color: Colors.placeholder },
  modeBtnLabelActive: { color: Colors.textOnPrimary },
  modeBtnSub: { fontSize: 11, color: Colors.placeholder, marginTop: 2 },
  modeBtnSubActive: { color: 'rgba(255,255,255,0.8)' },
  selector: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderColor: Colors.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: Colors.card },
  selectorText: { fontSize: 14, color: Colors.text, flex: 1 },
  selectorArrow: { fontSize: 12, color: Colors.placeholder, marginLeft: 8 },
  hint: { fontSize: 12, color: Colors.placeholder, marginTop: 4 },
  tiltExplainRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 },
  tiltExplainText: { flex: 1, fontSize: 12, color: Colors.placeholder, marginRight: 8 },
  tiltExplainLink: { fontSize: 12, color: Colors.primary, fontWeight: '600' },
  tiltHelpBody: { fontSize: 14, color: Colors.text, lineHeight: 21, marginBottom: 12 },
  tiltHelpCloseBtn: { marginHorizontal: 24, marginTop: 4, backgroundColor: Colors.background, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  tiltHelpCloseBtnText: { fontSize: 14, fontWeight: '700', color: Colors.text },
  eventCard: { borderWidth: 1, borderColor: Colors.accentLight, borderRadius: 12, padding: 12, marginBottom: 10, backgroundColor: Colors.accentLight },
  eventNameRow: {
    flex: 1, flexDirection: 'row', alignItems: 'center',
    borderWidth: 1, borderColor: Colors.border, borderRadius: 10, backgroundColor: Colors.card,
    paddingLeft: 12, paddingRight: 6,
  },
  eventNameInput: { flex: 1, paddingVertical: 10, fontSize: 15, color: Colors.text },
  dropArrowBtn: { paddingHorizontal: 6, paddingVertical: 8 },
  dropArrow: { color: Colors.placeholder, fontSize: 13 },
  removeBtn: { padding: 6 },
  removeBtnText: { color: Colors.placeholder, fontSize: 16 },
  amountRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  unit: { fontSize: 13, color: Colors.textSecondary, minWidth: 36 },
  required: { fontSize: 11, color: Colors.warning, marginTop: 4 },
  splitRow: { flexDirection: 'row', gap: 6, marginTop: 8 },
  splitBtn: { flex: 1, borderWidth: 2, borderColor: Colors.border, borderRadius: 8, paddingVertical: 6, alignItems: 'center' },
  splitBtnTiltActive: { borderColor: Colors.primary, backgroundColor: Colors.primary },
  splitBtnEqualActive: { borderColor: Colors.info, backgroundColor: Colors.info },
  splitBtnText: { fontSize: 12, fontWeight: '600', color: Colors.placeholder },
  splitBtnTextActive: { color: Colors.textOnPrimary },
  splitBtnEqualTextActive: { color: Colors.textOnPrimary },
  addBtn: { borderWidth: 2, borderStyle: 'dashed', borderColor: Colors.accentLight, borderRadius: 10, paddingVertical: 12, alignItems: 'center', marginTop: 4 },
  addBtnText: { color: Colors.warning, fontSize: 14 },
  participantCard: { borderWidth: 2, borderColor: Colors.border, borderRadius: 12, padding: 12, marginBottom: 10, backgroundColor: Colors.background },
  participantCardOrganizer: { borderColor: Colors.warning, backgroundColor: Colors.accentLight },
  nameRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 8 },
  organizerBtn: { borderWidth: 2, borderColor: Colors.border, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 8, backgroundColor: Colors.card },
  organizerBtnActive: { borderColor: Colors.accent, backgroundColor: Colors.accent },
  organizerBtnText: { fontSize: 12, fontWeight: '700', color: Colors.text },
  tenureRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  tenureInput: { width: 110, textAlign: 'center' },
  tenureNote: { fontSize: 11, color: Colors.placeholder, marginTop: 4 },
  suggestionsBox: { position: 'absolute', top: 44, left: 0, right: 0, backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.accentLight, borderRadius: 10, zIndex: 100, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.12, shadowRadius: 8, elevation: 8 },
  suggestionItem: { padding: 12, borderBottomWidth: 1, borderBottomColor: Colors.border },
  suggestionName: { fontSize: 14, fontWeight: '600', color: Colors.text },
  suggestionSub: { fontSize: 12, color: Colors.placeholder, marginTop: 2 },
  // 名前入力行（👥ボタン付き）
  nameInputRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  memberPickerBtn: { width: 38, height: 38, borderRadius: 8, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.background, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  memberPickerBtnText: { fontSize: 16 },
  memberPickerSub: { fontSize: 12, color: Colors.placeholder, marginTop: 2 },
  memberPickerSheet: { backgroundColor: Colors.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingTop: 0, paddingBottom: 40, maxHeight: '70%' },
  memberPickerHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: Colors.border },
  memberPickerTitle: { fontSize: 16, fontWeight: '700', color: Colors.primary },
  memberPickerCloseBtn: { paddingHorizontal: 4, paddingVertical: 4 },
  memberPickerCloseText: { fontSize: 13, color: Colors.placeholder, fontWeight: '600' },
  memberPickerList: { flexGrow: 0 },
  // 出席管理（マトリクス表）
  matrixTable: { flexDirection: 'row', marginTop: 10, borderWidth: 1, borderColor: Colors.border, borderRadius: 10, overflow: 'hidden' },
  matrixNameCol: { width: 100, borderRightWidth: 1, borderRightColor: Colors.border },
  matrixHeaderCell: { height: 40, backgroundColor: Colors.background, justifyContent: 'center', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: Colors.border, paddingHorizontal: 8 },
  matrixNameDataCell: { height: 52, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, gap: 4, borderBottomWidth: 1, borderBottomColor: Colors.border },
  matrixHeaderRow: { flexDirection: 'row', height: 40, backgroundColor: Colors.background, borderBottomWidth: 1, borderBottomColor: Colors.border },
  matrixEventHeaderCell: { width: 80, height: 40, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 4, borderRightWidth: 1, borderRightColor: Colors.border },
  matrixHeaderText: { fontSize: 11, fontWeight: '700', color: Colors.textSecondary, textAlign: 'center' },
  matrixNameText: { flex: 1, fontSize: 13, fontWeight: '500', color: Colors.text },
  matrixOrgMark: { fontSize: 12 },
  matrixDataRow: { flexDirection: 'row', height: 52, borderBottomWidth: 1, borderBottomColor: Colors.border },
  matrixCell: { width: 80, height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, borderRightWidth: 1, borderRightColor: Colors.border },
  matrixCheckBox: { width: 22, height: 22, borderRadius: 5, borderWidth: 2, borderColor: Colors.border, backgroundColor: Colors.card, alignItems: 'center', justifyContent: 'center' },
  matrixCheckBoxChecked: { borderColor: Colors.primary, backgroundColor: Colors.primary },
  matrixCheckMark: { color: Colors.textOnPrimary, fontSize: 12, fontWeight: '700' },
  matrixPayerBtn: { paddingHorizontal: 3, paddingVertical: 2, borderRadius: 4, borderWidth: 1, borderColor: Colors.border, opacity: 0.4 },
  matrixPayerBtnActive: { borderColor: Colors.accent, backgroundColor: Colors.accentLight, opacity: 1 },
  matrixPayerBtnText: { fontSize: 12 },
  errorText: { color: Colors.error, fontSize: 14, textAlign: 'center', marginBottom: 12 },
  submitBtn: { backgroundColor: Colors.primary, borderRadius: 12, paddingVertical: 16, alignItems: 'center', marginTop: 8 },
  submitBtnDisabled: { opacity: 0.6 },
  submitBtnText: { color: Colors.textOnPrimary, fontSize: 16, fontWeight: '700' },
  templateSaveAsBtn: { backgroundColor: Colors.info },
  templateDeleteBtn: { backgroundColor: Colors.error },
  templateCancelBtn: { backgroundColor: Colors.background, borderWidth: 1, borderColor: Colors.border },
  templateCancelBtnText: { color: Colors.text },
  eventDateRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  calendarBtn: { width: 44, height: 44, borderWidth: 2, borderColor: Colors.accentLight, backgroundColor: Colors.accentLight, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  calendarBtnText: { fontSize: 20 },
  calendarOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  calendarCard: { backgroundColor: Colors.card, borderRadius: 20, overflow: 'hidden', width: '100%', alignItems: 'center' },
  datePickerHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: Colors.border, width: '100%' },
  datePickerTitle: { fontSize: 15, fontWeight: '700', color: Colors.primary },
  datePickerCancel: { fontSize: 18, color: Colors.placeholder, paddingHorizontal: 4 },
  amountHint: {
    position: 'absolute', left: 16, right: 16, bottom: 24,
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: Colors.primaryLight, borderWidth: 1, borderColor: Colors.borderStrong, borderRadius: 12,
    paddingVertical: 12, paddingHorizontal: 14,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 6, elevation: 3,
  },
  amountHintText: { flex: 1, fontSize: 13, color: Colors.primary, fontWeight: '600' },
  amountHintClose: { fontSize: 14, color: Colors.placeholder },
  introOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 24 },
  introCard: { backgroundColor: Colors.card, borderRadius: 20, padding: 24 },
  introEmoji: { fontSize: 36, textAlign: 'center' },
  introTitle: { fontSize: 20, fontWeight: '800', color: Colors.primary, textAlign: 'center', marginTop: 4, marginBottom: 12 },
  introHeading: { fontSize: 14, fontWeight: '700', color: Colors.text, marginTop: 8, marginBottom: 4 },
  introBody: { fontSize: 13, color: Colors.textSecondary, lineHeight: 20 },
  introBtn: { backgroundColor: Colors.primary, borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 20 },
  introBtnText: { color: Colors.textOnPrimary, fontSize: 15, fontWeight: '700' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: Colors.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingTop: 20, paddingBottom: 40 },
  modalTitle: { fontSize: 16, fontWeight: '700', color: Colors.primary, textAlign: 'center', marginBottom: 12, paddingHorizontal: 20 },
  modalOption: { paddingVertical: 14, paddingHorizontal: 24, borderBottomWidth: 1, borderBottomColor: Colors.border },
  modalOptionSelected: { backgroundColor: Colors.accentLight },
  modalOptionText: { fontSize: 15, color: Colors.text },
  modalOptionTextSelected: { color: Colors.primary, fontWeight: '700' },
})
