import type { Door, Issue, Item, Room, SdrawDoc } from './types'

export interface Pt {
  x: number
  y: number
}

/** Bốn góc của món sau khi quay quanh tâm. */
export function corners(item: Pick<Item, 'cx' | 'cy' | 'w' | 'd' | 'rotation'>): Pt[] {
  const a = (item.rotation * Math.PI) / 180
  const cos = Math.cos(a)
  const sin = Math.sin(a)
  const hw = item.w / 2
  const hd = item.d / 2
  return [
    [-hw, -hd],
    [hw, -hd],
    [hw, hd],
    [-hw, hd]
  ].map(([x, y]) => ({
    x: item.cx + (x as number) * cos - (y as number) * sin,
    y: item.cy + (x as number) * sin + (y as number) * cos
  }))
}

function project(poly: Pt[], axis: Pt): [number, number] {
  let min = Infinity
  let max = -Infinity
  for (const p of poly) {
    const v = p.x * axis.x + p.y * axis.y
    if (v < min) min = v
    if (v > max) max = v
  }
  return [min, max]
}

/** Hai đa giác lồi chồng lên nhau (chạm mép không tính). Dùng SAT. */
export function polygonsOverlap(a: Pt[], b: Pt[], epsilon = 0.5): boolean {
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const p1 = poly[i] as Pt
      const p2 = poly[(i + 1) % poly.length] as Pt
      const len = Math.hypot(p2.y - p1.y, p1.x - p2.x) || 1
      const axis = { x: (p2.y - p1.y) / len, y: (p1.x - p2.x) / len }
      const [minA, maxA] = project(a, axis)
      const [minB, maxB] = project(b, axis)
      if (maxA <= minB + epsilon || maxB <= minA + epsilon) return false
    }
  }
  return true
}

export function inRoom(poly: Pt[], room: Room, epsilon = 0.5): boolean {
  return poly.every(
    (p) =>
      p.x >= -epsilon &&
      p.y >= -epsilon &&
      p.x <= room.widthMm + epsilon &&
      p.y <= room.depthMm + epsilon
  )
}

/** Vùng phía trong phòng cần để trống trước một cánh cửa (hình vuông bằng bề rộng cửa). */
export function doorClearZone(door: Door, room: Room): Pt[] {
  const w = door.widthMm
  const o = door.offsetMm
  switch (door.wall) {
    case 'top':
      return [
        { x: o, y: 0 },
        { x: o + w, y: 0 },
        { x: o + w, y: w },
        { x: o, y: w }
      ]
    case 'bottom':
      return [
        { x: o, y: room.depthMm - w },
        { x: o + w, y: room.depthMm - w },
        { x: o + w, y: room.depthMm },
        { x: o, y: room.depthMm }
      ]
    case 'left':
      return [
        { x: 0, y: o },
        { x: w, y: o },
        { x: w, y: o + w },
        { x: 0, y: o + w }
      ]
    case 'right':
      return [
        { x: room.widthMm - w, y: o },
        { x: room.widthMm, y: o },
        { x: room.widthMm, y: o + w },
        { x: room.widthMm - w, y: o + w }
      ]
  }
}

/** Các lỗi bố trí do chương trình tự tính (không phải AI đoán). */
export function findIssues(doc: SdrawDoc): Issue[] {
  const issues: Issue[] = []
  const polys = doc.items.map((it) => corners(it))

  doc.items.forEach((it, i) => {
    if (!inRoom(polys[i] as Pt[], doc.room)) {
      issues.push({ kind: 'outOfRoom', itemIds: [it.id], message: `${it.name} nằm ngoài phòng` })
    }
  })

  for (let i = 0; i < doc.items.length; i++) {
    for (let j = i + 1; j < doc.items.length; j++) {
      if (polygonsOverlap(polys[i] as Pt[], polys[j] as Pt[])) {
        const a = doc.items[i]!
        const b = doc.items[j]!
        issues.push({
          kind: 'collision',
          itemIds: [a.id, b.id],
          message: `${a.name} đè lên ${b.name}`
        })
      }
    }
  }

  for (const door of doc.doors) {
    const zone = doorClearZone(door, doc.room)
    doc.items.forEach((it, i) => {
      if (polygonsOverlap(polys[i] as Pt[], zone)) {
        issues.push({
          kind: 'doorBlocked',
          itemIds: [it.id],
          message: `${it.name} chắn lối vào cửa`
        })
      }
    })
  }
  return issues
}

/**
 * Tìm chỗ trống để đặt món mới: quét từ tâm phòng ra, bước 250 mm, lấy vị trí đầu tiên
 * nằm trong phòng, không đè món khác và không chắn cửa. Không có chỗ thì trả về tâm phòng.
 */
export function findFreeSpot(
  doc: SdrawDoc,
  size: { w: number; d: number }
): { cx: number; cy: number } {
  const step = 250
  const center = { cx: doc.room.widthMm / 2, cy: doc.room.depthMm / 2 }
  const others = doc.items.map((it) => corners(it))
  const zones = doc.doors.map((d) => doorClearZone(d, doc.room))
  const candidates: Array<{ cx: number; cy: number }> = []
  for (let x = size.w / 2; x <= doc.room.widthMm - size.w / 2; x += step) {
    for (let y = size.d / 2; y <= doc.room.depthMm - size.d / 2; y += step) {
      candidates.push({ cx: x, cy: y })
    }
  }
  candidates.sort(
    (a, b) =>
      Math.hypot(a.cx - center.cx, a.cy - center.cy) - Math.hypot(b.cx - center.cx, b.cy - center.cy)
  )
  for (const c of candidates) {
    const poly = corners({ ...c, ...size, rotation: 0 })
    if (others.some((o) => polygonsOverlap(poly, o))) continue
    if (zones.some((z) => polygonsOverlap(poly, z))) continue
    return c
  }
  return center
}

/** Hai đầu đoạn nằm trên tường của một cửa hoặc cửa sổ (mm, gốc ở góc trên trái, y hướng xuống). */
export function wallSegment(o: { wall: Door['wall']; offsetMm: number; widthMm: number }, room: Room): [Pt, Pt] {
  const a = o.offsetMm
  const b = o.offsetMm + o.widthMm
  switch (o.wall) {
    case 'top':
      return [{ x: a, y: 0 }, { x: b, y: 0 }]
    case 'bottom':
      return [{ x: a, y: room.depthMm }, { x: b, y: room.depthMm }]
    case 'left':
      return [{ x: 0, y: a }, { x: 0, y: b }]
    case 'right':
      return [{ x: room.widthMm, y: a }, { x: room.widthMm, y: b }]
  }
}
