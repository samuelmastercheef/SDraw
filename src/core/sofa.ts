import { makeShape, outlineBounds, withoutUnderlay, type Pt, type Shape, type SketchDoc } from './shapes'
import type { Sample } from './types'

export type SofaKind = 'straight' | 'L' | 'round'

export interface SofaParams {
  kind: SofaKind
  /** Chiều rộng tổng */
  width: number
  /** Chiều sâu phần ngồi chính */
  depth: number
  /** Chiều dài phần chaise (chỉ kiểu L), tính từ lưng */
  chaise: number
  /** Bề dày tay vịn */
  arm: number
  /** Bề dày lưng tựa */
  back: number
  height: number
  seats: number
}

export const SOFA_LABEL: Record<SofaKind, string> = { straight: 'Thẳng', L: 'Chữ L', round: 'Bo tròn' }

export const SOFA_DEFAULTS: Record<SofaKind, SofaParams> = {
  straight: { kind: 'straight', width: 2200, depth: 900, chaise: 0, arm: 180, back: 180, height: 800, seats: 3 },
  L: { kind: 'L', width: 2700, depth: 900, chaise: 1700, arm: 180, back: 180, height: 800, seats: 3 },
  round: { kind: 'round', width: 2400, depth: 950, chaise: 0, arm: 200, back: 200, height: 780, seats: 3 }
}

/** Giới hạn hợp lý (mm) để thông số không phá hình. */
export function clampParams(p: SofaParams): SofaParams {
  const width = Math.max(900, Math.min(5000, p.width))
  const depth = Math.max(600, Math.min(1300, p.depth))
  const arm = Math.max(0, Math.min(400, p.arm))
  const back = Math.max(80, Math.min(400, p.back))
  const seats = Math.max(1, Math.min(6, Math.round(p.seats)))
  const chaise = p.kind === 'L' ? Math.max(depth + 300, Math.min(3000, p.chaise)) : 0
  return { ...p, width, depth, arm, back, seats, chaise, height: Math.max(300, Math.min(1200, p.height)) }
}

function roundedRect(w: number, d: number, r: number, steps = 5): Pt[] {
  const pts: Pt[] = []
  const corners: [number, number, number][] = [
    [w - r, r, -90],
    [w - r, d - r, 0],
    [r, d - r, 90],
    [r, r, 180]
  ]
  for (const [cx, cy, start] of corners) {
    for (let i = 0; i <= steps; i++) {
      const a = ((start + (90 * i) / steps) * Math.PI) / 180
      pts.push({ x: Math.round(cx + r * Math.cos(a)), y: Math.round(cy + r * Math.sin(a)) })
    }
  }
  return pts
}

function line(name: string, a: Pt, b: Pt, role: Shape['role'] = 'detail'): Shape {
  return makeShape({ kind: 'path', name, role, nodes: [a, b], strokeWidth: 1 })
}

function dim(name: string, a: Pt, b: Pt): Shape {
  return makeShape({ kind: 'dim', name, role: 'dimension', nodes: [a, b], strokeWidth: 1, stroke: '#075E6B' })
}

/** Dựng khung sofa từ thông số. Khung ngoài (outline) là hình có thể kéo nút. */
export function buildSofa(input: SofaParams): Shape[] {
  const p = clampParams(input)
  const { width: w, depth: d, arm, back } = p
  const shapes: Shape[] = []
  const inner = (a: number, b: number, n: number): number[] => {
    const out: number[] = []
    for (let i = 1; i < n; i++) out.push(Math.round(a + ((b - a) * i) / n))
    return out
  }

  if (p.kind === 'L') {
    const c = p.chaise
    shapes.push(
      makeShape({
        kind: 'path',
        name: 'Khung sofa chữ L',
        role: 'outline',
        closed: true,
        fill: '#E7F3F4',
        nodes: [
          { x: 0, y: 0 },
          { x: w, y: 0 },
          { x: w, y: d },
          { x: d, y: d },
          { x: d, y: c },
          { x: 0, y: c }
        ]
      })
    )
    shapes.push(line('Lưng tựa', { x: 0, y: back }, { x: w, y: back }))
    shapes.push(line('Tay vịn trái', { x: arm, y: back }, { x: arm, y: c }))
    shapes.push(line('Tay vịn phải', { x: w - arm, y: back }, { x: w - arm, y: d }))
    shapes.push(line('Ranh chaise', { x: arm, y: d }, { x: d, y: d }))
    for (const x of inner(d, w - arm, p.seats)) shapes.push(line('Đệm', { x, y: back }, { x, y: d }))
    shapes.push(dim('Rộng', { x: 0, y: -120 }, { x: w, y: -120 }))
    shapes.push(dim('Dài chaise', { x: -120, y: 0 }, { x: -120, y: c }))
    shapes.push(dim('Sâu', { x: w + 120, y: 0 }, { x: w + 120, y: d }))
    return shapes
  }

  if (p.kind === 'round') {
    const r = Math.min(d, w) / 2.4
    shapes.push(
      makeShape({
        kind: 'path',
        name: 'Khung sofa bo tròn',
        role: 'outline',
        closed: true,
        fill: '#E7F3F4',
        nodes: roundedRect(w, d, r)
      })
    )
  } else {
    shapes.push(
      makeShape({
        kind: 'path',
        name: 'Khung sofa thẳng',
        role: 'outline',
        closed: true,
        fill: '#E7F3F4',
        nodes: [
          { x: 0, y: 0 },
          { x: w, y: 0 },
          { x: w, y: d },
          { x: 0, y: d }
        ]
      })
    )
  }
  shapes.push(line('Lưng tựa', { x: arm / 2, y: back }, { x: w - arm / 2, y: back }))
  shapes.push(line('Tay vịn trái', { x: arm, y: back }, { x: arm, y: d - 20 }))
  shapes.push(line('Tay vịn phải', { x: w - arm, y: back }, { x: w - arm, y: d - 20 }))
  for (const x of inner(arm, w - arm, p.seats)) shapes.push(line('Đệm', { x, y: back }, { x, y: d - 20 }))
  shapes.push(dim('Rộng', { x: 0, y: -120 }, { x: w, y: -120 }))
  shapes.push(dim('Sâu', { x: w + 120, y: 0 }, { x: w + 120, y: d }))
  return shapes
}

