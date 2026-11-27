/**
 * Chạy dọc đường (quét mặt cắt theo đường): đùn một mặt cắt (profile) dọc theo một đường gấp khúc,
 * nối góc vát theo phân giác. Dùng cho phào chỉ, len chân tường, viền mặt bàn, tay vịn.
 * Đường khép kín (vòng mặt sàn, viền mặt bàn) thì không có nắp; đường hở thì có hai nắp.
 */
import {
  add, addPolygon, cross, distance, dot, faceNormal, facePoints, length, normalize, polygonArea, polygonNormal, scale, sub,
  type Model3, type Vec3
} from './model3d'

/** Giao của đường thẳng (q, hướng d) với mặt phẳng (p0, pháp tuyến n). */
function projectAlong(q: Vec3, d: Vec3, p0: Vec3, n: Vec3): Vec3 {
  const den = dot(d, n)
  if (Math.abs(den) < 1e-9) throw new Error('Đường gấp khúc gập ngược 180°, không quét được')
  return add(q, scale(d, dot(sub(p0, q), n) / den))
}

/** Bỏ điểm trùng và điểm thẳng hàng của đường. */
function cleanPath(path: Vec3[], closed: boolean): Vec3[] {
  const out: Vec3[] = []
  for (const p of path) if (!out.length || distance(out[out.length - 1]!, p) > 0.5) out.push(p)
  if (closed && out.length > 1 && distance(out[0]!, out[out.length - 1]!) <= 0.5) out.pop()
  const keep = (i: number) => {
    const n = out.length
    if (!closed && (i === 0 || i === n - 1)) return true
    const a = out[(i - 1 + n) % n]!, b = out[i]!, c = out[(i + 1) % n]!
    return length(cross(normalize(sub(b, a)), normalize(sub(c, b)))) > 1e-4
  }
  return out.filter((_, i) => keep(i))
}

/**
 * Các mặt cắt tại từng đỉnh của đường. Mặt cắt gốc (profile) đặt gần đầu đường, gần vuông góc với đoạn đầu;
 * mặt cắt ở mỗi đỉnh là hình chiếu theo hướng đoạn lên mặt phẳng phân giác tại đỉnh đó.
 */
export function sweepSections(profile: Vec3[], path: Vec3[], closed: boolean): Vec3[][] {
  const P = cleanPath(path, closed)
  if (P.length < 2 || (closed && P.length < 3)) throw new Error('Đường cần ít nhất 2 điểm (3 điểm nếu khép kín)')
  const n = P.length
  const segs = closed ? n : n - 1
  const dir = (k: number) => normalize(sub(P[(k + 1) % n]!, P[k]!))
  const miter = (k: number): Vec3 => {
    if (!closed && k === 0) return dir(0)
    if (!closed && k === n - 1) return dir(n - 2)
    return normalize(add(dir((k - 1 + segs) % segs), dir(k % segs)))
  }
  const pn = polygonNormal(profile)
  if (Math.abs(dot(pn, dir(0))) < 0.2) throw new Error('Mặt cắt phải gần vuông góc với đoạn đầu của đường')
  const sections: Vec3[][] = []
  let cur = profile.map((q) => projectAlong(q, dir(0), P[0]!, miter(0)))
  sections.push(cur)
  for (let k = 1; k < n; k++) {
    cur = cur.map((q) => projectAlong(q, dir(k - 1), P[k]!, miter(k)))
    sections.push(cur)
  }
  return sections
}

/**
 * Quét mặt cắt profileFaceId dọc đường path, tạo nhóm mới. Mặt cắt gốc được thay bằng khối quét.
 * Trả về id nhóm. Mặt cắt có lỗ thì chỉ dùng vòng ngoài.
 */
export function followPath(m: Model3, profileFaceId: string, path: Vec3[], opts: { closed?: boolean; name?: string; keepProfile?: boolean } = {}): { model: Model3; groupId: string } {
  const f = m.faces[profileFaceId]
  if (!f) throw new Error('Không tìm thấy mặt cắt')
  const closed = !!opts.closed
  const prof = facePoints(m, f)
  let P = cleanPath(path, closed)
  if (closed) {
    // Bắt đầu từ đỉnh gần mặt cắt nhất, đi theo chiều có đoạn đầu vuông góc với mặt cắt nhất
    const c = prof.reduce((s, p) => add(s, p), [0, 0, 0] as Vec3).map((x) => x / prof.length) as Vec3
    let i0 = 0
    P.forEach((p, i) => { if (distance(p, c) < distance(P[i0]!, c)) i0 = i })
    P = [...P.slice(i0), ...P.slice(0, i0)]
    const pn = faceNormal(m, f)
    const fwd = Math.abs(dot(pn, normalize(sub(P[1]!, P[0]!))))
    const back = Math.abs(dot(pn, normalize(sub(P[P.length - 1]!, P[0]!))))
    if (back > fwd) P = [P[0]!, ...P.slice(1).reverse()]
  }
  const S = sweepSections(prof, P, closed)
  const groupId = `g${m.seq}`
  let d: Model3 = { ...m, seq: m.seq + 1, groups: { ...m.groups, [groupId]: { id: groupId, name: opts.name ?? 'Chạy dọc đường' } } }
  if (!opts.keepProfile) {
    const faces = { ...d.faces }
    delete faces[profileFaceId]
    d = { ...d, faces }
  }
  const paint = { ...(f.color ? { color: f.color } : {}) }
  const k = prof.length
  const quads: Vec3[][] = []
  const segs = closed ? S.length : S.length - 1
  for (let s = 0; s < segs; s++) {
    const A = S[s]!, B = S[(s + 1) % S.length]!
    for (let j = 0; j < k; j++) quads.push([A[j]!, A[(j + 1) % k]!, B[(j + 1) % k]!, B[j]!])
  }
  const caps = closed ? [] : [[...S[0]!].reverse(), S[S.length - 1]!]
  const newIds: string[] = []
  for (const poly of [...quads, ...caps]) {
    if (polygonArea(poly) < 0.01) continue
    const r = addPolygon(d, poly, { group: groupId, ...paint })
    d = r.model
    newIds.push(r.faceId)
  }
  // Hướng mặt: thể tích có dấu âm thì đảo hết để mặt quay ra ngoài
  let vol = 0
  for (const id of newIds) {
    const pts = facePoints(d, d.faces[id]!)
    for (let i = 1; i + 1 < pts.length; i++) vol += dot(pts[0]!, cross(pts[i]!, pts[i + 1]!)) / 6
  }
  if (vol < 0) {
    const faces = { ...d.faces }
    for (const id of newIds) faces[id] = { ...faces[id]!, loop: [...faces[id]!.loop].reverse() }
    d = { ...d, faces }
  }
  if (f.material && d.materials?.[f.material]) {
    const faces = { ...d.faces }
    for (const id of newIds) faces[id] = { ...faces[id]!, material: f.material }
    d = { ...d, faces }
  }
  return { model: d, groupId }
}

/** Đường là vòng ngoài của một mặt (ví dụ mặt sàn để chạy len chân tường, mặt bàn để chạy viền). */
export function faceLoopPath(m: Model3, faceId: string): Vec3[] {
  const f = m.faces[faceId]
  if (!f) throw new Error('Không tìm thấy mặt làm đường')
  return facePoints(m, f)
}
