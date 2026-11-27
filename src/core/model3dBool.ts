/**
 * Phép toán khối (trừ, hợp, giao) cho lõi dựng hình, dùng thư viện Manifold (Apache-2.0, chạy WebAssembly).
 * Khối đầu vào phải kín. Kết quả được dựng lại thành mặt đa giác (gộp tam giác cùng mặt gốc, có lỗ),
 * giữ màu của mặt gốc.
 */
import {
  add, connectedFaces, cross, dot, faceList, faceLoops, faceNormal, faceTriangles,
  normalize, paintOf, polygonArea, polygonNormal, scale, sub, pushPull, type Face3, type Model3, type Vec3
} from './model3d'

type Wasm = Awaited<ReturnType<typeof import('manifold-3d').default>>

let loader: (() => Promise<Wasm>) | null = null
let ready: Promise<Wasm> | null = null

/** Cho phép giao diện chỉ định cách nạp WebAssembly (đường dẫn file .wasm sau khi đóng gói). */
export function setManifoldLoader(fn: () => Promise<Wasm>): void {
  loader = fn
  ready = null
}

async function manifold(): Promise<Wasm> {
  if (!ready) {
    ready = (async () => {
      const w = loader ? await loader() : await (await import('manifold-3d')).default()
      w.setup()
      return w
    })()
  }
  return ready
}

export type BoolOp = 'subtract' | 'union' | 'intersect'

interface Built { mesh: { numProp: number; vertProperties: Float32Array; triVerts: Uint32Array; faceID: Uint32Array }; faces: Face3[] }

/** Lưới tam giác (đỉnh hàn theo toạ độ) của tập mặt, faceID là chỉ số mặt trong danh sách chung `all`. */
function buildMesh(m: Model3, faceIds: string[], all: Face3[]): Built['mesh'] {
  const index = new Map<string, number>()
  const pos: number[] = []
  const tris: number[] = []
  const fid: number[] = []
  faceIds.forEach((id) => {
    const f = m.faces[id]!
    const k = all.length
    all.push(f)
    for (const tri of faceTriangles(m, f)) {
      for (const p of tri) {
        const key = p.map((c) => Math.round(c / 0.01)).join(',')
        let i = index.get(key)
        if (i === undefined) { i = pos.length / 3; index.set(key, i); pos.push(...p) }
        tris.push(i)
      }
      fid.push(k)
    }
  })
  return { numProp: 3, vertProperties: new Float32Array(pos), triVerts: new Uint32Array(tris), faceID: new Uint32Array(fid) }
}

/** Dựng lại mặt đa giác từ lưới kết quả: gom tam giác theo faceID và mặt phẳng, nối cạnh biên thành vòng. */
function rebuild(m: Model3, out: { vertProperties: Float32Array; triVerts: Uint32Array; faceID?: Uint32Array; numProp: number }, sources: Face3[], group: string | undefined): Model3 {
  const np = out.numProp
  const P = (i: number): Vec3 => [out.vertProperties[i * np]!, out.vertProperties[i * np + 1]!, out.vertProperties[i * np + 2]!]
  const nTri = out.triVerts.length / 3
  const tri = (t: number): [number, number, number] => [out.triVerts[t * 3]!, out.triVerts[t * 3 + 1]!, out.triVerts[t * 3 + 2]!]
  const triNormal = (t: number) => { const [a, b, c] = tri(t); return normalize(cross(sub(P(b), P(a)), sub(P(c), P(a)))) }

  // Gom tam giác: cùng faceID, cùng hướng, nối nhau qua cạnh chung
  const byKey = new Map<string, number[]>()
  for (let t = 0; t < nTri; t++) {
    const n = triNormal(t)
    if (Math.hypot(...n) < 0.5) continue
    const key = `${out.faceID?.[t] ?? 0}|${n.map((c) => Math.round(c * 1000)).join(',')}`
    byKey.set(key, [...(byKey.get(key) ?? []), t])
  }
  const vertices: Record<string, Vec3> = {}
  const faces: Record<string, Face3> = {}
  let seq = m.seq
  const vid = new Map<number, string>()
  const V = (i: number) => { let id = vid.get(i); if (!id) { id = `v${seq++}`; vid.set(i, id); vertices[id] = P(i) }; return id }

  for (const [key, ts] of byKey) {
    const src = sources[Number(key.split('|')[0])]
    // Thành phần liên thông
    const edgeTri = new Map<string, number[]>()
    const ek = (a: number, b: number) => (a < b ? `${a}_${b}` : `${b}_${a}`)
    for (const t of ts) { const [a, b, c] = tri(t); for (const [x, y] of [[a, b], [b, c], [c, a]] as const) edgeTri.set(ek(x, y), [...(edgeTri.get(ek(x, y)) ?? []), t]) }
    const seen = new Set<number>()
    for (const t0 of ts) {
      if (seen.has(t0)) continue
      const comp: number[] = []
      const stack = [t0]
      seen.add(t0)
      while (stack.length) {
        const t = stack.pop()!
        comp.push(t)
        const [a, b, c] = tri(t)
        for (const [x, y] of [[a, b], [b, c], [c, a]] as const) for (const u of edgeTri.get(ek(x, y)) ?? []) if (!seen.has(u)) { seen.add(u); stack.push(u) }
      }
      // Cạnh biên có hướng: cạnh chỉ thuộc một tam giác của thành phần
      const count = new Map<string, number>()
      for (const t of comp) { const [a, b, c] = tri(t); for (const [x, y] of [[a, b], [b, c], [c, a]] as const) count.set(ek(x, y), (count.get(ek(x, y)) ?? 0) + 1) }
      const next = new Map<number, number[]>()
      for (const t of comp) {
        const [a, b, c] = tri(t)
        for (const [x, y] of [[a, b], [b, c], [c, a]] as const) if (count.get(ek(x, y)) === 1) next.set(x, [...(next.get(x) ?? []), y])
      }
      const loops: number[][] = []
      while (next.size) {
        const start = next.keys().next().value as number
        const loop = [start]
        let cur = start
        for (let guard = 0; guard < 100000; guard++) {
          const outs = next.get(cur)
          if (!outs?.length) break
          const nx = outs.shift()!
          if (!outs.length) next.delete(cur)
          if (nx === start) break
          loop.push(nx)
          cur = nx
        }
        if (loop.length >= 3) loops.push(loop)
      }
      if (!loops.length) continue
      const n = triNormal(comp[0]!)
      const signed = (l: number[]) => { const pts = l.map(P); return dot(polygonNormal(pts), n) * polygonArea(pts) }
      const outer = loops.filter((l) => signed(l) > 0).sort((a, b) => signed(b) - signed(a))
      const holes = loops.filter((l) => signed(l) <= 0)
      if (!outer.length) continue
      // Mỗi thành phần liên thông có đúng một vòng ngoài; lỗ thuộc về vòng ngoài đó
      const id = `f${seq++}`
      faces[id] = {
        id,
        loop: outer[0]!.map(V),
        ...(holes.length ? { holes: holes.map((h) => h.map(V)) } : {}),
        ...paintOf(src),
        ...(group ? { group } : {})
      }
    }
  }
  return simplify({ version: 1, vertices, faces, groups: {}, seq })
}

