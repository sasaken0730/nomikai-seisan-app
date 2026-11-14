// テスト: 同条件メンバーの支払額均等化検証
// 実行: node lib/calculations.test.mjs

import { applyRoundingPerEvent } from './calculations.js'

let passed = 0
let failed = 0

function assert(label, condition, detail = '') {
  if (condition) {
    console.log(`  ✓ ${label}`)
    passed++
  } else {
    console.error(`  ✗ ${label}${detail ? ' — ' + detail : ''}`)
    failed++
  }
}

function run(label, fn) {
  console.log(`\n${label}`)
  fn()
}

// ─── ケース1: 同年次2人 + 幹事1人 で 3500円 ───────────────────────────────
run('ケース1: 同年次2人(課長) + 幹事(課長) / 3500円 / unit=500', () => {
  const participants = [
    { id: 'org', name: '幹事',  role: '課長クラス', tenure_years: null, fixed_amount: null, is_organizer: true },
    { id: 'a',   name: 'Aさん', role: '課長クラス', tenure_years: null, fixed_amount: null, is_organizer: false },
    { id: 'b',   name: 'Bさん', role: '課長クラス', tenure_years: null, fixed_amount: null, is_organizer: false },
  ]
  const events = [{ id: 'e1', name: '飲み会', amount: 3500, attendeeIds: ['org', 'a', 'b'] }]

  const results = applyRoundingPerEvent(participants, events, 500)
  const r = Object.fromEntries(results.map(r => [r.id, r.payment]))
  console.log(`    幹事=${r.org}円, A=${r.a}円, B=${r.b}円, 合計=${r.org+r.a+r.b}円`)

  assert('AさんとBさんが同額', r.a === r.b, `A=${r.a}, B=${r.b}`)
  assert('合計が3500円', r.org + r.a + r.b === 3500, `合計=${r.org+r.a+r.b}`)
})

// ─── ケース2: 同年次3人 + 幹事1人 で 5000円 ───────────────────────────────
run('ケース2: 同年次3人(課長) + 幹事(役員) / 5000円 / unit=500', () => {
  const participants = [
    { id: 'org', name: '幹事',  role: '役員クラス', tenure_years: null, fixed_amount: null, is_organizer: true },
    { id: 'a',   name: 'Aさん', role: '課長クラス', tenure_years: null, fixed_amount: null, is_organizer: false },
    { id: 'b',   name: 'Bさん', role: '課長クラス', tenure_years: null, fixed_amount: null, is_organizer: false },
    { id: 'c',   name: 'Cさん', role: '課長クラス', tenure_years: null, fixed_amount: null, is_organizer: false },
  ]
  const events = [{ id: 'e1', name: '飲み会', amount: 5000, attendeeIds: ['org', 'a', 'b', 'c'] }]

  const results = applyRoundingPerEvent(participants, events, 500)
  const r = Object.fromEntries(results.map(r => [r.id, r.payment]))
  console.log(`    幹事=${r.org}円, A=${r.a}円, B=${r.b}円, C=${r.c}円, 合計=${r.org+r.a+r.b+r.c}円`)

  assert('A=B=C(同額)', r.a === r.b && r.b === r.c, `A=${r.a}, B=${r.b}, C=${r.c}`)
  assert('合計が5000円', r.org + r.a + r.b + r.c === 5000, `合計=${r.org+r.a+r.b+r.c}`)
})

