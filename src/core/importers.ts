import { sampleNameFromPath } from './catalog'
import { sketchSize, withoutUnderlay, type SketchDoc } from './shapes'
import type { Sample, SourceType } from './types'

/** Đọc mẫu từ file người dùng tải lên. Không đụng tới đĩa: nhận nội dung đã đọc. */

export interface ImportResult {
  sample: Sample
  /** true khi kích thước chưa đọc được: người dùng phải nhập tay trước khi dùng */
  needsDimensions: boolean
  warnings: string[]
}

export const IMPORT_EXTENSIONS = ['skp', 'dxf', 'svg', 'png', 'jpg', 'jpeg', 'sdraw', 'sdsketch', 'json'] as const

export function extensionOf(name: string): string {
  const m = /\.([^.\\/]+)$/.exec(name)
  return m ? m[1]!.toLowerCase() : ''
}

export function sourceTypeOf(name: string): SourceType | null {
  switch (extensionOf(name)) {
    case 'skp':
      return 'skp'
    case 'dxf':
      return 'dxf'
    case 'svg':
      return 'svg'
    case 'png':
    case 'jpg':
    case 'jpeg':
      return 'image'
    case 'sdraw':
      return 'sdraw'
    case 'sdsketch':
      return 'sketch'
    default:
      return null
  }
}

interface Box {
  w: number
  d: number
}

// ---------------- DXF ----------------

const INSUNITS_TO_MM: Record<number, number> = { 1: 25.4, 2: 304.8, 4: 1, 5: 10, 6: 1000 }

/** Đọc khung bao từ DXF dạng chữ (ASCII). Hỗ trợ LINE, LWPOLYLINE, POLYLINE, CIRCLE, ARC. */
export function parseDxf(text: string): (Box & { unitFactor: number; unitKnown: boolean }) | null {
  const lines = text.split(/\r?\n/)
  const pairs: [number, string][] = []
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = Number(lines[i]!.trim())
    if (Number.isNaN(code)) continue
    pairs.push([code, lines[i + 1]!.trim()])
  }
  let unitFactor = 1
  let unitKnown = false
  const xs: number[] = []
  const ys: number[] = []
  let entity = ''
  let cx = 0
  let cy = 0
  let radius = 0
  const flush = (): void => {
    if ((entity === 'CIRCLE' || entity === 'ARC') && radius > 0) {
      xs.push(cx - radius, cx + radius)
      ys.push(cy - radius, cy + radius)
    }
    radius = 0
  }
  for (let i = 0; i < pairs.length; i++) {
    const [code, val] = pairs[i]!
    if (code === 9 && val === '$INSUNITS') {
      const next = pairs[i + 1]
      const f = next ? INSUNITS_TO_MM[Number(next[1])] : undefined
      if (f) {
        unitFactor = f
        unitKnown = true
      }
    }
    if (code === 0) {
      flush()
      entity = val
      continue
    }
    if (entity === 'CIRCLE' || entity === 'ARC') {
      if (code === 10) cx = Number(val)
      else if (code === 20) cy = Number(val)
      else if (code === 40) radius = Number(val)
    } else if (entity === 'LINE' || entity === 'LWPOLYLINE' || entity === 'VERTEX' || entity === 'POLYLINE') {
      if (code === 10 || code === 11) xs.push(Number(val))
      else if (code === 20 || code === 21) ys.push(Number(val))
    }
  }
  flush()
  const fx = xs.filter((n) => Number.isFinite(n))
  const fy = ys.filter((n) => Number.isFinite(n))
  if (fx.length === 0 || fy.length === 0) return null
  return {
    w: (Math.max(...fx) - Math.min(...fx)) * unitFactor,
    d: (Math.max(...fy) - Math.min(...fy)) * unitFactor,
    unitFactor,
    unitKnown
  }
}

// ---------------- SVG ----------------

const UNIT_MM: Record<string, number> = { mm: 1, cm: 10, in: 25.4, pt: 25.4 / 72, px: 25.4 / 96, '': 1 }

function lengthMm(value: string | undefined): { mm: number; explicit: boolean } | null {
  if (!value) return null
  const m = /^\s*([0-9.]+)\s*(mm|cm|in|pt|px)?\s*$/i.exec(value)
  if (!m) return null
  const unit = (m[2] ?? '').toLowerCase()
  return { mm: Number(m[1]) * (UNIT_MM[unit] ?? 1), explicit: unit === 'mm' || unit === 'cm' || unit === 'in' }
}

