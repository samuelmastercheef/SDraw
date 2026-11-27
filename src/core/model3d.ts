/**
 * Lõi dựng hình 3D của S Draw: điểm, mặt đa giác, nhóm. Đơn vị milimét, trục Z hướng lên,
 * X sang phải, Y ra xa (hệ tay phải). Mọi thao tác trả về mô hình mới (không sửa mô hình cũ)
 * để dùng chung cơ chế Hoàn tác/Làm lại.
 *
 * Mặt là một vòng đỉnh, đi ngược chiều kim đồng hồ khi nhìn từ phía mặt ngoài (pháp tuyến).
 * Cạnh không lưu riêng: hai mặt chung cạnh khi dùng chung hai đỉnh liên tiếp.
 * Mặt có thể có lỗ (vẽ hình nằm trong mặt): vòng lỗ đi ngược chiều vòng ngoài.
 */

export type Vec3 = [number, number, number]

export interface Face3 {
  id: string
  loop: string[]
  /** Các lỗ trong mặt, mỗi lỗ là một vòng đỉnh đi ngược chiều vòng ngoài */
  holes?: string[][]
  /** Màu dạng #rrggbb; trống là màu mặc định */
  color?: string
  /** Vật liệu (id trong `Model3.materials`); có vật liệu thì vẽ theo vật liệu thay cho màu */
  material?: string
  /** Nhóm chứa mặt; trống là hình rời */
  group?: string
}

export interface Group3 {
  id: string
  name: string
  /** Nhóm là một bản của cấu kiện này (xem components.ts) */
  component?: string
  /** Hệ toạ độ riêng của bản cấu kiện: điểm thế giới = o + x·lx + y·ly + z·lz */
  frame?: Frame3
}

/** Hệ toạ độ affine của một bản cấu kiện (có thể xoay, co giãn, lật). */
export interface Frame3 {
  o: Vec3
  x: Vec3
  y: Vec3
  z: Vec3
}

/** Định nghĩa cấu kiện: hình học trong hệ toạ độ riêng, các bản dùng chung. */
export interface ComponentDef {
  id: string
  name: string
  vertices: Vec3[]
  faces: { loop: number[]; holes?: number[][]; color?: string; material?: string }[]
}

/** Kiểu vân vẽ sẵn (sinh bằng mã, không cần ảnh) */
export type MaterialPattern = 'plain' | 'wood' | 'marble' | 'tile' | 'concrete' | 'fabric' | 'brick' | 'metal'

export interface Material3 {
  id: string
  name: string
  /** Màu nền #rrggbb */
  color: string
  /** Vân vẽ sẵn; bỏ qua khi có ảnh vân */
  pattern?: MaterialPattern
  /** Ảnh vân dạng data URL (png, jpeg, webp) */
  texture?: string
  /** Kích thước một ô vân trên mặt, mm */
  size: number
  /** Độ nhám 0..1 (mặc định 0.8) */
  roughness?: number
  /** Độ kim loại 0..1 (mặc định 0) */
  metalness?: number
}

/** Đường ghi kích thước: đo từ a tới b, đường kích thước đi qua p (song song ab). */
export interface Dim3 {
  id: string
  a: Vec3
  b: Vec3
  p: Vec3
}

export interface Model3 {
  version: 1
  vertices: Record<string, Vec3>
  faces: Record<string, Face3>
  groups: Record<string, Group3>
  /** Vật liệu dùng trong mô hình (lưu kèm tệp) */
  materials?: Record<string, Material3>
  /** Đường ghi kích thước */
  dims?: Record<string, Dim3>
  /** Định nghĩa cấu kiện dùng lại */
  components?: Record<string, ComponentDef>
  /** Bộ đếm cấp id */
  seq: number
}

export const EPS = 1e-6
/** Hai điểm gần hơn khoảng này (mm) được coi là một khi hàn đỉnh */
export const WELD_MM = 0.5

// ---------- Vector ----------

export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
export const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k]
export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
export const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
export const length = (a: Vec3): number => Math.hypot(a[0], a[1], a[2])
export const distance = (a: Vec3, b: Vec3): number => length(sub(a, b))
export function normalize(a: Vec3): Vec3 {
  const l = length(a)
  return l < EPS ? [0, 0, 0] : scale(a, 1 / l)
}

// ---------- Mô hình ----------

export function emptyModel(): Model3 {
  return { version: 1, vertices: {}, faces: {}, groups: {}, seq: 1 }
}

/** Bản nháp: chép nông các bảng để sửa mà không đụng mô hình cũ. */
function draft(m: Model3): Model3 {
  return { version: 1, vertices: { ...m.vertices }, faces: { ...m.faces }, groups: { ...m.groups }, ...(m.materials ? { materials: { ...m.materials } } : {}), ...(m.dims ? { dims: { ...m.dims } } : {}), ...(m.components ? { components: { ...m.components } } : {}), seq: m.seq }
}

/** Màu và vật liệu của mặt, để chép sang các mặt sinh ra từ nó. */
export function paintOf(f: { color?: string; material?: string } | undefined): { color?: string; material?: string } {
  return { ...(f?.color ? { color: f.color } : {}), ...(f?.material ? { material: f.material } : {}) }
}

function nextId(d: Model3, prefix: 'v' | 'f' | 'g' | 'c'): string {
  return `${prefix}${d.seq++}`
}

export function faceList(m: Model3): Face3[] {
  return Object.values(m.faces)
}

export function facePoints(m: Model3, f: Face3): Vec3[] {
  return f.loop.map((id) => {
    const p = m.vertices[id]
    if (!p) throw new Error(`Mặt ${f.id} trỏ tới đỉnh không có: ${id}`)
    return p
  })
}

/** Pháp tuyến theo phương pháp Newell (chịu được đa giác lõm), đã chuẩn hoá. */
export function polygonNormal(pts: Vec3[]): Vec3 {
  let x = 0, y = 0, z = 0
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!, b = pts[(i + 1) % pts.length]!
    x += (a[1] - b[1]) * (a[2] + b[2])
    y += (a[2] - b[2]) * (a[0] + b[0])
    z += (a[0] - b[0]) * (a[1] + b[1])
  }
  return normalize([x, y, z])
}

export function polygonArea(pts: Vec3[]): number {
  let s: Vec3 = [0, 0, 0]
  for (let i = 0; i < pts.length; i++) s = add(s, cross(pts[i]!, pts[(i + 1) % pts.length]!))
  return length(s) / 2
}

/** Vòng ngoài và các vòng lỗ của mặt. */
export const faceLoops = (f: Face3): string[][] => (f.holes?.length ? [f.loop, ...f.holes] : [f.loop])

const loopPoints = (m: Model3, loop: string[]): Vec3[] => loop.map((id) => m.vertices[id]!)

export const faceNormal = (m: Model3, f: Face3): Vec3 => polygonNormal(facePoints(m, f))
export const faceArea = (m: Model3, f: Face3): number =>
  polygonArea(facePoints(m, f)) - (f.holes ?? []).reduce((s, h) => s + polygonArea(loopPoints(m, h)), 0)
export function faceCentroid(m: Model3, f: Face3): Vec3 {
  const pts = facePoints(m, f)
  return scale(pts.reduce((s, p) => add(s, p), [0, 0, 0] as Vec3), 1 / pts.length)
}

