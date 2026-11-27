/**
 * Cấu kiện dùng lại: một định nghĩa hình học (trong hệ toạ độ riêng) và nhiều bản đặt trong mô hình.
 * Mỗi bản là một nhóm bình thường (mặt thật, chọn, vẽ, xuất như mọi nhóm) có thêm `component` và `frame`.
 * Di chuyển, xoay, co giãn, chép cả bản chỉ đổi frame. Sửa hình bên trong một bản thì `propagateComponents`
 * lấy bản đó làm định nghĩa mới và dựng lại mọi bản còn lại.
 */
import {
  add, cross, dot, faceList, faceLoops, groupFaces, scale, sub,
  type ComponentDef, type Face3, type Frame3, type Group3, type Model3, type Vec3
} from './model3d'

const IDENTITY: Omit<Frame3, 'o'> = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] }

export function frameApply(fr: Frame3, p: Vec3): Vec3 {
  return add(fr.o, add(add(scale(fr.x, p[0]), scale(fr.y, p[1])), scale(fr.z, p[2])))
}

const det = (fr: Frame3) => dot(fr.x, cross(fr.y, fr.z))

/** Đổi điểm thế giới về hệ riêng của bản (nghịch đảo ma trận 3×3 bằng tích có hướng). */
export function frameInverse(fr: Frame3, p: Vec3): Vec3 {
  const D = det(fr)
  if (Math.abs(D) < 1e-12) throw new Error('Hệ toạ độ cấu kiện bị suy biến')
  const q = sub(p, fr.o)
  return [dot(q, cross(fr.y, fr.z)) / D, dot(q, cross(fr.z, fr.x)) / D, dot(q, cross(fr.x, fr.y)) / D]
}

const copyModel = (m: Model3): Model3 => ({
  ...m, vertices: { ...m.vertices }, faces: { ...m.faces }, groups: { ...m.groups },
  ...(m.materials ? { materials: { ...m.materials } } : {}), ...(m.dims ? { dims: { ...m.dims } } : {}),
  components: { ...(m.components ?? {}) }
})
const newId = (d: Model3, p: string) => `${p}${d.seq++}`

/** Khung bao của một tập mặt (chỉ các đỉnh chúng dùng). */
export function faceBounds(m: Model3, faceIds: Iterable<string>): { min: Vec3; max: Vec3 } | null {
  const min: Vec3 = [Infinity, Infinity, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity]
  let any = false
  for (const id of faceIds) {
    const f = m.faces[id]
    if (!f) continue
    for (const v of faceLoops(f).flat()) { const p = m.vertices[v]!; any = true; for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i]!, p[i]!); max[i] = Math.max(max[i]!, p[i]!) } }
  }
  return any ? { min, max } : null
}

export function groupFaceIds(m: Model3, groupId: string): string[] {
  return faceList(m).filter((f) => f.group === groupId).map((f) => f.id)
}

export function instancesOf(m: Model3, componentId: string): Group3[] {
  return Object.values(m.groups).filter((g) => g.component === componentId)
}

/** Hình học của một bản trong hệ riêng của nó, dạng định nghĩa cấu kiện. */
export function localGeometry(m: Model3, groupId: string): Omit<ComponentDef, 'id' | 'name'> {
  const g = m.groups[groupId]
  if (!g?.frame) throw new Error('Nhóm này không phải bản cấu kiện')
  const index = new Map<string, number>()
  const vertices: Vec3[] = []
  const idx = (v: string) => {
    let i = index.get(v)
    if (i === undefined) { i = vertices.length; index.set(v, i); vertices.push(frameInverse(g.frame!, m.vertices[v]!)) }
    return i
  }
  // Bản bị lật (định thức âm) thì đảo vòng để định nghĩa luôn quay mặt ra ngoài
  const flip = det(g.frame) < 0
  const order = (l: string[]) => (flip ? [...l].reverse() : l).map(idx)
  const faces = faceList(m).filter((f) => f.group === groupId).map((f) => ({
    loop: order(f.loop), ...(f.holes?.length ? { holes: f.holes.map(order) } : {}),
    ...(f.color ? { color: f.color } : {}), ...(f.material ? { material: f.material } : {})
  }))
  return { vertices, faces }
}