function attr(tag: string, name: string): string | undefined {
  const m = new RegExp(`\\s${name}\\s*=\\s*["']([^"']+)["']`, 'i').exec(tag)
  return m ? m[1] : undefined
}

export function parseSvg(text: string): (Box & { explicitUnit: boolean }) | null {
  const tag = /<svg\b[^>]*>/i.exec(text)?.[0]
  if (!tag) return null
  const wl = lengthMm(attr(tag, 'width'))
  const hl = lengthMm(attr(tag, 'height'))
  if (wl && hl) return { w: wl.mm, d: hl.mm, explicitUnit: wl.explicit && hl.explicit }
  const vb = attr(tag, 'viewBox')?.split(/[\s,]+/).map(Number)
  if (vb && vb.length === 4 && vb.every(Number.isFinite) && vb[2]! > 0 && vb[3]! > 0) {
    return { w: vb[2]!, d: vb[3]!, explicitUnit: false }
  }
  return null
}

// ---------------- Ảnh ----------------

/** Kích thước điểm ảnh của PNG hoặc JPEG; không phải mm. */
export function imagePixelSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length > 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    return { width: dv.getUint32(16), height: dv.getUint32(20) }
  }
  if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    let i = 2
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) {
        i += 1
        continue
      }
      const marker = bytes[i + 1]!
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: dv.getUint16(i + 5), width: dv.getUint16(i + 7) }
      }
      i += 2 + dv.getUint16(i + 2)
    }
  }
  return null
}

// ---------------- Gộp ----------------

function guessCategory(name: string): string {
  const n = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
  const table: [RegExp, string][] = [
    [/sofa|so pha|sopha/, 'Sofa'],
    [/ban tra|ban cafe|coffee/, 'Bàn trà'],
    [/ke tivi|ke tv|tv/, 'Kệ tivi'],
    [/ke sach|tu sach/, 'Kệ sách'],
    [/ban an/, 'Bàn ăn'],
    [/ban lam viec|ban lv/, 'Bàn làm việc'],
    [/giuong/, 'Giường'],
    [/tu quan ao|tu ao/, 'Tủ quần áo'],
    [/ghe/, 'Ghế'],
    [/ban/, 'Bàn']
  ]
  for (const [re, cat] of table) if (re.test(n)) return cat
  return 'Chưa phân loại'
}

function idFor(name: string, size: number): string {
  let h = 5381
  const key = `${name}:${size}`
  for (let i = 0; i < key.length; i++) h = ((h << 5) + h + key.charCodeAt(i)) | 0
  return `up-${(h >>> 0).toString(36)}`
}

/**
 * Chuyển nội dung file thành mục kho. `path` là đường dẫn trên máy (ghi nhớ để mở lại), `bytes` là nội dung.
 * Mặc định mẫu nhập từ file đều cần duyệt; chỉ DXF/SVG có đơn vị rõ mới đọc được kích thước.
 */
