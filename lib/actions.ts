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

  const attendanceRows: { event_id: string; participant_id: string }[] = []
  input.attendances.forEach((row, pIdx) => {
    if (pIdx >= dbParticipants.length) return
    row.forEach((attended, eIdx) => {
      if (attended && eIdx < dbEvents.length) {
        attendanceRows.push({
          event_id: dbEvents[eIdx].id as string,
          participant_id: dbParticipants[pIdx].id as string,
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

export async function getSuggestions(query: string): Promise<Suggestion[]> {
  if (!query.trim()) return []

  const { data } = await supabase
    .from('nomikai_seisan_participants')
    .select('name, role, tenure_years, created_at')
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

export async function getRecentMembers(): Promise<Suggestion[]> {
  const { data } = await supabase
    .from('nomikai_seisan_participants')
    .select('name, role, tenure_years, created_at')
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
}

export interface TemplateEvent {
  name: string
  split_mode: string
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

export async function renameTemplate(id: string, newName: string): Promise<void> {
  const { error } = await supabase
    .from('nomikai_seisan_templates')
    .update({ template_name: newName, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw new Error(error.message)
}
