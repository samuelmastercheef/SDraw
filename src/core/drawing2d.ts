/**
 * Bản vẽ 2D từ mô hình 3D: chiếu vuông góc (mặt bằng, các mặt đứng), tách nét thấy / nét khuất,
 * đường ghi kích thước, dàn trang và xuất SVG (để in PDF) hoặc DXF (đơn vị mm).
 */
import {
  bounds, cross, distance, dot, edgeFaces, faceList, faceNormal, faceTriangles, length, scale, sub, add,
  type Dim3, type Model3, type Vec3
} from './model3d'

export type ViewName = 'top' | 'front' | 'right' | 'back' | 'left'

export const VIEW_LABEL: Record<ViewName, string> = {
  top: 'Mặt bằng',
  front: 'Mặt đứng trước',
  right: 'Mặt đứng phải',
  back: 'Mặt đứng sau',
  left: 'Mặt đứng trái'
}

/** Hướng nhìn (từ mắt vào mô hình) và hai trục giấy u (sang phải), v (lên trên). */
const VIEWS: Record<ViewName, { dir: Vec3; u: Vec3; v: Vec3 }> = {
  top: { dir: [0, 0, -1], u: [1, 0, 0], v: [0, 1, 0] },
  front: { dir: [0, 1, 0], u: [1, 0, 0], v: [0, 0, 1] },
  right: { dir: [-1, 0, 0], u: [0, 1, 0], v: [0, 0, 1] },
  back: { dir: [0, -1, 0], u: [-1, 0, 0], v: [0, 0, 1] },
  left: { dir: [1, 0, 0], u: [0, -1, 0], v: [0, 0, 1] }
}

export type P2 = [number, number]

export interface Seg2 { a: P2; b: P2; hidden: boolean }
/** Kích thước trên giấy: đo từ a tới b, đường kích thước lệch theo vector off, ghi value (mm). */
export interface Dim2 { a: P2; b: P2; off: P2; value: number }

export interface Drawing2D {
  view: ViewName
  label: string
  segments: Seg2[]
  dims: Dim2[]
  min: P2
  max: P2
}

// ---------- Kích thước trong mô hình ----------

/** Thêm đường ghi kích thước từ a tới b, đường kích thước đi qua p. */
export function addDimension(m: Model3, a: Vec3, b: Vec3, p: Vec3): { model: Model3; id: string } {
  if (distance(a, b) < 1) throw new Error('Hai điểm đo trùng nhau')
  const id = `d${m.seq}`
  return { model: { ...m, dims: { ...(m.dims ?? {}), [id]: { id, a, b, p } }, seq: m.seq + 1 }, id }
}

export function deleteDimensions(m: Model3, ids: Iterable<string>): Model3 {
  if (!m.dims) return m
  const dims = { ...m.dims }
  for (const id of ids) delete dims[id]
  if (!Object.keys(dims).length) { const { dims: _d, ...rest } = m; return rest }
  return { ...m, dims }
}

/** Vector lệch của đường kích thước: phần của (p - a) vuông góc với ab. */
export function dimOffset(d: Pick<Dim3, 'a' | 'b' | 'p'>): Vec3 {
  const ab = sub(d.b, d.a)
  const l = length(ab)
  if (l < 1e-9) return [0, 0, 0]
  const u = scale(ab, 1 / l)
  const ap = sub(d.p, d.a)
  return sub(ap, scale(u, dot(ap, u)))
}

// ---------- Chiếu ----------

interface Tri { a: Vec3; b: Vec3; c: Vec3; min: Vec3; max: Vec3 }

