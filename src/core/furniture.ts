import { makeShape, outlineBounds, type Pt, type Shape, type SketchDoc } from './shapes'
import { newSofaSketch, paramsFromSketch, rebuildSofa, syncParamsFromOutline, clampParams as clampSofa } from './sofa'
import type { SofaKind } from './sofa'

/** Bàn và ghế dựng theo thông số, cùng cách làm với sofa: khung ngoài kéo nút được, nét phụ vẽ lại theo thông số. */

export type TableKind = 'rect' | 'round' | 'oval'
export const TABLE_LABEL: Record<TableKind, string> = { rect: 'Chữ nhật', round: 'Tròn', oval: 'Elip' }

export interface ParamSpec {
  key: string
  label: string
  min: number
  max: number
  /** Chỉ hiện với các kiểu này; bỏ trống là hiện với mọi kiểu */
  kinds?: string[]
}

export const TABLE_SPECS: ParamSpec[] = [
  { key: 'width', label: 'Rộng', min: 300, max: 4000 },
  { key: 'depth', label: 'Sâu', min: 300, max: 2000, kinds: ['rect', 'oval'] },
  { key: 'height', label: 'Cao', min: 250, max: 1200 },
  { key: 'leg', label: 'Chân (vuông)', min: 30, max: 200 },
  { key: 'inset', label: 'Chân thụt vào', min: 0, max: 400 }
]

export const CHAIR_SPECS: ParamSpec[] = [
  { key: 'width', label: 'Rộng', min: 300, max: 900 },
  { key: 'depth', label: 'Sâu', min: 300, max: 900 },
  { key: 'height', label: 'Cao tổng', min: 600, max: 1300 },
  { key: 'seatHeight', label: 'Cao mặt ngồi', min: 250, max: 600 },
  { key: 'back', label: 'Dày lưng tựa', min: 20, max: 200 },
  { key: 'leg', label: 'Chân (vuông)', min: 20, max: 100 }
]

export const TABLE_DEFAULTS: Record<TableKind, Record<string, number>> = {
  rect: { width: 1600, depth: 800, height: 750, leg: 60, inset: 60 },
  round: { width: 1000, depth: 1000, height: 750, leg: 60, inset: 150 },
  oval: { width: 1800, depth: 900, height: 750, leg: 60, inset: 150 }
}
export const CHAIR_DEFAULTS: Record<string, number> = { width: 450, depth: 480, height: 900, seatHeight: 450, back: 40, leg: 40 }

function clampBy(specs: ParamSpec[], r: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = { ...r }
  for (const s of specs) {
    const v = typeof r[s.key] === 'number' && Number.isFinite(r[s.key]) ? (r[s.key] as number) : s.min
    out[s.key] = Math.round(Math.max(s.min, Math.min(s.max, v)))
  }
  return out
}

export function clampTable(kind: TableKind, r: Record<string, number>): Record<string, number> {
  const out = clampBy(TABLE_SPECS, { ...TABLE_DEFAULTS[kind], ...r })
  if (kind === 'round') out['depth'] = out['width']!
  // Chân không được thụt quá nửa mặt bàn.
  out['inset'] = Math.min(out['inset']!, Math.floor((Math.min(out['width']!, out['depth']!) - out['leg']!) / 2))
  return out
}

export function clampChair(r: Record<string, number>): Record<string, number> {
  const out = clampBy(CHAIR_SPECS, { ...CHAIR_DEFAULTS, ...r })
  out['seatHeight'] = Math.min(out['seatHeight']!, out['height']! - 200)
  out['back'] = Math.min(out['back']!, Math.floor(out['depth']! / 2))
  return out
}

function ellipse(w: number, d: number): Shape {
  return makeShape({ kind: 'ellipse', name: 'Mặt bàn', role: 'outline', closed: true, fill: '#E7F3F4', nodes: [{ x: w / 2, y: d / 2 }, { x: w, y: d }] })
}

function rect(name: string, x: number, y: number, w: number, d: number, role: Shape['role'], fill: string | null = null): Shape {
  const nodes: Pt[] = [{ x, y }, { x: x + w, y }, { x: x + w, y: y + d }, { x, y: y + d }]
  return makeShape({ kind: 'path', name, role, closed: true, fill, nodes, strokeWidth: role === 'outline' ? 2 : 1 })
}

function dimLine(name: string, a: Pt, b: Pt): Shape {
  return makeShape({ kind: 'dim', name, role: 'dimension', nodes: [a, b], strokeWidth: 1, stroke: '#075E6B' })
}

