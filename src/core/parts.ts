import { paramsFromSketch } from './sofa'
import { sketchSize, type SketchDoc } from './shapes'
import { clampBed, clampChair, clampShelf, clampTable, clampWardrobe, type TableKind } from './furniture'

/**
 * Dựng 3D thô từ thông số: danh sách khối hộp (hoặc elip đùn) trong toạ độ cục bộ của món.
 * x: sang phải 0..rộng, y: như bản vẽ (lưng ở y nhỏ, mặt trước ở y lớn), z: lên trên từ sàn.
 * Đơn vị mm. Plugin SketchUp chỉ việc đùn từng khối, nên phần tính toán kiểm thử được mà không cần SketchUp.
 */
export interface Part {
  name: string
  kind: 'box' | 'ellipse'
  x: number
  y: number
  z: number
  w: number
  d: number
  h: number
}

const box = (name: string, x: number, y: number, z: number, w: number, d: number, h: number, kind: Part['kind'] = 'box'): Part => ({
  name, kind, x: Math.round(x), y: Math.round(y), z: Math.round(z), w: Math.round(w), d: Math.round(d), h: Math.round(h)
})

function sofaParts(doc: SketchDoc): Part[] {
  const p = paramsFromSketch(doc)
  const w = p.width, d = p.depth, h = p.height, arm = p.arm, back = p.back
  const chaise = p.kind === 'L' ? p.chaise : d
  const seatTop = Math.min(430, h * 0.55)
  const baseZ = 90
  const armTop = Math.min(h - 100, seatTop + 200)
  const out: Part[] = []
  // Khung đế: sofa chữ L gồm thân chính và phần chaise.
  const baseH = Math.max(40, seatTop - 170)
  out.push(box('Đế', 0, 0, baseZ, w, d, baseH))
  if (p.kind === 'L') out.push(box('Đế chaise', 0, d, baseZ, d, chaise - d, baseH))
  const cushionZ = seatTop - 80
  out.push(box('Lưng tựa', 0, 0, cushionZ, w, back, h - cushionZ))
  out.push(box('Tay vịn trái', 0, 0, cushionZ, arm, chaise, armTop - cushionZ))
  out.push(box('Tay vịn phải', w - arm, 0, cushionZ, arm, d, armTop - cushionZ))
  const x0 = p.kind === 'L' ? d : arm
  const seatW = (w - arm - x0) / p.seats
  for (let i = 0; i < p.seats; i++) out.push(box(`Đệm ngồi ${i + 1}`, x0 + i * seatW + 4, back, cushionZ, seatW - 8, d - back, 80))
  if (p.kind === 'L') out.push(box('Đệm chaise', arm, d, cushionZ, d - arm - 4, chaise - d, 80))
  for (const [i, [lx, ly]] of ([[40, 40], [w - 100, 40], [40, d - 100], [w - 100, d - 100]] as [number, number][]).entries()) out.push(box(`Chân ${i + 1}`, lx, ly, 0, 60, 60, baseZ))
  return out
}

function tableParts(doc: SketchDoc): Part[] {
  const kind = (doc.kind === 'round' || doc.kind === 'oval' ? doc.kind : 'rect') as TableKind
  const p = clampTable(kind, doc.params)
  const w = p['width']!, d = p['depth']!, h = p['height']!, leg = p['leg']!, inset = p['inset']!
  const top = Math.min(40, Math.max(20, Math.round(h * 0.05)))
  const out: Part[] = [box('Mặt bàn', 0, 0, h - top, w, d, top, kind === 'rect' ? 'box' : 'ellipse')]
  const spots: [number, number][] =
    kind === 'rect'
      ? [[inset, inset], [w - inset - leg, inset], [w - inset - leg, d - inset - leg], [inset, d - inset - leg]]
      : [0, 1, 2, 3].map((i) => {
          const a = Math.PI / 4 + (i * Math.PI) / 2
          return [w / 2 + (w / 2 - inset) * Math.cos(a) - leg / 2, d / 2 + (d / 2 - inset) * Math.sin(a) - leg / 2] as [number, number]
        })
  spots.forEach(([x, y], i) => out.push(box(`Chân ${i + 1}`, x, y, 0, leg, leg, h - top)))
  return out
}