function rayHits(o: Vec3, d: Vec3, tris: Tri[]): boolean {
  for (const t of tris) {
    // Loại nhanh theo khung bao (tia đi theo một trục chính)
    let skip = false
    for (let i = 0; i < 3; i++) {
      if (Math.abs(d[i]!) < 0.5 && (o[i]! < t.min[i]! - 0.01 || o[i]! > t.max[i]! + 0.01)) { skip = true; break }
      if (d[i]! > 0.5 && t.max[i]! < o[i]!) { skip = true; break }
      if (d[i]! < -0.5 && t.min[i]! > o[i]!) { skip = true; break }
    }
    if (skip) continue
    const e1 = sub(t.b, t.a), e2 = sub(t.c, t.a)
    const p = cross(d, e2)
    const det = dot(e1, p)
    if (Math.abs(det) < 1e-9) continue
    const inv = 1 / det
    const s = sub(o, t.a)
    const u = dot(s, p) * inv
    if (u < 1e-6 || u > 1 - 1e-6) continue
    const q = cross(s, e1)
    const v = dot(d, q) * inv
    if (v < 1e-6 || u + v > 1 - 1e-6) continue
    if (dot(e2, q) * inv > 0.01) return true
  }
  return false
}

/** Bỏ đoạn nằm gọn trên một đoạn thấy khác (cùng đường thẳng), để nét không chồng lên nhau. */
function dropCovered(segs: Seg2[]): Seg2[] {
  const len = (s: Seg2) => Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1])
  const order = [...segs].sort((x, y) => Number(x.hidden) - Number(y.hidden) || len(y) - len(x))
  const keep: Seg2[] = []
  const on = (s: Seg2, p: P2) => {
    const dx = s.b[0] - s.a[0], dy = s.b[1] - s.a[1], l = Math.hypot(dx, dy)
    const t = ((p[0] - s.a[0]) * dx + (p[1] - s.a[1]) * dy) / (l * l)
    const dist = Math.abs((p[0] - s.a[0]) * dy - (p[1] - s.a[1]) * dx) / l
    return dist < 0.5 && t > -1e-6 && t < 1 + 1e-6
  }
  for (const s of order) if (!keep.some((k) => !k.hidden && on(k, s.a) && on(k, s.b))) keep.push(s)
  return keep
}

/** Góc (độ) dưới ngưỡng này giữa hai mặt kề thì cạnh là cạnh mềm (thân trụ), không vẽ. */
const SOFT_DEG = 20