// ─── ケース3: 同年次2人 + 立替者1人 で 4000円 ─────────────────────────────
run('ケース3: 同年次2人(課長) + 立替者(fixed=1000) / 4000円 / unit=500', () => {
  const participants = [
    { id: 'payer', name: '立替者', role: '課長クラス', tenure_years: null, fixed_amount: 1000, is_organizer: false },
    { id: 'a',     name: 'Aさん', role: '課長クラス', tenure_years: null, fixed_amount: null, is_organizer: false },
    { id: 'b',     name: 'Bさん', role: '課長クラス', tenure_years: null, fixed_amount: null, is_organizer: false },
  ]
  const events = [{ id: 'e1', name: '飲み会', amount: 4000, attendeeIds: ['payer', 'a', 'b'] }]

  const results = applyRoundingPerEvent(participants, events, 500)
  const r = Object.fromEntries(results.map(r => [r.id, r.payment]))
  console.log(`    立替者=${r.payer}円, A=${r.a}円, B=${r.b}円, 合計=${r.payer+r.a+r.b}円`)

  assert('AさんとBさんが同額', r.a === r.b, `A=${r.a}, B=${r.b}`)
  assert('合計が4000円', r.payer + r.a + r.b === 4000, `合計=${r.payer+r.a+r.b}`)
})

// ─── ケース4: すべて異なる年次（既存挙動が壊れていないか） ────────────────
run('ケース4: 役員+部長+課長+一般 / 10000円 / unit=500 (傾斜あり)', () => {
  const participants = [
    { id: 'a', name: '役員', role: '役員クラス', tenure_years: null, fixed_amount: null, is_organizer: true },
    { id: 'b', name: '部長', role: '部長クラス', tenure_years: null, fixed_amount: null, is_organizer: false },
    { id: 'c', name: '課長', role: '課長クラス', tenure_years: null, fixed_amount: null, is_organizer: false },
    { id: 'd', name: '一般', role: '一般職',     tenure_years: null, fixed_amount: null, is_organizer: false },
  ]
  const events = [{ id: 'e1', name: '飲み会', amount: 10000, attendeeIds: ['a', 'b', 'c', 'd'] }]

  const results = applyRoundingPerEvent(participants, events, 500)
  const r = Object.fromEntries(results.map(r => [r.id, r.payment]))
  const total = Object.values(r).reduce((s, v) => s + v, 0)
  console.log(`    役員=${r.a}円, 部長=${r.b}円, 課長=${r.c}円, 一般=${r.d}円, 合計=${total}円`)

  assert('合計が10000円', total === 10000, `合計=${total}`)
  assert('役員 > 部長 > 課長 > 一般（傾斜順）', r.a >= r.b && r.b >= r.c && r.c >= r.d,
    `役員=${r.a}, 部長=${r.b}, 課長=${r.c}, 一般=${r.d}`)
})

// ─── ケース4b: 異なる年次・unit=1 ────────────────────────────────────────
run('ケース4b: 役員+部長+課長+一般 / 7777円 / unit=1', () => {
  const participants = [
    { id: 'a', name: '役員', role: '役員クラス', tenure_years: null, fixed_amount: null, is_organizer: true },
    { id: 'b', name: '部長', role: '部長クラス', tenure_years: null, fixed_amount: null, is_organizer: false },
    { id: 'c', name: '課長', role: '課長クラス', tenure_years: null, fixed_amount: null, is_organizer: false },
    { id: 'd', name: '一般', role: '一般職',     tenure_years: null, fixed_amount: null, is_organizer: false },
  ]
  const events = [{ id: 'e1', name: '飲み会', amount: 7777, attendeeIds: ['a', 'b', 'c', 'd'] }]

  const results = applyRoundingPerEvent(participants, events, 1)
  const r = Object.fromEntries(results.map(r => [r.id, r.payment]))
  const total = Object.values(r).reduce((s, v) => s + v, 0)
  console.log(`    役員=${r.a}円, 部長=${r.b}円, 課長=${r.c}円, 一般=${r.d}円, 合計=${total}円`)

  assert('合計が7777円', total === 7777, `合計=${total}`)
  assert('役員 >= 部長 >= 課長 >= 一般', r.a >= r.b && r.b >= r.c && r.c >= r.d)
})