export function buildTable(kind: TableKind, input: Record<string, number>): Shape[] {
  const p = clampTable(kind, input)
  const w = p['width']!, d = p['depth']!, leg = p['leg']!, inset = p['inset']!
  const shapes: Shape[] = []
  shapes.push(kind === 'rect' ? rect('Mặt bàn', 0, 0, w, d, 'outline', '#E7F3F4') : ellipse(w, d))
  // Chân nằm trong mặt bàn; bàn tròn/elip đặt chân trên đường elip thu nhỏ.
  const spots: Pt[] =
    kind === 'rect'
      ? [
          { x: inset, y: inset }, { x: w - inset - leg, y: inset },
          { x: w - inset - leg, y: d - inset - leg }, { x: inset, y: d - inset - leg }
        ]
      : [0, 1, 2, 3].map((i) => {
          const a = Math.PI / 4 + (i * Math.PI) / 2
          return { x: Math.round(w / 2 + ((w / 2 - inset) * Math.cos(a)) - leg / 2), y: Math.round(d / 2 + ((d / 2 - inset) * Math.sin(a)) - leg / 2) }
        })
  spots.forEach((s, i) => shapes.push(rect(`Chân ${i + 1}`, s.x, s.y, leg, leg, 'detail')))
  shapes.push(dimLine('Rộng', { x: 0, y: -120 }, { x: w, y: -120 }))
  if (kind !== 'round') shapes.push(dimLine('Sâu', { x: w + 120, y: 0 }, { x: w + 120, y: d }))
  return shapes
}

export function buildChair(input: Record<string, number>): Shape[] {
  const p = clampChair(input)
  const w = p['width']!, d = p['depth']!, back = p['back']!, leg = p['leg']!
  const shapes: Shape[] = [rect('Mặt ghế', 0, 0, w, d, 'outline', '#E7F3F4')]
  shapes.push(rect('Lưng tựa', 0, 0, w, back, 'detail', '#CFE3E6'))
  for (const [i, s] of ([[0, d - leg], [w - leg, d - leg], [0, back], [w - leg, back]] as [number, number][]).entries()) {
    shapes.push(rect(`Chân ${i + 1}`, s[0], s[1], leg, leg, 'detail'))
  }
  shapes.push(dimLine('Rộng', { x: 0, y: -120 }, { x: w, y: -120 }))
  shapes.push(dimLine('Sâu', { x: w + 120, y: 0 }, { x: w + 120, y: d }))
  return shapes
}

export function newTableSketch(kind: TableKind = 'rect', overrides: Record<string, number> = {}): SketchDoc {
  const params = clampTable(kind, { ...TABLE_DEFAULTS[kind], ...overrides })
  return { version: 1, name: `Bàn ${TABLE_LABEL[kind].toLowerCase()}`, category: 'Bàn', kind, params, heightMm: params['height']!, manualEdits: false, shapes: buildTable(kind, params) }
}

export function newChairSketch(overrides: Record<string, number> = {}): SketchDoc {
  const params = clampChair({ ...CHAIR_DEFAULTS, ...overrides })
  return { version: 1, name: 'Ghế ăn', category: 'Ghế', kind: 'dining', params, heightMm: params['height']!, manualEdits: false, shapes: buildChair(params) }
}

/** Dựng lại khung theo thông số mới, giữ nét tự vẽ (free) và nét tham chiếu. */
export function rebuildFromParams(doc: SketchDoc, patch: Record<string, number>, kind?: string): SketchDoc {
  const kept = doc.shapes.filter((s) => s.role === 'free' || s.role === 'reference')
  if (doc.category === 'Bàn') {
    const k = (kind ?? doc.kind) as TableKind
    const params = clampTable(k, { ...doc.params, ...patch })
    return { ...doc, kind: k, params, heightMm: params['height']!, manualEdits: false, shapes: [...buildTable(k, params), ...kept] }
  }
  if (doc.category === 'Ghế') {
    const params = clampChair({ ...doc.params, ...patch })
    return { ...doc, params, heightMm: params['height']!, manualEdits: false, shapes: [...buildChair(params), ...kept] }
  }
  if (doc.category === 'Giường' || doc.category === 'Kệ sách' || doc.category === 'Tủ quần áo') {
    const d = SIMPLE[doc.category]
    const params = d.clamp({ ...doc.params, ...patch })
    return { ...doc, params, heightMm: params['height']!, manualEdits: false, shapes: [...d.build(params), ...kept] }
  }
  const sofa = paramsFromSketch(doc)
  return rebuildSofa(doc, clampSofa({ ...sofa, ...patch, ...(kind ? { kind: kind as SofaKind } : {}) }))
}