/** Chiếu mô hình theo một hướng nhìn: nét thấy, nét khuất, kích thước tổng và kích thước người dùng ghi. */
export function projectView(m: Model3, view: ViewName, opts: { hidden?: boolean; overall?: boolean } = {}): Drawing2D {
  const { dir, u, v } = VIEWS[view]
  const pr = (p: Vec3): P2 => [dot(p, u), dot(p, v)]
  const tris: Tri[] = []
  for (const f of faceList(m)) for (const [a, b, c] of faceTriangles(m, f)) {
    tris.push({ a, b, c, min: [0, 1, 2].map((i) => Math.min(a[i]!, b[i]!, c[i]!)) as Vec3, max: [0, 1, 2].map((i) => Math.max(a[i]!, b[i]!, c[i]!)) as Vec3 })
  }
  const toEye = scale(dir, -1)
  // Hai cạnh trùng nhau trên giấy (trước và sau) chỉ vẽ một lần, nét thấy thắng nét khuất
  const byKey = new Map<string, Seg2>()
  const cos = Math.cos((SOFT_DEG * Math.PI) / 180)
  for (const [k, fs] of edgeFaces(m)) {
    const [ia, ib] = k.split('|') as [string, string]
    const A = m.vertices[ia]!, B = m.vertices[ib]!
    const a2 = pr(A), b2 = pr(B)
    if (Math.hypot(a2[0] - b2[0], a2[1] - b2[1]) < 0.5) continue
    if (fs.length === 2) {
      const n0 = faceNormal(m, m.faces[fs[0]!]!), n1 = faceNormal(m, m.faces[fs[1]!]!)
      if (dot(n0, n1) > cos) continue
    }
    const key = [a2, b2].map((p) => p.map((c) => Math.round(c)).join(',')).sort().join('|')
    const prev = byKey.get(key)
    if (prev && !prev.hidden) continue
    const samples = [0.15, 0.5, 0.85]
    let blocked = 0
    for (const t of samples) if (rayHits(add(add(A, scale(sub(B, A), t)), scale(toEye, 0.5)), toEye, tris)) blocked++
    const hidden = blocked * 2 > samples.length
    if (hidden && (!opts.hidden || prev)) continue
    byKey.set(key, { a: a2, b: b2, hidden })
  }
  const segments = dropCovered([...byKey.values()])

  const min: P2 = [Infinity, Infinity], max: P2 = [-Infinity, -Infinity]
  for (const s of segments) for (const p of [s.a, s.b]) for (let i = 0; i < 2; i++) { min[i] = Math.min(min[i]!, p[i]!); max[i] = Math.max(max[i]!, p[i]!) }
  if (!segments.length) { min[0] = min[1] = 0; max[0] = max[1] = 0 }

  const dims: Dim2[] = []
  // Kích thước người dùng ghi: chỉ lấy cái song song mặt giấy (độ dài chiếu ≈ độ dài thật)
  for (const d of Object.values(m.dims ?? {})) {
    const a2 = pr(d.a), b2 = pr(d.b)
    const real = distance(d.a, d.b)
    if (Math.abs(Math.hypot(b2[0] - a2[0], b2[1] - a2[1]) - real) > Math.max(0.5, real * 0.005)) continue
    let off = pr(dimOffset(d))
    if (Math.hypot(off[0], off[1]) < 1) {
      // Đường kích thước lệch theo hướng nhìn nên trên giấy trùng vào nét: đặt ra phía ngoài hình
      const span = Math.max(max[0] - min[0], max[1] - min[1], 1)
      const gap = Math.max(150, span * 0.05)
      const dx = b2[0] - a2[0], dy = b2[1] - a2[1], l = Math.hypot(dx, dy)
      let n: P2 = [-dy / l, dx / l]
      const mid: P2 = [(a2[0] + b2[0]) / 2, (a2[1] + b2[1]) / 2], c: P2 = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2]
      if ((mid[0] - c[0]) * n[0] + (mid[1] - c[1]) * n[1] < 0) n = [-n[0], -n[1]]
      off = [n[0] * gap, n[1] * gap]
    }
    dims.push({ a: a2, b: b2, off, value: real })
  }
  if (opts.overall !== false && segments.length) {
    const w = max[0] - min[0], h = max[1] - min[1]
    const gap = Math.max(200, Math.max(w, h) * 0.08)
    if (w >= 1) dims.push({ a: [min[0], min[1]], b: [max[0], min[1]], off: [0, -gap], value: w })
    if (h >= 1) dims.push({ a: [min[0], min[1]], b: [min[0], max[1]], off: [-gap, 0], value: h })
  }
  return { view, label: VIEW_LABEL[view], segments, dims, min, max }
}

// ---------- Dàn trang ----------

export interface Sheet {
  /** Các hình chiếu đã dời về vị trí trên tờ (mm của mô hình) */
  drawings: { d: Drawing2D; dx: number; dy: number }[]
  min: P2
  max: P2
  /** Tỉ lệ in 1:scale khi in lên khổ A3 ngang */
  scale: number
  title: string
}

const A3: P2 = [420, 297]
const SCALES = [1, 2, 5, 10, 20, 25, 50, 75, 100, 150, 200, 250, 500, 1000]

/** Khung bao của hình chiếu kể cả đường kích thước và chữ. */
function extent(d: Drawing2D): { min: P2; max: P2 } {
  const min: P2 = [...d.min], max: P2 = [...d.max]
  for (const k of d.dims) for (const p of [k.a, k.b]) for (let i = 0; i < 2; i++) {
    const q = p[i]! + k.off[i]! * 1.6
    min[i] = Math.min(min[i]!, q); max[i] = Math.max(max[i]!, q)
  }
  return { min, max }
}

