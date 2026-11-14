// デフォルト傾斜倍率（最高位 ÷ 最低位の支払額比率）
export const GRADIENT = 2.0

export const ROLES = [
  '役員クラス',
  '部長クラス',
  '課長クラス',
  '一般職',
  'その他役職',
] as const
export type Role = (typeof ROLES)[number]

export const ROLE_EQUIVALENT_YEARS: Record<string, number> = {
  役員クラス: 35,
  部長クラス: 25,
  課長クラス: 15,
  一般職: 3,
}

function getEquivalentYears(role: string, tenureYears: number | null): number {
  if (role !== 'その他役職' && ROLE_EQUIVALENT_YEARS[role] != null) {
    return ROLE_EQUIVALENT_YEARS[role]
  }
  return tenureYears ?? 1
}

// 手動倍率モード時のウェイト計算（manual_multiplier をそのまま使う）
function getManualWeights(participants: ParticipantInput[]): number[] {
  return participants.map((p) => Math.max(0.1, p.manual_multiplier ?? 1))
}

export interface ParticipantInput {
  id: string
  name: string
  role: string
  tenure_years: number | null
  fixed_amount: number | null
  is_organizer: boolean
  manual_multiplier?: number | null
}

export interface EventInput {
  id: string
  name: string
  amount: number
  attendeeIds: string[]
  splitMode?: 'tilt' | 'equal' // 'equal': 均等割り, 'tilt': 傾斜配分（デフォルト）
  /**
   * この会だけ支払額を固定する人。participantId → 金額。
   * 遅刻・主役・下戸など「その会に限った事情」を表すための指定。
   */
  fixedAmounts?: Record<string, number>
}

/**
 * (会 → 参加者 → 固定額) を組み立てる。
 * 会ごとの指定(EventInput.fixedAmounts)を優先し、1件も指定が無い参加者についてのみ
 * 旧方式の参加者単位 fixed_amount を会の金額比で按分して補う（過去データの互換）。
 */
function buildFixedByEvent(
  participants: ParticipantInput[],
  activeEvents: EventInput[]
): Map<string, Map<string, number>> {
  const byEvent = new Map<string, Map<string, number>>()
  activeEvents.forEach((e) => byEvent.set(e.id, new Map()))

  const hasPerEvent = new Set<string>()
  for (const e of activeEvents) {
    const m = byEvent.get(e.id)!
    for (const [pid, amount] of Object.entries(e.fixedAmounts ?? {})) {
      if (!e.attendeeIds.includes(pid)) continue
      m.set(pid, amount)
      hasPerEvent.add(pid)
    }
  }

  for (const p of participants) {
    if (p.fixed_amount == null || hasPerEvent.has(p.id)) continue
    const attended = activeEvents.filter((e) => e.attendeeIds.includes(p.id))
    const totalAttended = attended.reduce((s, e) => s + e.amount, 0)
    if (totalAttended <= 0) continue
    attended.forEach((e) => {
      byEvent.get(e.id)!.set(p.id, (p.fixed_amount! * e.amount) / totalAttended)
    })
  }

  return byEvent
}

/** 会ごとのウェイト。均等割り／手動倍率／年次傾斜を切り替える。 */
function eventWeights(
  attendees: ParticipantInput[],
  event: EventInput,
  gradient: number,
  manualMode: boolean
): number[] {
  if (event.splitMode === 'equal') return attendees.map(() => 1)
  if (manualMode) return getManualWeights(attendees)
  const years = attendees.map((p) => getEquivalentYears(p.role, p.tenure_years))
  const minY = Math.min(...years)
  const maxY = Math.max(...years)
  return years.map((y) => (maxY === minY ? 1 : 1 + ((y - minY) / (maxY - minY)) * (gradient - 1)))
}

export interface PaymentResult extends ParticipantInput {
  rawPayment: number
}

export interface RoundedResult extends PaymentResult {
  payment: number
  perEventPayment: (number | null)[]
}

