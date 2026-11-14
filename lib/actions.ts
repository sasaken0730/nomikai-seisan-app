import { supabase } from './supabase'

export interface ParticipantData {
  name: string
  role: string
  tenure_years: number | null
  fixed_amount: number | null
  is_organizer: boolean
  manual_multiplier: number
}

export interface EventData {
  name: string
  total_amount: number
  sort_order: number
  split_mode: string
  payer_participant_idx: number | null
}

export interface RoomInput {
  event_date: string | null
  tilt_ratio: number
  manual_mode: boolean
  device_id?: string | null
  events: EventData[]
  participants: ParticipantData[]
  attendances: boolean[][] // attendances[participantIdx][eventIdx]
  // 会ごとの固定額。attendanceFixed[participantIdx][eventIdx]。null は固定しない（通常の傾斜配分）。
  attendanceFixed?: (number | null)[][]
}

async function insertRoomData(roomId: string, input: RoomInput): Promise<void> {
  const { data: dbParticipants, error: participantError } = await supabase
    .from('nomikai_seisan_participants')
    .insert(
      input.participants.map((p) => ({
        room_id: roomId,
        name: p.name.trim(),
        role: p.role,
        tenure_years: p.tenure_years,
        fixed_amount: p.fixed_amount,
        is_organizer: p.is_organizer,
        manual_multiplier: p.manual_multiplier,
      }))
    )
    .select('id')

  if (participantError || !dbParticipants) throw new Error(participantError?.message ?? '参加者の保存に失敗しました')

  const { data: dbEvents, error: eventError } = await supabase
    .from('nomikai_seisan_events')
    .insert(
      input.events.map((e) => ({
        room_id: roomId,
        event_name: e.name,
        total_amount: e.total_amount,
        sort_order: e.sort_order,
        split_mode: e.split_mode,
        payer_participant_id:
          e.payer_participant_idx != null
            ? (dbParticipants[e.payer_participant_idx]?.id as string ?? null)
            : null,
      }))
    )
    .select('id')

  if (eventError || !dbEvents) throw new Error(eventError?.message ?? 'イベントの保存に失敗しました')

  const attendanceRows: { event_id: string; participant_id: string; fixed_amount: number | null }[] = []
  input.attendances.forEach((row, pIdx) => {
    if (pIdx >= dbParticipants.length) return
    row.forEach((attended, eIdx) => {
      if (attended && eIdx < dbEvents.length) {
        attendanceRows.push({
          event_id: dbEvents[eIdx].id as string,
          participant_id: dbParticipants[pIdx].id as string,
          fixed_amount: input.attendanceFixed?.[pIdx]?.[eIdx] ?? null,
        })
      }
    })
  })

  if (attendanceRows.length > 0) {
    const { error: attendError } = await supabase
      .from('nomikai_seisan_event_attendances')
      .insert(attendanceRows)
    if (attendError) throw new Error(attendError.message)
  }
}

export async function createRoom(input: RoomInput): Promise<string> {
  const shareId = Math.random().toString(36).substring(2, 10)

  const { data: room, error: roomError } = await supabase
    .from('nomikai_seisan_rooms')
    .insert({
      share_id: shareId,
      event_date: input.event_date || null,
      tilt_ratio: input.tilt_ratio,
      manual_mode: input.manual_mode,
      created_by_device_id: input.device_id ?? null,
    })
    .select()
    .single()

  if (roomError) throw new Error(roomError.message)

  await insertRoomData(room.id as string, input)

  return shareId
}

export async function updateRoom(shareId: string, input: RoomInput): Promise<void> {
  const { data: room, error: findError } = await supabase
    .from('nomikai_seisan_rooms')
    .select('id')
    .eq('share_id', shareId)
    .single()

  if (findError || !room) throw new Error('精算ルームが見つかりません')

  const { error: roomError } = await supabase
    .from('nomikai_seisan_rooms')
    .update({ event_date: input.event_date || null, tilt_ratio: input.tilt_ratio, manual_mode: input.manual_mode })
    .eq('id', room.id)

  if (roomError) throw new Error(roomError.message)

  await supabase.from('nomikai_seisan_events').delete().eq('room_id', room.id)
  await supabase.from('nomikai_seisan_participants').delete().eq('room_id', room.id)

  await insertRoomData(room.id as string, input)
}

