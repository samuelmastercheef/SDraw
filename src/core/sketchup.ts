import { fitMesh, rotateMeshZ, type FittedMesh, type Mesh } from './mesh'
import { fitParts, partsFor, type Part } from './parts'
import type { Sample, SdrawDoc } from './types'

export interface SketchupPlan {
  format: 'sdraw-sketchup-plan'
  version: 1
  units: 'mm'
  name: string
  room: { widthMm: number; depthMm: number }
  doors: SdrawDoc['doors']
  items: Array<{
    id: string
    name: string
    sampleId: string
    /** Đường dẫn .skp để plugin SketchUp chèn component; null nếu mẫu chưa có file */
    skpPath: string | null
    cx: number
    cy: number
    widthMm: number
    depthMm: number
    heightMm: number | null
    rotationDeg: number
    material: string
    /** Khối 3D thô dựng từ thông số (mẫu phác thảo); plugin dùng khi không có file .skp. null nếu không có */
    parts: Part[] | null
    /** Lưới tam giác đọc từ .obj/.glb đã co giãn về kích thước món; plugin dùng khi không có file .skp. null nếu không có */
    mesh: FittedMesh | null
  }>
}

/** Tệp JSON để SketchUp (plugin Ruby sau này, hoặc script thủ công) đọc và dựng lại bố cục. */
export function toSketchupPlan(doc: SdrawDoc, samples: Sample[], meshes: ReadonlyMap<string, Mesh> = new Map()): SketchupPlan {
  const map = new Map(samples.map((s) => [s.id, s]))
  return {
    format: 'sdraw-sketchup-plan',
    version: 1,
    units: 'mm',
    name: doc.name,
    room: { ...doc.room },
    doors: doc.doors,
    items: doc.items.map((it) => {
      const s = map.get(it.sampleId)
      return {
        id: it.id,
        name: it.name,
        sampleId: it.sampleId,
        skpPath: s?.skpPath ?? null,
        cx: Math.round(it.cx),
        cy: Math.round(it.cy),
        widthMm: Math.round(it.w),
        depthMm: Math.round(it.d),
        heightMm: s ? s.h : null,
        rotationDeg: it.rotation,
        material: it.material,
        mesh: s && s.meshPath && meshes.has(s.meshPath) ? fitMesh(rotateMeshZ(meshes.get(s.meshPath)!, s.meshRotation ?? 0), Math.round(it.w), Math.round(it.d), s.h) : null,
        parts: s?.sketch ? (() => { const base = partsFor(s.sketch); return base ? fitParts(base, s.sketch, Math.round(it.w), Math.round(it.d), s.h) : null })() : null
      }
    })
  }
}