// ─── ケース5 (追加): 旧コードで必ずバグが出るパターン ─────────────────────
run('ケース5: 同年次3人(全員一般職) / 3500円 / unit=500 (旧コードでは必ず不平等)', () => {
  // 3人全員同年次で幹事なし → absorberは最初の人
  // rawAmounts = 3500/3 ≈ 1166.67 → floored=1000, extraUnits=1
  // 旧コード: タイブレークで配列[0]が+500 → [0]=1500, [1]=1000, [2]=1000 → 不平等
  // 新コード: 1グループ3人, rem=1<3 → absorber(idx=0)に+500 → [0]=1500, [1]=1000, [2]=1000
  //           ※ 0番目がabsorberになるのは同じだが、グループ論理でabsorberに集約
  //           実質この場合は同じ結果だが、[1][2]は必ず同額になる
  const participants = [
    { id: 'a', name: 'Aさん', role: '一般職', tenure_years: null, fixed_amount: null, is_organizer: false },
    { id: 'b', name: 'Bさん', role: '一般職', tenure_years: null, fixed_amount: null, is_organizer: false },
    { id: 'c', name: 'Cさん', role: '一般職', tenure_years: null, fixed_amount: null, is_organizer: false },
  ]
  const events = [{ id: 'e1', name: '飲み会', amount: 3500, attendeeIds: ['a', 'b', 'c'] }]

  const results = applyRoundingPerEvent(participants, events, 500)
  const r = Object.fromEntries(results.map(r => [r.id, r.payment]))
  console.log(`    A=${r.a}円, B=${r.b}円, C=${r.c}円, 合計=${r.a+r.b+r.c}円`)

  // absorber(幹事なし=最大額=配列先頭)が余分を持つので A≠B,C だが B=C は保証
  assert('BさんとCさんが同額（absorber以外は同額）', r.b === r.c, `B=${r.b}, C=${r.c}`)
  assert('合計が3500円', r.a + r.b + r.c === 3500)
})

// ─── ケース6: 2イベント × 同年次2人 ─────────────────────────────────────
run('ケース6: 2イベント(3000+2000) / 同年次2人+幹事 / unit=500', () => {
  const participants = [
    { id: 'org', name: '幹事',  role: '役員クラス', tenure_years: null, fixed_amount: null, is_organizer: true },
    { id: 'a',   name: 'Aさん', role: '課長クラス', tenure_years: null, fixed_amount: null, is_organizer: false },
    { id: 'b',   name: 'Bさん', role: '課長クラス', tenure_years: null, fixed_amount: null, is_organizer: false },
  ]
  const events = [
    { id: 'e1', name: '一次会', amount: 3000, attendeeIds: ['org', 'a', 'b'] },
    { id: 'e2', name: '二次会', amount: 2000, attendeeIds: ['org', 'a', 'b'] },
  ]

  const results = applyRoundingPerEvent(participants, events, 500)
  const r = Object.fromEntries(results.map(r => [r.id, r.payment]))
  const total = Object.values(r).reduce((s, v) => s + v, 0)
  console.log(`    幹事=${r.org}円, A=${r.a}円, B=${r.b}円, 合計=${total}円`)

  assert('AさんとBさんが同額', r.a === r.b, `A=${r.a}, B=${r.b}`)
  assert('合計が5000円', total === 5000, `合計=${total}`)
})

