/**
 * Cổng cho AI: bộ lệnh dựng hình và xuất file mà một mô hình AI (qua MCP hoặc gói mở rộng) gọi được.
 * Mỗi lệnh là một mở rộng trong sổ đăng ký, có mô tả và JSON Schema cho tham số, chạy trên Model3
 * và trả về mô hình mới (nếu đổi) cùng kết quả dạng chữ và dữ liệu.
 * Gói mở rộng (kể cả gói Pro) đăng ký thêm lệnh bằng aiTools.register(...).
 */
import { createRegistry, type Extension } from './extensions'
import {
  addBox, addCircle, addRectangle, arrayFaces, bounds, connectedFaces, deleteFaces, drawCircle, drawRectangle, expandToGroups,
  faceArea, faceCentroid, faceList, faceNormal, groupFaces, pushPull, rotateFaces, scaleFaces, setFaceColor, translateFaces,
  type Model3, type Vec3
} from './model3d'
import { MATERIAL_LIBRARY, pruneMaterials, setFaceMaterial } from './materials'
import { booleanOp, depthBehind, pushPullCut } from './model3dBool'
import { toGlb, toObj, toStl, type GlbImages } from './model3dIo'
import { faceLoopPath, followPath } from './sweep'
import { componentList, makeComponent, makeUnique, placeComponent, propagateComponents } from './components'
import { addDimension, buildSheet, sheetToDxf, sheetToSvg, VIEW_LABEL, type ViewName } from './drawing2d'

export type JsonSchema = Record<string, unknown>

export interface AiContext {
  model: Model3
  /** Tên mô hình (dùng đặt tên file) */
  name: string
  /** Giao diện cấp ảnh vân để xuất GLB có vân (không có thì xuất màu) */
  glbImages?: () => Promise<GlbImages>
}

export interface AiFile {
  kind: 'obj' | 'stl' | 'glb' | 'dxf' | 'svg' | 'pdf'
  /** Với pdf: nội dung SVG, phần ghi file sẽ in ra PDF */
  data: string | Uint8Array
  name: string
}

export interface AiResult {
  /** Mô hình sau lệnh; trống nếu lệnh chỉ đọc */
  model?: Model3
  /** Tóm tắt cho AI đọc */
  text: string
  /** Dữ liệu có cấu trúc (id mới tạo...), skill dùng lại qua $1.group_id */
  data?: Record<string, unknown>
  file?: AiFile
}

export interface AiTool extends Extension {
  /** Mô tả cho AI biết khi nào dùng */
  description: string
  inputSchema: JsonSchema
  run(ctx: AiContext, args: Record<string, unknown>): AiResult | Promise<AiResult>
}

export const aiTools = createRegistry<AiTool>()

// ---------- Đọc tham số ----------

const num = (a: Record<string, unknown>, k: string, def?: number): number => {
  const v = a[k] ?? def
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`Thiếu hoặc sai tham số số "${k}"`)
  return v
}
const optNum = (a: Record<string, unknown>, k: string): number | undefined => (a[k] === undefined ? undefined : num(a, k))
const str = (a: Record<string, unknown>, k: string, def?: string): string => {
  const v = a[k] ?? def
  if (typeof v !== 'string' || !v) throw new Error(`Thiếu tham số chữ "${k}"`)
  return v
}
const vec = (a: Record<string, unknown>, k: string, def?: Vec3): Vec3 => {
  const v = a[k] ?? def
  if (!Array.isArray(v) || v.length !== 3 || !v.every((x) => typeof x === 'number' && Number.isFinite(x))) throw new Error(`Tham số "${k}" phải là [x, y, z] (mm)`)
  return v as Vec3
}
const ids = (a: Record<string, unknown>, k = 'ids'): string[] => {
  const v = a[k]
  const arr = typeof v === 'string' ? [v] : v
  if (!Array.isArray(arr) || !arr.length || !arr.every((x) => typeof x === 'string')) throw new Error(`Tham số "${k}" phải là danh sách id nhóm hoặc id mặt`)
  return arr as string[]
}

