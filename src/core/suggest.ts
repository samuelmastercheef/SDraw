import type { Sample } from './types'

/**
 * Hiểu yêu cầu tiếng Việt của khách bằng từ khoá và quy tắc, rồi xếp hạng mẫu bằng thống kê.
 * Không phải mô hình học sâu: đây là điểm khởi đầu, có thể giải thích từng điểm số.
 */

export function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/\s+/g, ' ')
    .trim()
}

const CATEGORY_WORDS: Record<string, string[]> = {
  Sofa: ['sofa', 'so pha', 'sopha'],
  'Bàn trà': ['ban tra', 'ban cafe', 'ban coffee'],
  'Kệ tivi': ['ke tivi', 'ke tv', 'tu tivi', 'tu tv', 'ke ti vi'],
  'Ghế thư giãn': ['ghe thu gian', 'ghe don', 'armchair', 'ghe bang'],
  Ghế: ['ghe'],
  'Kệ sách': ['ke sach', 'tu sach'],
  'Bàn ăn': ['ban an'],
  'Bàn làm việc': ['ban lam viec', 'ban lv', 'ban may tinh'],
  'Giường': ['giuong'],
  'Tủ quần áo': ['tu quan ao', 'tu ao'],
  'Tủ giày': ['tu giay', 'ke giay']
}

const STYLE_WORDS: Record<string, string[]> = {
  'hiện đại': ['hien dai', 'modern'],
  'tối giản': ['toi gian', 'minimal'],
  'bắc âu': ['bac au', 'scandinavian', 'scandi'],
  'tân cổ điển': ['tan co dien', 'neoclassic'],
  indochine: ['indochine', 'dong duong'],
  industrial: ['industrial', 'cong nghiep']
}

const SHAPE_WORDS: Record<string, string[]> = {
  'chữ L': ['chu l', 'goc l', 'l-shape'],
  'bo tròn': ['bo tron', 'tron', 'bo cong'],
  thẳng: ['dang thang', 'sofa thang', 'thang']
}

/** Chất liệu dò trên chữ thường có dấu, vì "da" (da thật) và "đá" bỏ dấu giống nhau. */
const MATERIAL_PATTERNS: Record<string, RegExp> = {
  gỗ: /(?<![\p{L}])(gỗ|go)(?![\p{L}])/u,
  da: /(?<![\p{L}])da(?![\p{L}])/u,
  vải: /(?<![\p{L}])(vải|vai)(?![\p{L}])/u,
  'kim loại': /kim loại|kim loai|(?<![\p{L}])(sắt|inox)(?![\p{L}])/u,
  đá: /(?<![\p{L}])đá(?![\p{L}])|cẩm thạch|cam thach|marble/u,
  nhung: /(?<![\p{L}])nhung(?![\p{L}])/u
}

export interface Requirement {
  raw: string
  categories: string[]
  styles: string[]
  materials: string[]
  /** Hình dáng: chữ L, bo tròn, thẳng */
  shapes: string[]
  widthMm?: number
  budgetVnd?: number
}

function findKeys(text: string, dict: Record<string, string[]>): string[] {
  const out: string[] = []
  for (const [key, words] of Object.entries(dict)) {
    const hit = words.some((w) => new RegExp(`(^|[^a-z0-9])${w.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&')}($|[^a-z0-9])`).test(text))
    if (hit) out.push(key)
  }
  return out
}

function findMaterials(rawLower: string): string[] {
  return Object.entries(MATERIAL_PATTERNS)
    .filter(([, re]) => re.test(rawLower))
    .map(([k]) => k)
}

function parseNumber(s: string): number {
  return Number(s.replace(',', '.'))
}

/** Lấy chiều dài chính (mm) khách nêu: "2m4", "2,4m", "2400mm", "rộng 2400". */
export function parseWidthMm(text: string): number | undefined {
  const found: number[] = []
  for (const m of text.matchAll(/(\d+)\s*m\s*(\d{1,2})\b(?!\s*m)/g)) {
    const frac = m[2]!.length === 1 ? Number(m[2]) / 10 : Number(m[2]) / 100
    found.push((Number(m[1]) + frac) * 1000)
  }
  for (const m of text.matchAll(/(\d+(?:[.,]\d+)?)\s*m(?![a-z0-9])/g)) found.push(parseNumber(m[1]!) * 1000)
  for (const m of text.matchAll(/(\d{3,4})\s*mm/g)) found.push(Number(m[1]))
  const plausible = found.filter((n) => n >= 300 && n <= 6000)
  return plausible.length > 0 ? Math.round(Math.max(...plausible)) : undefined
}

