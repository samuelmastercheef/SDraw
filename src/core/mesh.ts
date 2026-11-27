/** Đọc lưới tam giác từ .obj và .glb (glTF nhị phân) để xem trước và lấy kích thước. Không đọc vật liệu hay texture. */
export interface Mesh {
  /** x, y, z liên tiếp, đơn vị gốc của file. */
  positions: number[]
  /** ba chỉ số đỉnh mỗi tam giác. */
  triangles: number[]
}

export const MAX_TRIANGLES = 200_000

export function parseObj(text: string): Mesh {
  const positions: number[] = []
  const triangles: number[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (line.startsWith('v ')) {
      const [, x, y, z] = line.split(/\s+/)
      const v = [Number(x), Number(y), Number(z)]
      if (v.some((n) => !Number.isFinite(n))) throw new Error('Toạ độ đỉnh không hợp lệ trong .obj')
      positions.push(...v)
    } else if (line.startsWith('f ')) {
      const n = positions.length / 3
      const idx = line.split(/\s+/).slice(1).map((t) => {
        const i = parseInt(t.split('/')[0] ?? '', 10)
        if (!Number.isInteger(i) || i === 0) throw new Error('Chỉ số mặt không hợp lệ trong .obj')
        return i > 0 ? i - 1 : n + i
      })
      if (idx.some((i) => i < 0 || i >= n)) throw new Error('Mặt tham chiếu đỉnh không tồn tại')
      for (let k = 1; k + 1 < idx.length; k++) triangles.push(idx[0]!, idx[k]!, idx[k + 1]!)
      if (triangles.length / 3 > MAX_TRIANGLES) throw new Error('Mô hình quá nặng để xem trước')
    }
  }
  if (triangles.length === 0) throw new Error('File .obj không có mặt nào')
  return { positions, triangles }
}

interface Gltf {
  meshes?: { primitives: { attributes: { POSITION?: number }; indices?: number; mode?: number }[] }[]
  accessors?: { bufferView?: number; byteOffset?: number; componentType: number; count: number; type: string }[]
  bufferViews?: { byteOffset?: number; byteLength: number; byteStride?: number }[]
}

const COMP: Record<number, { size: number; read: (dv: DataView, o: number) => number }> = {
  5121: { size: 1, read: (dv, o) => dv.getUint8(o) },
  5123: { size: 2, read: (dv, o) => dv.getUint16(o, true) },
  5125: { size: 4, read: (dv, o) => dv.getUint32(o, true) },
  5126: { size: 4, read: (dv, o) => dv.getFloat32(o, true) }
}

/** Chỉ đọc lưới gốc, bỏ qua phép biến đổi nút; glTF dùng y hướng lên nên đổi sang z hướng lên cho khớp SketchUp. */
export function parseGlb(bytes: Uint8Array): Mesh {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (bytes.length < 20 || dv.getUint32(0, true) !== 0x46546c67) throw new Error('Không phải file .glb')
  let json: Gltf | null = null
  let bin: { start: number; end: number } | null = null
  for (let o = 12; o + 8 <= bytes.length; ) {
    const len = dv.getUint32(o, true), type = dv.getUint32(o + 4, true)
    const start = o + 8, end = start + len
    if (end > bytes.length) throw new Error('File .glb bị cắt cụt')
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(bytes.subarray(start, end))) as Gltf
    else if (type === 0x004e4942 && !bin) bin = { start, end }
    o = end + ((4 - (len % 4)) % 4)
  }
  if (!json || !bin) throw new Error('File .glb thiếu dữ liệu')
  const binStart = bin.start, binEnd = bin.end
  const read = (acc: number, comps: number): number[] => {
    const a = json.accessors?.[acc]
    const bv = a?.bufferView !== undefined ? json.bufferViews?.[a.bufferView] : undefined
    const c = a ? COMP[a.componentType] : undefined
    if (!a || !bv || !c) throw new Error('Accessor không hỗ trợ')
    const stride = bv.byteStride ?? c.size * comps
    const base = binStart + (bv.byteOffset ?? 0) + (a.byteOffset ?? 0)
    if (base + (a.count - 1) * stride + c.size * comps > binEnd) throw new Error('Accessor vượt quá dữ liệu')
    const out: number[] = []
    for (let i = 0; i < a.count; i++) for (let k = 0; k < comps; k++) out.push(c.read(dv, base + i * stride + k * c.size))
    return out
  }
  const positions: number[] = []
  const triangles: number[] = []
  for (const m of json.meshes ?? []) for (const p of m.primitives) {
    if ((p.mode ?? 4) !== 4 || p.attributes.POSITION === undefined) continue
    const offset = positions.length / 3
    const pos = read(p.attributes.POSITION, 3)
    for (let i = 0; i < pos.length; i += 3) positions.push(pos[i]!, -pos[i + 2]!, pos[i + 1]!)
    const idx = p.indices !== undefined ? read(p.indices, 1) : Array.from({ length: pos.length / 3 }, (_, i) => i)
    if (idx.some((i) => i < 0 || i >= pos.length / 3)) throw new Error('Chỉ số đỉnh vượt phạm vi')
    for (let i = 0; i + 2 < idx.length; i += 3) triangles.push(offset + idx[i]!, offset + idx[i + 1]!, offset + idx[i + 2]!)
    if (triangles.length / 3 > MAX_TRIANGLES) throw new Error('Mô hình quá nặng để xem trước')
  }
  if (triangles.length === 0) throw new Error('File .glb không có tam giác nào')
  return { positions, triangles }
}