export function calculateRawPayments(
  participants: ParticipantInput[],
  events: EventInput[],
  gradient = GRADIENT,
  manualMode = false
): PaymentResult[] {
  const activeEvents = events.filter((e) => e.amount > 0)
  const fixedByEvent = buildFixedByEvent(participants, activeEvents)

  const totals = new Map<string, number>()
  participants.forEach((p) => totals.set(p.id, 0))

  for (const event of activeEvents) {
    const fixedHere = fixedByEvent.get(event.id)!
    const attendees = participants.filter((p) => event.attendeeIds.includes(p.id))
    if (attendees.length === 0) continue

    // 固定額の人は会ごとにその額をそのまま負担し、残りを傾斜で分ける
    let pool = event.amount
    for (const p of attendees) {
      const f = fixedHere.get(p.id)
      if (f == null) continue
      totals.set(p.id, (totals.get(p.id) ?? 0) + f)
      pool -= f
    }

    const spread = attendees.filter((p) => fixedHere.get(p.id) == null)
    if (spread.length === 0 || pool <= 0) continue

    const weights = eventWeights(spread, event, gradient, manualMode)
    const totalWeight = weights.reduce((s, w) => s + w, 0)
    spread.forEach((p, i) => {
      totals.set(p.id, (totals.get(p.id) ?? 0) + (pool * weights[i]) / totalWeight)
    })
  }

  return participants.map((p) => ({ ...p, rawPayment: totals.get(p.id) ?? 0 }))
}

// 会ごとに最大剰余法で丸めを適用（倍率を保持）、unit未満の端数のみ幹事が吸収
export function applyRoundingPerEvent(
  participants: ParticipantInput[],
  events: EventInput[],
  unit: 1 | 500 | 1000,
  gradient = GRADIENT,
  manualMode = false
): RoundedResult[] {
  const activeEvents = events.filter((e) => e.amount > 0)

  const totals = new Map<string, number>()
  participants.forEach((p) => totals.set(p.id, 0))

  const perEventMap = new Map<string, (number | null)[]>()
  participants.forEach((p) => perEventMap.set(p.id, events.map(() => null)))

  const organizerId = participants.find((p) => p.is_organizer)?.id

  // (会 → 参加者 → 固定額)。会ごとの指定が無い場合のみ旧方式の按分で補う。
  const fixedByEvent = buildFixedByEvent(participants, activeEvents)

  for (const event of activeEvents) {
    const fixedHere = fixedByEvent.get(event.id)!
    const attendees = participants.filter((p) => event.attendeeIds.includes(p.id))
    const nonFixedAttendees = attendees.filter((p) => fixedHere.get(p.id) == null)
    const eventIdx = events.findIndex((e) => e.id === event.id)

    // 固定額の人はその額で確定（丸めの対象にしない）
    let fixedShare = 0
    for (const p of attendees) {
      const amount = fixedHere.get(p.id)
      if (amount == null) continue
      totals.set(p.id, (totals.get(p.id) ?? 0) + amount)
      fixedShare += amount
      if (eventIdx >= 0) perEventMap.get(p.id)![eventIdx] = amount
    }

    if (nonFixedAttendees.length === 0) continue

    const gradientPool = event.amount - fixedShare
    if (gradientPool <= 0) continue

    const weights = eventWeights(nonFixedAttendees, event, gradient, manualMode)
    const totalWeight = weights.reduce((s, w) => s + w, 0)

    const rawAmounts = nonFixedAttendees.map(
      (_, i) => (gradientPool * weights[i]) / totalWeight
    )

    // 端数吸収者：幹事が参加していればその人、いなければ最高額負担者
    let absorberIdx = organizerId
      ? nonFixedAttendees.findIndex((p) => p.id === organizerId)
      : -1
    if (absorberIdx === -1) {
      let maxVal = -1
      rawAmounts.forEach((a, i) => {
        if (a > maxVal) {
          maxVal = a
          absorberIdx = i
        }
      })
    }
    if (absorberIdx === -1) absorberIdx = 0

    // 最大剰余法で公平に丸め（倍率を保持）
    let rounded: number[]
    if (unit === 1) {
      const r = rawAmounts.map(a => Math.floor(a))
      const othersSum = r.reduce((s, a, i) => (i === absorberIdx ? s : s + a), 0)
      r[absorberIdx] = Math.floor(gradientPool) - othersSum
      rounded = r
    } else {
      // 各人をunit単位に切り捨て
      const floored = rawAmounts.map(a => Math.floor(a / unit) * unit)
      const floorsSum = floored.reduce((s, a) => s + a, 0)
      // unit単位で分配できる総額
      const budgetInUnits = Math.floor(gradientPool / unit) * unit
      // 追加配分すべき単位数
      const extraUnits = Math.round((budgetInUnits - floorsSum) / unit)

      rounded = [...floored]

      if (extraUnits > 0) {
        // 同ウェイトグループ単位で丸め上げを適用し、同条件メンバー間の金額差を防ぐ
        // （個人単位のタイブレークは配列順依存になるため、グループ全員を同時に扱う）
        const weightGroupMap = new Map<number, { indices: number[]; frac: number }>()
        rawAmounts.forEach((a, i) => {
          const key = weights[i]
          if (!weightGroupMap.has(key)) {
            weightGroupMap.set(key, { indices: [], frac: a - Math.floor(a / unit) * unit })
          }
          weightGroupMap.get(key)!.indices.push(i)
        })
        const sortedGroups = [...weightGroupMap.values()].sort((a, b) => b.frac - a.frac)
        let rem = extraUnits
        for (const group of sortedGroups) {
          if (rem <= 0) break
          if (rem >= group.indices.length) {
            // グループ全員に +unit（同条件は必ず同額）
            group.indices.forEach(i => { rounded[i] += unit })
            rem -= group.indices.length
          } else {
            // グループを全員カバーできない端数は absorber に集約
            rounded[absorberIdx] += rem * unit
            rem = 0
          }
        }
      }

      // unit未満の真の端数のみ幹事が吸収
      const residual = Math.floor(gradientPool) - budgetInUnits
      if (residual !== 0) rounded[absorberIdx] += residual
    }

    nonFixedAttendees.forEach((p, i) => {
      totals.set(p.id, (totals.get(p.id) ?? 0) + rounded[i])
      if (eventIdx >= 0) perEventMap.get(p.id)![eventIdx] = rounded[i]
    })
  }

  // 浮動小数点誤差を除去：旧方式（参加者単位）の固定額のみ、総額をexactな値に補正する。
  // 会ごとの固定額を使っている人は会ごとに確定済みなので上書きしない。
  participants
    .filter(
      (p) =>
        p.fixed_amount != null &&
        !activeEvents.some((e) => e.fixedAmounts?.[p.id] != null)
    )
    .forEach((p) => totals.set(p.id, p.fixed_amount!))

  const rawPayments = calculateRawPayments(participants, events, gradient, manualMode)
  const rawMap = new Map(rawPayments.map((r) => [r.id, r.rawPayment]))

  return participants.map((p) => ({
    ...p,
    rawPayment: rawMap.get(p.id) ?? 0,
    payment: totals.get(p.id) ?? 0,
    perEventPayment: perEventMap.get(p.id) ?? events.map(() => null),
  }))
}

