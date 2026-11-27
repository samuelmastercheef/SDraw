import { parseRequirement, rankSamples, type PickStats } from './suggest'
import type { Sample } from './types'

/** Gắn nhãn mẫu (admin) và đo chất lượng gợi ý trên bộ mẫu đã gắn nhãn. */

export interface LabelInput {
  category?: string
  tags?: string[]
  styles?: string[]
  materials?: string[]
  w?: number
  d?: number
  h?: number
}

function uniq(list: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of list) {
    const v = raw.trim()
    const k = v.toLowerCase()
    if (v && !seen.has(k)) {
      seen.add(k)
      out.push(v)
    }
  }
  return out
}

/** Áp nhãn lên mẫu và đánh dấu đã duyệt. Nhập kích thước thì mẫu hết trạng thái cần duyệt. */
export function applyLabel(sample: Sample, label: LabelInput): Sample {
  const next: Sample = { ...sample, labeled: true, needsReview: false }
  if (label.category) next.category = label.category
  if (label.tags) next.tags = uniq(label.tags)
  if (label.styles) next.styles = uniq(label.styles)
  if (label.materials) next.materials = uniq(label.materials)
  if (label.w && label.w > 0) next.w = Math.round(label.w)
  if (label.d && label.d > 0) next.d = Math.round(label.d)
  if (label.h && label.h > 0) next.h = Math.round(label.h)
  return next
}

/** Mẫu cần gắn nhãn trước: chưa duyệt, rồi chưa có nhãn. */
export function labelQueue(samples: Sample[]): Sample[] {
  return samples
    .filter((s) => !s.labeled)
    .sort((a, b) => Number(!!b.needsReview) - Number(!!a.needsReview) || a.name.localeCompare(b.name))
}

export interface EvalCase {
  text: string
  /** Các mẫu được coi là câu trả lời đúng */
  expected: string[]
}

export interface EvalReport {
  total: number
  top1: number
  top3: number
  /** Tỉ lệ 0..1 */
  top1Rate: number
  top3Rate: number
  misses: { text: string; got: string[] }[]
}

/** Đo tỉ lệ gợi ý đúng: cổng của giai đoạn 3 trong lộ trình. */
export function evaluateSuggest(samples: Sample[], cases: EvalCase[], stats: PickStats = {}): EvalReport {
  let top1 = 0
  let top3 = 0
  const misses: EvalReport['misses'] = []
  for (const c of cases) {
    const ranked = rankSamples(samples, parseRequirement(c.text), stats, 3).map((r) => r.sample.id)
    const want = new Set(c.expected)
    if (ranked[0] && want.has(ranked[0])) top1 += 1
    if (ranked.some((id) => want.has(id))) top3 += 1
    else misses.push({ text: c.text, got: ranked })
  }
  const total = cases.length
  return {
    total,
    top1,
    top3,
    top1Rate: total ? top1 / total : 0,
    top3Rate: total ? top3 / total : 0,
    misses
  }
}