export function newSofaSketch(kind: SofaKind = 'straight', overrides: Partial<SofaParams> = {}): SketchDoc {
  const params = clampParams({ ...SOFA_DEFAULTS[kind], ...overrides, kind })
  return {
    version: 1,
    name: `Sofa ${SOFA_LABEL[kind].toLowerCase()}`,
    category: 'Sofa',
    kind,
    params: paramsToRecord(params),
    heightMm: params.height,
    manualEdits: false,
    shapes: buildSofa(params)
  }
}

export function paramsToRecord(p: SofaParams): Record<string, number> {
  return { width: p.width, depth: p.depth, chaise: p.chaise, arm: p.arm, back: p.back, height: p.height, seats: p.seats }
}

export function paramsFromSketch(doc: SketchDoc): SofaParams {
  const kind = (doc.kind === 'L' || doc.kind === 'round' ? doc.kind : 'straight') as SofaKind
  const r = doc.params
  const base = SOFA_DEFAULTS[kind]
  return clampParams({
    kind,
    width: r['width'] ?? base.width,
    depth: r['depth'] ?? base.depth,
    chaise: r['chaise'] ?? base.chaise,
    arm: r['arm'] ?? base.arm,
    back: r['back'] ?? base.back,
    height: r['height'] ?? base.height,
    seats: r['seats'] ?? base.seats
  })
}

/**
 * Điểm bắt đầu từ dữ liệu mẫu: thông số của mẫu có sẵn trong kho.
 * Mẫu có bản phác thảo thì lấy thông số đã lưu; còn lại suy từ kích thước và tên.
 */
export function paramsFromSample(sample: Sample): SofaParams {
  if (sample.sketch && sample.sketch.category === 'Sofa') return paramsFromSketch(sample.sketch)
  const text = `${sample.name} ${(sample.tags ?? []).join(' ')}`.toLowerCase()
  const kind: SofaKind = /chữ l|góc l|\bl\b/.test(text) ? 'L' : /bo tròn|tròn/.test(text) ? 'round' : 'straight'
  const base = SOFA_DEFAULTS[kind]
  return clampParams({ ...base, width: sample.w, depth: Math.min(sample.d, 1300), height: sample.h })
}

/** Dựng lại khung từ thông số mới. Giữ nguyên hình người dùng tự vẽ (role free). */
export function rebuildSofa(doc: SketchDoc, params: SofaParams): SketchDoc {
  const p = clampParams(params)
  const kept = doc.shapes.filter((s) => s.role === 'free' || s.role === 'reference')
  return {
    ...doc,
    kind: p.kind,
    params: paramsToRecord(p),
    heightMm: p.height,
    manualEdits: false,
    shapes: [...buildSofa(p), ...kept]
  }
}

/** Sau khi kéo nút: cập nhật rộng và sâu theo khung ngoài, các thông số khác giữ nguyên. */
export function syncParamsFromOutline(doc: SketchDoc): SketchDoc {
  const b = outlineBounds(doc)
  if (!b) return doc
  const width = Math.round(b.maxX - b.minX)
  const depth = doc.kind === 'L' ? doc.params['depth'] ?? 900 : Math.round(b.maxY - b.minY)
  const chaise = doc.kind === 'L' ? Math.round(b.maxY - b.minY) : 0
  return { ...doc, params: { ...doc.params, width, depth, chaise } }
}

/** Mẫu kho từ bản phác thảo: kích thước theo khung ngoài, kèm bản phác thảo để mở lại sửa. */
export function sketchToSample(doc: SketchDoc, id: string, base?: Partial<Sample>): Sample {
  const b = outlineBounds(doc)
  const w = b ? Math.round(b.maxX - b.minX) : Math.round(doc.params['width'] ?? 1000)
  const d = b ? Math.round(b.maxY - b.minY) : Math.round(doc.params['depth'] ?? 600)
  return {
    id,
    name: doc.name,
    category: doc.category,
    w,
    d,
    h: Math.round(doc.heightMm),
    origin: 'sketch',
    sourceType: 'sketch',
    tags: [doc.kind === 'L' ? 'chữ L' : doc.kind === 'round' ? 'bo tròn' : 'thẳng'],
    sketch: withoutUnderlay(doc),
    ...base
  }
}