function chairParts(doc: SketchDoc): Part[] {
  const p = clampChair(doc.params)
  const w = p['width']!, d = p['depth']!, h = p['height']!, sh = p['seatHeight']!, back = p['back']!, leg = p['leg']!
  const seat = 30
  const out: Part[] = [box('Mặt ghế', 0, 0, sh - seat, w, d, seat)]
  out.push(box('Lưng tựa', 0, 0, sh, w, back, h - sh))
  for (const [i, [x, y]] of ([[0, d - leg], [w - leg, d - leg], [0, back], [w - leg, back]] as [number, number][]).entries()) out.push(box(`Chân ${i + 1}`, x, y, 0, leg, leg, sh - seat))
  return out
}

function bedParts(doc: SketchDoc): Part[] {
  const p = clampBed(doc.params)
  const w = p['width']!, d = p['depth']!, h = p['height']!, hb = p['headboard']!
  const frameTop = Math.min(350, h * 0.4)
  const out: Part[] = [box('Khung giường', 0, 0, 120, w, d, frameTop - 120)]
  out.push(box('Đầu giường', 0, 0, 0, w, hb, h))
  const mattressTop = frameTop + 200
  out.push(box('Nệm', 30, hb, frameTop, w - 60, d - hb - 30, mattressTop - frameTop))
  const pillows = w >= 1400 ? 2 : 1
  const pw = (w - 100 * (pillows + 1)) / pillows
  for (let i = 0; i < pillows; i++) out.push(box(`Gối ${i + 1}`, 100 + i * (pw + 100), hb + 60, mattressTop, pw, 400, 120))
  for (const [i, [x, y]] of ([[0, d - 60], [w - 60, d - 60]] as [number, number][]).entries()) out.push(box(`Chân ${i + 1}`, x, y, 0, 60, 60, 120))
  return out
}

function shelfParts(doc: SketchDoc): Part[] {
  const p = clampShelf(doc.params)
  const w = p['width']!, d = p['depth']!, h = p['height']!, t = p['panel']!, n = p['shelves']!
  const out: Part[] = [
    box('Hông trái', 0, 0, 0, t, d, h),
    box('Hông phải', w - t, 0, 0, t, d, h),
    box('Ván hậu', t, 0, 0, w - 2 * t, Math.min(t, 10), h)
  ]
  // n tầng: n + 1 tấm ngang gồm đáy và nóc.
  for (let i = 0; i <= n; i++) out.push(box(i === 0 ? 'Đáy' : i === n ? 'Nóc' : `Tầng ${i}`, t, 0, (i * (h - t)) / n, w - 2 * t, d, t))
  return out
}

function wardrobeParts(doc: SketchDoc): Part[] {
  const p = clampWardrobe(doc.params)
  const w = p['width']!, d = p['depth']!, h = p['height']!, t = p['panel']!, n = p['doors']!
  const out: Part[] = [
    box('Hông trái', 0, 0, 0, t, d - t, h),
    box('Hông phải', w - t, 0, 0, t, d - t, h),
    box('Ván hậu', t, 0, 0, w - 2 * t, t, h),
    box('Đáy', t, 0, 0, w - 2 * t, d - t, t),
    box('Nóc', t, 0, h - t, w - 2 * t, d - t, t),
    box('Tầng giữa', t, 0, h * 0.7, w - 2 * t, d - t, t)
  ]
  const dw = w / n
  for (let i = 0; i < n; i++) out.push(box(`Cánh ${i + 1}`, i * dw + 2, d - t, 0, dw - 4, t, h))
  return out
}

/** null nếu loại này chưa có dựng 3D (plugin dùng khối hộp thay thế). */
export function partsFor(doc: SketchDoc): Part[] | null {
  switch (doc.category) {
    case 'Sofa': return sofaParts(doc)
    case 'Bàn': return tableParts(doc)
    case 'Ghế': return chairParts(doc)
    case 'Giường': return bedParts(doc)
    case 'Kệ sách': return shelfParts(doc)
    case 'Tủ quần áo': return wardrobeParts(doc)
    default: return null
  }
}

/** Co giãn các khối theo kích thước món trong bố cục (rộng, sâu, cao); giữ nguyên độ dày các tấm mỏng. */
export function fitParts(parts: Part[], doc: SketchDoc, w: number, d: number, h: number): Part[] {
  const s = sketchSize(doc)
  const sx = s.w > 0 ? w / s.w : 1
  const sy = s.d > 0 ? d / s.d : 1
  const sz = doc.heightMm > 0 ? h / doc.heightMm : 1
  return parts.map((p) => box(p.name, p.x * sx, p.y * sy, p.z * sz, p.w * sx, p.d * sy, p.h * sz, p.kind))
}