/** Dấu vân tay hình học (làm tròn 0,01 mm) để biết một bản có khác định nghĩa không. */
function signature(def: Omit<ComponentDef, 'id' | 'name'>): string {
  const r = (n: number) => (Math.round(n * 100) / 100).toFixed(2)
  const key = (i: number) => def.vertices[i]!.map(r).join(',')
  const loopKey = (l: number[]) => {
    const ks = l.map(key)
    // Vòng bắt đầu ở đỉnh nhỏ nhất để không phụ thuộc điểm đầu
    let best = 0
    for (let i = 1; i < ks.length; i++) if (ks[i]! < ks[best]!) best = i
    return [...ks.slice(best), ...ks.slice(0, best)].join(';')
  }
  return def.faces.map((f) => [loopKey(f.loop), ...(f.holes ?? []).map(loopKey).sort(), f.color ?? '', f.material ?? ''].join('|')).sort().join('\n')
}

/** Dựng các mặt của bản từ định nghĩa, vào nhóm groupId (nhóm phải có sẵn trong d với frame). */
function buildInstance(d: Model3, def: ComponentDef, groupId: string): string[] {
  const fr = d.groups[groupId]!.frame!
  const flip = det(fr) < 0
  const ids = def.vertices.map((p) => { const v = newId(d, 'v'); d.vertices[v] = frameApply(fr, p); return v })
  const order = (l: number[]) => (flip ? [...l].reverse() : l).map((i) => ids[i]!)
  const out: string[] = []
  for (const f of def.faces) {
    const id = newId(d, 'f')
    const face: Face3 = {
      id, loop: order(f.loop), ...(f.holes?.length ? { holes: f.holes.map(order) } : {}),
      ...(f.color ? { color: f.color } : {}), ...(f.material && d.materials?.[f.material] ? { material: f.material } : {}), group: groupId
    }
    d.faces[id] = face
    out.push(id)
  }
  return out
}

function removeFacesOf(d: Model3, groupId: string): void {
  const used = new Set<string>()
  for (const f of faceList(d)) {
    if (f.group === groupId) delete d.faces[f.id]
    else for (const v of faceLoops(f).flat()) used.add(v)
  }
  for (const v of Object.keys(d.vertices)) if (!used.has(v)) delete d.vertices[v]
}

/**
 * Biến các mặt đã chọn thành cấu kiện. Nếu chúng đúng là một nhóm thì dùng nhóm đó, không thì gom nhóm mới.
 * Gốc toạ độ riêng là góc nhỏ nhất của khung bao.
 */
export function makeComponent(m: Model3, faceIds: Iterable<string>, name = 'Cấu kiện'): { model: Model3; componentId: string; groupId: string } {
  const ids = [...new Set(faceIds)].filter((id) => m.faces[id])
  if (!ids.length) throw new Error('Chưa chọn mặt nào')
  const g0 = m.faces[ids[0]!]!.group
  const whole = g0 && ids.every((id) => m.faces[id]!.group === g0) && groupFaceIds(m, g0).length === ids.length
  if (whole && m.groups[g0!]!.component) throw new Error('Nhóm này đã là cấu kiện')
  let base = m, groupId = g0 ?? ''
  if (!whole) { const r = groupFaces(m, ids, name); base = r.model; groupId = r.groupId }
  const bb = faceBounds(base, groupFaceIds(base, groupId))!
  const d = copyModel(base)
  const componentId = newId(d, 'c')
  const gname = whole ? (name !== 'Cấu kiện' ? name : base.groups[groupId]!.name) : name
  d.groups[groupId] = { ...base.groups[groupId]!, name: gname, component: componentId, frame: { o: bb.min, ...IDENTITY } }
  d.components![componentId] = { id: componentId, name: gname, ...localGeometry(d, groupId) }
  return { model: d, componentId, groupId }
}

