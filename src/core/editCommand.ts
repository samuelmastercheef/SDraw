import { applyOps } from './commands'
import { BASE_WEIGHTS, rankWithModel } from './ranker'
import { parseRequirement } from './suggest'
import type { Item, Op, Sample, SdrawDoc } from './types'

export interface Proposal {
  /** Mã ổn định để bật tắt trong giao diện */
  key: string
  op: Op
  /** Mô tả ngắn: "Dịch Kệ tivi sang phải 30 cm" */
  label: string
  /** Động từ in đậm đầu dòng: Dịch, Xoay, Thay, Xoá, Đổi */
  verb: string
}

export interface ParsedEdit {
  proposals: Proposal[]
  /** Món bị bỏ qua vì đã khoá, để người dùng thấy AI không đụng tới */
  skippedLocked: string[]
  /** Lý do không hiểu hoặc không làm được */
  notes: string[]
}

const plain = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase()

/** Loại đồ, dài trước ngắn sau để "ban tra" không bị "ban" nuốt. */
const KINDS: [string, string[]][] = [
  ['Bàn trà', ['ban tra']],
  ['Bàn ăn', ['ban an']],
  ['Kệ tivi', ['ke tivi', 'ke tv', 'tivi']],
  ['Kệ sách', ['ke sach']],
  ['Sofa', ['sofa', 'sopha']],
  ['Giường', ['giuong']],
  ['Ghế', ['ghe']],
  ['Bàn', ['ban']],
  ['Tủ', ['tu ']]
]

function kindsIn(clause: string): string[] {
  const padded = ` ${clause} `
  const found: string[] = []
  let rest = padded
  for (const [kind, words] of KINDS) {
    const hit = words.find((w) => new RegExp(`(^|[^a-z0-9])${w.trim()}($|[^a-z0-9])`).test(rest))
    if (hit) { found.push(kind); rest = rest.replace(new RegExp(hit.trim(), 'g'), ' ') }
  }
  return found
}

const DIRECTIONS: Record<string, [number, number, string]> = {
  trai: [-1, 0, 'sang trái'], phai: [1, 0, 'sang phải'], len: [0, -1, 'lên'], xuong: [0, 1, 'xuống']
}

function lengthMm(clause: string): number | null {
  const m = /(\d+(?:[.,]\d+)?)\s*(mm|cm|m)\b/.exec(clause)
  if (!m) return null
  const n = Number(m[1]!.replace(',', '.'))
  const mm = m[2] === 'mm' ? n : m[2] === 'cm' ? n * 10 : n * 1000
  return mm > 0 && mm <= 10000 ? Math.round(mm) : null
}

const fmtLen = (mm: number): string => (mm % 1000 === 0 ? `${mm / 1000} m` : mm % 10 === 0 ? `${mm / 10} cm` : `${mm} mm`)

/**
 * Hiểu lệnh sửa bố cục bằng tiếng Việt, chạy trên máy: dịch, xoay, xoá, đổi vật liệu, thay mẫu.
 * Món đích: loại đồ nêu trong câu (sofa, bàn trà...) hoặc món đang chọn khi câu nói "món này".
 * Món đã khoá không bao giờ nằm trong đề xuất; chỉ được liệt kê ở skippedLocked.
 */
