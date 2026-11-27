/** Hình vector của trình phác thảo mẫu. Đơn vị mm, gốc ở góc trên trái của mẫu, y hướng xuống. */

export interface Pt {
  x: number
  y: number
}

export type ShapeKind = 'path' | 'ellipse' | 'dim'
export type ShapeRole = 'outline' | 'detail' | 'dimension' | 'reference' | 'free'

export interface Shape {
  id: string
  kind: ShapeKind
  name: string
  role: ShapeRole
  /**
   * path: các nút theo thứ tự. ellipse: [tâm, tâm + (rx, ry)]. dim: [điểm đầu, điểm cuối].
   */
  nodes: Pt[]
  closed: boolean
  /** Làm mượt đường đi qua các nút (đường cong Catmull-Rom). */
  smooth: boolean
  /** Chỉ số các nút giữ làm góc nhọn khi đã làm mượt (làm mượt từng nút). */
  sharp?: number[]
  stroke: string
  strokeWidth: number
  fill: string | null
  locked: boolean
  visible: boolean
}

/** Ảnh nền đã đặt tỉ lệ (chỉ lưu trong file .sdsketch, không đưa vào kho hay gửi lên hệ thống). */
export interface Underlay {
  /** data URL png/jpeg */
  src: string
  name: string
  px: number
  py: number
  x: number
  y: number
  scale: number
  opacity: number
}

export const MAX_UNDERLAY_CHARS = 22 * 1024 * 1024

export function isUnderlay(u: unknown): u is Underlay {
  const o = u as Underlay | null
  return (
    !!o && typeof o.src === 'string' && /^data:image\/(png|jpeg);base64,/.test(o.src) && o.src.length <= MAX_UNDERLAY_CHARS &&
    typeof o.name === 'string' && [o.px, o.py, o.x, o.y, o.scale, o.opacity].every((n) => typeof n === 'number' && Number.isFinite(n)) &&
    o.px > 0 && o.py > 0 && o.scale > 0 && o.opacity >= 0 && o.opacity <= 1
  )
}

/** Bỏ ảnh nền trước khi đưa phác thảo vào kho mẫu hoặc chỉ mục. */
export function withoutUnderlay(doc: SketchDoc): SketchDoc {
  if (doc.underlay === undefined) return doc
  const { underlay: _u, ...rest } = doc
  void _u
  return rest
}

export interface SketchDoc {
  version: 1
  name: string
  /** Loại mẫu: Sofa, Bàn, Ghế */
  category: string
  /** Kiểu cụ thể: straight, L, round... */
  kind: string
  /** Thông số đã dùng để dựng khung (mm, hoặc số ghế) */
  params: Record<string, number>
  heightMm: number
  /** true khi người dùng đã kéo nút tay: đổi thông số sẽ phải vẽ lại khung */
  manualEdits: boolean
  shapes: Shape[]
  underlay?: Underlay
}

let counter = 0
export function newShapeId(): string {
  counter += 1
  return `s${Date.now().toString(36)}${counter.toString(36)}`
}

export function makeShape(partial: Partial<Shape> & Pick<Shape, 'kind' | 'nodes'>): Shape {
  return {
    id: newShapeId(),
    name: partial.kind === 'ellipse' ? 'Elip' : partial.kind === 'dim' ? 'Kích thước' : 'Đường',
    role: 'free',
    closed: false,
    smooth: false,
    stroke: '#0D1B2A',
    strokeWidth: 2,
    fill: null,
    locked: false,
    visible: true,
    ...partial
  }
}

export function dist(a: Pt, b: Pt): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

export function mid(a: Pt, b: Pt): Pt {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}

export function round1(n: number): number {
  return Math.round(n * 10) / 10
}

export interface Bounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export function shapeBounds(s: Shape): Bounds | null {
  if (s.nodes.length === 0) return null
  if (s.kind === 'ellipse' && s.nodes.length >= 2) {
    const c = s.nodes[0]!
    const e = s.nodes[1]!
    const rx = Math.abs(e.x - c.x)
    const ry = Math.abs(e.y - c.y)
    return { minX: c.x - rx, minY: c.y - ry, maxX: c.x + rx, maxY: c.y + ry }
  }
  const xs = s.nodes.map((n) => n.x)
  const ys = s.nodes.map((n) => n.y)
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) }
}

/** Khung bao của các hình tính kích thước (khung ngoài), bỏ qua hình tham chiếu và đường kích thước. */
export function outlineBounds(doc: SketchDoc): Bounds | null {
  const pick = doc.shapes.filter((s) => s.role === 'outline')
  const list = pick.length > 0 ? pick : doc.shapes.filter((s) => s.role !== 'reference' && s.role !== 'dimension')
  let out: Bounds | null = null
  for (const s of list) {
    const b = shapeBounds(s)
    if (!b) continue
    out = out
      ? {
          minX: Math.min(out.minX, b.minX),
          minY: Math.min(out.minY, b.minY),
          maxX: Math.max(out.maxX, b.maxX),
          maxY: Math.max(out.maxY, b.maxY)
        }
      : b
  }
  return out
}