/** Xếp các hình chiếu thành lưới (mặt bằng trên, mặt đứng dưới), chọn tỉ lệ chuẩn vừa khổ A3. */
export function layoutSheet(drawings: Drawing2D[], title: string): Sheet {
  if (!drawings.length) throw new Error('Chưa chọn hình chiếu nào')
  const ext = drawings.map(extent)
  const widths = ext.map((e) => e.max[0] - e.min[0]), heights = ext.map((e) => e.max[1] - e.min[1])
  const gap = Math.max(400, Math.max(...widths, ...heights) * 0.15)
  // Hàng 1: mặt bằng (nếu có); hàng 2: các mặt đứng
  const rows: number[][] = [[], []]
  drawings.forEach((d, i) => rows[d.view === 'top' ? 0 : 1]!.push(i))
  const placed: Sheet['drawings'] = []
  let y = 0
  for (const row of rows.filter((r) => r.length)) {
    let x = 0
    const rowH = Math.max(...row.map((i) => heights[i]!))
    for (const i of row) {
      const e = ext[i]!
      placed[i] = { d: drawings[i]!, dx: x - e.min[0], dy: y - rowH + (rowH - heights[i]!) - e.min[1] }
      x += widths[i]! + gap
    }
    y -= rowH + gap
  }
  const min: P2 = [Infinity, Infinity], max: P2 = [-Infinity, -Infinity]
  placed.forEach((p, i) => {
    const e = ext[i]!
    for (const q of [e.min, e.max]) { min[0] = Math.min(min[0], q[0] + p.dx); max[0] = Math.max(max[0], q[0] + p.dx); min[1] = Math.min(min[1], q[1] + p.dy); max[1] = Math.max(max[1], q[1] + p.dy) }
  })
  const W = max[0] - min[0], H = max[1] - min[1] + gap * 0.6
  // Chừa lề 20 mm và khung tên 25 mm
  const need = Math.max(W / (A3[0] - 40), H / (A3[1] - 65))
  const sc = SCALES.find((s) => s >= need) ?? Math.ceil(need / 100) * 100
  return { drawings: placed, min, max, scale: sc, title }
}

// ---------- Xuất ----------

const fmtMm = (v: number) => String(Math.round(v))

