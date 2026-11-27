/**
 * Dựng hình 3D từ bản phác thảo (nhìn từ trên xuống, mm, y hướng xuống).
 * - Mẫu nội thất có thông số (sofa, bàn, ghế, giường, kệ, tủ) và chưa kéo nút tay: dựng theo từng bộ phận (partsFor).
 * - Còn lại (vẽ tự do, đã sửa nút tay): đùn mọi hình khép kín lên chiều cao của mẫu.
 * Mỗi bộ phận / hình là một nhóm. Trục mô hình: X sang phải, Y = -y bản vẽ, Z lên.
 */
import { addPolygon, addBox, faceList, pushPull, type Model3, type Vec3 } from './model3d'
import { partsFor, type Part } from './parts'
import { isSharp, outlineBounds, type Pt, type Shape, type SketchDoc } from './shapes'

export const DEFAULT_HEIGHT_MM = 750
const PART_COLOR = '#b9a184'
const FREE_COLOR = '#9fb7c4'

/** Điểm của một hình khép kín (đã làm mượt nếu cần), theo toạ độ bản vẽ. */
export function shapeOutline(s: Shape, segments = 12): Pt[] {
  if (s.kind === 'ellipse' && s.nodes.length >= 2) {
    const c = s.nodes[0]!, e = s.nodes[1]!
    const rx = Math.abs(e.x - c.x), ry = Math.abs(e.y - c.y)
    const n = 32
    return Array.from({ length: n }, (_, i) => ({ x: c.x + rx * Math.cos((2 * Math.PI * i) / n), y: c.y + ry * Math.sin((2 * Math.PI * i) / n) }))
  }
  const pts = s.nodes
  if (!s.smooth || pts.length < 3) return [...pts]
  // Catmull-Rom giống shapeToSvgPath: chia mỗi đoạn Bézier thành `segments` điểm
  const n = pts.length
  const at = (i: number): Pt => pts[(i + n) % n]!
  const out: Pt[] = []
  for (let i = 0; i < n; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2)
    const c1 = isSharp(s, i) ? p1 : { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 }
    const c2 = isSharp(s, (i + 1) % n) ? p2 : { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 }
    for (let k = 0; k < segments; k++) {
      const t = k / segments, u = 1 - t
      out.push({
        x: u * u * u * p1.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * p2.x,
        y: u * u * u * p1.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * p2.y
      })
    }
  }
  return out
}

/** Đùn một đa giác nằm ngang từ cao độ z lên h, gom thành nhóm. */
function extrude(m: Model3, pts: Vec3[], h: number, name: string, color: string): { model: Model3; groupId: string } {
  const tmp = `__sk${m.seq}`
  const r = addPolygon(m, pts, { group: tmp, color, normal: [0, 0, -1] })
  const model = pushPull(r.model, r.faceId, -h)
  const ids = faceList(model).filter((f) => f.group === tmp).map((f) => f.id)
  const groupId = `g${model.seq}`
  const out: Model3 = { ...model, faces: { ...model.faces }, groups: { ...model.groups, [groupId]: { id: groupId, name } }, seq: model.seq + 1 }
  for (const id of ids) out.faces[id] = { ...out.faces[id]!, group: groupId }
  return { model: out, groupId }
}

function addPart(m: Model3, p: Part, o: Vec3, label: string): { model: Model3; groupId: string } {
  const name = `${label}: ${p.name}`
  if (p.kind === 'ellipse') {
    const cx = p.x + p.w / 2, cy = p.y + p.d / 2
    const pts: Vec3[] = Array.from({ length: 32 }, (_, i) => {
      const a = (2 * Math.PI * i) / 32
      return [o[0] + cx + (p.w / 2) * Math.cos(a), o[1] - (cy + (p.d / 2) * Math.sin(a)), o[2] + p.z]
    })
    return extrude(m, pts, p.h, name, PART_COLOR)
  }
  return addBox(m, [o[0] + p.x + p.w / 2, o[1] - (p.y + p.d / 2), o[2] + p.z], p.w, p.d, p.h, { name, color: PART_COLOR })
}

export interface Sketch3dResult {
  model: Model3
  groupIds: string[]
  mode: 'parts' | 'extrude'
  /** Số hình không dựng được (hở, tự cắt, quá nhỏ) */
  skipped: number
}

/** Thêm hình 3D dựng từ bản phác thảo vào mô hình m, đặt góc trái phía sau của món tại `origin`. */
export function addSketchTo3d(m: Model3, doc: SketchDoc, origin: Vec3 = [0, 0, 0]): Sketch3dResult {
  const label = doc.name || 'Phác thảo'
  const groupIds: string[] = []
  const parts = doc.manualEdits ? null : partsFor(doc)
  if (parts && parts.length) {
    let model = m
    for (const p of parts) {
      if (p.w < 1 || p.d < 1 || p.h < 1) continue
      const r = addPart(model, p, origin, label)
      model = r.model
      groupIds.push(r.groupId)
    }
    return { model, groupIds, mode: 'parts', skipped: 0 }
  }
  const b = outlineBounds(doc)
  const ox = b?.minX ?? 0, oy = b?.minY ?? 0
  const h = doc.heightMm > 0 ? doc.heightMm : DEFAULT_HEIGHT_MM
  let model = m
  let skipped = 0
  let i = 0
  for (const s of doc.shapes) {
    if (!s.visible || s.role === 'dimension' || s.role === 'reference' || s.kind === 'dim') continue
    if (s.kind === 'path' && !s.closed) continue
    i++
    const pts: Vec3[] = shapeOutline(s).map((p) => [origin[0] + p.x - ox, origin[1] - (p.y - oy), origin[2]])
    try {
      const r = extrude(model, pts, h, `${label}: ${s.name || `Hình ${i}`}`, s.role === 'outline' ? PART_COLOR : FREE_COLOR)
      model = r.model
      groupIds.push(r.groupId)
    } catch {
      skipped++
    }
  }
  return { model, groupIds, mode: 'extrude', skipped }
}