export function meshBounds(m: Mesh): { size: [number, number, number] } {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < m.positions.length; i++) {
    const a = i % 3
    lo[a] = Math.min(lo[a]!, m.positions[i]!); hi[a] = Math.max(hi[a]!, m.positions[i]!)
  }
  return { size: [hi[0]! - lo[0]!, hi[1]! - lo[1]!, hi[2]! - lo[2]!] }
}

/** Vẽ lưới theo hình chiếu trục đo cùng hướng nhìn với xem trước khối; sắp tam giác từ xa tới gần, tô sáng theo pháp tuyến. */
export function meshIso(m: Mesh, maxSize = 420): { polys: { points: string; fill: string }[]; width: number; height: number } {
  const C = Math.cos(Math.PI / 6)
  const P = m.positions
  const tris: { pts: [number, number][]; depth: number; shade: number }[] = []
  for (let t = 0; t < m.triangles.length; t += 3) {
    const v = [0, 1, 2].map((k) => { const i = m.triangles[t + k]! * 3; return [P[i]!, P[i + 1]!, P[i + 2]!] as const })
    const a = v[0]!, b = v[1]!, c = v[2]!
    const u = [b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!], w = [c[0]! - a[0]!, c[1]! - a[1]!, c[2]! - a[2]!]
    const n = [u[1]! * w[2]! - u[2]! * w[1]!, u[2]! * w[0]! - u[0]! * w[2]!, u[0]! * w[1]! - u[1]! * w[0]!]
    const len = Math.hypot(n[0]!, n[1]!, n[2]!) || 1
    // Ánh sáng từ phía người xem (x, y lớn, z cao); lấy giá trị tuyệt đối vì mặt có thể ngược chiều.
    const shade = Math.abs((n[0]! * 0.5 + n[1]! * 0.5 + n[2]! * 0.7) / len)
    tris.push({
      pts: v.map((p) => [(p[0]! - p[1]!) * C, (p[0]! + p[1]!) * 0.5 - p[2]!] as [number, number]),
      depth: v.reduce((s, p) => s + p[0]! + p[1]! + p[2]! * 0.0001, 0),
      shade
    })
  }
  tris.sort((x, y) => x.depth - y.depth)
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const t of tris) for (const [x, y] of t.pts) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y) }
  const scale = maxSize / Math.max(maxX - minX, maxY - minY, 1e-9)
  const pad = 8
  const polys = tris.map((t) => {
    const l = Math.round(58 + 36 * Math.min(1, t.shade))
    return { fill: `hsl(190 35% ${l}%)`, points: t.pts.map(([x, y]) => `${((x - minX) * scale + pad).toFixed(1)},${((y - minY) * scale + pad).toFixed(1)}`).join(' ') }
  })
  return { polys, width: Math.round((maxX - minX) * scale + pad * 2), height: Math.round((maxY - minY) * scale + pad * 2) }
}

/** Số tam giác tối đa đưa vào bản xuất SketchUp; quá giới hạn thì dùng khối hộp thay thế. */
export const MAX_EXPORT_TRIANGLES = 20_000

export interface FittedMesh {
  /** x, y, z mm, gốc ở góc dưới (min = 0), kích thước đúng w × d × h */
  vertices: number[]
  triangles: number[]
}

/** Co giãn lưới về đúng w × d × h (mm), dời góc nhỏ nhất về 0. Trả về null nếu lưới rỗng, suy biến hoặc quá nặng. */
export function fitMesh(m: Mesh, w: number, d: number, h: number): FittedMesh | null {
  if (m.triangles.length === 0 || m.triangles.length / 3 > MAX_EXPORT_TRIANGLES) return null
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < m.positions.length; i++) {
    const a = i % 3
    lo[a] = Math.min(lo[a]!, m.positions[i]!); hi[a] = Math.max(hi[a]!, m.positions[i]!)
  }
  const target = [w, d, h]
  const span = hi.map((v, a) => v - lo[a]!)
  if (span.some((v) => !(v > 0)) || target.some((v) => !(v > 0))) return null
  const vertices = m.positions.map((v, i) => Math.round(((v - lo[i % 3]!) / span[i % 3]!) * target[i % 3]! * 10) / 10)
  return { vertices, triangles: [...m.triangles] }
}

/** Xoay lưới quanh trục đứng z theo bội của 90 độ (ngược chiều kim đồng hồ nhìn từ trên xuống). Các góc khác giữ nguyên. */
export function rotateMeshZ(m: Mesh, deg: number): Mesh {
  const k = ((Math.round(deg / 90) % 4) + 4) % 4
  if (k === 0) return m
  const p = [...m.positions]
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i]!, y = p[i + 1]!
    if (k === 1) { p[i] = -y; p[i + 1] = x }
    else if (k === 2) { p[i] = -x; p[i + 1] = -y }
    else { p[i] = y; p[i + 1] = -x }
  }
  return { positions: p, triangles: m.triangles }
}