/** Sau khi kéo nút khung ngoài: cập nhật rộng và sâu theo khung. */
export function syncFromOutline(doc: SketchDoc): SketchDoc {
  if (doc.category === 'Sofa') return syncParamsFromOutline(doc)
  const b = outlineBounds(doc)
  if (!b) return doc
  const width = Math.round(b.maxX - b.minX)
  const depth = Math.round(b.maxY - b.minY)
  return { ...doc, params: { ...doc.params, width, depth: doc.kind === 'round' ? width : depth } }
}

export type FurnitureCategory = 'Sofa' | 'Bàn' | 'Ghế' | 'Giường' | 'Kệ sách' | 'Tủ quần áo'

// ---- Giường, kệ sách, tủ áo: nhìn từ trên xuống, khung ngoài kéo nút được ----

export const BED_SPECS: ParamSpec[] = [
  { key: 'width', label: 'Rộng', min: 800, max: 2400 },
  { key: 'depth', label: 'Dài', min: 1600, max: 2400 },
  { key: 'height', label: 'Cao (cả đầu giường)', min: 300, max: 1500 },
  { key: 'headboard', label: 'Dày đầu giường', min: 40, max: 300 }
]
export const BED_DEFAULTS: Record<string, number> = { width: 1600, depth: 2000, height: 1000, headboard: 80 }

export const SHELF_SPECS: ParamSpec[] = [
  { key: 'width', label: 'Rộng', min: 300, max: 4000 },
  { key: 'depth', label: 'Sâu', min: 150, max: 800 },
  { key: 'height', label: 'Cao', min: 300, max: 2800 },
  { key: 'shelves', label: 'Số tầng', min: 1, max: 12 },
  { key: 'panel', label: 'Dày ván', min: 10, max: 50 }
]
export const SHELF_DEFAULTS: Record<string, number> = { width: 800, depth: 300, height: 1800, shelves: 5, panel: 18 }

export const WARDROBE_SPECS: ParamSpec[] = [
  { key: 'width', label: 'Rộng', min: 400, max: 5000 },
  { key: 'depth', label: 'Sâu', min: 350, max: 900 },
  { key: 'height', label: 'Cao', min: 1200, max: 3000 },
  { key: 'doors', label: 'Số cánh', min: 1, max: 8 },
  { key: 'panel', label: 'Dày ván', min: 10, max: 50 }
]
export const WARDROBE_DEFAULTS: Record<string, number> = { width: 1800, depth: 600, height: 2200, doors: 3, panel: 18 }

export function clampBed(r: Record<string, number>): Record<string, number> {
  const out = clampBy(BED_SPECS, { ...BED_DEFAULTS, ...r })
  out['headboard'] = Math.min(out['headboard']!, Math.floor(out['depth']! / 4))
  return out
}
export function clampShelf(r: Record<string, number>): Record<string, number> {
  const out = clampBy(SHELF_SPECS, { ...SHELF_DEFAULTS, ...r })
  out['panel'] = Math.min(out['panel']!, Math.floor(Math.min(out['width']!, out['depth']!) / 4))
  return out
}
export function clampWardrobe(r: Record<string, number>): Record<string, number> {
  const out = clampBy(WARDROBE_SPECS, { ...WARDROBE_DEFAULTS, ...r })
  out['panel'] = Math.min(out['panel']!, Math.floor(Math.min(out['width']!, out['depth']!) / 4))
  return out
}

export function buildBed(input: Record<string, number>): Shape[] {
  const p = clampBed(input)
  const w = p['width']!, d = p['depth']!, hb = p['headboard']!
  const shapes: Shape[] = [rect('Khung giường', 0, 0, w, d, 'outline', '#E7F3F4')]
  shapes.push(rect('Đầu giường', 0, 0, w, hb, 'detail', '#CFE3E6'))
  // Hai gối khi giường từ 1,4 m trở lên, một gối với giường đơn.
  const pillows = w >= 1400 ? 2 : 1
  const pw = Math.round((w - 100 * (pillows + 1)) / pillows)
  for (let i = 0; i < pillows; i++) shapes.push(rect(`Gối ${i + 1}`, 100 + i * (pw + 100), hb + 60, pw, 400, 'detail'))
  shapes.push(dimLine('Rộng', { x: 0, y: -120 }, { x: w, y: -120 }))
  shapes.push(dimLine('Dài', { x: w + 120, y: 0 }, { x: w + 120, y: d }))
  return shapes
}