export function sketchSize(doc: SketchDoc): { w: number; d: number } {
  const b = outlineBounds(doc)
  if (!b) return { w: 0, d: 0 }
  return { w: Math.round(b.maxX - b.minX), d: Math.round(b.maxY - b.minY) }
}

export function polygonArea(nodes: Pt[]): number {
  let a = 0
  for (let i = 0; i < nodes.length; i++) {
    const p = nodes[i]!
    const q = nodes[(i + 1) % nodes.length]!
    a += p.x * q.y - q.x * p.y
  }
  return Math.abs(a) / 2
}

// ---- sửa nút (thuần, trả về hình mới) ----

export function moveNode(s: Shape, index: number, p: Pt): Shape {
  if (index < 0 || index >= s.nodes.length) return s
  const nodes = s.nodes.map((n, i) => (i === index ? { x: round1(p.x), y: round1(p.y) } : n))
  return { ...s, nodes }
}

/** Thêm nút vào giữa cạnh index → index+1. Chỉ cho đường (path). */
export function insertNodeAfter(s: Shape, index: number, p?: Pt): Shape {
  if (s.kind !== 'path' || index < 0 || index >= s.nodes.length) return s
  const a = s.nodes[index]!
  const next = s.nodes[(index + 1) % s.nodes.length]!
  if (index === s.nodes.length - 1 && !s.closed) return s
  const at = p ?? mid(a, next)
  const nodes = [...s.nodes.slice(0, index + 1), { x: round1(at.x), y: round1(at.y) }, ...s.nodes.slice(index + 1)]
  return { ...s, nodes, ...(s.sharp ? { sharp: s.sharp.map((i) => (i > index ? i + 1 : i)) } : {}) }
}

/** Xoá nút. Đường mở giữ tối thiểu 2 nút, đường kín tối thiểu 3. */
export function removeNode(s: Shape, index: number): Shape {
  if (s.kind !== 'path') return s
  const min = s.closed ? 3 : 2
  if (s.nodes.length <= min || index < 0 || index >= s.nodes.length) return s
  return {
    ...s,
    nodes: s.nodes.filter((_, i) => i !== index),
    ...(s.sharp ? { sharp: s.sharp.filter((i) => i !== index).map((i) => (i > index ? i - 1 : i)) } : {})
  }
}

/** Đổi một nút giữa góc nhọn và mượt (chỉ có tác dụng khi hình đang làm mượt). */
export function toggleSharp(s: Shape, index: number): Shape {
  if (s.kind !== 'path' || index < 0 || index >= s.nodes.length) return s
  const cur = new Set(s.sharp ?? [])
  if (cur.has(index)) cur.delete(index)
  else cur.add(index)
  return { ...s, sharp: [...cur].sort((a, b) => a - b) }
}

export function isSharp(s: Shape, index: number): boolean {
  return !!s.sharp?.includes(index)
}

export function translateShape(s: Shape, dx: number, dy: number): Shape {
  return { ...s, nodes: s.nodes.map((n) => ({ x: round1(n.x + dx), y: round1(n.y + dy) })) }
}

/** Lật qua trục dọc x = axisX. */
export function mirrorShapeX(s: Shape, axisX: number): Shape {
  const nodes = s.nodes.map((n) => ({ x: round1(2 * axisX - n.x), y: n.y }))
  return { ...s, nodes: s.closed ? [...nodes].reverse() : nodes }
}

// ---- snap ----

export interface SnapResult {
  p: Pt
  /** Có bám vào nút khác hay không (để vẽ đường dẫn thông minh) */
  hit: { x?: number; y?: number } | null
}

/** Bám nút của hình khác (cùng x hoặc y trong ngưỡng), sau đó bám lưới. */
export function snapPoint(p: Pt, grid: number, others: Pt[], tolerance: number): SnapResult {
  let x = p.x
  let y = p.y
  const hit: { x?: number; y?: number } = {}
  let bestX = tolerance
  let bestY = tolerance
  for (const o of others) {
    const dx = Math.abs(o.x - p.x)
    const dy = Math.abs(o.y - p.y)
    if (dx < bestX) {
      bestX = dx
      x = o.x
      hit.x = o.x
    }
    if (dy < bestY) {
      bestY = dy
      y = o.y
      hit.y = o.y
    }
  }
  if (hit.x === undefined && grid > 0) x = Math.round(x / grid) * grid
  if (hit.y === undefined && grid > 0) y = Math.round(y / grid) * grid
  return { p: { x: round1(x), y: round1(y) }, hit: hit.x === undefined && hit.y === undefined ? null : hit }
}

