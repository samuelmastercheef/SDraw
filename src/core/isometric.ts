import type { Part } from './parts'

export interface IsoPoly {
  points: string
  fill: string
}

export interface IsoDrawing {
  polys: IsoPoly[]
  width: number
  height: number
}

const C30 = Math.cos(Math.PI / 6)

/** Hình chiếu trục đo nhìn từ phía trước bên phải, từ trên xuống: thấy mặt trên, mặt trước (y lớn) và mặt phải (x lớn). */
const proj = (x: number, y: number, z: number): [number, number] => [(x - y) * C30, (x + y) * 0.5 - z]

function ring(p: Part): [number, number][] {
  if (p.kind !== 'ellipse') return [[p.x, p.y], [p.x + p.w, p.y], [p.x + p.w, p.y + p.d], [p.x, p.y + p.d]]
  const n = 28
  return Array.from({ length: n }, (_, i) => {
    const a = (2 * Math.PI * i) / n
    return [p.x + p.w / 2 + (p.w / 2) * Math.cos(a), p.y + p.d / 2 + (p.d / 2) * Math.sin(a)] as [number, number]
  })
}

/** Xem trước 3D thô để kiểm tra hình khối; không phải bản dựng cuối cùng. Vẽ từ xa tới gần (thuật toán người thợ sơn). */
export function isoDrawing(parts: Part[], maxSize = 420): IsoDrawing {
  const order = farToNear(parts)
  const raw: { pts: [number, number][]; fill: string }[] = []
  for (const p of order) {
    const base = ring(p)
    const z0 = p.z, z1 = p.z + p.h
    // Mặt bên: chỉ vẽ mặt có pháp tuyến hướng về người xem (x + y tăng).
    for (let i = 0; i < base.length; i++) {
      const a = base[i]!, b = base[(i + 1) % base.length]!
      const nx = b[1] - a[1], ny = -(b[0] - a[0]) // pháp tuyến ra ngoài của đa giác ngược chiều kim đồng hồ trong hệ (x, y)
      const facing = nx + ny
      const sign = polygonSign(base)
      if (facing * sign > 1e-6) {
        const shade = nx * sign > ny * sign ? '#9CC7CD' : '#B9DADF'
        raw.push({ pts: [proj(a[0], a[1], z0), proj(b[0], b[1], z0), proj(b[0], b[1], z1), proj(a[0], a[1], z1)], fill: shade })
      }
    }
    raw.push({ pts: base.map(([x, y]) => proj(x, y, z1)), fill: '#E7F3F4' })
  }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const r of raw) for (const [x, y] of r.pts) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y) }
  if (!Number.isFinite(minX)) return { polys: [], width: 0, height: 0 }
  const scale = maxSize / Math.max(maxX - minX, maxY - minY, 1)
  const pad = 8
  const polys = raw.map((r) => ({
    fill: r.fill,
    points: r.pts.map(([x, y]) => `${((x - minX) * scale + pad).toFixed(1)},${((y - minY) * scale + pad).toFixed(1)}`).join(' ')
  }))
  return { polys, width: Math.round((maxX - minX) * scale + pad * 2), height: Math.round((maxY - minY) * scale + pad * 2) }
}

const key = (p: Part): number => p.x + p.w / 2 + p.y + p.d / 2 + p.z * 0.0001

/** a nằm sau b (vẽ trước) khi a tách rời b theo một trục và b ở phía người xem (x, y lớn hơn hoặc z cao hơn). */
const behind = (a: Part, b: Part): boolean => a.x + a.w <= b.x || a.y + a.d <= b.y || a.z + a.h <= b.z

/**
 * Sắp xếp từ xa tới gần theo thứ tự từng phần giữa các khối (chỉ so sánh khi một chiều xác định rõ);
 * sắp theo tâm chưa đủ cho khối lớn như cánh tủ và vách. Gặp vòng thì quay về sắp theo tâm.
 */
function farToNear(parts: Part[]): Part[] {
  const n = parts.length
  const before: Set<number>[] = parts.map(() => new Set<number>())
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    if (i === j) continue
    if (behind(parts[i]!, parts[j]!) && !behind(parts[j]!, parts[i]!)) before[j]!.add(i)
  }
  const done = new Set<number>()
  const out: Part[] = []
  while (out.length < n) {
    const ready = [...Array(n).keys()].filter((i) => !done.has(i) && [...before[i]!].every((k) => done.has(k)))
    const pool = ready.length > 0 ? ready : [...Array(n).keys()].filter((i) => !done.has(i))
    const next = pool.reduce((best, i) => (key(parts[i]!) < key(parts[best]!) ? i : best))
    done.add(next)
    out.push(parts[next]!)
  }
  return out
}

/** Dấu diện tích có hướng của đa giác (+1 hoặc -1). */
function polygonSign(p: [number, number][]): number {
  let a = 0
  for (let i = 0; i < p.length; i++) { const [x1, y1] = p[i]!, [x2, y2] = p[(i + 1) % p.length]!; a += x1 * y2 - x2 * y1 }
  return a >= 0 ? 1 : -1
}