export function buildShelf(input: Record<string, number>): Shape[] {
  const p = clampShelf(input)
  const w = p['width']!, d = p['depth']!, t = p['panel']!
  const shapes: Shape[] = [rect('Thân kệ', 0, 0, w, d, 'outline', '#E7F3F4')]
  shapes.push(rect('Ván hậu', 0, 0, w, t, 'detail', '#CFE3E6'))
  shapes.push(rect('Hông trái', 0, 0, t, d, 'detail', '#CFE3E6'))
  shapes.push(rect('Hông phải', w - t, 0, t, d, 'detail', '#CFE3E6'))
  shapes.push(dimLine('Rộng', { x: 0, y: -120 }, { x: w, y: -120 }))
  shapes.push(dimLine('Sâu', { x: w + 120, y: 0 }, { x: w + 120, y: d }))
  return shapes
}

export function buildWardrobe(input: Record<string, number>): Shape[] {
  const p = clampWardrobe(input)
  const w = p['width']!, d = p['depth']!, t = p['panel']!, doors = p['doors']!
  const shapes: Shape[] = [rect('Thân tủ', 0, 0, w, d, 'outline', '#E7F3F4')]
  shapes.push(rect('Ván hậu', 0, 0, w, t, 'detail', '#CFE3E6'))
  // Cánh tủ ở mặt trước (y = d), chia đều theo chiều rộng.
  for (let i = 0; i < doors; i++) {
    const x0 = Math.round((w * i) / doors), x1 = Math.round((w * (i + 1)) / doors)
    shapes.push(rect(`Cánh ${i + 1}`, x0, d - t, x1 - x0, t, 'detail', '#CFE3E6'))
  }
  shapes.push(dimLine('Rộng', { x: 0, y: -120 }, { x: w, y: -120 }))
  shapes.push(dimLine('Sâu', { x: w + 120, y: 0 }, { x: w + 120, y: d }))
  return shapes
}

const SIMPLE: Record<'Giường' | 'Kệ sách' | 'Tủ quần áo', { name: string; kind: string; defaults: Record<string, number>; clamp: (r: Record<string, number>) => Record<string, number>; build: (r: Record<string, number>) => Shape[]; specs: ParamSpec[] }> = {
  Giường: { name: 'Giường', kind: 'bed', defaults: BED_DEFAULTS, clamp: clampBed, build: buildBed, specs: BED_SPECS },
  'Kệ sách': { name: 'Kệ sách', kind: 'shelf', defaults: SHELF_DEFAULTS, clamp: clampShelf, build: buildShelf, specs: SHELF_SPECS },
  'Tủ quần áo': { name: 'Tủ áo', kind: 'wardrobe', defaults: WARDROBE_DEFAULTS, clamp: clampWardrobe, build: buildWardrobe, specs: WARDROBE_SPECS }
}

export function newSimpleSketch(category: 'Giường' | 'Kệ sách' | 'Tủ quần áo', overrides: Record<string, number> = {}): SketchDoc {
  const d = SIMPLE[category]
  const params = d.clamp({ ...d.defaults, ...overrides })
  return { version: 1, name: d.name, category, kind: d.kind, params, heightMm: params['height']!, manualEdits: false, shapes: d.build(params) }
}

export function newSketchFor(category: FurnitureCategory, kind?: string): SketchDoc {
  if (category === 'Giường' || category === 'Kệ sách' || category === 'Tủ quần áo') return newSimpleSketch(category)
  if (category === 'Bàn') return newTableSketch((kind as TableKind) ?? 'rect')
  if (category === 'Ghế') return newChairSketch()
  return newSofaSketch((kind as SofaKind) ?? 'straight')
}

export function specsFor(doc: SketchDoc): ParamSpec[] {
  const list = doc.category === 'Bàn' ? TABLE_SPECS : doc.category === 'Ghế' ? CHAIR_SPECS : doc.category === 'Giường' || doc.category === 'Kệ sách' || doc.category === 'Tủ quần áo' ? SIMPLE[doc.category].specs : []
  return list.filter((s) => !s.kinds || s.kinds.includes(doc.kind))
}
