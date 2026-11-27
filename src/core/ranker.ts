import { normalize, scoreSample, type PickStats, type Requirement, type Suggestion } from './suggest'
import type { Sample } from './types'

/**
 * Mô hình xếp hạng tự huấn luyện: điểm = w · f, f là các đặc trưng đã có sẵn trong bộ chấm điểm có giải thích.
 * Trọng số khởi đầu chính là trọng số tay của `scoreSample`, nên chưa huấn luyện thì kết quả không đổi.
 * Học từ lựa chọn của người dùng theo cặp (mẫu được chọn so với mẫu cùng hiển thị mà không chọn),
 * bị kéo về trọng số gốc nên dữ liệu ít hoặc nhiễu không làm hỏng xếp hạng.
 */
export const FEATURES = ['loại', 'chưa nêu loại', 'dáng', 'phong cách', 'chất liệu', 'kích thước', 'trong ngân sách', 'vượt ngân sách', 'lượt chọn', 'đã gắn nhãn', 'cần duyệt'] as const
export const N_FEATURES = FEATURES.length

export const BASE_WEIGHTS: readonly number[] = [40, 10, 12, 24, 18, 20, 8, -10, 10, 3, -5]

function overlapCount(a: string[] | undefined, b: string[]): number {
  if (!a || b.length === 0) return 0
  const set = new Set(a.map(normalize))
  return b.filter((x) => set.has(normalize(x))).length
}

function catMatch(a: string, b: string): boolean {
  const na = normalize(a), nb = normalize(b)
  return na === nb || na.startsWith(`${nb} `) || nb.startsWith(`${na} `)
}

/** Đặc trưng của một mẫu với một yêu cầu, mỗi giá trị trong [0, 1]. Mẫu sai loại khách đã nêu: trả null (bị loại hẳn). */
export function featuresOf(sample: Sample, req: Requirement, stats: PickStats = {}): number[] | null {
  const hasCat = req.categories.length > 0
  if (hasCat && !req.categories.some((c) => catMatch(c, sample.category))) return null
  const shape = req.shapes.some((s) => (sample.tags ?? []).map(normalize).includes(normalize(s)) || normalize(`${sample.name} ${sample.description ?? ''}`).includes(normalize(s))) ? 1 : 0
  const size = req.widthMm && req.widthMm > 0 ? Math.max(0, 1 - Math.abs(sample.w - req.widthMm) / req.widthMm) : 0
  const priced = !!req.budgetVnd && sample.listPrice !== undefined
  const picks = stats[sample.id]?.picks ?? 0
  return [
    hasCat ? 1 : 0,
    hasCat ? 0 : 1,
    shape,
    Math.min(3, overlapCount(sample.styles, req.styles)) / 3,
    Math.min(3, overlapCount(sample.materials, req.materials)) / 3,
    size,
    priced && sample.listPrice! <= req.budgetVnd! ? 1 : 0,
    priced && sample.listPrice! > req.budgetVnd! ? 1 : 0,
    Math.min(1, 0.3 * Math.log(1 + picks)),
    sample.labeled ? 1 : 0,
    sample.needsReview ? 1 : 0
  ]
}

const dot = (w: readonly number[], f: readonly number[]): number => w.reduce((s, x, i) => s + x * (f[i] ?? 0), 0)

export function scoreWithModel(sample: Sample, req: Requirement, w: readonly number[], stats: PickStats = {}): Suggestion {
  const base = scoreSample(sample, req, stats) // giữ lý do có giải thích
  const f = featuresOf(sample, req, stats)
  if (!f || base.score <= 0 && base.reasons.length === 0) return { ...base, score: 0, reasons: [] }
  return { ...base, score: Math.round(dot(w, f) * 10) / 10 }
}

export function rankWithModel(samples: Sample[], req: Requirement, w: readonly number[], stats: PickStats = {}, limit = 8): Suggestion[] {
  return samples
    .map((s) => scoreWithModel(s, req, w, stats))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.sample.name.localeCompare(b.sample.name))
    .slice(0, limit)
}

/** Cặp học: hiệu đặc trưng (mẫu được chọn trừ mẫu không chọn), mỗi phần tử trong [-1, 1]. Không chứa khoá mẫu hay chữ của khách. */
export function pairsFromChoice(shown: Sample[], picked: Sample, req: Requirement, stats: PickStats = {}, maxPairs = 7): number[][] {
  const fp = featuresOf(picked, req, stats)
  if (!fp) return []
  const out: number[][] = []
  for (const s of shown) {
    if (s.id === picked.id) continue
    const fn = featuresOf(s, req, stats)
    if (!fn) continue
    const d = fp.map((x, i) => x - fn[i]!)
    if (d.some((x) => x !== 0)) out.push(d)
    if (out.length >= maxPairs) break
  }
  return out
}

export function validPair(d: unknown): d is number[] {
  return Array.isArray(d) && d.length === N_FEATURES && d.every((x) => typeof x === 'number' && Number.isFinite(x) && x >= -1 && x <= 1)
}

export interface TrainOptions {
  epochs?: number
  lr?: number
  /** Độ kéo về trọng số gốc (càng lớn càng thận trọng) */
  pull?: number
  /** Nhiệt độ của hàm mất mát: điểm lệch bao nhiêu thì coi là "chắc chắn" */
  temperature?: number
}

/** Trọng số mỗi đặc trưng chỉ dao động trong [0.25, 3] lần giá trị gốc và không đổi dấu. */
export function clampWeights(w: readonly number[]): number[] {
  return w.map((x, i) => {
    const b = BASE_WEIGHTS[i]!
    const lo = b >= 0 ? b * 0.25 : b * 3
    const hi = b >= 0 ? b * 3 : b * 0.25
    return Math.min(hi, Math.max(lo, x))
  })
}

/** Huấn luyện theo cặp (hồi quy logistic xếp hạng) bằng giảm gradient toàn phần; xác định, không ngẫu nhiên. */
export function train(pairs: number[][], start: readonly number[] = BASE_WEIGHTS, opts: TrainOptions = {}): number[] {
  const { epochs = 60, lr = 10, pull = 0.02, temperature = 10 } = opts
  let w = [...start]
  if (pairs.length === 0) return clampWeights(w)
  for (let e = 0; e < epochs; e++) {
    const g = new Array<number>(N_FEATURES).fill(0)
    for (const d of pairs) {
      const margin = dot(w, d) / temperature
      const k = 1 / (1 + Math.exp(margin)) // = σ(-margin): lớn khi mô hình đang xếp sai
      for (let i = 0; i < N_FEATURES; i++) g[i]! += (k * d[i]!) / temperature
    }
    w = clampWeights(
      // n + 50: ít dữ liệu thì bước nhỏ, dữ liệu nhiều thì mô hình mới dịch chuyển đáng kể.
      w.map((x, i) => x + (lr * g[i]!) / (pairs.length + 50) * 10 - pull * (x - BASE_WEIGHTS[i]!))
    )
  }
  return w.map((x) => Math.round(x * 100) / 100)
}
