import type { Sample } from './types'

/**
 * Bản ghi chỉ mục gửi lên hệ thống chung để học. Chủ ý chỉ chứa thông số và nhãn:
 * không tên file, đường dẫn, giá, ảnh hay file .skp. Mọi thứ gửi đi phải đi qua toIndexEntry.
 */
export interface IndexEntry {
  /** Khoá ẩn danh, ổn định theo mẫu (không suy ngược được đường dẫn) */
  key: string
  category: string
  w: number
  d: number
  h: number
  tags: string[]
  styles: string[]
  materials: string[]
  kind?: string
  /** Thông số số học của phác thảo (rộng, sâu, số ghế...) */
  params?: Record<string, number>
  origin: string
  labeled: boolean
}

function fnv(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}

/** Khoá theo doanh nghiệp để hai doanh nghiệp không đè nhau; `salt` do máy chủ hoặc app giữ. */
export function indexKey(sampleId: string, salt: string): string {
  return `${fnv(`${salt}|${sampleId}`)}${fnv(`${sampleId}|${salt}`)}`
}

export function toIndexEntry(sample: Sample, salt: string): IndexEntry {
  const entry: IndexEntry = {
    key: indexKey(sample.id, salt),
    category: sample.category,
    w: Math.round(sample.w),
    d: Math.round(sample.d),
    h: Math.round(sample.h),
    tags: [...(sample.tags ?? [])],
    styles: [...(sample.styles ?? [])],
    materials: [...(sample.materials ?? [])],
    origin: sample.origin ?? 'upload',
    labeled: !!sample.labeled
  }
  if (sample.sketch) {
    entry.kind = sample.sketch.kind
    entry.params = { ...sample.sketch.params }
  }
  return entry
}

const ALLOWED = new Set<keyof IndexEntry>([
  'key',
  'category',
  'w',
  'd',
  'h',
  'tags',
  'styles',
  'materials',
  'kind',
  'params',
  'origin',
  'labeled'
])

/**
 * Máy chủ dùng hàm này để từ chối mọi thứ ngoài danh sách cho phép (đường dẫn, giá, tên...).
 * Trả về bản ghi sạch hoặc lý do bị từ chối.
 */
export function sanitizeIndexEntry(input: unknown): { ok: true; entry: IndexEntry } | { ok: false; reason: string } {
  if (!input || typeof input !== 'object') return { ok: false, reason: 'không phải đối tượng' }
  const o = input as Record<string, unknown>
  for (const k of Object.keys(o)) {
    if (!ALLOWED.has(k as keyof IndexEntry)) return { ok: false, reason: `trường không được phép: ${k}` }
  }
  const str = (v: unknown, max = 80): string | null => (typeof v === 'string' && v.length > 0 && v.length <= max ? v : null)
  const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100_000 ? v : null)
  const list = (v: unknown): string[] | null =>
    Array.isArray(v) && v.length <= 20 && v.every((x) => typeof x === 'string' && x.length <= 40) ? (v as string[]) : null
  const key = str(o['key'], 64)
  const category = str(o['category'], 40)
  const w = num(o['w'])
  const d = num(o['d'])
  const h = num(o['h'])
  const tags = list(o['tags'] ?? [])
  const styles = list(o['styles'] ?? [])
  const materials = list(o['materials'] ?? [])
  const origin = str(o['origin'], 20)
  if (!key || !category || w === null || d === null || h === null || !tags || !styles || !materials || !origin) {
    return { ok: false, reason: 'thiếu hoặc sai trường bắt buộc' }
  }
  const entry: IndexEntry = { key, category, w, d, h, tags, styles, materials, origin, labeled: o['labeled'] === true }
  if (o['kind'] !== undefined) {
    const kind = str(o['kind'], 20)
    if (!kind) return { ok: false, reason: 'kind không hợp lệ' }
    entry.kind = kind
  }
  if (o['params'] !== undefined) {
    const p = o['params']
    if (!p || typeof p !== 'object' || Array.isArray(p)) return { ok: false, reason: 'params không hợp lệ' }
    const out: Record<string, number> = {}
    for (const [k, v] of Object.entries(p as Record<string, unknown>)) {
      const n = num(v)
      if (n === null || k.length > 20) return { ok: false, reason: 'params không hợp lệ' }
      out[k] = n
    }
    entry.params = out
  }
  return { ok: true, entry }
}

/** Mẫu giả dựng từ chỉ mục, để dùng chung bộ xếp hạng ở máy chủ. */
export function entryToSample(e: IndexEntry): Sample {
  return {
    id: e.key,
    name: e.category,
    category: e.category,
    w: e.w,
    d: e.d,
    h: e.h,
    tags: e.tags,
    styles: e.styles,
    materials: e.materials,
    origin: e.origin as Sample['origin'],
    labeled: e.labeled
  }
}