function dimGeometry(k: Dim2, ext: number) {
  const ol = Math.hypot(k.off[0], k.off[1])
  const on: P2 = ol > 1e-9 ? [k.off[0] / ol, k.off[1] / ol] : [0, 0]
  const pa: P2 = [k.a[0] + k.off[0], k.a[1] + k.off[1]], pb: P2 = [k.b[0] + k.off[0], k.b[1] + k.off[1]]
  const extA: [P2, P2] = [k.a, [pa[0] + on[0] * ext, pa[1] + on[1] * ext]]
  const extB: [P2, P2] = [k.b, [pb[0] + on[0] * ext, pb[1] + on[1] * ext]]
  const mid: P2 = [(pa[0] + pb[0]) / 2 + on[0] * ext, (pa[1] + pb[1]) / 2 + on[1] * ext]
  let ang = (Math.atan2(pb[1] - pa[1], pb[0] - pa[0]) * 180) / Math.PI
  if (ang > 90) ang -= 180
  if (ang <= -90) ang += 180
  return { pa, pb, extA, extB, mid, ang }
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** SVG khổ A3 ngang (mm), sẵn để in PDF. */
export function sheetToSvg(sh: Sheet): string {
  const k = 1 / sh.scale
  const ox = 20 - sh.min[0] * k, oyTop = 20
  const top = sh.max[1]
  // Toạ độ giấy: x sang phải, y xuống dưới
  const X = (x: number) => ox + x * k
  const Y = (y: number) => oyTop + (top - y) * k
  const txt = 2.5, ext = 2 / k
  const out: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${A3[0]}mm" height="${A3[1]}mm" viewBox="0 0 ${A3[0]} ${A3[1]}">`,
    `<rect x="0" y="0" width="${A3[0]}" height="${A3[1]}" fill="#fff"/>`,
    `<rect x="10" y="10" width="${A3[0] - 20}" height="${A3[1] - 20}" fill="none" stroke="#000" stroke-width="0.5"/>`
  ]
  for (const { d, dx, dy } of sh.drawings) {
    const vis: string[] = [], hid: string[] = []
    for (const s of d.segments) (s.hidden ? hid : vis).push(`M${X(s.a[0] + dx).toFixed(2)} ${Y(s.a[1] + dy).toFixed(2)}L${X(s.b[0] + dx).toFixed(2)} ${Y(s.b[1] + dy).toFixed(2)}`)
    if (hid.length) out.push(`<path d="${hid.join('')}" stroke="#777" stroke-width="0.18" stroke-dasharray="1.2 0.8" fill="none"/>`)
    if (vis.length) out.push(`<path d="${vis.join('')}" stroke="#000" stroke-width="0.35" fill="none" stroke-linecap="round"/>`)
    for (const dm of d.dims) {
      const g = dimGeometry({ ...dm, a: [dm.a[0] + dx, dm.a[1] + dy], b: [dm.b[0] + dx, dm.b[1] + dy] }, ext)
      const L = (p: P2, q: P2) => `M${X(p[0]).toFixed(2)} ${Y(p[1]).toFixed(2)}L${X(q[0]).toFixed(2)} ${Y(q[1]).toFixed(2)}`
      // Gạch chéo ở hai đầu theo lối bản vẽ kiến trúc
      const tick = (p: P2) => `M${(X(p[0]) - 1).toFixed(2)} ${(Y(p[1]) + 1).toFixed(2)}L${(X(p[0]) + 1).toFixed(2)} ${(Y(p[1]) - 1).toFixed(2)}`
      out.push(`<path d="${L(g.extA[0], g.extA[1])}${L(g.extB[0], g.extB[1])}${L(g.pa, g.pb)}${tick(g.pa)}${tick(g.pb)}" stroke="#1f5fff" stroke-width="0.18" fill="none"/>`)
      out.push(`<text x="${X(g.mid[0]).toFixed(2)}" y="${Y(g.mid[1]).toFixed(2)}" font-size="${txt}" fill="#1f5fff" text-anchor="middle" font-family="sans-serif" transform="rotate(${(-g.ang).toFixed(1)} ${X(g.mid[0]).toFixed(2)} ${Y(g.mid[1]).toFixed(2)})" dy="-0.6">${fmtMm(dm.value)}</text>`)
    }
    // Tên hình chiếu dưới hình
    const e = extent(d)
    out.push(`<text x="${X((e.min[0] + e.max[0]) / 2 + dx).toFixed(2)}" y="${(Y(e.min[1] + dy) + 7).toFixed(2)}" font-size="4" font-weight="bold" text-anchor="middle" font-family="sans-serif">${esc(d.label.toUpperCase())}</text>`)
  }
  // Khung tên
  const bx = A3[0] - 140, by = A3[1] - 30
  out.push(`<rect x="${bx}" y="${by}" width="130" height="20" fill="none" stroke="#000" stroke-width="0.35"/>`)
  out.push(`<line x1="${bx}" y1="${by + 10}" x2="${bx + 130}" y2="${by + 10}" stroke="#000" stroke-width="0.25"/>`)
  out.push(`<text x="${bx + 3}" y="${by + 7}" font-size="4.5" font-weight="bold" font-family="sans-serif">${esc(sh.title)}</text>`)
  out.push(`<text x="${bx + 3}" y="${by + 17}" font-size="3.2" font-family="sans-serif">Tỉ lệ 1:${sh.scale} · Đơn vị: mm · S Draw</text>`)
  out.push('</svg>')
  return out.join('\n')
}