export function parseEdit(text: string, doc: SdrawDoc, selectedId: string | null, catalog: Sample[]): ParsedEdit {
  const out: ParsedEdit = { proposals: [], skippedLocked: [], notes: [] }
  const byId = new Map(catalog.map((s) => [s.id, s]))
  const kindOf = (it: Item): string => byId.get(it.sampleId)?.category ?? kindsIn(plain(it.name))[0] ?? ''
  const clauses = text.toLowerCase().split(/\s*(?:(?<!\d),(?!\d)|;|\brồi\b|\bsau đó\b)\s*/u).map((c) => c.trim()).filter(Boolean)
  let n = 0

  for (const raw of clauses) {
    const c = plain(raw)
    const wantsSelected = /\b(nay|do|no)\b/.test(c) || /mon (dang )?chon/.test(c)
    const kinds = kindsIn(c)
    let targets: Item[] = []
    if (kinds.length > 0) targets = doc.items.filter((it) => kinds.some((k) => kindOf(it) === k || plain(it.name).includes(plain(k))))
    else if (selectedId || wantsSelected) targets = doc.items.filter((it) => it.id === selectedId)
    // "thay sofa này bằng ..." nói tới món cần thay, không phải mẫu mới: chỉ phần trước "bằng" chọn đích
    const beforeBy = c.split(/\bbang\b/)[0] ?? c
    if (/\bthay\b/.test(c) && kinds.length > 0) {
      const k0 = kindsIn(beforeBy)
      if (k0.length > 0) targets = doc.items.filter((it) => k0.some((k) => kindOf(it) === k || plain(it.name).includes(plain(k))))
    }
    if (targets.length === 0) { out.notes.push(`Chưa rõ món cần sửa trong: "${raw}". Hãy chọn một món hoặc nêu loại đồ.`); continue }

    const live = targets.filter((t) => !t.locked)
    for (const t of targets) if (t.locked && !out.skippedLocked.includes(t.name)) out.skippedLocked.push(t.name)
    if (live.length === 0) continue

    const push = (_it: Item, op: Op, verb: string, label: string): void => { out.proposals.push({ key: `p${n++}`, op, verb, label }) }

    const dir = /\b(trai|phai|len|xuong)\b/.exec(c)?.[1]
    if (/\b(dich|di chuyen|day|keo|nhich|doi)\b/.test(c) && dir) {
      const mm = lengthMm(c)
      if (!mm) { out.notes.push(`Cần khoảng cách (ví dụ 30 cm) trong: "${raw}"`); continue }
      const [dx, dy, word] = DIRECTIONS[dir]!
      for (const it of live) push(it, { op: 'nudge', id: it.id, dx: dx * mm, dy: dy * mm }, 'Dịch', `${it.name} ${word} ${fmtLen(mm)}`)
      continue
    }
    const rot = /\bxoay\b/.test(c) ? /(-?\d+)\s*(do)?\b/.exec(c.replace(/\bxoay\b/, ''))?.[1] : undefined
    if (/\bxoay\b/.test(c)) {
      if (rot === undefined) { out.notes.push(`Cần số độ cần xoay (ví dụ 90 độ) trong: "${raw}"`); continue }
      for (const it of live) push(it, { op: 'rotate', id: it.id, rotation: it.rotation + Number(rot) }, 'Xoay', `${it.name} thêm ${Number(rot)}°`)
      continue
    }
    if (/\b(xoa|bo|go)\b/.test(c) && !/\bbo (tron|goc)\b/.test(c)) {
      for (const it of live) push(it, { op: 'remove', id: it.id }, 'Xoá', `${it.name} khỏi bản vẽ`)
      continue
    }
    const mat = /(?:vat lieu|chat lieu|doi sang|doi thanh)\s+(.+)$/.exec(c)
    if (mat && /\b(vat lieu|chat lieu)\b/.test(c)) {
      const after = raw.slice(raw.toLowerCase().search(/(vật liệu|chất liệu)/u))
      const name = (/(?:sang|thành|là)\s+(.+)$/iu.exec(after)?.[1] ?? '').trim()
      if (!name) { out.notes.push(`Cần tên vật liệu trong: "${raw}"`); continue }
      for (const it of live) push(it, { op: 'setMaterial', id: it.id, material: name }, 'Đổi', `vật liệu ${it.name} sang ${name}`)
      continue
    }
    if (/\bthay\b/.test(c) && /\bbang\b/.test(c)) {
      const restRaw = raw.slice(raw.search(/bằng/u) + 'bằng'.length).trim()
      for (const it of live) {
        const cat = kindOf(it)
        const req = parseRequirement(restRaw)
        if (req.categories.length === 0 && cat) req.categories = [cat]
        const pool = catalog.filter((s) => s.id !== it.sampleId)
        const best = rankWithModel(pool, req, BASE_WEIGHTS, {}, 1)[0]
        if (!best) { out.notes.push(`Không có mẫu nào trong kho khớp "${restRaw}" để thay ${it.name}`); continue }
        push(it, { op: 'replace', id: it.id, sample: best.sample }, 'Thay', `${it.name} bằng ${best.sample.name}`)
      }
      continue
    }
    out.notes.push(`Chưa hiểu lệnh: "${raw}". Thử: "dịch kệ tivi sang phải 30 cm", "xoay sofa 90 độ", "thay sofa bằng mẫu bo tròn", "xoá ghế".`)
  }
  return out
}

/** Bản vẽ sau khi áp các đề xuất được chọn. Món khoá đã bị loại từ lúc phân tích nên không bị đụng tới. */
export function applyProposals(doc: SdrawDoc, proposals: Proposal[]): SdrawDoc {
  return applyOps(doc, proposals.map((p) => p.op)).doc
}