/** Bỏ đỉnh thẳng hàng (nằm giữa cạnh) nếu mọi mặt dùng đỉnh đó đều thấy nó thẳng hàng. */
function simplify(m: Model3): Model3 {
  const uses = new Map<string, number>()
  const straight = new Map<string, boolean>()
  for (const f of faceList(m)) for (const loop of faceLoops(f)) loop.forEach((v, i) => {
    const a = m.vertices[loop[(i + loop.length - 1) % loop.length]!]!, b = m.vertices[v]!, c = m.vertices[loop[(i + 1) % loop.length]!]!
    const col = Math.hypot(...cross(normalize(sub(b, a)), normalize(sub(c, b)))) < 1e-4 && dot(sub(b, a), sub(c, b)) > 0
    uses.set(v, (uses.get(v) ?? 0) + 1)
    straight.set(v, (straight.get(v) ?? true) && col)
  })
  const drop = new Set([...straight].filter(([v, s]) => s && (uses.get(v) ?? 0) >= 1).map(([v]) => v))
  if (!drop.size) return m
  const faces: Record<string, Face3> = {}
  for (const f of faceList(m)) {
    const keep = (l: string[]) => { const r = l.filter((v) => !drop.has(v)); return r.length >= 3 ? r : l }
    faces[f.id] = { ...f, loop: keep(f.loop), ...(f.holes ? { holes: f.holes.map(keep) } : {}) }
  }
  const vertices = { ...m.vertices }
  const used = new Set(faceList({ ...m, faces }).flatMap((f) => faceLoops(f).flat()))
  for (const v of Object.keys(vertices)) if (!used.has(v)) delete vertices[v]
  return { ...m, faces, vertices }
}

/**
 * Phép toán khối giữa hai tập mặt (mỗi tập là một khối kín). Kết quả thay cho cả hai tập,
 * thuộc nhóm của khối thứ nhất. Trừ: khối thứ hai bị khoét khỏi khối thứ nhất.
 */