/** Đổi danh sách id (nhóm "g…" hoặc mặt "f…") thành id mặt; mặt rời mở rộng theo nhóm. */
export function resolveFaces(m: Model3, list: string[]): string[] {
  const out = new Set<string>()
  for (const id of list) {
    if (m.groups[id]) faceList(m).filter((f) => f.group === id).forEach((f) => out.add(f.id))
    else if (m.faces[id]) expandToGroups(m, [id]).forEach((f) => out.add(f))
    else throw new Error(`Không có nhóm hay mặt "${id}"`)
  }
  return [...out]
}

const round = (v: number) => Math.round(v * 10) / 10
const r3 = (p: Vec3) => p.map(round) as Vec3
const boxOf = (m: Model3, faceIds: string[]) => {
  const b = bounds({ ...m, faces: Object.fromEntries(faceIds.map((id) => [id, m.faces[id]!])), vertices: Object.fromEntries(faceIds.flatMap((id) => [m.faces[id]!.loop, ...(m.faces[id]!.holes ?? [])].flat()).map((v) => [v, m.vertices[v]!])) })
  return b ? { min: r3(b.min), max: r3(b.max), size: r3([b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]]) } : null
}
const newFaces = (before: Model3, after: Model3) => Object.keys(after.faces).filter((id) => !before.faces[id])
const newGroups = (before: Model3, after: Model3) => Object.keys(after.groups).filter((id) => !before.groups[id])

const ID_LIST = { type: 'array', items: { type: 'string' }, description: 'Id nhóm (g…) hoặc id mặt (f…); mặt thuộc nhóm thì lấy cả nhóm' }
const POINT = { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3, description: '[x, y, z] mm, z hướng lên' }
const DIRS: Record<string, Vec3> = { up: [0, 0, 1], down: [0, 0, -1], '+x': [1, 0, 0], '-x': [-1, 0, 0], '+y': [0, 1, 0], '-y': [0, -1, 0] }

// ---------- Lệnh có sẵn ----------