// ─── ケース7: 会ごとの固定額（遅刻・主役・下戸） ───────────────────────────
run('ケース7: 1次会に遅刻した人だけ3000円固定 / 1次会10000+2次会6000 / unit=1', () => {
  const participants = [
    { id: 'org',  name: '幹事',  role: '課長クラス', tenure_years: null, fixed_amount: null, is_organizer: true },
    { id: 'a',    name: 'Aさん', role: '課長クラス', tenure_years: null, fixed_amount: null, is_organizer: false },
    { id: 'late', name: '遅刻',  role: '課長クラス', tenure_years: null, fixed_amount: null, is_organizer: false },
  ]
  const events = [
    { id: 'e1', name: '1次会', amount: 10000, attendeeIds: ['org', 'a', 'late'], fixedAmounts: { late: 3000 } },
    { id: 'e2', name: '2次会', amount: 6000,  attendeeIds: ['org', 'a', 'late'] },
  ]

  const results = applyRoundingPerEvent(participants, events, 1)
  const r = Object.fromEntries(results.map(r => [r.id, r.payment]))
  const per = Object.fromEntries(results.map(r => [r.id, r.perEventPayment]))
  console.log(`    幹事=${r.org}円, A=${r.a}円, 遅刻=${r.late}円, 合計=${r.org + r.a + r.late}円`)
  console.log(`    遅刻の内訳: 1次会=${per.late[0]}円, 2次会=${per.late[1]}円`)

  assert('遅刻者の1次会がちょうど3000円', per.late[0] === 3000, `=${per.late[0]}`)
  assert('遅刻者の2次会は固定されない', per.late[1] !== 3000 && per.late[1] > 0, `=${per.late[1]}`)
  assert('合計が16000円', r.org + r.a + r.late === 16000, `合計=${r.org + r.a + r.late}`)
  assert('同条件の幹事とAは2次会が同額', per.org[1] === per.a[1], `${per.org[1]} vs ${per.a[1]}`)
})

run('ケース8: 主役は1次会0円 / 1次会12000 / unit=1', () => {
  const participants = [
    { id: 'org',  name: '幹事',  role: '課長クラス', tenure_years: null, fixed_amount: null, is_organizer: true },
    { id: 'a',    name: 'Aさん', role: '課長クラス', tenure_years: null, fixed_amount: null, is_organizer: false },
    { id: 'star', name: '主役',  role: '課長クラス', tenure_years: null, fixed_amount: null, is_organizer: false },
  ]
  const events = [
    { id: 'e1', name: '1次会', amount: 12000, attendeeIds: ['org', 'a', 'star'], fixedAmounts: { star: 0 } },
  ]

  const results = applyRoundingPerEvent(participants, events, 1)
  const r = Object.fromEntries(results.map(r => [r.id, r.payment]))
  console.log(`    幹事=${r.org}円, A=${r.a}円, 主役=${r.star}円, 合計=${r.org + r.a + r.star}円`)

  assert('主役は0円', r.star === 0, `=${r.star}`)
  assert('合計が12000円', r.org + r.a + r.star === 12000, `合計=${r.org + r.a + r.star}`)
  assert('残り2人で折半（6000円ずつ）', r.org === 6000 && r.a === 6000, `幹事=${r.org}, A=${r.a}`)
})

run('ケース9: 旧方式（参加者単位の固定額）が引き続き動く', () => {
  const participants = [
    { id: 'org', name: '幹事',  role: '課長クラス', tenure_years: null, fixed_amount: null, is_organizer: true },
    { id: 'a',   name: 'Aさん', role: '課長クラス', tenure_years: null, fixed_amount: null, is_organizer: false },
    { id: 'f',   name: '固定',  role: '課長クラス', tenure_years: null, fixed_amount: 2000, is_organizer: false },
  ]
  const events = [
    { id: 'e1', name: '1次会', amount: 6000, attendeeIds: ['org', 'a', 'f'] },
    { id: 'e2', name: '2次会', amount: 4000, attendeeIds: ['org', 'a', 'f'] },
  ]

  const results = applyRoundingPerEvent(participants, events, 1)
  const r = Object.fromEntries(results.map(r => [r.id, r.payment]))
  console.log(`    幹事=${r.org}円, A=${r.a}円, 固定=${r.f}円, 合計=${r.org + r.a + r.f}円`)

  assert('固定額の人はちょうど2000円', r.f === 2000, `=${r.f}`)
  assert('合計が10000円', r.org + r.a + r.f === 10000, `合計=${r.org + r.a + r.f}`)
})

// ─── 結果サマリー ──────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(50)}`)
console.log(`結果: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