export function importFile(path: string, bytes: Uint8Array): ImportResult | { error: string } {
  const type = sourceTypeOf(path)
  if (!type) return { error: `Không hỗ trợ định dạng .${extensionOf(path) || '?'}` }
  const name = sampleNameFromPath(path)
  const warnings: string[] = []
  const base: Sample = {
    id: idFor(path, bytes.length),
    name,
    category: guessCategory(name),
    w: 1000,
    d: 600,
    h: 800,
    origin: 'upload',
    sourceType: type,
    needsReview: true
  }
  const text = (): string => new TextDecoder('utf-8').decode(bytes)

  if (type === 'skp') {
    warnings.push('SketchUp là định dạng đóng: app chưa đọc được kích thước. Nhập tay hoặc dùng plugin SketchUp sau này.')
    return { sample: { ...base, skpPath: path }, needsDimensions: true, warnings }
  }

  if (type === 'image') {
    const px = imagePixelSize(bytes)
    warnings.push(
      px
        ? `Ảnh ${px.width} × ${px.height} điểm ảnh, không có kích thước thật. Nhập tay kích thước (mm).`
        : 'Không đọc được kích thước ảnh. Nhập tay kích thước (mm).'
    )
    return { sample: { ...base, imagePath: path }, needsDimensions: true, warnings }
  }

  if (type === 'dxf') {
    const box = parseDxf(text())
    if (!box || box.w <= 0 || box.d <= 0) {
      warnings.push('DXF không có hình đọc được (có thể là DXF nhị phân). Nhập tay kích thước.')
      return { sample: base, needsDimensions: true, warnings }
    }
    if (!box.unitKnown) warnings.push('DXF không ghi đơn vị: đang coi là mm. Hãy kiểm tra kích thước.')
    return {
      sample: { ...base, w: Math.round(box.w), d: Math.round(box.d) },
      needsDimensions: false,
      warnings
    }
  }

  if (type === 'svg') {
    const box = parseSvg(text())
    if (!box) {
      warnings.push('SVG không có kích thước. Nhập tay kích thước.')
      return { sample: base, needsDimensions: true, warnings }
    }
    if (!box.explicitUnit) warnings.push('SVG không ghi đơn vị mm, cm hoặc in: kích thước chỉ là ước lượng, hãy kiểm tra.')
    return {
      sample: { ...base, w: Math.round(box.w), d: Math.round(box.d) },
      needsDimensions: false,
      warnings
    }
  }

  if (type === 'sketch') {
    try {
      const doc = JSON.parse(text()) as SketchDoc
      if (doc.version !== 1 || !Array.isArray(doc.shapes)) throw new Error('sai định dạng')
      const { w, d } = sketchSize(doc)
      return {
        sample: {
          ...base,
          name: doc.name || name,
          category: doc.category || base.category,
          w: w || base.w,
          d: d || base.d,
          h: doc.heightMm || base.h,
          sketch: withoutUnderlay(doc),
          origin: 'sketch',
          needsReview: false
        },
        needsDimensions: false,
        warnings
      }
    } catch {
      return { error: 'Tệp phác thảo (.sdsketch) không hợp lệ' }
    }
  }

  // .sdraw: bố cục phòng đã dựng, dùng làm mẫu khởi đầu
  try {
    const doc = JSON.parse(text()) as { version?: number; name?: string; room?: { widthMm: number; depthMm: number } }
    if (doc.version !== 1 || !doc.room) throw new Error('sai định dạng')
    return {
      sample: {
        ...base,
        name: doc.name || name,
        category: 'Bố cục phòng',
        w: Math.round(doc.room.widthMm),
        d: Math.round(doc.room.depthMm),
        h: 2700,
        needsReview: false
      },
      needsDimensions: false,
      warnings: ['Bố cục phòng (.sdraw) được lưu như mẫu khởi đầu theo kích thước phòng.']
    }
  } catch {
    return { error: 'Tệp .sdraw không hợp lệ' }
  }
}

/**
 * Thư viện do plugin SketchUp xuất (`*.sdlib.json`): mỗi mục đã có kích thước đo trong SketchUp,
 * nên không cần nhập tay. Trả về lỗi nếu tệp không phải thư viện Sdraw AI.
 */
export function importLibrary(path: string, text: string): { items: ImportResult[] } | { error: string } {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { error: 'Tệp JSON không đọc được' }
  }
  const lib = raw as { format?: unknown; version?: unknown; items?: unknown }
  if (lib?.format !== 'sdraw-library') return { error: 'Không phải thư viện Sdraw AI (thiếu format sdraw-library)' }
  if (lib.version !== 1) return { error: `Phiên bản thư viện ${String(lib.version)} chưa được hỗ trợ` }
  if (!Array.isArray(lib.items)) return { error: 'Thư viện không có danh sách items' }
  const items: ImportResult[] = []
  for (const it of lib.items.slice(0, 20_000) as Record<string, unknown>[]) {
    const skp = typeof it?.['path'] === 'string' ? (it['path'] as string) : ''
    const name = typeof it?.['name'] === 'string' && it['name'] ? (it['name'] as string).slice(0, 120) : sampleNameFromPath(skp || path)
    const dim = (k: string): number => {
      const v = it?.[k]
      return typeof v === 'number' && Number.isFinite(v) && v > 0 && v < 100_000 ? Math.round(v) : 0
    }
    const w = dim('w'), d = dim('d'), h = dim('h')
    const known = w > 0 && d > 0 && h > 0
    const category = typeof it?.['category'] === 'string' && it['category'] ? (it['category'] as string).slice(0, 40) : guessCategory(name)
    items.push({
      sample: {
        id: idFor(skp || `${path}#${name}`, w * 1_000_000 + d * 1_000 + h),
        name, category, w: w || 1000, d: d || 600, h: h || 800,
        origin: 'upload', sourceType: 'skp', ...(skp ? { skpPath: skp } : {}),
        // Kích thước đo trong SketchUp đáng tin hơn đoán từ tên, nhưng phân loại vẫn nên được người duyệt.
        needsReview: !known || category === 'Chưa phân loại'
      },
      needsDimensions: !known,
      warnings: known ? [] : ['Thiếu kích thước trong thư viện: nhập tay.']
    })
  }
  return { items }
}