/** DXF R12 (mm, 1:1): lớp NET (nét thấy), KHUAT (nét khuất, nét đứt), KICHTHUOC, CHU. */
export function sheetToDxf(sh: Sheet): string {
  const o: string[] = []
  const add2 = (c: number, v: string | number) => { o.push(String(c), String(v)) }
  const layers: [string, number, string][] = [['NET', 7, 'CONTINUOUS'], ['KHUAT', 8, 'DASHED'], ['KICHTHUOC', 5, 'CONTINUOUS'], ['CHU', 7, 'CONTINUOUS']]
  add2(0, 'SECTION'); add2(2, 'HEADER'); add2(9, '$ACADVER'); add2(1, 'AC1009'); add2(9, '$INSUNITS'); add2(70, 4); add2(0, 'ENDSEC')
  add2(0, 'SECTION'); add2(2, 'TABLES')
  add2(0, 'TABLE'); add2(2, 'LTYPE'); add2(70, 2)
  add2(0, 'LTYPE'); add2(2, 'CONTINUOUS'); add2(70, 0); add2(3, 'Solid line'); add2(72, 65); add2(73, 0); add2(40, 0)
  add2(0, 'LTYPE'); add2(2, 'DASHED'); add2(70, 0); add2(3, '__ __ __'); add2(72, 65); add2(73, 2); add2(40, 18); add2(49, 12); add2(49, -6)
  add2(0, 'ENDTAB')
  add2(0, 'TABLE'); add2(2, 'LAYER'); add2(70, layers.length)
  for (const [n, c, lt] of layers) { add2(0, 'LAYER'); add2(2, n); add2(70, 0); add2(62, c); add2(6, lt) }
  add2(0, 'ENDTAB'); add2(0, 'ENDSEC')
  add2(0, 'SECTION'); add2(2, 'ENTITIES')
  const line = (layer: string, p: P2, q: P2) => {
    add2(0, 'LINE'); add2(8, layer)
    add2(10, p[0].toFixed(2)); add2(20, p[1].toFixed(2)); add2(30, 0)
    add2(11, q[0].toFixed(2)); add2(21, q[1].toFixed(2)); add2(31, 0)
  }
  const text = (p: P2, h: number, value: string, rot = 0, center = true) => {
    add2(0, 'TEXT'); add2(8, 'CHU'); add2(10, p[0].toFixed(2)); add2(20, p[1].toFixed(2)); add2(30, 0); add2(40, h); add2(1, value)
    if (rot) add2(50, rot.toFixed(1))
    if (center) { add2(72, 1); add2(11, p[0].toFixed(2)); add2(21, p[1].toFixed(2)); add2(31, 0) }
  }
  const th = 2.5 * sh.scale
  for (const { d, dx, dy } of sh.drawings) {
    const T = (p: P2): P2 => [p[0] + dx, p[1] + dy]
    for (const s of d.segments) line(s.hidden ? 'KHUAT' : 'NET', T(s.a), T(s.b))
    for (const dm of d.dims) {
      const g = dimGeometry({ ...dm, a: T(dm.a), b: T(dm.b) }, 2 * sh.scale)
      line('KICHTHUOC', g.extA[0], g.extA[1]); line('KICHTHUOC', g.extB[0], g.extB[1]); line('KICHTHUOC', g.pa, g.pb)
      text(g.mid, th, fmtMm(dm.value), g.ang)
    }
    const e = extent(d)
    text([(e.min[0] + e.max[0]) / 2 + dx, e.min[1] + dy - 7 * sh.scale], 4 * sh.scale, d.label.toUpperCase())
  }
  add2(0, 'ENDSEC'); add2(0, 'EOF')
  return o.join('\n') + '\n'
}

/** Tiện: chiếu các hướng đã chọn rồi dàn trang. */
export function buildSheet(m: Model3, views: ViewName[], title: string, opts: { hidden?: boolean } = {}): Sheet {
  if (!bounds(m)) throw new Error('Mô hình chưa có gì để vẽ')
  return layoutSheet(views.map((v) => projectView(m, v, opts)), title)
}