/** Giữ góc 0, 45, 90... độ so với điểm neo (phím Shift). */
export function constrainAngle(anchor: Pt, p: Pt): Pt {
  const dx = p.x - anchor.x
  const dy = p.y - anchor.y
  const len = Math.hypot(dx, dy)
  if (len === 0) return p
  const step = Math.PI / 4
  const ang = Math.round(Math.atan2(dy, dx) / step) * step
  return { x: round1(anchor.x + Math.cos(ang) * len), y: round1(anchor.y + Math.sin(ang) * len) }
}

// ---- thao tác trên cả bản phác thảo ----

export function updateShape(doc: SketchDoc, id: string, fn: (s: Shape) => Shape, manual = false): SketchDoc {
  let changed = false
  const shapes = doc.shapes.map((s) => {
    if (s.id !== id) return s
    const next = fn(s)
    if (next !== s) changed = true
    return next
  })
  return changed ? { ...doc, shapes, manualEdits: doc.manualEdits || manual } : doc
}

export function addShape(doc: SketchDoc, s: Shape): SketchDoc {
  return { ...doc, shapes: [...doc.shapes, s] }
}

export function removeShape(doc: SketchDoc, id: string): SketchDoc {
  const target = doc.shapes.find((s) => s.id === id)
  if (!target || target.locked) return doc
  return { ...doc, shapes: doc.shapes.filter((s) => s.id !== id) }
}

export function allNodes(doc: SketchDoc, exceptId?: string): Pt[] {
  const out: Pt[] = []
  for (const s of doc.shapes) {
    if (s.id === exceptId || !s.visible || s.kind === 'dim') continue
    out.push(...s.nodes)
  }
  return out
}

/** Đường dẫn SVG (dùng cho xuất ảnh khung nét gửi bộ tạo ảnh và để thử nghiệm). */
export function shapeToSvgPath(s: Shape): string {
  if (s.kind === 'ellipse' && s.nodes.length >= 2) {
    const c = s.nodes[0]!
    const e = s.nodes[1]!
    const rx = Math.abs(e.x - c.x)
    const ry = Math.abs(e.y - c.y)
    return `M${c.x - rx} ${c.y}a${rx} ${ry} 0 1 0 ${2 * rx} 0a${rx} ${ry} 0 1 0 ${-2 * rx} 0z`
  }
  if (s.nodes.length === 0) return ''
  const pts = s.nodes
  if (!s.smooth || pts.length < 3) {
    return `M${pts.map((p) => `${p.x} ${p.y}`).join('L')}${s.closed ? 'Z' : ''}`
  }
  // Catmull-Rom → Bézier, căng 0.5
  const n = pts.length
  const at = (i: number): Pt => pts[s.closed ? (i + n) % n : Math.max(0, Math.min(n - 1, i))]!
  let d = `M${pts[0]!.x} ${pts[0]!.y}`
  const segs = s.closed ? n : n - 1
  for (let i = 0; i < segs; i++) {
    const p0 = at(i - 1)
    const p1 = at(i)
    const p2 = at(i + 1)
    const p3 = at(i + 2)
    const j1 = (s.closed ? i % n : i) 
    const j2 = s.closed ? (i + 1) % n : i + 1
    // Nút góc nhọn: tay cầm trùng nút nên đường cong gãy đúng tại nút đó.
    const c1 = isSharp(s, j1) ? p1 : { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 }
    const c2 = isSharp(s, j2) ? p2 : { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 }
    d += `C${round1(c1.x)} ${round1(c1.y)} ${round1(c2.x)} ${round1(c2.y)} ${p2.x} ${p2.y}`
  }
  return d + (s.closed ? 'Z' : '')
}

/** Ảnh khung nét (SVG) của cả bản phác thảo: thứ duy nhất được gửi tới bộ tạo ảnh. */
export function sketchToSvg(doc: SketchDoc, pad = 100): string {
  const b = outlineBounds(doc) ?? { minX: 0, minY: 0, maxX: 1000, maxY: 1000 }
  const w = b.maxX - b.minX + pad * 2
  const h = b.maxY - b.minY + pad * 2
  const body = doc.shapes
    .filter((s) => s.visible && s.role !== 'reference' && s.role !== 'dimension')
    .map((s) => `<path d="${shapeToSvgPath(s)}" fill="none" stroke="#000" stroke-width="${s.strokeWidth * 3}"/>`)
    .join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${b.minX - pad} ${b.minY - pad} ${w} ${h}" width="${w}" height="${h}"><rect x="${b.minX - pad}" y="${b.minY - pad}" width="${w}" height="${h}" fill="#fff"/>${body}</svg>`
}