/** Đặt thêm một bản cấu kiện: góc gốc tại `at`, xoay quanh trục đứng `rotDeg` độ. */
export function placeComponent(m: Model3, componentId: string, at: Vec3, rotDeg = 0): { model: Model3; groupId: string; faceIds: string[] } {
  const def = m.components?.[componentId]
  if (!def) throw new Error(`Không có cấu kiện ${componentId}`)
  const a = (rotDeg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a)
  const d = copyModel(m)
  const groupId = newId(d, 'g')
  d.groups[groupId] = { id: groupId, name: def.name, component: componentId, frame: { o: at, x: [c, s, 0], y: [-s, c, 0], z: [0, 0, 1] } }
  const faceIds = buildInstance(d, def, groupId)
  return { model: d, groupId, faceIds }
}

/** Lấy hình của một bản làm định nghĩa mới và dựng lại mọi bản khác. */
export function syncFromInstance(m: Model3, groupId: string): Model3 {
  const g = m.groups[groupId]
  if (!g?.component || !m.components?.[g.component]) throw new Error('Nhóm này không phải bản cấu kiện')
  const d = copyModel(m)
  const def: ComponentDef = { ...m.components[g.component]!, ...localGeometry(m, groupId) }
  d.components![def.id] = def
  for (const other of instancesOf(m, def.id)) {
    if (other.id === groupId) continue
    removeFacesOf(d, other.id)
    buildInstance(d, def, other.id)
  }
  return d
}

/** Tách một bản khỏi cấu kiện (thành nhóm thường, sửa riêng). Định nghĩa không còn bản nào thì bỏ. */
export function makeUnique(m: Model3, groupId: string): Model3 {
  const g = m.groups[groupId]
  if (!g?.component) return m
  const d = copyModel(m)
  const { component: _c, frame: _f, ...rest } = g
  d.groups[groupId] = rest
  return pruneComponents(d)
}

export function renameComponent(m: Model3, componentId: string, name: string): Model3 {
  const def = m.components?.[componentId]
  const n = name.trim()
  if (!def || !n) return m
  const d = copyModel(m)
  d.components![componentId] = { ...def, name: n }
  for (const g of instancesOf(m, componentId)) d.groups[g.id] = { ...g, name: n }
  return d
}

/** Bỏ định nghĩa không còn bản nào và tham chiếu tới nhóm đã mất. */
export function pruneComponents(m: Model3): Model3 {
  if (!m.components) return m
  const used = new Set(Object.values(m.groups).map((g) => g.component).filter(Boolean))
  const dead = Object.keys(m.components).filter((id) => !used.has(id))
  if (!dead.length) return m
  const d = copyModel(m)
  for (const id of dead) delete d.components![id]
  if (!Object.keys(d.components!).length) delete d.components
  return d
}

/**
 * Sau mỗi thao tác: bản nào có hình khác định nghĩa thì lấy làm định nghĩa mới và dựng lại các bản khác.
 * Nhiều bản cùng khác (hiếm) thì lấy bản đầu tiên. Trả về đúng mô hình cũ nếu không có gì đổi.
 */
export function propagateComponents(m: Model3): Model3 {
  let out = pruneComponents(m)
  if (!out.components) return out
  for (const def of Object.values(out.components)) {
    const ref = signature(def)
    const changed = instancesOf(out, def.id).find((g) => {
      try { return signature(localGeometry(out, g.id)) !== ref } catch { return false }
    })
    if (changed) out = syncFromInstance(out, changed.id)
  }
  return out
}

/** Danh sách cấu kiện và số bản, cho bảng bên và lệnh AI. */
export function componentList(m: Model3): { id: string; name: string; instances: number; faces: number }[] {
  return Object.values(m.components ?? {}).map((c) => ({ id: c.id, name: c.name, instances: instancesOf(m, c.id).length, faces: c.faces.length }))
}