const CORE: AiTool[] = [
  {
    id: 'model_info', order: 1,
    description: 'Tóm tắt mô hình đang mở: số mặt, khung bao, danh sách nhóm (id, tên, kích thước), vật liệu, kích thước đã ghi. Gọi đầu tiên để biết đang có gì. Đơn vị mm, trục Z hướng lên.',
    inputSchema: { type: 'object', properties: {} },
    run: ({ model: m, name }) => {
      const groups = Object.values(m.groups).map((g) => {
        const fs = faceList(m).filter((f) => f.group === g.id).map((f) => f.id)
        return { id: g.id, name: g.name, faces: fs.length, box: boxOf(m, fs) }
      })
      const loose = faceList(m).filter((f) => !f.group).length
      const b = bounds(m)
      const data = {
        name, faces: faceList(m).length, looseFaces: loose,
        bounds: b ? { min: r3(b.min), max: r3(b.max) } : null,
        groups, materials: Object.values(m.materials ?? {}).map((x) => ({ id: x.id, name: x.name })),
        dimensions: Object.keys(m.dims ?? {}).length
      }
      return { text: JSON.stringify(data), data }
    }
  },
  {
    id: 'find_faces', order: 2,
    description: 'Liệt kê mặt (id, hướng pháp tuyến, tâm, diện tích) của một nhóm hoặc cả mô hình, lọc theo hướng. Dùng để tìm mặt trên cùng ("up") trước khi đẩy kéo.',
    inputSchema: { type: 'object', properties: { group_id: { type: 'string' }, direction: { type: 'string', enum: Object.keys(DIRS) }, limit: { type: 'number' } } },
    run: ({ model: m }, a) => {
      const g = a['group_id'] as string | undefined
      const dir = a['direction'] ? DIRS[String(a['direction'])] : undefined
      let fs = faceList(m).filter((f) => !g || f.group === g)
      if (dir) fs = fs.filter((f) => { const n = faceNormal(m, f); return n[0] * dir[0] + n[1] * dir[1] + n[2] * dir[2] > 0.95 })
      const rows = fs.slice(0, Math.min(200, optNum(a, 'limit') ?? 50)).map((f) => ({ id: f.id, normal: faceNormal(m, f).map((x) => Math.round(x * 100) / 100), center: r3(faceCentroid(m, f)), area_m2: Math.round(faceArea(m, f) / 1e4) / 100, group: f.group ?? null, holes: f.holes?.length ?? 0 }))
      return { text: JSON.stringify(rows), data: { faces: rows } }
    }
  },
  {
    id: 'add_box', order: 10,
    description: 'Thêm một khối hộp thành nhóm mới. x, y, z là tâm đáy hộp (mm). Dùng cho tủ, bàn, kệ, tường, vách.',
    inputSchema: { type: 'object', required: ['x', 'y', 'width', 'depth', 'height'], properties: { x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number', default: 0 }, width: { type: 'number', description: 'Theo X' }, depth: { type: 'number', description: 'Theo Y' }, height: { type: 'number', description: 'Theo Z' }, rotation: { type: 'number', description: 'Độ quanh trục đứng' }, name: { type: 'string' }, material: { type: 'string', description: 'Id vật liệu (xem list_materials)' } } },
    run: ({ model: m }, a) => {
      const w = num(a, 'width'), d = num(a, 'depth'), h = num(a, 'height')
      if (w <= 0 || d <= 0 || h <= 0) throw new Error('Kích thước hộp phải lớn hơn 0')
      const rot = optNum(a, 'rotation')
      let r = addBox(m, [num(a, 'x'), num(a, 'y'), num(a, 'z', 0)], w, d, h, { ...(rot ? { rotDeg: rot } : {}), name: typeof a['name'] === 'string' ? a['name'] : 'Hộp' })
      let model = r.model
      if (typeof a['material'] === 'string') model = applyMaterial(model, faceList(model).filter((f) => f.group === r.groupId).map((f) => f.id), a['material'])
      return { model, text: `Đã thêm hộp ${w}×${d}×${h} mm, nhóm ${r.groupId}`, data: { group_id: r.groupId } }
    }
  },
  {
    id: 'draw_rectangle', order: 11,
    description: 'Vẽ chữ nhật từ góc corner1 tới corner2 trên mặt phẳng có pháp tuyến normal (mặc định nằm ngang). Nếu chữ nhật nằm trong một mặt có sẵn (host_face) thì mặt đó được cắt. Trả về face_id để đẩy kéo.',
    inputSchema: { type: 'object', required: ['corner1', 'corner2'], properties: { corner1: POINT, corner2: POINT, normal: POINT, host_face: { type: 'string' } } },
    run: ({ model: m }, a) => {
      const n = a['normal'] ? vec(a, 'normal') : [0, 0, 1] as Vec3
      const host = typeof a['host_face'] === 'string' ? a['host_face'] : null
      const r = host ? drawRectangle(m, vec(a, 'corner1'), vec(a, 'corner2'), n, { host }) : addRectangle(m, vec(a, 'corner1'), vec(a, 'corner2'), n)
      return { model: r.model, text: `Đã vẽ chữ nhật, mặt ${r.faceId}`, data: { face_id: r.faceId } }
    }
  },
  {
    id: 'draw_circle', order: 12,
    description: 'Vẽ hình tròn tâm center, bán kính radius (mm), trên mặt phẳng có pháp tuyến normal. host_face để khoét lỗ trên mặt có sẵn.',
    inputSchema: { type: 'object', required: ['center', 'radius'], properties: { center: POINT, radius: { type: 'number' }, normal: POINT, host_face: { type: 'string' } } },
    run: ({ model: m }, a) => {
      const n = a['normal'] ? vec(a, 'normal') : [0, 0, 1] as Vec3
      const host = typeof a['host_face'] === 'string' ? a['host_face'] : null
      const r = host ? drawCircle(m, vec(a, 'center'), num(a, 'radius'), n, { host }) : addCircle(m, vec(a, 'center'), num(a, 'radius'), n)
      return { model: r.model, text: `Đã vẽ hình tròn, mặt ${r.faceId}`, data: { face_id: r.faceId } }
    }
  },
  {
    id: 'push_pull', order: 13,
    description: 'Đẩy kéo một mặt theo pháp tuyến: dương là kéo ra (thành khối, khối nhô), âm là đẩy vào (hốc). Đẩy bằng hoặc hơn chiều dày khối thì khoét xuyên.',
    inputSchema: { type: 'object', required: ['face_id', 'distance'], properties: { face_id: { type: 'string' }, distance: { type: 'number' } } },
    run: async ({ model: m }, a) => {
      const id = str(a, 'face_id'), d = num(a, 'distance')
      if (!m.faces[id]) throw new Error(`Không có mặt "${id}"`)
      const depth = d < 0 ? depthBehind(m, id) : 0
      let model: Model3
      if (d < 0 && depth > 0 && -d >= depth - 0.5) model = await pushPullCut(m, id, -depth)
      else {
        try { model = pushPull(m, id, d) } catch (e) {
          if (d < 0 && /sát mép/.test((e as Error).message)) model = await pushPullCut(m, id, d)
          else throw e
        }
      }
      return { model, text: `Đã đẩy kéo ${d} mm, thêm ${newFaces(m, model).length} mặt`, data: { new_faces: newFaces(m, model) } }
    }
  },
  {
    id: 'follow_path', order: 14,
    description: 'Chạy dọc đường: quét mặt cắt (profile_face, vẽ đứng gần đầu đường, vuông góc với đoạn đầu) dọc theo viền một mặt (path_face, vòng kín) hoặc theo danh sách điểm points (closed để khép). Dùng cho len chân tường, phào trần, viền mặt bàn, tay vịn.',
    inputSchema: { type: 'object', required: ['profile_face'], properties: { profile_face: { type: 'string' }, path_face: { type: 'string' }, points: { type: 'array', items: POINT }, closed: { type: 'boolean' }, name: { type: 'string' } } },
    run: ({ model: m }, a) => {
      const prof = str(a, 'profile_face')
      let path: Vec3[], closed: boolean
      if (typeof a['path_face'] === 'string') { path = faceLoopPath(m, a['path_face']); closed = true } else {
        const pts = a['points']
        if (!Array.isArray(pts) || pts.length < 2) throw new Error('Cần path_face hoặc points (ít nhất 2 điểm)')
        path = pts.map((_, i) => vec({ p: pts[i] }, 'p'))
        closed = a['closed'] === true
      }
      const r = followPath(m, prof, path, { closed, ...(typeof a['name'] === 'string' ? { name: a['name'] } : {}) })
      return { model: r.model, text: `Đã chạy mặt cắt dọc đường, nhóm ${r.groupId}`, data: { group_id: r.groupId } }
    }
  },
  {
    id: 'move', order: 20,
    description: 'Dời nhóm hoặc mặt một đoạn [dx, dy, dz] mm. copy = true để chép thay vì dời.',
    inputSchema: { type: 'object', required: ['ids', 'offset'], properties: { ids: ID_LIST, offset: POINT, copy: { type: 'boolean' } } },
    run: ({ model: m }, a) => {
      const fs = resolveFaces(m, ids(a)), off = vec(a, 'offset')
      if (a['copy'] === true) {
        const r = arrayFaces(m, fs, off, 1)
        return { model: r.model, text: `Đã chép ${fs.length} mặt`, data: { new_groups: newGroups(m, r.model), new_faces: r.copies[0] } }
      }
      return { model: translateFaces(m, fs, off), text: `Đã dời ${fs.length} mặt` }
    }
  },
  {
    id: 'rotate', order: 21,
    description: 'Xoay nhóm hoặc mặt một góc (độ) quanh trục axis (mặc định trục đứng) đi qua center (mặc định tâm khung bao).',
    inputSchema: { type: 'object', required: ['ids', 'angle'], properties: { ids: ID_LIST, angle: { type: 'number' }, axis: POINT, center: POINT } },
    run: ({ model: m }, a) => {
      const fs = resolveFaces(m, ids(a))
      const b = boxOf(m, fs)!
      const c = a['center'] ? vec(a, 'center') : [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, b.min[2]] as Vec3
      return { model: rotateFaces(m, fs, c, a['axis'] ? vec(a, 'axis') : [0, 0, 1], num(a, 'angle')), text: `Đã xoay ${num(a, 'angle')}°` }
    }
  },
  {
    id: 'scale', order: 22,
    description: 'Co giãn nhóm hoặc mặt: factor là một số hoặc [fx, fy, fz]; số âm để lật. origin mặc định là tâm đáy khung bao.',
    inputSchema: { type: 'object', required: ['ids', 'factor'], properties: { ids: ID_LIST, factor: { oneOf: [{ type: 'number' }, POINT] }, origin: POINT } },
    run: ({ model: m }, a) => {
      const fs = resolveFaces(m, ids(a))
      const b = boxOf(m, fs)!
      const o = a['origin'] ? vec(a, 'origin') : [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, b.min[2]] as Vec3
      const f = typeof a['factor'] === 'number' ? a['factor'] : vec(a, 'factor')
      return { model: scaleFaces(m, fs, o, f), text: 'Đã co giãn' }
    }
  },
  {
    id: 'copy_array', order: 23,
    description: 'Chép nhóm hoặc mặt thành dãy count bản, bản thứ i lệch offset × i (mm). Dùng cho dãy tủ, lam gỗ, ô kệ.',
    inputSchema: { type: 'object', required: ['ids', 'offset', 'count'], properties: { ids: ID_LIST, offset: POINT, count: { type: 'number' } } },
    run: ({ model: m }, a) => {
      if (num(a, 'count') < 1) return { text: 'Không chép bản nào (count < 1)', data: { new_groups: [] } }
      const r = arrayFaces(m, resolveFaces(m, ids(a)), vec(a, 'offset'), num(a, 'count'))
      return { model: r.model, text: `Đã chép thành dãy ${r.copies.length} bản`, data: { new_groups: newGroups(m, r.model) } }
    }
  },
  {
    id: 'group', order: 24,
    description: 'Gom các mặt rời thành một nhóm có tên.',
    inputSchema: { type: 'object', required: ['ids'], properties: { ids: ID_LIST, name: { type: 'string' } } },
    run: ({ model: m }, a) => {
      const list = ids(a)
      // Mặt rời: lấy cả khối liền nhau
      const fs = [...new Set(list.flatMap((id) => (m.faces[id] && !m.faces[id]!.group ? connectedFaces(m, id) : resolveFaces(m, [id]))))]
      const r = groupFaces(m, fs, typeof a['name'] === 'string' ? a['name'] : 'Nhóm')
      return { model: r.model, text: `Đã tạo nhóm ${r.groupId}`, data: { group_id: r.groupId } }
    }
  },
  {
    id: 'delete', order: 25,
    description: 'Xoá nhóm hoặc mặt.',
    inputSchema: { type: 'object', required: ['ids'], properties: { ids: ID_LIST } },
    run: ({ model: m }, a) => {
      const fs = resolveFaces(m, ids(a))
      return { model: pruneMaterials(deleteFaces(m, fs)), text: `Đã xoá ${fs.length} mặt` }
    }
  },
  {
    id: 'make_component', order: 26,
    description: 'Biến nhóm hoặc các mặt thành cấu kiện dùng lại. Chép (move với copy, copy_array) hay place_component ra thêm bản; sửa một bản thì mọi bản đổi theo.',
    inputSchema: { type: 'object', required: ['ids'], properties: { ids: ID_LIST, name: { type: 'string' } } },
    run: ({ model: m }, a) => {
      const r = makeComponent(m, resolveFaces(m, ids(a)), typeof a['name'] === 'string' && a['name'].trim() ? a['name'] : undefined)
      return { model: r.model, text: `Đã tạo cấu kiện ${r.componentId} (nhóm ${r.groupId})`, data: { component_id: r.componentId, group_id: r.groupId } }
    }
  },
  {
    id: 'place_component', order: 27,
    description: 'Đặt thêm một bản cấu kiện: góc gốc (góc nhỏ nhất khung bao lúc tạo) tại "at", xoay quanh trục đứng rot_deg độ.',
    inputSchema: { type: 'object', required: ['component_id', 'at'], properties: { component_id: { type: 'string' }, at: POINT, rot_deg: { type: 'number' } } },
    run: ({ model: m }, a) => {
      const r = placeComponent(m, str(a, 'component_id'), vec(a, 'at'), optNum(a, 'rot_deg') ?? 0)
      return { model: r.model, text: `Đã đặt bản ${r.groupId}`, data: { group_id: r.groupId } }
    }
  },
  {
    id: 'list_components', order: 28,
    description: 'Danh sách cấu kiện trong mô hình: id, tên, số bản, id các nhóm là bản của nó.',
    inputSchema: { type: 'object', properties: {} },
    run: ({ model: m }) => {
      const list = componentList(m).map((c) => ({ ...c, groups: Object.values(m.groups).filter((g) => g.component === c.id).map((g) => g.id) }))
      return { text: list.length ? list.map((c) => `${c.id} "${c.name}": ${c.instances} bản (${c.groups.join(', ')})`).join('\n') : 'Chưa có cấu kiện nào', data: { components: list } }
    }
  },
  {
    id: 'make_unique', order: 29,
    description: 'Tách một bản khỏi cấu kiện để sửa riêng (thành nhóm thường).',
    inputSchema: { type: 'object', required: ['group_id'], properties: { group_id: { type: 'string' } } },
    run: ({ model: m }, a) => ({ model: makeUnique(m, str(a, 'group_id')), text: 'Đã tách khỏi cấu kiện' })
  },
  {
    id: 'list_materials', order: 30,
    description: 'Danh sách vật liệu có sẵn (id, tên) để dùng với set_material.',
    inputSchema: { type: 'object', properties: {} },
    run: ({ model: m }) => {
      const rows = [...MATERIAL_LIBRARY, ...Object.values(m.materials ?? {}).filter((x) => !MATERIAL_LIBRARY.some((l) => l.id === x.id))].map((x) => ({ id: x.id, name: x.name, tile_mm: x.size }))
      return { text: JSON.stringify(rows), data: { materials: rows } }
    }
  },
  {
    id: 'set_material', order: 31,
    description: 'Gán vật liệu (material id từ list_materials) hoặc màu (#rrggbb) cho nhóm hoặc mặt.',
    inputSchema: { type: 'object', required: ['ids'], properties: { ids: ID_LIST, material: { type: 'string' }, color: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' } } },
    run: ({ model: m }, a) => {
      const fs = resolveFaces(m, ids(a))
      if (typeof a['material'] === 'string') return { model: applyMaterial(m, fs, a['material']), text: `Đã gán vật liệu cho ${fs.length} mặt` }
      const c = str(a, 'color')
      if (!/^#[0-9a-fA-F]{6}$/.test(c)) throw new Error('Màu phải dạng #rrggbb')
      return { model: pruneMaterials(setFaceColor(m, fs, c)), text: `Đã tô màu ${c}` }
    }
  },
  {
    id: 'boolean', order: 32,
    description: 'Phép toán khối giữa hai khối kín: subtract (khoét khối b khỏi khối a), union (hợp), intersect (giao). Kết quả thuộc nhóm của a.',
    inputSchema: { type: 'object', required: ['op', 'a', 'b'], properties: { op: { type: 'string', enum: ['subtract', 'union', 'intersect'] }, a: ID_LIST, b: ID_LIST } },
    run: async ({ model: m }, a) => {
      const op = str(a, 'op')
      if (!['subtract', 'union', 'intersect'].includes(op)) throw new Error('op phải là subtract, union hoặc intersect')
      const model = await booleanOp(m, resolveFaces(m, ids(a, 'a')), resolveFaces(m, ids(a, 'b')), op as 'subtract')
      return { model, text: `Đã ${op}, còn ${faceList(model).length} mặt` }
    }
  },
  {
    id: 'add_dimension', order: 40,
    description: 'Ghi kích thước đo từ điểm a tới điểm b; đường kích thước đi qua điểm p (đặt lệch ra ngoài hình). Hiện trên mô hình và bản vẽ.',
    inputSchema: { type: 'object', required: ['a', 'b', 'p'], properties: { a: POINT, b: POINT, p: POINT } },
    run: ({ model: m }, a) => {
      const r = addDimension(m, vec(a, 'a'), vec(a, 'b'), vec(a, 'p'))
      return { model: r.model, text: 'Đã ghi kích thước', data: { dimension_id: r.id } }
    }
  },
  {
    id: 'export', order: 50,
    description: 'Xuất file: glb, obj, stl (mô hình 3D) hoặc pdf, dxf, svg (bản vẽ mặt bằng và mặt đứng). File được lưu vào thư mục xuất của S Draw, trả về đường dẫn.',
    inputSchema: { type: 'object', required: ['format'], properties: { format: { type: 'string', enum: ['glb', 'obj', 'stl', 'pdf', 'dxf', 'svg'] }, views: { type: 'array', items: { type: 'string', enum: Object.keys(VIEW_LABEL) } }, hidden_lines: { type: 'boolean' }, file_name: { type: 'string' } } },
    run: async (ctx, a) => {
      const m = ctx.model
      const fmt = str(a, 'format') as AiFile['kind']
      if (!faceList(m).length) throw new Error('Mô hình chưa có mặt nào')
      const fileName = (typeof a['file_name'] === 'string' ? a['file_name'] : ctx.name || 'mo-hinh').slice(0, 80)
      let data: string | Uint8Array
      if (fmt === 'glb') data = toGlb(m, ctx.glbImages ? await ctx.glbImages() : {})
      else if (fmt === 'obj') data = toObj(m, fileName)
      else if (fmt === 'stl') data = toStl(m, fileName)
      else if (fmt === 'pdf' || fmt === 'svg' || fmt === 'dxf') {
        const views = (Array.isArray(a['views']) && a['views'].length ? a['views'] : ['top', 'front', 'right']) as ViewName[]
        if (!views.every((v) => v in VIEW_LABEL)) throw new Error('views gồm top, front, right, back, left')
        const sh = buildSheet(m, views, fileName, { hidden: a['hidden_lines'] === true })
        data = fmt === 'dxf' ? sheetToDxf(sh) : sheetToSvg(sh)
      } else throw new Error('format không hỗ trợ')
      return { text: `Đã tạo file ${fmt}`, file: { kind: fmt, data, name: fileName } }
    }
  }
]

function applyMaterial(m: Model3, faceIds: string[], id: string): Model3 {
  const mat = m.materials?.[id] ?? MATERIAL_LIBRARY.find((x) => x.id === id)
  if (!mat) throw new Error(`Không có vật liệu "${id}" (xem list_materials)`)
  return setFaceMaterial(m, faceIds, mat)
}

for (const t of CORE) aiTools.register({ tier: 'core', ...t })

/** Chạy một lệnh theo tên. */
export async function runAiTool(ctx: AiContext, name: string, args: Record<string, unknown> = {}): Promise<AiResult> {
  const t = aiTools.get(name)
  if (!t) throw new Error(`Không có lệnh "${name}"`)
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Tham số phải là đối tượng JSON')
  const r = await t.run(ctx, args)
  // Lệnh sửa một bản cấu kiện thì các bản khác đổi theo
  return r.model ? { ...r, model: propagateComponents(r.model) } : r
}

/** Danh sách lệnh dạng MCP (name, description, inputSchema). */
export function aiToolList(): { name: string; description: string; inputSchema: JsonSchema }[] {
  return aiTools.list().map((t) => ({ name: t.id, description: t.description, inputSchema: t.inputSchema }))
}