export async function booleanOp(m: Model3, aFaces: string[], bFaces: string[], op: BoolOp): Promise<Model3> {
  const a = aFaces.filter((id) => m.faces[id]), b = bFaces.filter((id) => m.faces[id] && !aFaces.includes(id))
  if (!a.length || !b.length) throw new Error('Cần chọn hai khối riêng biệt')
  const w = await manifold()
  const sources: Face3[] = []
  const meshA = buildMesh(m, a, sources)
  const meshB = buildMesh(m, b, sources)
  const toManifold = (mesh: Built['mesh'], label: string) => {
    const g = new w.Mesh(mesh)
    g.merge()
    try { return new w.Manifold(g) } catch { throw new Error(`${label} chưa kín (có khe hoặc mặt thừa), chưa trừ/hợp được`) }
  }
  const A = toManifold(meshA, 'Khối thứ nhất'), B = toManifold(meshB, 'Khối thứ hai')
  const R = op === 'subtract' ? A.subtract(B) : op === 'union' ? A.add(B) : A.intersect(B)
  const out = R.getMesh()
  A.delete(); B.delete(); R.delete()
  // Mặt của khối thứ hai nằm cùng mặt phẳng, cùng màu với một mặt của khối thứ nhất thì gộp chung
  const plane = (f: Face3) => { const n = faceNormal(m, f); return { n, d: dot(n, m.vertices[f.loop[0]!]!) } }
  const planes = sources.map(plane)
  const alias = sources.map((f, i) => {
    if (i < a.length) return i
    const p = planes[i]!
    const j = planes.findIndex((q, k) => k < a.length && dot(q.n, p.n) > 0.9999 && Math.abs(q.d - p.d) < 0.01 && (sources[k]!.color ?? '') === (f.color ?? '') && (sources[k]!.material ?? '') === (f.material ?? ''))
    return j >= 0 ? j : i
  })
  const faceID = out.faceID ? Uint32Array.from(out.faceID, (x) => alias[x] ?? x) : undefined
  const group = m.faces[a[0]!]!.group
  const built = rebuild(m, { numProp: out.numProp, vertProperties: out.vertProperties, triVerts: out.triVerts, ...(faceID ? { faceID } : {}) }, sources, group)
  // Ghép vào mô hình: bỏ mặt cũ, thêm mặt mới
  const faces = { ...m.faces }
  for (const id of [...a, ...b]) delete faces[id]
  Object.assign(faces, built.faces)
  const vertices = { ...m.vertices, ...built.vertices }
  const used = new Set(Object.values(faces).flatMap((f) => faceLoops(f).flat()))
  for (const v of Object.keys(vertices)) if (!used.has(v)) delete vertices[v]
  const groups = { ...m.groups }
  const usedGroups = new Set(Object.values(faces).map((f) => f.group).filter(Boolean))
  for (const g of Object.keys(groups)) if (!usedGroups.has(g)) delete groups[g]
  return { version: 1, vertices, faces, groups, ...(m.materials ? { materials: m.materials } : {}), ...(m.dims ? { dims: m.dims } : {}), seq: built.seq }
}

/**
 * Đẩy lõm một mặt vào khối bằng phép trừ: dùng khi đẩy kéo thường không làm được
 * (hình sát mép khối, hoặc khoét xuyên qua khối).
 */
export async function pushPullCut(m: Model3, faceId: string, dist: number): Promise<Model3> {
  const f = m.faces[faceId]
  if (!f) throw new Error('Không tìm thấy mặt')
  if (dist >= 0) throw new Error('Chỉ dùng khi đẩy vào trong khối')
  const n = faceNormal(m, f)
  const solid = connectedFaces(m, faceId)
  // Lăng trụ cắt: chép mặt ra mô hình tạm, nhô lên 1 mm để không trùng mặt, rồi đùn vào trong khối
  const lift = scale(n, 1)
  let tmp: Model3 = { version: 1, vertices: {}, faces: {}, groups: {}, seq: m.seq }
  const vmap = new Map<string, string>()
  const mapV = (v: string) => { let id = vmap.get(v); if (!id) { id = `v${tmp.seq++}`; tmp.vertices[id] = add(m.vertices[v]!, lift); vmap.set(v, id) }; return id }
  const cutId = `f${tmp.seq++}`
  tmp.faces[cutId] = { id: cutId, loop: f.loop.map(mapV), ...(f.holes?.length ? { holes: f.holes.map((h) => h.map(mapV)) } : {}) }
  tmp = pushPull(tmp, cutId, dist - 1)
  // Gộp lăng trụ vào mô hình (nhóm tạm) rồi trừ
  const merged: Model3 = {
    version: 1,
    vertices: { ...m.vertices, ...tmp.vertices },
    faces: { ...m.faces, ...tmp.faces },
    groups: m.groups,
    ...(m.materials ? { materials: m.materials } : {}),
    ...(m.dims ? { dims: m.dims } : {}),
    seq: tmp.seq
  }
  const r = await booleanOp(merged, solid, Object.keys(tmp.faces), 'subtract')
  return r
}

/** Độ dày khối theo hướng ngược pháp tuyến của mặt (để biết đẩy bao nhiêu thì xuyên). */
export function depthBehind(m: Model3, faceId: string): number {
  const f = m.faces[faceId]
  if (!f) return 0
  const n = faceNormal(m, f), o = m.vertices[f.loop[0]!]!
  let deepest = 0
  for (const id of connectedFaces(m, faceId)) for (const v of faceLoops(m.faces[id]!).flat()) deepest = Math.min(deepest, dot(sub(m.vertices[v]!, o), n))
  return -deepest
}