/** "15 triệu", "15tr", "15,5 triệu" → đồng. */
export function parseBudgetVnd(text: string): number | undefined {
  const m = /(\d+(?:[.,]\d+)?)\s*(?:trieu|tr)\b/.exec(text)
  return m ? Math.round(parseNumber(m[1]!) * 1_000_000) : undefined
}

export function parseRequirement(raw: string): Requirement {
  const t = normalize(raw)
  const req: Requirement = {
    raw,
    categories: findKeys(t, CATEGORY_WORDS),
    styles: findKeys(t, STYLE_WORDS),
    materials: findMaterials(raw.toLowerCase().normalize('NFC')),
    shapes: findKeys(t, SHAPE_WORDS)
  }
  const w = parseWidthMm(t)
  const b = parseBudgetVnd(t)
  if (w !== undefined) req.widthMm = w
  if (b !== undefined) req.budgetVnd = b
  return req
}

export type PickStats = Record<string, { picks: number }>

export function recordPick(stats: PickStats, sampleId: string): PickStats {
  const cur = stats[sampleId]?.picks ?? 0
  return { ...stats, [sampleId]: { picks: cur + 1 } }
}

export interface Suggestion {
  sample: Sample
  score: number
  reasons: string[]
}

/** "Ghế" khớp "Ghế thư giãn" và ngược lại; "Bàn trà" không khớp "Bàn ăn". */
function categoryMatches(a: string, b: string): boolean {
  const na = normalize(a)
  const nb = normalize(b)
  return na === nb || na.startsWith(`${nb} `) || nb.startsWith(`${na} `)
}

function overlap(a: string[] | undefined, b: string[]): string[] {
  if (!a || b.length === 0) return []
  const set = new Set(a.map(normalize))
  return b.filter((x) => set.has(normalize(x)))
}

export function scoreSample(sample: Sample, req: Requirement, stats: PickStats = {}): Suggestion {
  let score = 0
  const reasons: string[] = []

  if (req.categories.length > 0) {
    // Khách đã nêu loại: mẫu khác loại bị loại hẳn, nhãn và thống kê không cứu được.
    if (!req.categories.some((c) => categoryMatches(c, sample.category))) return { sample, score: 0, reasons: [] }
    score += 40
    reasons.push(`Đúng loại ${sample.category}`)
  } else {
    score += 10
  }

  const shapeHit = [...overlap(sample.tags, req.shapes), ...req.shapes.filter((s) => normalize(`${sample.name} ${sample.description ?? ''}`).includes(normalize(s)))]
  if (shapeHit.length > 0) {
    score += 12
    reasons.push(`Hợp dáng ${shapeHit[0]}`)
  }
  const styleHit = overlap(sample.styles, req.styles)
  if (styleHit.length > 0) {
    score += 8 * styleHit.length
    reasons.push(`Phong cách ${styleHit.join(', ')}`)
  }
  const matHit = overlap(sample.materials, req.materials)
  if (matHit.length > 0) {
    score += 6 * matHit.length
    reasons.push(`Chất liệu ${matHit.join(', ')}`)
  }

  if (req.widthMm && req.widthMm > 0) {
    const gap = Math.abs(sample.w - req.widthMm) / req.widthMm
    const part = Math.max(0, 1 - gap) * 20
    score += part
    if (gap <= 0.1) reasons.push(`Rộng ${sample.w} mm, sát yêu cầu ${req.widthMm} mm`)
    else if (gap <= 0.25) reasons.push(`Rộng ${sample.w} mm, lệch ${Math.round(gap * 100)}%`)
  }

  if (req.budgetVnd && sample.listPrice !== undefined) {
    if (sample.listPrice <= req.budgetVnd) {
      score += 8
      reasons.push('Trong ngân sách')
    } else {
      score -= 10
      reasons.push('Vượt ngân sách')
    }
  }

  const picks = stats[sample.id]?.picks ?? 0
  if (picks > 0) {
    score += Math.min(10, 3 * Math.log(1 + picks))
    reasons.push(`Được chọn ${picks} lần`)
  }
  if (sample.labeled) score += 3
  if (sample.needsReview) score -= 5

  return { sample, score: Math.round(score * 10) / 10, reasons }
}

export function rankSamples(samples: Sample[], req: Requirement, stats: PickStats = {}, limit = 8): Suggestion[] {
  return samples
    .map((s) => scoreSample(s, req, stats))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.sample.name.localeCompare(b.sample.name))
    .slice(0, limit)
}

/** Số mẫu đủ giống yêu cầu (đúng loại) trong một danh sách, ví dụ Store: để nhắc người dùng đi tìm. */
export function countSimilar(samples: Sample[], req: Requirement, minScore = 40): number {
  return samples.filter((s) => scoreSample(s, req).score >= minScore).length
}
