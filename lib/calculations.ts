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
  const grandTotal = activeEvents.reduce((sum, e) => sum + e.amount, 0)

  if (grandTotal === 0) {
    return participants.map((p) => ({ ...p, rawPayment: p.fixed_amount ?? 0 }))
  }

  const fixed = participants.filter((p) => p.fixed_amount != null)
  const nonFixed = participants.filter((p) => p.fixed_amount == null)
  const totalFixed = fixed.reduce((sum, p) => sum + (p.fixed_amount ?? 0), 0)
  const remaining = grandTotal - totalFixed

  const exposures = new Map<string, number>()
  nonFixed.forEach((p) => exposures.set(p.id, 0))

  for (const event of activeEvents) {
    const attendees = nonFixed.filter((p) => event.attendeeIds.includes(p.id))
    if (attendees.length === 0) continue

    let weights: number[]
    if (event.splitMode === 'equal') {
      weights = attendees.map(() => 1)
    } else if (manualMode) {
      weights = getManualWeights(attendees)
    } else {
      const years = attendees.map((p) => getEquivalentYears(p.role, p.tenure_years))
      const minY = Math.min(...years)
      const maxY = Math.max(...years)
      weights = years.map((y) =>
        maxY === minY ? 1 : 1 + ((y - minY) / (maxY - minY)) * (gradient - 1)
      )
    }
    const totalWeight = weights.reduce((s, w) => s + w, 0)

    attendees.forEach((p, i) => {
      exposures.set(p.id, (exposures.get(p.id) ?? 0) + (event.amount * weights[i]) / totalWeight)
    })
  }

  const totalExposure = [...exposures.values()].reduce((s, e) => s + e, 0)

  const rawMap = new Map<string, number>()
  if (remaining <= 0) {
    nonFixed.forEach((p) => rawMap.set(p.id, 0))
  } else if (totalExposure === 0) {
    nonFixed.forEach((p) => rawMap.set(p.id, remaining / nonFixed.length))
  } else {
    nonFixed.forEach((p) => {
      rawMap.set(p.id, (remaining * (exposures.get(p.id) ?? 0)) / totalExposure)
    })
  }
  fixed.forEach((p) => rawMap.set(p.id, p.fixed_amount!))

  return participants.map((p) => ({ ...p, rawPayment: rawMap.get(p.id) ?? 0 }))
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

  // 固定額参加者の各会への按分額を事前計算（参加会の金額比率で按分）
  const fixedContrib = new Map<string, Map<string, number>>()
  participants
    .filter((p) => p.fixed_amount != null)
    .forEach((p) => {
      const totalAttended = activeEvents
        .filter((e) => e.attendeeIds.includes(p.id))
        .reduce((s, e) => s + e.amount, 0)
      const byEvent = new Map<string, number>()
      activeEvents.forEach((e) => {
        byEvent.set(e.id, totalAttended > 0 ? (p.fixed_amount! * e.amount) / totalAttended : 0)
      })
      fixedContrib.set(p.id, byEvent)
    })

  for (const event of activeEvents) {
    const nonFixedAttendees = participants.filter(
      (p) => p.fixed_amount == null && event.attendeeIds.includes(p.id)
    )
    const fixedAttendees = participants.filter(
      (p) => p.fixed_amount != null && event.attendeeIds.includes(p.id)
    )

    fixedAttendees.forEach((p) => {
      const contrib = fixedContrib.get(p.id)?.get(event.id) ?? 0
      totals.set(p.id, (totals.get(p.id) ?? 0) + contrib)
    })

    if (nonFixedAttendees.length === 0) continue

    const fixedShare = fixedAttendees.reduce(
      (s, p) => s + (fixedContrib.get(p.id)?.get(event.id) ?? 0),
      0
    )
    const gradientPool = event.amount - fixedShare
    if (gradientPool <= 0) continue

    let weights: number[]
    if (event.splitMode === 'equal') {
      weights = nonFixedAttendees.map(() => 1)
    } else if (manualMode) {
      weights = getManualWeights(nonFixedAttendees)
    } else {
      const years = nonFixedAttendees.map((p) => getEquivalentYears(p.role, p.tenure_years))
      const minY = Math.min(...years)
      const maxY = Math.max(...years)
      weights = years.map((y) =>
        maxY === minY ? 1 : 1 + ((y - minY) / (maxY - minY)) * (gradient - 1)
      )
    }
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

    const eventOrigIdx = events.findIndex((e) => e.id === event.id)
    nonFixedAttendees.forEach((p, i) => {
      totals.set(p.id, (totals.get(p.id) ?? 0) + rounded[i])
      if (eventOrigIdx >= 0) perEventMap.get(p.id)![eventOrigIdx] = rounded[i]
    })
  }

  // 浮動小数点誤差を除去：固定額は常にexactな値に補正
  participants
    .filter((p) => p.fixed_amount != null)
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

  events.forEach((event, idx) => {
    if (event.amount <= 0) return

    const attendees = participants.filter(
      (p) => p.fixed_amount == null && event.attendeeIds.includes(p.id)
    )
    if (attendees.length === 0) return

    const years = attendees.map((p) => getEquivalentYears(p.role, p.tenure_years))
    const minY = Math.min(...years)
    const maxY = Math.max(...years)
    const weights = years.map((y) =>
      maxY === minY ? 1 : 1 + ((y - minY) / (maxY - minY)) * (gradient - 1)
    )
    const totalWeight = weights.reduce((s, w) => s + w, 0)

    attendees.forEach((p, i) => {
      result[p.id][idx] = Math.round((event.amount * weights[i]) / totalWeight)
    })
  })

  return result
}