const edgeKey = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`)

/** Bảng cạnh → các mặt dùng cạnh đó. */
export function edgeFaces(m: Model3): Map<string, string[]> {
  const map = new Map<string, string[]>()
  for (const f of faceList(m)) {
    for (const loop of faceLoops(f)) {
      for (let i = 0; i < loop.length; i++) {
        const k = edgeKey(loop[i]!, loop[(i + 1) % loop.length]!)
        const arr = map.get(k)
        if (arr) arr.push(f.id)
        else map.set(k, [f.id])
      }
    }
  }
  return map
}

/** Danh sách cạnh duy nhất [đỉnh, đỉnh]. */
export function edges(m: Model3): [string, string][] {
  return [...edgeFaces(m).keys()].map((k) => k.split('|') as [string, string])
}

export function bounds(m: Model3): { min: Vec3; max: Vec3 } | null {
  const vs = Object.values(m.vertices)
  if (!vs.length) return null
  const min: Vec3 = [Infinity, Infinity, Infinity]
  const max: Vec3 = [-Infinity, -Infinity, -Infinity]
  for (const v of vs) for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i]!, v[i]!); max[i] = Math.max(max[i]!, v[i]!) }
  return { min, max }
}

// ---------- Vẽ ----------

/** Tìm đỉnh có sẵn (cùng nhóm) trùng vị trí để hàn, hoặc tạo đỉnh mới. */
function vertexAt(d: Model3, p: Vec3, group: string | undefined): string {
  const used = new Set<string>()
  for (const f of faceList(d)) if (f.group === group) faceLoops(f).flat().forEach((v) => used.add(v))
  for (const id of used) {
    const q = d.vertices[id]
    if (q && distance(p, q) < WELD_MM) return id
  }
  const id = nextId(d, 'v')
  d.vertices[id] = [p[0], p[1], p[2]]
  return id
}

function cleanLoop(pts: Vec3[]): Vec3[] {
  const out: Vec3[] = []
  for (const p of pts) if (!out.length || distance(out[out.length - 1]!, p) >= WELD_MM) out.push(p)
  while (out.length > 1 && distance(out[0]!, out[out.length - 1]!) < WELD_MM) out.pop()
  return out
}

export interface DrawOpts {
  group?: string
  color?: string
  /** Ép hướng pháp tuyến: vòng bị đảo nếu ngược hướng này */
  normal?: Vec3
}

/** Thêm một mặt đa giác phẳng. Đỉnh trùng với đỉnh có sẵn trong cùng nhóm được hàn lại. */
export function addPolygon(m: Model3, points: Vec3[], opts: DrawOpts = {}): { model: Model3; faceId: string } {
  let pts = cleanLoop(points)
  if (pts.length < 3 || polygonArea(pts) < 1) throw new Error('Mặt cần ít nhất 3 điểm không thẳng hàng')
  const n = polygonNormal(pts)
  const off = pts.reduce((mx, p) => Math.max(mx, Math.abs(dot(sub(p, pts[0]!), n))), 0)
  if (off > 0.5) throw new Error('Các điểm của mặt không cùng một mặt phẳng')
  if (opts.normal && dot(n, opts.normal) < 0) pts = [...pts].reverse()
  const d = draft(m)
  const loop = pts.map((p) => vertexAt(d, p, opts.group))
  if (new Set(loop).size !== loop.length) throw new Error('Mặt tự cắt hoặc có điểm trùng')
  const faceId = nextId(d, 'f')
  d.faces[faceId] = { id: faceId, loop, ...(opts.color ? { color: opts.color } : {}), ...(opts.group ? { group: opts.group } : {}) }
  return { model: d, faceId }
}

/** Hai trục u, v trên mặt phẳng có pháp tuyến n, ưu tiên bám trục X/Y của thế giới. */
export function planeAxes(n: Vec3): [Vec3, Vec3] {
  const nn = normalize(n)
  const ref: Vec3 = Math.abs(nn[2]) > 0.9 ? [1, 0, 0] : [0, 0, 1]
  const u = Math.abs(nn[2]) > 0.9 ? normalize(sub(ref, scale(nn, dot(ref, nn)))) : normalize(cross(ref, nn))
  return [u, cross(nn, u)]
}

/** Bốn góc chữ nhật trên mặt phẳng qua a, pháp tuyến n, góc đối diện chiếu từ b. */
export function rectangleCorners(a: Vec3, b: Vec3, n: Vec3 = [0, 0, 1]): Vec3[] {
  const [u, v] = planeAxes(n)
  const ab = sub(b, a)
  const du = dot(ab, u), dv = dot(ab, v)
  return [a, add(a, scale(u, du)), add(add(a, scale(u, du)), scale(v, dv)), add(a, scale(v, dv))]
}

export function addRectangle(m: Model3, a: Vec3, b: Vec3, n: Vec3 = [0, 0, 1], opts: DrawOpts = {}) {
  return addPolygon(m, rectangleCorners(a, b, n), { ...opts, normal: n })
}

export function circlePoints(center: Vec3, radius: number, n: Vec3 = [0, 0, 1], segments = 24): Vec3[] {
  const [u, v] = planeAxes(n)
  const pts: Vec3[] = []
  for (let i = 0; i < segments; i++) {
    const t = (i / segments) * Math.PI * 2
    pts.push(add(center, add(scale(u, Math.cos(t) * radius), scale(v, Math.sin(t) * radius))))
  }
  return pts
}

export function addCircle(m: Model3, center: Vec3, radius: number, n: Vec3 = [0, 0, 1], opts: DrawOpts & { segments?: number } = {}) {
  if (radius < 1) throw new Error('Bán kính quá nhỏ')
  return addPolygon(m, circlePoints(center, radius, n, opts.segments ?? 24), { ...opts, normal: n })
}

// ---------- Cắt mặt ----------

type Where = { kind: 'vertex'; id: string } | { kind: 'edge'; a: string; b: string } | { kind: 'inside' } | { kind: 'outside' } | { kind: 'hole' }

function inPolygon2(p: [number, number], poly: [number, number][]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!, b = poly[j]!
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside
  }
  return inside
}

function distToSegment(p: Vec3, a: Vec3, b: Vec3): number {
  const ab = sub(b, a)
  const l2 = dot(ab, ab)
  const t = l2 < EPS ? 0 : Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2))
  return distance(p, add(a, scale(ab, t)))
}

/** Điểm p (đã nằm trên mặt phẳng của mặt) ở đâu so với mặt: đỉnh, cạnh vòng ngoài, trong, ngoài, hay chạm/trong lỗ. */
function locate(m: Model3, f: Face3, p: Vec3): Where {
  for (const v of f.loop) if (distance(m.vertices[v]!, p) < WELD_MM) return { kind: 'vertex', id: v }
  for (let i = 0; i < f.loop.length; i++) {
    const a = f.loop[i]!, b = f.loop[(i + 1) % f.loop.length]!
    if (distToSegment(p, m.vertices[a]!, m.vertices[b]!) < WELD_MM) return { kind: 'edge', a, b }
  }
  const [u, v] = planeAxes(faceNormal(m, f))
  const to2 = (q: Vec3): [number, number] => [dot(q, u), dot(q, v)]
  for (const h of f.holes ?? []) {
    const pts = loopPoints(m, h)
    if (pts.some((q, i) => distToSegment(p, q, pts[(i + 1) % pts.length]!) < WELD_MM) || inPolygon2(to2(p), pts.map(to2))) return { kind: 'hole' }
  }
  return inPolygon2(to2(p), facePoints(m, f).map(to2)) ? { kind: 'inside' } : { kind: 'outside' }
}

/** Chèn đỉnh mới vào giữa cạnh a–b của mọi mặt cùng nhóm dùng cạnh đó (giữ khối kín, không có khe). */
function insertOnEdge(d: Model3, a: string, b: string, p: Vec3, group: string | undefined): string {
  const id = nextId(d, 'v')
  d.vertices[id] = p
  const fix = (loop: string[]): string[] => {
    for (let i = 0; i < loop.length; i++) {
      const x = loop[i]!, y = loop[(i + 1) % loop.length]!
      if ((x === a && y === b) || (x === b && y === a)) return [...loop.slice(0, i + 1), id, ...loop.slice(i + 1)]
    }
    return loop
  }
  for (const f of faceList(d)) {
    if (f.group !== group) continue
    const loop = fix(f.loop)
    const holes = f.holes?.map(fix)
    if (loop !== f.loop || holes?.some((h, i) => h !== f.holes![i])) d.faces[f.id] = { ...f, loop, ...(holes ? { holes } : {}) }
  }
  return id
}

function cyclicSlice(loop: string[], i: number, j: number): string[] {
  const out: string[] = []
  for (let k = i; ; k = (k + 1) % loop.length) { out.push(loop[k]!); if (k === j) break }
  return out
}

/** Chia mặt g theo đường path (hai đầu nằm trên vòng ngoài của g, đoạn giữa nằm trong g). Trả về id hai mặt. */
function splitFace(d: Model3, gid: string, path: string[]): [string, string] {
  const g = d.faces[gid]!
  const i = g.loop.indexOf(path[0]!), j = g.loop.indexOf(path[path.length - 1]!)
  if (i < 0 || j < 0 || i === j) throw new Error('Đường cắt phải nối hai điểm khác nhau trên mép mặt')
  const mid = path.slice(1, -1)
  const loop1 = [...cyclicSlice(g.loop, i, j), ...[...mid].reverse()]
  const loop2 = [...cyclicSlice(g.loop, j, i), ...mid]
  const keep = { ...paintOf(g), ...(g.group ? { group: g.group } : {}) }
  const [u, v] = planeAxes(faceNormal(d, g))
  const to2 = (q: Vec3): [number, number] => [dot(q, u), dot(q, v)]
  const poly1 = loopPoints(d, loop1).map(to2)
  const h1: string[][] = [], h2: string[][] = []
  for (const h of g.holes ?? []) (inPolygon2(to2(d.vertices[h[0]!]!), poly1) ? h1 : h2).push(h)
  const nid = nextId(d, 'f')
  d.faces[gid] = { id: gid, loop: loop1, ...(h1.length ? { holes: h1 } : {}), ...keep }
  d.faces[nid] = { id: nid, loop: loop2, ...(h2.length ? { holes: h2 } : {}), ...keep }
  return [gid, nid]
}

function crossesBoundary(m: Model3, f: Face3, a: Vec3, b: Vec3): boolean {
  const [u, v] = planeAxes(faceNormal(m, f))
  const to2 = (q: Vec3): [number, number] => [dot(q, u), dot(q, v)]
  for (const loop of faceLoops(f)) {
    const pts = loopPoints(m, loop)
    for (let i = 0; i < pts.length; i++) if (segmentsCross2(to2(a), to2(b), to2(pts[i]!), to2(pts[(i + 1) % pts.length]!))) return true
  }
  return false
}

/**
 * Cắt mặt hostId bằng đường gấp khúc (đóng nếu closed). Hình nằm gọn trong mặt thành lỗ + mặt mới;
 * hình chạm mép thì mặt được chia theo các đoạn nằm bên trong. Trả về mặt ứng với hình vừa vẽ (nếu có).
 */
function cutFace(m: Model3, hostId: string, points: Vec3[], closed: boolean): { model: Model3; faceId: string | null } {
  const host = m.faces[hostId]!
  const n = faceNormal(m, host)
  const origin = m.vertices[host.loop[0]!]!
  if (points.some((p) => Math.abs(dot(sub(p, origin), n)) > 0.5)) throw new Error('Hình vẽ không nằm trên mặt phẳng của mặt')
  let pts = closed ? cleanLoop(points) : points.filter((p, i) => i === 0 || distance(p, points[i - 1]!) >= WELD_MM)
  if (closed && polygonNormal(pts) && dot(polygonNormal(pts), n) < 0) pts = [...pts].reverse()
  const segs = pts.map((p, i) => [p, pts[(i + 1) % pts.length]!] as [Vec3, Vec3]).slice(0, closed ? pts.length : pts.length - 1)
  const where = pts.map((p) => locate(m, host, p))
  if (where.some((w) => w.kind === 'outside')) throw new Error('Hình vẽ vượt ra ngoài mặt; hãy vẽ gọn trong mặt')
  if (where.some((w) => w.kind === 'hole')) throw new Error('Hình vẽ chạm vào lỗ có sẵn trong mặt, chưa hỗ trợ')
  for (const [a, b] of segs) {
    const mw = locate(m, host, scale(add(a, b), 0.5))
    if (mw.kind === 'outside' || mw.kind === 'hole' || crossesBoundary(m, host, a, b)) throw new Error('Hình vẽ cắt qua mép mặt; hãy vẽ gọn trong mặt')
  }
  const d = draft(m)
  const onEdge = (w: Where) => w.kind === 'vertex' || w.kind === 'edge'

  if (!where.some(onEdge)) {
    if (!closed) throw new Error('Đường cắt phải bắt đầu và kết thúc trên mép mặt')
    // Hình nằm gọn trong mặt: thành mặt mới, mặt chủ có thêm lỗ
    const [u, v] = planeAxes(n)
    const to2 = (q: Vec3): [number, number] => [dot(q, u), dot(q, v)]
    const poly = pts.map(to2)
    if ((host.holes ?? []).some((h) => inPolygon2(to2(m.vertices[h[0]!]!), poly))) throw new Error('Hình vẽ bao quanh một lỗ có sẵn, chưa hỗ trợ')
    const ids = pts.map((p) => { const id = nextId(d, 'v'); d.vertices[id] = p; return id })
    const fid = nextId(d, 'f')
    const keep = { ...paintOf(host), ...(host.group ? { group: host.group } : {}) }
    d.faces[fid] = { id: fid, loop: ids, ...keep }
    d.faces[hostId] = { ...host, holes: [...(host.holes ?? []), [...ids].reverse()] }
    return { model: d, faceId: fid }
  }

  // Gán id cho từng điểm (chèn đỉnh lên cạnh khi cần), xét lại vị trí trên bản nháp vì cạnh có thể vừa bị chia
  const ids: string[] = []
  const boundary: boolean[] = []
  for (const p of pts) {
    const w = locate(d, d.faces[hostId]!, p)
    if (w.kind === 'vertex') { ids.push(w.id); boundary.push(true) }
    else if (w.kind === 'edge') { ids.push(insertOnEdge(d, w.a, w.b, p, host.group)); boundary.push(true) }
    else { const id = nextId(d, 'v'); d.vertices[id] = p; ids.push(id); boundary.push(false) }
  }
  // Tách thành các đoạn: từ một điểm trên mép, qua các điểm bên trong, tới điểm trên mép kế tiếp
  const order = pts.map((_, i) => i)
  if (closed) { const s0 = boundary.indexOf(true); order.push(...order.splice(0, s0)); order.push(order[0]!) }
  else if (!boundary[0] || !boundary[pts.length - 1]) throw new Error('Đường cắt phải bắt đầu và kết thúc trên mép mặt')
  const paths: string[][] = []
  let cur = [order[0]!]
  for (let k = 1; k < order.length; k++) {
    const i = order[k]!
    if (boundary[i]) {
      const prev = cur[cur.length - 1]!
      const chord = cur.length > 1 || locate(m, host, scale(add(pts[prev]!, pts[i]!), 0.5)).kind === 'inside'
      if (chord) paths.push([...cur, i].map((x) => ids[x]!))
      cur = [i]
    } else cur.push(i)
  }
  const family = new Set([hostId])
  for (const path of paths) {
    const probe = path.length > 2 ? d.vertices[path[1]!]! : scale(add(d.vertices[path[0]!]!, d.vertices[path[1]!]!), 0.5)
    const target = [...family].find((id) => {
      const g = d.faces[id]!
      return g.loop.includes(path[0]!) && g.loop.includes(path[path.length - 1]!) && locate(d, g, probe).kind === 'inside'
    })
    if (!target) throw new Error('Không cắt được mặt theo hình vẽ này')
    splitFace(d, target, path).forEach((id) => family.add(id))
  }
  const mine = new Set(ids)
  const faceId = closed ? [...family].find((id) => d.faces[id]!.loop.every((v) => mine.has(v))) ?? null : null
  return { model: d, faceId }
}

/** Vẽ đa giác trên một mặt có sẵn (cắt mặt đó); không có mặt chủ thì vẽ như mặt rời. */
export function drawPolygon(m: Model3, points: Vec3[], opts: DrawOpts & { host?: string | null } = {}): { model: Model3; faceId: string } {
  const host = opts.host ? m.faces[opts.host] : undefined
  if (!host) return addPolygon(m, points, opts)
  const r = cutFace(m, host.id, points, true)
  return { model: r.model, faceId: r.faceId ?? host.id }
}

export function drawRectangle(m: Model3, a: Vec3, b: Vec3, n: Vec3 = [0, 0, 1], opts: DrawOpts & { host?: string | null } = {}) {
  return drawPolygon(m, rectangleCorners(a, b, n), { ...opts, normal: n })
}

export function drawCircle(m: Model3, center: Vec3, radius: number, n: Vec3 = [0, 0, 1], opts: DrawOpts & { host?: string | null; segments?: number } = {}) {
  if (radius < 1) throw new Error('Bán kính quá nhỏ')
  return drawPolygon(m, circlePoints(center, radius, n, opts.segments ?? 24), { ...opts, normal: n })
}

/** Chia một mặt bằng đường gấp khúc nối hai điểm trên mép (công cụ Đường thẳng). */
export function splitFaceByPath(m: Model3, faceId: string, points: Vec3[]): Model3 {
  if (!m.faces[faceId]) throw new Error('Không tìm thấy mặt')
  if (points.length < 2) throw new Error('Đường cắt cần ít nhất hai điểm')
  return cutFace(m, faceId, points, false).model
}

/** Mặt (trong số các mặt cho trước hoặc mọi mặt) chứa điểm p trên mặt phẳng của nó, kể cả trên mép. */
export function faceAt(m: Model3, p: Vec3, prefer?: string | null): string | null {
  const test = (f: Face3) => {
    const n = faceNormal(m, f)
    if (Math.abs(dot(sub(p, m.vertices[f.loop[0]!]!), n)) > 0.5) return false
    const w = locate(m, f, p)
    return w.kind !== 'outside' && w.kind !== 'hole'
  }
  if (prefer && m.faces[prefer] && test(m.faces[prefer]!)) return prefer
  return faceList(m).find(test)?.id ?? null
}

/** Mặt chứa đoạn a–b (hai đầu trong mặt hoặc trên mép, trung điểm nằm trong mặt): mặt chủ cho công cụ Đường thẳng. */
export function faceForSegment(m: Model3, a: Vec3, b: Vec3): string | null {
  const mid = scale(add(a, b), 0.5)
  for (const f of faceList(m)) {
    const n = faceNormal(m, f), o = m.vertices[f.loop[0]!]!
    if (Math.abs(dot(sub(a, o), n)) > 0.5 || Math.abs(dot(sub(b, o), n)) > 0.5) continue
    const ok = (w: Where) => w.kind !== 'outside' && w.kind !== 'hole'
    if (ok(locate(m, f, a)) && ok(locate(m, f, b)) && locate(m, f, mid).kind === 'inside') return f.id
  }
  return null
}

/** Điểm p có nằm trên mép ngoài (đỉnh hoặc cạnh) của mặt không. */
export function onFaceEdge(m: Model3, faceId: string, p: Vec3): boolean {
  const f = m.faces[faceId]
  if (!f) return false
  const k = locate(m, f, p).kind
  return k === 'vertex' || k === 'edge'
}

// ---------- Cung tròn và offset ----------

/**
 * Các điểm của cung tròn đi từ a qua c tới b (ba điểm cùng mặt phẳng). Cung gần thẳng hàng thì trả về [a, b].
 * segments là số đoạn cho cả vòng tròn (cung được chia theo tỉ lệ góc, ít nhất 2 đoạn).
 */
export function arcPoints(a: Vec3, c: Vec3, b: Vec3, segments = 24): Vec3[] {
  const n = normalize(cross(sub(c, a), sub(b, a)))
  if (length(n) < 0.5) return [a, b]
  const [u, v] = planeAxes(n)
  const to2 = (p: Vec3): [number, number] => [dot(sub(p, a), u), dot(sub(p, a), v)]
  const [bx, by] = to2(b), [cx, cy] = to2(c)
  // Tâm đường tròn qua (0,0), b, c
  const d = 2 * (bx * cy - by * cx)
  if (Math.abs(d) < EPS) return [a, b]
  const b2 = bx * bx + by * by, c2 = cx * cx + cy * cy
  const ox = (cy * b2 - by * c2) / d, oy = (bx * c2 - cx * b2) / d
  const r = Math.hypot(ox, oy)
  const ang = (x: number, y: number) => Math.atan2(y - oy, x - ox)
  const t0 = ang(0, 0)
  const norm = (t: number) => { let x = t - t0; while (x < 0) x += Math.PI * 2; while (x >= Math.PI * 2) x -= Math.PI * 2; return x }
  const tb = norm(ang(bx, by)), tc = norm(ang(cx, cy))
  // Đi ngược chiều kim đồng hồ nếu c nằm giữa a và b theo chiều đó, ngược lại đi chiều kim đồng hồ
  const sweep = tc < tb ? tb : tb - Math.PI * 2
  const steps = Math.max(2, Math.round((Math.abs(sweep) / (Math.PI * 2)) * segments))
  const center = add(a, add(scale(u, ox), scale(v, oy)))
  const pts: Vec3[] = []
  for (let i = 0; i <= steps; i++) {
    const t = t0 + (sweep * i) / steps
    pts.push(add(center, add(scale(u, Math.cos(t) * r), scale(v, Math.sin(t) * r))))
  }
  pts[0] = a
  pts[pts.length - 1] = b
  return pts
}

/** Điểm giữa cung có độ võng (sagitta) h về phía điểm side, dùng khi gõ độ võng bằng bàn phím. */
export function bulgePoint(a: Vec3, b: Vec3, n: Vec3, h: number, side?: Vec3): Vec3 {
  const mid = scale(add(a, b), 0.5)
  let perp = normalize(cross(n, sub(b, a)))
  if (side && dot(sub(side, mid), perp) < 0) perp = scale(perp, -1)
  return add(mid, scale(perp, h))
}

/**
 * Vẽ cung từ a qua c tới b. Nếu a và b nằm trên mép cùng một mặt và cung đi trong mặt: chia mặt (bo góc, khoét cung).
 * Ngược lại: khép cung bằng dây cung thành một mặt (vẽ trên mặt chủ thì cắt mặt đó).
 */
export function drawArc(m: Model3, a: Vec3, c: Vec3, b: Vec3, opts: { host?: string | null; segments?: number; normal?: Vec3 } = {}): { model: Model3; faceId: string | null } {
  const pts = arcPoints(a, c, b, opts.segments ?? 24)
  if (pts.length < 3) throw new Error('Ba điểm thẳng hàng, không tạo được cung')
  const host = opts.host && m.faces[opts.host] ? opts.host : faceForSegment(m, a, b) ?? faceForSegment(m, pts[0]!, pts[1]!)
  if (host && onFaceEdge(m, host, a) && onFaceEdge(m, host, b)) {
    return { model: splitFaceByPath(m, host, pts), faceId: null }
  }
  let normal = opts.normal
  if (!normal) { const pn = polygonNormal(pts); normal = pn[2] < -1e-6 ? scale(pn, -1) : pn }
  const r = drawPolygon(m, pts, { host, normal })
  return { model: r.model, faceId: r.faceId }
}

/** Đa giác cách đều vòng p một khoảng dist (dương là co vào trong, theo pháp tuyến n), nối góc kiểu vát nhọn. */
export function offsetPolygon(pts: Vec3[], dist: number, n: Vec3): Vec3[] {
  const k = pts.length
  const out: Vec3[] = []
  for (let i = 0; i < k; i++) {
    const prev = pts[(i + k - 1) % k]!, cur = pts[i]!, next = pts[(i + 1) % k]!
    const e1 = normalize(sub(cur, prev)), e2 = normalize(sub(next, cur))
    // Hướng vào trong của mỗi cạnh (vòng ngược chiều kim đồng hồ quanh n): n × e
    const in1 = cross(n, e1), in2 = cross(n, e2)
    const bis = normalize(add(in1, in2))
    const cosHalf = dot(bis, in1)
    if (length(bis) < 0.5 || cosHalf < 0.1) { out.push(add(cur, scale(in2, dist))); continue }
    out.push(add(cur, scale(bis, dist / cosHalf)))
  }
  return out
}

/**
 * Offset vòng ngoài của mặt. dist > 0: vẽ vòng nhỏ hơn bên trong mặt (cắt mặt thành viền + mặt giữa).
 * dist < 0: thêm viền bao ngoài, chỉ cho mặt rời (mặt không dính mặt khác).
 */
export function offsetFace(m: Model3, faceId: string, dist: number): { model: Model3; faceId: string } {
  const f = m.faces[faceId]
  if (!f) throw new Error('Không tìm thấy mặt')
  if (Math.abs(dist) < 1) throw new Error('Khoảng offset quá nhỏ')
  const n = faceNormal(m, f)
  const pts = offsetPolygon(facePoints(m, f), dist, n)
  if (polygonArea(pts) < 1 || dot(polygonNormal(pts), n) < 0) throw new Error('Khoảng offset quá lớn so với mặt')
  if (dist > 0) {
    const r = cutFace(m, faceId, pts, true)
    return { model: r.model, faceId: r.faceId ?? faceId }
  }
  const ef = edgeFaces(m)
  const shared = f.loop.some((v, i) => (ef.get(edgeKey(v, f.loop[(i + 1) % f.loop.length]!))?.length ?? 0) > 1)
  if (shared) throw new Error('Offset ra ngoài chỉ làm được với mặt rời; hãy offset vào trong')
  const d = draft(m)
  const ids = pts.map((p) => { const id = nextId(d, 'v'); d.vertices[id] = p; return id })
  const rid = nextId(d, 'f')
  d.faces[rid] = { id: rid, loop: ids, holes: [[...f.loop].reverse()], ...paintOf(f), ...(f.group ? { group: f.group } : {}) }
  return { model: d, faceId: rid }
}

/** Khoảng cách có dấu từ điểm p tới mép ngoài của mặt: dương khi p nằm trong mặt. Dùng để rê chuột khi offset. */
export function insetDistance(m: Model3, faceId: string, p: Vec3): number {
  const f = m.faces[faceId]
  if (!f) return 0
  const pts = facePoints(m, f)
  const dmin = pts.reduce((best, q, i) => Math.min(best, distToSegment(p, q, pts[(i + 1) % pts.length]!)), Infinity)
  const w = locate(m, f, p)
  return w.kind === 'outside' ? -dmin : dmin
}

// ---------- Đẩy kéo ----------

/**
 * Đẩy/kéo một mặt theo pháp tuyến một đoạn dist (mm, âm là đẩy vào).
 * - Mặt của khối mà mọi mặt kề đều vuông góc (nóc hộp, vách hộp): kéo dãn khối, không thêm mặt.
 * - Mặt rời (vừa vẽ): đùn thành khối, giữ mặt gốc làm đáy.
 * - Trường hợp khác: đùn thêm thành bên, mặt gốc nằm trong khối nên được bỏ.
 */
export function pushPull(m: Model3, faceId: string, dist: number): Model3 {
  const f = m.faces[faceId]
  if (!f) throw new Error('Không tìm thấy mặt')
  if (Math.abs(dist) < EPS) return m
  const n = faceNormal(m, f)
  const delta = scale(n, dist)
  const ef = edgeFaces(m)
  const loops = faceLoops(f)
  const neighbours: Face3[] = []
  let allEdgesShared = true
  for (const loop of loops) {
    for (let i = 0; i < loop.length; i++) {
      const others = (ef.get(edgeKey(loop[i]!, loop[(i + 1) % loop.length]!)) ?? []).filter((id) => id !== faceId)
      if (!others.length) allEdgesShared = false
      for (const id of others) neighbours.push(m.faces[id]!)
    }
  }
  const origin = m.vertices[f.loop[0]!]!
  const isPerp = (g: Face3) => Math.abs(dot(faceNormal(m, g), n)) < 1e-6
  const perpendicular = neighbours.every(isPerp)

  if (allEdgesShared && perpendicular) {
    // Kéo dãn: không cho đẩy quá mặt đối diện của khối
    let deepest = 0
    for (const g of neighbours) for (const p of facePoints(m, g)) deepest = Math.min(deepest, dot(sub(p, origin), n))
    if (dist <= deepest + 1) throw new Error('Không thể đẩy xuyên qua mặt đối diện')
    const d = draft(m)
    for (const v of new Set(loops.flat())) d.vertices[v] = add(m.vertices[v]!, delta)
    return d
  }

  const free = neighbours.length === 0
  if (!free && dist < 0 && neighbours.some(isPerp)) {
    throw new Error('Chưa hỗ trợ đẩy lõm hình nằm sát mép khối; hãy vẽ hình cách mép một chút')
  }
  const d = draft(m)
  const lift = new Map<string, string>()
  for (const v of new Set(loops.flat())) {
    const id = nextId(d, 'v')
    d.vertices[id] = add(m.vertices[v]!, delta)
    lift.set(v, id)
  }
  const keep = { ...paintOf(f), ...(f.group ? { group: f.group } : {}) }
  // Mặt rời đẩy âm thì khối nằm phía sau mặt: lật nắp và thành bên. Mặt gắn vào khối (lỗ, mặt đã cắt) thì không lật:
  // kéo ra là khối nhô, đẩy vào là hốc.
  const flip = free && dist < 0
  const rev = (l: string[]) => (flip ? [...l].reverse() : l)
  const capId = nextId(d, 'f')
  const capLoops = loops.map((l) => rev(l.map((v) => lift.get(v)!)))
  d.faces[capId] = { id: capId, loop: capLoops[0]!, ...(capLoops.length > 1 ? { holes: capLoops.slice(1) } : {}), ...keep }
  for (const loop of loops) {
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i]!, b = loop[(i + 1) % loop.length]!
      const id = nextId(d, 'f')
      d.faces[id] = { id, loop: rev([a, b, lift.get(b)!, lift.get(a)!]), ...keep }
    }
  }
  if (free) {
    // Mặt rời: mặt gốc thành đáy, quay ra ngoài khối
    const back = (l: string[]) => (dist > 0 ? [...l].reverse() : l)
    d.faces[faceId] = { ...f, loop: back(f.loop), ...(f.holes?.length ? { holes: f.holes.map(back) } : {}) }
  } else {
    delete d.faces[faceId]
  }
  return d
}

// ---------- Chọn, di chuyển, xoá, nhóm ----------

/** Các mặt nối với mặt đã cho qua đỉnh chung, cùng nhóm (giống bấm ba lần trong phần mềm dựng hình). */
export function connectedFaces(m: Model3, faceId: string): string[] {
  const start = m.faces[faceId]
  if (!start) return []
  if (start.group) return faceList(m).filter((f) => f.group === start.group).map((f) => f.id)
  const byVertex = new Map<string, string[]>()
  for (const f of faceList(m)) if (!f.group) for (const v of faceLoops(f).flat()) byVertex.set(v, [...(byVertex.get(v) ?? []), f.id])
  const seen = new Set([faceId])
  const queue = [faceId]
  while (queue.length) {
    const f = m.faces[queue.pop()!]!
    for (const v of faceLoops(f).flat()) for (const g of byVertex.get(v) ?? []) if (!seen.has(g)) { seen.add(g); queue.push(g) }
  }
  return [...seen]
}

/** Mở rộng lựa chọn: mặt thuộc nhóm thì chọn cả nhóm. */
export function expandToGroups(m: Model3, faceIds: Iterable<string>): string[] {
  const groups = new Set<string>()
  const out = new Set<string>()
  for (const id of faceIds) {
    const f = m.faces[id]
    if (!f) continue
    if (f.group) groups.add(f.group)
    else out.add(id)
  }
  for (const f of faceList(m)) if (f.group && groups.has(f.group)) out.add(f.id)
  return [...out]
}

function verticesOf(m: Model3, faceIds: Iterable<string>): Set<string> {
  const s = new Set<string>()
  for (const id of faceIds) { const f = m.faces[id]; if (f) faceLoops(f).flat().forEach((v) => s.add(v)) }
  return s
}

function dropOrphans(d: Model3): void {
  const used = verticesOf(d, Object.keys(d.faces))
  for (const id of Object.keys(d.vertices)) if (!used.has(id)) delete d.vertices[id]
  const groups = new Set(faceList(d).map((f) => f.group).filter(Boolean))
  for (const id of Object.keys(d.groups)) if (!groups.has(id)) delete d.groups[id]
}

/** Biến đổi cả hệ toạ độ của các bản cấu kiện nằm trọn trong tập mặt (di chuyển, xoay, co giãn cả bản). */
function moveFrames(d: Model3, m: Model3, faceIds: Iterable<string>, fn: (p: Vec3) => Vec3): void {
  const ids = new Set(faceIds)
  const touched = new Set<string>()
  for (const id of ids) { const g = m.faces[id]?.group; if (g && m.groups[g]?.frame) touched.add(g) }
  if (!touched.size) return
  const outside = new Set<string>()
  for (const f of faceList(m)) if (f.group && touched.has(f.group) && !ids.has(f.id)) outside.add(f.group)
  for (const gid of touched) {
    if (outside.has(gid)) continue
    const g = m.groups[gid]!, fr = g.frame!
    const o = fn(fr.o)
    d.groups[gid] = { ...g, frame: { o, x: sub(fn(add(fr.o, fr.x)), o), y: sub(fn(add(fr.o, fr.y)), o), z: sub(fn(add(fr.o, fr.z)), o) } }
  }
}

export function translateFaces(m: Model3, faceIds: Iterable<string>, delta: Vec3): Model3 {
  const ids = [...faceIds]
  const vs = verticesOf(m, ids)
  if (!vs.size || length(delta) < EPS) return m
  const d = draft(m)
  for (const v of vs) d.vertices[v] = add(m.vertices[v]!, delta)
  moveFrames(d, m, ids, (p) => add(p, delta))
  return d
}

/** Xoay các mặt quanh trục đứng qua tâm (độ, dương = ngược chiều kim đồng hồ khi nhìn từ trên xuống). */
export function rotateFacesZ(m: Model3, faceIds: Iterable<string>, center: Vec3, deg: number): Model3 {
  const ids = [...faceIds]
  const vs = verticesOf(m, ids)
  if (!vs.size) return m
  const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a)
  const d = draft(m)
  const fn = (p: Vec3): Vec3 => {
    const x = p[0] - center[0], y = p[1] - center[1]
    return [center[0] + x * c - y * s, center[1] + x * s + y * c, p[2]]
  }
  for (const v of vs) d.vertices[v] = fn(m.vertices[v]!)
  moveFrames(d, m, ids, fn)
  return d
}

/** Xoay các mặt quanh trục bất kỳ (qua center, hướng axis), góc theo độ, dương theo quy tắc bàn tay phải. */
export function rotateFaces(m: Model3, faceIds: Iterable<string>, center: Vec3, axis: Vec3, deg: number): Model3 {
  const ids = [...faceIds]
  const vs = verticesOf(m, ids)
  const k = normalize(axis)
  if (!vs.size || Math.abs(deg) < 1e-9 || length(k) < EPS) return m
  const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a)
  const d = draft(m)
  const fn = (q: Vec3): Vec3 => {
    // Công thức Rodrigues
    const p = sub(q, center)
    return add(center, add(add(scale(p, c), scale(cross(k, p), s)), scale(k, dot(k, p) * (1 - c))))
  }
  for (const v of vs) d.vertices[v] = fn(m.vertices[v]!)
  moveFrames(d, m, ids, fn)
  return d
}

/**
 * Co giãn các mặt quanh điểm gốc. factor là một số (đều mọi chiều) hoặc [x, y, z].
 * Hệ số âm là lật (soi gương): vòng đỉnh được đảo để mặt vẫn quay ra ngoài.
 */
export function scaleFaces(m: Model3, faceIds: Iterable<string>, origin: Vec3, factor: number | Vec3): Model3 {
  const f3: Vec3 = typeof factor === 'number' ? [factor, factor, factor] : factor
  if (f3.some((x) => !Number.isFinite(x) || Math.abs(x) < 1e-6)) throw new Error('Hệ số co giãn phải khác 0')
  const ids = [...faceIds].filter((id) => m.faces[id])
  const vs = verticesOf(m, ids)
  if (!vs.size) return m
  const d = draft(m)
  const fn = (p: Vec3): Vec3 => [origin[0] + (p[0] - origin[0]) * f3[0], origin[1] + (p[1] - origin[1]) * f3[1], origin[2] + (p[2] - origin[2]) * f3[2]]
  for (const v of vs) d.vertices[v] = fn(m.vertices[v]!)
  moveFrames(d, m, ids, fn)
  if (f3[0] * f3[1] * f3[2] < 0) {
    for (const id of ids) {
      const f = d.faces[id]!
      d.faces[id] = { ...f, loop: [...f.loop].reverse(), ...(f.holes ? { holes: f.holes.map((h) => [...h].reverse()) } : {}) }
    }
  }
  return d
}

/** Chép các mặt thành dãy: count bản, bản thứ i lệch delta × i. Trả về id mặt của từng bản. */
export function arrayFaces(m: Model3, faceIds: Iterable<string>, delta: Vec3, count: number): { model: Model3; copies: string[][] } {
  const n = Math.floor(count)
  if (n < 1 || n > 200) throw new Error('Số bản chép từ 1 đến 200')
  if (length(delta) < EPS) throw new Error('Khoảng cách giữa các bản phải khác 0')
  const ids = [...faceIds]
  let model = m
  const copies: string[][] = []
  for (let i = 1; i <= n; i++) {
    const c = copyFaces(model, ids, scale(delta, i))
    model = c.model
    copies.push(c.faceIds)
  }
  return { model, copies }
}

export function deleteFaces(m: Model3, faceIds: Iterable<string>): Model3 {
  const d = draft(m)
  let changed = false
  for (const id of faceIds) if (d.faces[id]) { delete d.faces[id]; changed = true }
  if (!changed) return m
  dropOrphans(d)
  return d
}

export function setFaceColor(m: Model3, faceIds: Iterable<string>, color: string | undefined): Model3 {
  const d = draft(m)
  for (const id of faceIds) {
    const f = d.faces[id]
    if (!f) continue
    // Chọn màu thì bỏ vật liệu đang gán
    const { color: _old, material: _mat, ...rest } = f
    d.faces[id] = color ? { ...rest, color } : rest
  }
  return d
}

/** Chép các mặt (kèm nhóm) sang vị trí lệch delta. Trả về id các mặt mới. */
export function copyFaces(m: Model3, faceIds: Iterable<string>, delta: Vec3): { model: Model3; faceIds: string[] } {
  const d = draft(m)
  const vmap = new Map<string, string>()
  const gmap = new Map<string, string>()
  const out: string[] = []
  for (const id of faceIds) {
    const f = m.faces[id]
    if (!f) continue
    const mapV = (v: string) => {
      let nv = vmap.get(v)
      if (!nv) { nv = nextId(d, 'v'); d.vertices[nv] = add(m.vertices[v]!, delta); vmap.set(v, nv) }
      return nv
    }
    const loop = f.loop.map(mapV)
    const holes = f.holes?.map((h) => h.map(mapV))
    let group: string | undefined
    if (f.group) {
      group = gmap.get(f.group)
      if (!group) {
        group = nextId(d, 'g')
        const src = m.groups[f.group]
        // Chép bản cấu kiện thì ra thêm một bản của cùng cấu kiện
        d.groups[group] = src?.component && src.frame
          ? { id: group, name: src.name, component: src.component, frame: { ...src.frame, o: add(src.frame.o, delta) } }
          : { id: group, name: `${src?.name ?? 'Nhóm'} (bản sao)` }
        gmap.set(f.group, group)
      }
    }
    const nid = nextId(d, 'f')
    d.faces[nid] = { id: nid, loop, ...(holes?.length ? { holes } : {}), ...paintOf(f), ...(group ? { group } : {}) }
    out.push(nid)
  }
  return { model: d, faceIds: out }
}

/**
 * Gom các mặt thành nhóm. Đỉnh dùng chung với mặt ngoài nhóm được tách ra (nhân đôi)
 * để di chuyển nhóm không kéo theo hình xung quanh.
 */
export function groupFaces(m: Model3, faceIds: Iterable<string>, name = 'Nhóm'): { model: Model3; groupId: string } {
  const ids = new Set([...faceIds].filter((id) => m.faces[id]))
  if (!ids.size) throw new Error('Chưa chọn mặt nào')
  const d = draft(m)
  const groupId = nextId(d, 'g')
  d.groups[groupId] = { id: groupId, name }
  const outside = verticesOf(m, Object.keys(m.faces).filter((id) => !ids.has(id)))
  const split = new Map<string, string>()
  for (const id of ids) {
    const f = d.faces[id]!
    const mapV = (v: string) => {
      if (!outside.has(v)) return v
      let nv = split.get(v)
      if (!nv) { nv = nextId(d, 'v'); d.vertices[nv] = [...m.vertices[v]!] as Vec3; split.set(v, nv) }
      return nv
    }
    d.faces[id] = { ...f, loop: f.loop.map(mapV), ...(f.holes?.length ? { holes: f.holes.map((h) => h.map(mapV)) } : {}), group: groupId }
  }
  dropOrphans(d)
  return { model: d, groupId }
}

export function ungroup(m: Model3, groupId: string): Model3 {
  if (!m.groups[groupId]) return m
  const d = draft(m)
  delete d.groups[groupId]
  for (const f of faceList(m)) if (f.group === groupId) { const { group: _g, ...rest } = f; d.faces[f.id] = rest }
  return d
}

export function renameGroup(m: Model3, groupId: string, name: string): Model3 {
  const g = m.groups[groupId]
  if (!g) return m
  const d = draft(m)
  d.groups[groupId] = { ...g, name: name.trim() || g.name }
  return d
}

/** Hộp chữ nhật đặt trên đáy: tâm đáy c, rộng w (X), sâu dp (Y), cao h, xoay quanh Z (độ). Gom thành nhóm. */
export function addBox(m: Model3, c: Vec3, w: number, dp: number, h: number, opts: { rotDeg?: number; name?: string; color?: string } = {}): { model: Model3; groupId: string } {
  const a: Vec3 = [c[0] - w / 2, c[1] - dp / 2, c[2]]
  const b: Vec3 = [c[0] + w / 2, c[1] + dp / 2, c[2]]
  // Vẽ trong nhóm tạm để không hàn vào hình có sẵn
  const tmp = `__box${m.seq}`
  const r = addRectangle(m, a, b, [0, 0, -1], { group: tmp, ...(opts.color ? { color: opts.color } : {}) })
  let model = pushPull(r.model, r.faceId, -h)
  const ids = faceList(model).filter((f) => f.group === tmp).map((f) => f.id)
  if (opts.rotDeg) model = rotateFacesZ(model, ids, c, opts.rotDeg)
  const d = draft(model)
  const groupId = nextId(d, 'g')
  d.groups[groupId] = { id: groupId, name: opts.name ?? 'Hộp' }
  for (const id of ids) d.faces[id] = { ...d.faces[id]!, group: groupId }
  return { model: d, groupId }
}

// ---------- Chia tam giác, chọn bằng tia, bám điểm ----------

/** Chia đa giác (có thể lõm) thành tam giác bằng cắt tai. Trả về chỉ số theo thứ tự vòng gốc. */
export function triangulatePolygon(pts: Vec3[], normal?: Vec3): [number, number, number][] {
  if (pts.length < 3) return []
  if (pts.length === 3) return [[0, 1, 2]]
  const n = normal ?? polygonNormal(pts)
  const [u, v] = planeAxes(n)
  const p2 = pts.map((p) => [dot(p, u), dot(p, v)] as [number, number])
  const idx = pts.map((_, i) => i)
  const area2 = (a: number, b: number, c: number) => {
    const A = p2[a]!, B = p2[b]!, C = p2[c]!
    return (B[0] - A[0]) * (C[1] - A[1]) - (B[1] - A[1]) * (C[0] - A[0])
  }
  const same = (p: number, q: number) => Math.abs(p2[p]![0] - p2[q]![0]) < EPS && Math.abs(p2[p]![1] - p2[q]![1]) < EPS
  const inside = (p: number, a: number, b: number, c: number) =>
    !same(p, a) && !same(p, b) && !same(p, c) && area2(a, b, p) >= -EPS && area2(b, c, p) >= -EPS && area2(c, a, p) >= -EPS
  const out: [number, number, number][] = []
  let guard = 0
  while (idx.length > 3 && guard++ < 10000) {
    let cut = false
    for (let i = 0; i < idx.length; i++) {
      const a = idx[(i + idx.length - 1) % idx.length]!, b = idx[i]!, c = idx[(i + 1) % idx.length]!
      if (area2(a, b, c) <= EPS) continue
      if (idx.some((p) => p !== a && p !== b && p !== c && inside(p, a, b, c))) continue
      out.push([a, b, c])
      idx.splice(i, 1)
      cut = true
      break
    }
    if (!cut) break // đa giác suy biến: cắt quạt phần còn lại
  }
  for (let k = 1; k + 1 < idx.length; k++) out.push([idx[0]!, idx[k]!, idx[k + 1]!])
  return out
}

function segmentsCross2(a: [number, number], b: [number, number], c: [number, number], d: [number, number]): boolean {
  const o = (p: [number, number], q: [number, number], r: [number, number]) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])
  const d1 = o(c, d, a), d2 = o(c, d, b), d3 = o(a, b, c), d4 = o(a, b, d)
  return ((d1 > EPS && d2 < -EPS) || (d1 < -EPS && d2 > EPS)) && ((d3 > EPS && d4 < -EPS) || (d3 < -EPS && d4 > EPS))
}

/**
 * Vòng đa giác duy nhất của mặt: lỗ được nối vào vòng ngoài bằng một "cầu" để chia tam giác.
 * Trả về danh sách điểm (có thể lặp lại ở hai đầu cầu).
 */
export function facePolygon(m: Model3, f: Face3): Vec3[] {
  const outer = facePoints(m, f)
  if (!f.holes?.length) return outer
  const n = polygonNormal(outer)
  const [u, v] = planeAxes(n)
  const to2 = (p: Vec3): [number, number] => [dot(p, u), dot(p, v)]
  let poly = outer
  const holes = f.holes.map((h) => loopPoints(m, h)).sort((a, b) => Math.max(...b.map((p) => dot(p, u))) - Math.max(...a.map((p) => dot(p, u))))
  for (const hole of holes) {
    const hi = hole.reduce((best, p, i) => (dot(p, u) > dot(hole[best]!, u) ? i : best), 0)
    const h = hole[hi]!
    const segs: [[number, number], [number, number]][] = []
    const addSegs = (pts: Vec3[]) => pts.forEach((p, i) => segs.push([to2(p), to2(pts[(i + 1) % pts.length]!)]))
    addSegs(poly); holes.forEach(addSegs)
    const order = poly.map((_, i) => i).sort((a, b) => distance(poly[a]!, h) - distance(poly[b]!, h))
    const k = order.find((i) => !segs.some(([a, b]) => segmentsCross2(to2(poly[i]!), to2(h), a, b))) ?? order[0]!
    const ring = [...hole.slice(hi), ...hole.slice(0, hi), h]
    poly = [...poly.slice(0, k + 1), ...ring, poly[k]!, ...poly.slice(k + 1)]
  }
  return poly
}

/** Các tam giác của mặt (toạ độ), theo hướng pháp tuyến của mặt. */
export function faceTriangles(m: Model3, f: Face3): [Vec3, Vec3, Vec3][] {
  const pts = facePolygon(m, f)
  return triangulatePolygon(pts, f.holes?.length ? polygonNormal(facePoints(m, f)) : undefined).map(([a, b, c]) => [pts[a]!, pts[b]!, pts[c]!])
}

export interface TriMesh {
  positions: number[]
  triangles: number[]
  /** Mặt sinh ra từng tam giác */
  faceOf: string[]
}

/** Lưới tam giác của toàn mô hình (đỉnh dùng chung). */
export function toTriMesh(m: Model3): TriMesh {
  const index = new Map<string, number>()
  const positions: number[] = []
  const triangles: number[] = []
  const faceOf: string[] = []
  for (const f of faceList(m)) {
    for (const tri of faceTriangles(m, f)) {
      for (const p of tri) {
        const key = p.join(',')
        let i = index.get(key)
        if (i === undefined) { i = positions.length / 3; index.set(key, i); positions.push(...p) }
        triangles.push(i)
      }
      faceOf.push(f.id)
    }
  }
  return { positions, triangles, faceOf }
}

function rayTriangle(o: Vec3, dir: Vec3, a: Vec3, b: Vec3, c: Vec3): number | null {
  const e1 = sub(b, a), e2 = sub(c, a)
  const p = cross(dir, e2)
  const det = dot(e1, p)
  if (Math.abs(det) < EPS) return null
  const inv = 1 / det
  const t0 = sub(o, a)
  const u = dot(t0, p) * inv
  if (u < -EPS || u > 1 + EPS) return null
  const q = cross(t0, e1)
  const v = dot(dir, q) * inv
  if (v < -EPS || u + v > 1 + EPS) return null
  const t = dot(e2, q) * inv
  return t > EPS ? t : null
}

/** Mặt gần nhất mà tia (gốc o, hướng dir) chạm vào. */
export function pickFace(m: Model3, o: Vec3, dir: Vec3): { faceId: string; point: Vec3; t: number } | null {
  const dn = normalize(dir)
  let best: { faceId: string; point: Vec3; t: number } | null = null
  for (const f of faceList(m)) {
    for (const [a, b, c] of faceTriangles(m, f)) {
      const t = rayTriangle(o, dn, a, b, c)
      if (t !== null && (!best || t < best.t)) best = { faceId: f.id, point: add(o, scale(dn, t)), t }
    }
  }
  return best
}

/** Giao của tia với mặt phẳng (điểm p0, pháp tuyến n). */
export function rayPlane(o: Vec3, dir: Vec3, p0: Vec3, n: Vec3): Vec3 | null {
  const den = dot(dir, n)
  if (Math.abs(den) < EPS) return null
  const t = dot(sub(p0, o), n) / den
  return t > 0 ? add(o, scale(dir, t)) : null
}

/** Tham số t trên trục (gốc a, hướng u) gần tia (gốc o, hướng dir) nhất: dùng cho đẩy kéo và di chuyển theo trục. */
export function closestOnAxis(a: Vec3, u: Vec3, o: Vec3, dir: Vec3): number {
  const uu = normalize(u), dd = normalize(dir)
  const w = sub(a, o)
  const b = dot(uu, dd)
  const den = 1 - b * b
  if (den < 1e-9) return 0
  return (b * dot(dd, w) - dot(uu, w)) / den
}

export type SnapKind = 'vertex' | 'midpoint' | 'edge' | 'none'

/** Bám điểm: đỉnh, trung điểm cạnh rồi tới điểm trên cạnh, trong bán kính tol (mm). */
export function snapPoint(m: Model3, p: Vec3, tol: number): { point: Vec3; kind: SnapKind } {
  let best: { point: Vec3; kind: SnapKind; dist: number } | null = null
  const consider = (q: Vec3, kind: SnapKind, bias: number) => {
    const dd = distance(p, q) * bias
    if (dd <= tol && (!best || dd < best.dist)) best = { point: q, kind, dist: dd }
  }
  for (const v of Object.values(m.vertices)) consider(v, 'vertex', 0.5)
  for (const [ia, ib] of edges(m)) {
    const a = m.vertices[ia]!, b = m.vertices[ib]!
    consider(scale(add(a, b), 0.5), 'midpoint', 0.7)
    const ab = sub(b, a)
    const l2 = dot(ab, ab)
    if (l2 < EPS) continue
    const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2))
    consider(add(a, scale(ab, t)), 'edge', 1)
  }
  const b = best as { point: Vec3; kind: SnapKind } | null
  return b ? { point: b.point, kind: b.kind } : { point: p, kind: 'none' }
}

/** Làm tròn điểm theo lưới (mm). */
export function snapGrid(p: Vec3, step: number): Vec3 {
  return [Math.round(p[0] / step) * step, Math.round(p[1] / step) * step, Math.round(p[2] / step) * step]
}

// ---------- Kiểm tra tệp ----------

const isVec = (v: unknown): v is Vec3 => Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number' && Number.isFinite(n))

/** Kiểm tra dữ liệu đọc từ tệp có đúng là mô hình hợp lệ không. */
export function isModel3(x: unknown): x is Model3 {
  if (!x || typeof x !== 'object') return false
  const m = x as Model3
  if (m.version !== 1 || typeof m.seq !== 'number' || !m.vertices || !m.faces || !m.groups) return false
  if (!Object.values(m.vertices).every(isVec)) return false
  for (const [id, f] of Object.entries(m.faces)) {
    if (!f || f.id !== id || !Array.isArray(f.loop) || f.loop.length < 3) return false
    if (f.holes !== undefined && (!Array.isArray(f.holes) || !f.holes.every((h) => Array.isArray(h) && h.length >= 3))) return false
    if (!faceLoops(f).flat().every((v) => typeof v === 'string' && m.vertices[v])) return false
    if (f.group !== undefined && !m.groups[f.group]) return false
    if (f.color !== undefined && !/^#[0-9a-fA-F]{6}$/.test(f.color)) return false
    if (f.material !== undefined && !m.materials?.[f.material]) return false
  }
  if (m.materials !== undefined) {
    if (typeof m.materials !== 'object' || !m.materials) return false
    for (const [id, mat] of Object.entries(m.materials)) if (!isMaterial3(mat) || mat.id !== id) return false
  }
  if (m.dims !== undefined) {
    if (typeof m.dims !== 'object' || !m.dims) return false
    for (const [id, d] of Object.entries(m.dims)) if (!d || d.id !== id || !isVec(d.a) || !isVec(d.b) || !isVec(d.p)) return false
  }
  if (m.components !== undefined) {
    if (typeof m.components !== 'object' || !m.components) return false
    for (const [id, c] of Object.entries(m.components)) {
      if (!c || c.id !== id || typeof c.name !== 'string' || !Array.isArray(c.vertices) || !c.vertices.every(isVec) || !Array.isArray(c.faces)) return false
      const n = c.vertices.length
      const okLoop = (l: unknown) => Array.isArray(l) && l.length >= 3 && l.every((i) => Number.isInteger(i) && i >= 0 && i < n)
      if (!c.faces.every((f) => f && okLoop(f.loop) && (f.holes === undefined || (Array.isArray(f.holes) && f.holes.every(okLoop))))) return false
    }
  }
  const okFrame = (fr: Frame3 | undefined) => fr === undefined || (isVec(fr.o) && isVec(fr.x) && isVec(fr.y) && isVec(fr.z))
  return Object.entries(m.groups).every(([id, g]) => g && g.id === id && typeof g.name === 'string' && okFrame(g.frame) &&
    (g.component === undefined || (typeof g.component === 'string' && !!m.components?.[g.component] && !!g.frame)))
}

const PATTERNS: MaterialPattern[] = ['plain', 'wood', 'marble', 'tile', 'concrete', 'fabric', 'brick', 'metal']

export function isMaterial3(x: unknown): x is Material3 {
  if (!x || typeof x !== 'object') return false
  const t = x as Material3
  const unit = (v: unknown) => v === undefined || (typeof v === 'number' && v >= 0 && v <= 1)
  return typeof t.id === 'string' && typeof t.name === 'string' && /^#[0-9a-fA-F]{6}$/.test(t.color) &&
    typeof t.size === 'number' && Number.isFinite(t.size) && t.size > 0 &&
    (t.pattern === undefined || PATTERNS.includes(t.pattern)) &&
    (t.texture === undefined || (typeof t.texture === 'string' && /^data:image\/(png|jpeg|webp);base64,/.test(t.texture))) &&
    unit(t.roughness) && unit(t.metalness)
}