export async function updateRoomSaved(shareId: string): Promise<void> {
  const { data, error } = await supabase
    .from('nomikai_seisan_rooms')
    .update({ is_saved: true })
    .eq('share_id', shareId)
    .select('id')
  if (error) throw new Error(error.message)
  if (!data || data.length === 0) throw new Error('保存に失敗しました')
}

export interface RoomSummary {
  share_id: string
  event_date: string | null
  tilt_ratio: number
  created_at: string
  is_saved: boolean
  participantCount: number
  grandTotal: number
  isComplete: boolean
}

// 精算として成立しているか（参加者2人以上・合計金額 > 0）。
// Home/履歴のバッジ判定と、RoomScreen の自動保存条件で同じ基準を使う。
export function isSettlementComplete(participantCount: number, grandTotal: number): boolean {
  return participantCount >= 2 && grandTotal > 0
}

// このデバイスで作成したルームを新しい順に返す（is_saved は問わない）
export async function getRecentRooms(deviceId: string, limit: number): Promise<RoomSummary[]> {
  const { data: rooms, error } = await supabase
    .from('nomikai_seisan_rooms')
    .select('id, share_id, event_date, tilt_ratio, created_at, is_saved')
    .eq('created_by_device_id', deviceId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(error.message)
  if (!rooms || rooms.length === 0) return []

  const roomIds = rooms.map((r) => r.id as string)
  const [{ data: participants }, { data: events }] = await Promise.all([
    supabase.from('nomikai_seisan_participants').select('room_id').in('room_id', roomIds),
    supabase.from('nomikai_seisan_events').select('room_id, total_amount').in('room_id', roomIds),
  ])

  const countByRoom: Record<string, number> = {}
  ;(participants ?? []).forEach((p) => {
    const id = p.room_id as string
    countByRoom[id] = (countByRoom[id] ?? 0) + 1
  })
  const totalByRoom: Record<string, number> = {}
  ;(events ?? []).forEach((e) => {
    const id = e.room_id as string
    totalByRoom[id] = (totalByRoom[id] ?? 0) + ((e.total_amount as number) ?? 0)
  })

  return rooms.map((room) => {
    const id = room.id as string
    const participantCount = countByRoom[id] ?? 0
    const grandTotal = totalByRoom[id] ?? 0
    return {
      share_id: room.share_id as string,
      event_date: room.event_date as string | null,
      tilt_ratio: (room.tilt_ratio as number) ?? 2.0,
      created_at: room.created_at as string,
      is_saved: (room.is_saved as boolean) ?? false,
      participantCount,
      grandTotal,
      isComplete: isSettlementComplete(participantCount, grandTotal),
    }
  })
}

export async function deleteRoom(shareId: string): Promise<void> {
  const { data: room } = await supabase
    .from('nomikai_seisan_rooms')
    .select('id')
    .eq('share_id', shareId)
    .single()

  if (!room) throw new Error('精算ルームが見つかりません')

  await supabase.from('nomikai_seisan_rooms').delete().eq('id', room.id)
}

export interface Suggestion {
  name: string
  role: string
  tenure_years: number | null
}

function toHiragana(str: string): string {
  return str.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
}

// 自分（このデバイス）が作成したルームの id 一覧だけを返す。
// 他ユーザーのルームの participants を絶対に露出させないためのスコープ境界。
async function getOwnRoomIds(deviceId: string): Promise<string[]> {
  if (!deviceId) return []

  const { data } = await supabase
    .from('nomikai_seisan_rooms')
    .select('id')
    .eq('created_by_device_id', deviceId)

  return (data ?? []).map((r) => r.id as string)
}

export async function getSuggestions(query: string, deviceId: string): Promise<Suggestion[]> {
  if (!query.trim()) return []

  const roomIds = await getOwnRoomIds(deviceId)
  if (roomIds.length === 0) return []

  const { data } = await supabase
    .from('nomikai_seisan_participants')
    .select('name, role, tenure_years, created_at')
    .in('room_id', roomIds)
    .order('created_at', { ascending: false })
    .limit(200)

  if (!data) return []

  const q = query.trim()
  const qHira = toHiragana(q)

  const seen = new Set<string>()
  return data
    .filter((p) => {
      const name = p.name as string
      if (name.startsWith(q)) return true
      if (toHiragana(name).startsWith(qHira)) return true
      return false
    })
    .filter((p) => {
      if (seen.has(p.name as string)) return false
      seen.add(p.name as string)
      return true
    })
    .slice(0, 5)
    .map((p) => ({
      name: p.name as string,
      role: p.role as string,
      tenure_years: p.tenure_years as number | null,
    }))
}

export async function getRecentMembers(deviceId: string): Promise<Suggestion[]> {
  const roomIds = await getOwnRoomIds(deviceId)
  if (roomIds.length === 0) return []

  const { data } = await supabase
    .from('nomikai_seisan_participants')
    .select('name, role, tenure_years, created_at')
    .in('room_id', roomIds)
    .order('created_at', { ascending: false })
    .limit(200)

  if (!data) return []

  const seen = new Set<string>()
  return data
    .filter((p) => {
      if (seen.has(p.name as string)) return false
      seen.add(p.name as string)
      return true
    })
    .slice(0, 30)
    .map((p) => ({
      name: p.name as string,
      role: p.role as string,
      tenure_years: p.tenure_years as number | null,
    }))
}

export interface TemplateParticipant {
  name: string
  role: string
  tenure_years: number | null
  is_organizer: boolean
  manual_multiplier: number
  attendances?: boolean[]
}

export interface TemplateEvent {
  name: string
  split_mode: string
  total_amount?: number
  payer_participant_name?: string | null
}

export interface TemplateSummary {
  id: string
  template_name: string
  tilt_ratio: number
  manual_mode: boolean
  participants_data: TemplateParticipant[]
  events_data: TemplateEvent[]
  created_at: string
}

export async function saveTemplate(input: {
  deviceId: string
  templateName: string
  tiltRatio: number
  manualMode: boolean
  participantsData: TemplateParticipant[]
  eventsData: TemplateEvent[]
}): Promise<{ id: string }> {
  const { data, error } = await supabase
    .from('nomikai_seisan_templates')
    .insert({
      device_id: input.deviceId,
      template_name: input.templateName,
      tilt_ratio: input.tiltRatio,
      manual_mode: input.manualMode,
      participants_data: input.participantsData,
      events_data: input.eventsData,
    })
    .select('id')
    .single()

  if (error || !data) throw new Error(error?.message ?? 'テンプレートの保存に失敗しました')
  return { id: data.id as string }
}

export async function getTemplates(deviceId: string): Promise<TemplateSummary[]> {
  const { data } = await supabase
    .from('nomikai_seisan_templates')
    .select('*')
    .eq('device_id', deviceId)
    .order('created_at', { ascending: false })

  return (data ?? []).map((t) => ({
    id: t.id as string,
    template_name: t.template_name as string,
    tilt_ratio: t.tilt_ratio as number,
    manual_mode: t.manual_mode as boolean,
    participants_data: (t.participants_data as TemplateParticipant[]) ?? [],
    events_data: (t.events_data as TemplateEvent[]) ?? [],
    created_at: t.created_at as string,
  }))
}

export async function deleteTemplate(id: string): Promise<void> {
  const { error } = await supabase.from('nomikai_seisan_templates').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

export async function updateTemplate(id: string, input: {
  templateName: string
  tiltRatio: number
  manualMode: boolean
  participantsData: TemplateParticipant[]
  eventsData: TemplateEvent[]
}): Promise<void> {
  const { error } = await supabase
    .from('nomikai_seisan_templates')
    .update({
      template_name: input.templateName,
      tilt_ratio: input.tiltRatio,
      manual_mode: input.manualMode,
      participants_data: input.participantsData,
      events_data: input.eventsData,
    })
    .eq('id', id)
  if (error) throw new Error(error.message)
}

export async function renameTemplate(id: string, newName: string): Promise<void> {
  const { error } = await supabase
    .from('nomikai_seisan_templates')
    .update({ template_name: newName, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw new Error(error.message)
}
