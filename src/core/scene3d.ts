import { packHouse, FLOOR_HEIGHT_M, NEONPLAN_INNER_M, type HouseRoom } from './neonplan'
import type { Sample } from './types'

/** Khối hộp trong cảnh 3D. Mét; trục X sang phải, Y lên, Z xuống dưới theo bản vẽ (z = y của bản vẽ). */
export interface Box3 {
  kind: 'floor' | 'wall' | 'door' | 'window' | 'curtain' | 'furniture' | 'light'
  /** Tâm khối */
  x: number
  y: number
  z: number
  w: number
  h: number
  d: number
  /** Quay quanh trục đứng (radian, dương = ngược chiều kim đồng hồ khi nhìn từ trên xuống) */
  rotY: number
  floor: number
  label?: string
  /** Món nội thất: mẫu gốc, để tìm lưới 3D thật */
  sampleId?: string
  /** Món là đèn (danh mục Đèn): phát sáng trong cảnh */
  lamp?: boolean
}

export interface Scene3d {
  boxes: Box3[]
  floors: number[]
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number; maxY: number }
}

export const WALL_HEIGHT_M = 2.4
const mm = (v: number): number => v / 1000
const DEFAULT_FURNITURE_H_MM = 600
function isLamp(category: string, name: string): boolean {
  const flat = (v: string) => v.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd')
  return /\bden\b/.test(flat(category)) || /\bden\b/.test(flat(name))
}

/** Dựng cảnh 3D thô từ các phòng của dự án: sàn, tường, cửa, cửa sổ, rèm và nội thất dạng khối hộp. */
export function buildScene(rooms: HouseRoom[], samples: Sample[] = []): Scene3d {
  const t = NEONPLAN_INNER_M
  const boxes: Box3[] = []
  for (const { room, x, y } of packHouse(rooms, t)) {
    const doc = room.doc
    const elev = room.floor * FLOOR_HEIGHT_M
    const W = mm(doc.room.widthMm)
    const D = mm(doc.room.depthMm)
    const ox = mm(x)
    const oz = mm(y)
    const outW = W + 2 * t
    const outD = D + 2 * t
    const ix = ox + t // gốc mép trong
    const iz = oz + t
    const f = room.floor
    const push = (b: Omit<Box3, 'floor' | 'rotY'> & { rotY?: number }) => boxes.push({ rotY: 0, floor: f, ...b })

    push({ kind: 'floor', x: ox + outW / 2, y: elev - 0.025, z: oz + outD / 2, w: outW, h: 0.05, d: outD })
    const wy = elev + WALL_HEIGHT_M / 2
    push({ kind: 'wall', x: ox + outW / 2, y: wy, z: oz + t / 2, w: outW, h: WALL_HEIGHT_M, d: t })
    push({ kind: 'wall', x: ox + outW / 2, y: wy, z: oz + outD - t / 2, w: outW, h: WALL_HEIGHT_M, d: t })
    push({ kind: 'wall', x: ox + t / 2, y: wy, z: iz + D / 2, w: t, h: WALL_HEIGHT_M, d: D })
    push({ kind: 'wall', x: ox + outW - t / 2, y: wy, z: iz + D / 2, w: t, h: WALL_HEIGHT_M, d: D })

    /** Điểm giữa đoạn trên tường và hướng vào trong phòng. */
    const onWall = (wall: 'top' | 'right' | 'bottom' | 'left', offsetMm: number, widthMm: number) => {
      const mid = mm(offsetMm + widthMm / 2)
      switch (wall) {
        case 'top':
          return { cx: ix + mid, cz: oz + t / 2, along: 'x' as const, inward: [0, 1] as const }
        case 'bottom':
          return { cx: ix + mid, cz: oz + outD - t / 2, along: 'x' as const, inward: [0, -1] as const }
        case 'left':
          return { cx: ox + t / 2, cz: iz + mid, along: 'z' as const, inward: [1, 0] as const }
        case 'right':
          return { cx: ox + outW - t / 2, cz: iz + mid, along: 'z' as const, inward: [-1, 0] as const }
      }
    }

    for (const d of doc.doors) {
      const p = onWall(d.wall, d.offsetMm, d.widthMm)
      const wd = mm(d.widthMm)
      push({ kind: 'door', x: p.cx, y: elev + 1.05, z: p.cz, w: p.along === 'x' ? wd : t + 0.02, h: 2.1, d: p.along === 'x' ? t + 0.02 : wd, label: 'Cửa' })
    }
    for (const w of doc.windows ?? []) {
      const p = onWall(w.wall, w.offsetMm, w.widthMm)
      const wd = mm(w.widthMm)
      const h = mm(w.heightMm)
      const cy = elev + mm(w.sillMm) + h / 2
      push({ kind: 'window', x: p.cx, y: cy, z: p.cz, w: p.along === 'x' ? wd : t + 0.02, h, d: p.along === 'x' ? t + 0.02 : wd, label: 'Cửa sổ' })
      if (w.curtain) {
        const cw = wd + 0.2
        const off = t / 2 + 0.06
        push({
          kind: 'curtain',
          x: p.cx + p.inward[0] * off,
          y: cy + 0.1,
          z: p.cz + p.inward[1] * off,
          w: p.along === 'x' ? cw : 0.04,
          h: h + 0.4,
          d: p.along === 'x' ? 0.04 : cw,
          label: 'Rèm'
        })
      }
    }
    push({ kind: 'light', x: ix + W / 2, y: elev + WALL_HEIGHT_M - 0.06, z: iz + D / 2, w: 0.3, h: 0.04, d: 0.3, label: 'Đèn trần' })
    for (const it of doc.items) {
      const s = samples.find((x) => x.id === it.sampleId)
      const h = mm(s && s.h > 0 ? s.h : DEFAULT_FURNITURE_H_MM)
      const lamp = isLamp(s?.category ?? '', it.name)
      push({ kind: 'furniture', x: ix + mm(it.cx), y: elev + h / 2, z: iz + mm(it.cy), w: mm(it.w), h, d: mm(it.d), rotY: (-it.rotation * Math.PI) / 180, label: it.name, sampleId: it.sampleId, ...(lamp ? { lamp: true } : {}) })
    }
  }
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, maxY = 0
  for (const b of boxes) {
    if (b.kind !== 'floor') { maxY = Math.max(maxY, b.y + b.h / 2); continue }
    minX = Math.min(minX, b.x - b.w / 2); maxX = Math.max(maxX, b.x + b.w / 2)
    minZ = Math.min(minZ, b.z - b.d / 2); maxZ = Math.max(maxZ, b.z + b.d / 2)
  }
  if (!Number.isFinite(minX)) { minX = 0; maxX = 1; minZ = 0; maxZ = 1 }
  return { boxes, floors: [...new Set(rooms.map((r) => r.floor))].sort((a, b) => a - b), bounds: { minX, maxX, minZ, maxZ, maxY } }
}