// 会ごとの支払額を独立計算（内訳テーブルの参考値用）
export function calculatePerEventAmounts(
  participants: ParticipantInput[],
  events: EventInput[],
  gradient = GRADIENT
): Record<string, (number | null)[]> {
  const result: Record<string, (number | null)[]> = {}
  participants.forEach((p) => {
    result[p.id] = events.map(() => null)
  })

  const activeEvents = events.filter((e) => e.amount > 0)
  const fixedByEvent = buildFixedByEvent(participants, activeEvents)

  events.forEach((event, idx) => {
    if (event.amount <= 0) return
    const fixedHere = fixedByEvent.get(event.id) ?? new Map<string, number>()

    const all = participants.filter((p) => event.attendeeIds.includes(p.id))
    let pool = event.amount
    for (const p of all) {
      const amount = fixedHere.get(p.id)
      if (amount == null) continue
      result[p.id][idx] = Math.round(amount)
      pool -= amount
    }

    const attendees = all.filter((p) => fixedHere.get(p.id) == null)
    if (attendees.length === 0 || pool <= 0) return

    const weights = eventWeights(attendees, event, gradient, false)
    const totalWeight = weights.reduce((s, w) => s + w, 0)

    attendees.forEach((p, i) => {
      result[p.id][idx] = Math.round((pool * weights[i]) / totalWeight)
    })
  })

  return result
}
