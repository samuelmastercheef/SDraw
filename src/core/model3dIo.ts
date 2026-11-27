/**
 * Nhập/xuất mô hình 3D: OBJ (mm), STL (mm, nhị phân hoặc văn bản), glTF nhị phân .glb (mét, trục Y lên theo chuẩn glTF),
 * và dựng mô hình từ bố cục phòng.
 */
import { parseGlb, parseObj, type Mesh } from './mesh'
import {
  addBox, emptyModel, WELD_MM, faceList, facePoints, faceTriangles, polygonArea, polygonNormal,
  type Model3, type Vec3
} from './model3d'
import { faceTrianglesUV } from './materials'
import type { Scene3d } from './scene3d'

export const DEFAULT_FACE_COLOR = '#d9dee4'

const fmt = (n: number): string => String(Math.round(n * 1000) / 1000)

function safeName(s: string): string {
  return s.replace(/[^\p{L}\p{N}_-]+/gu, '_').slice(0, 60) || 'nhom'
}

/** OBJ đa giác, đơn vị mm, trục Z lên (đúng như trong S Draw). Mỗi nhóm là một "o". */
export function toObj(m: Model3, name = 'sdraw'): string {
  const ids = Object.keys(m.vertices)
  const index = new Map(ids.map((id, i) => [id, i + 1]))
  const posKey = new Map(ids.map((id) => [m.vertices[id]!.join(','), id]))
  const lines = [`# S Draw, đơn vị: mm, trục Z hướng lên`, `o ${safeName(name)}`]
  for (const id of ids) { const v = m.vertices[id]!; lines.push(`v ${fmt(v[0])} ${fmt(v[1])} ${fmt(v[2])}`) }
  const byGroup = new Map<string, string[]>()
  for (const f of faceList(m)) {
    const g = f.group ?? ''
    const rows = f.holes?.length
      // OBJ không có lỗ: mặt có lỗ được ghi thành các tam giác
      ? faceTriangles(m, f).map((t) => `f ${t.map((p) => index.get(posKey.get(p.join(','))!)).join(' ')}`)
      : [`f ${f.loop.map((v) => index.get(v)).join(' ')}`]
    byGroup.set(g, [...(byGroup.get(g) ?? []), ...rows])
  }
  for (const [g, faces] of byGroup) {
    if (g) lines.push(`o ${safeName(m.groups[g]?.name ?? g)}`)
    lines.push(...faces)
  }
  return lines.join('\n') + '\n'
}

function triangles(m: Model3): { a: Vec3; b: Vec3; c: Vec3; n: Vec3; color: string }[] {
  const out: { a: Vec3; b: Vec3; c: Vec3; n: Vec3; color: string }[] = []
  for (const f of faceList(m)) {
    const n = polygonNormal(facePoints(m, f))
    const color = (f.material ? m.materials?.[f.material]?.color : undefined) ?? f.color ?? DEFAULT_FACE_COLOR
    for (const [a, b, c] of faceTriangles(m, f)) out.push({ a, b, c, n, color })
  }
  return out
}

/** STL văn bản, đơn vị mm (dùng cho in 3D). */
export function toStl(m: Model3, name = 'sdraw'): string {
  const out = [`solid ${safeName(name)}`]
  for (const t of triangles(m)) {
    out.push(`  facet normal ${fmt(t.n[0])} ${fmt(t.n[1])} ${fmt(t.n[2])}`, '    outer loop')
    for (const p of [t.a, t.b, t.c]) out.push(`      vertex ${fmt(p[0])} ${fmt(p[1])} ${fmt(p[2])}`)
    out.push('    endloop', '  endfacet')
  }
  out.push(`endsolid ${safeName(name)}`)
  return out.join('\n') + '\n'
}

function hexToLinear(hex: string): [number, number, number] {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
  return c.map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)) as [number, number, number]
}

/** Ảnh vân để nhúng vào GLB, theo id vật liệu (giao diện vẽ sẵn ra PNG). */
export type GlbImages = Record<string, { mime: 'image/png' | 'image/jpeg'; data: Uint8Array }>

/**
 * glTF nhị phân: mét, trục Y lên (x, z, -y), mặt phẳng có pháp tuyến riêng.
 * Mặt không có ảnh vân dùng màu đỉnh; mặt có vật liệu kèm ảnh vân (truyền qua images)
 * được tách thành phần riêng có toạ độ vân và chất liệu PBR.
 */
export function toGlb(m: Model3, images: GlbImages = {}): Uint8Array {
  const conv = (p: Vec3): [number, number, number] => [p[0] / 1000, p[2] / 1000, -p[1] / 1000]
  // Gom tam giác: '' là phần màu đỉnh, còn lại theo id vật liệu có ảnh
  const parts = new Map<string, { pos: number[]; nor: number[]; col: number[]; uv: number[] }>()
  const part = (k: string) => { let p = parts.get(k); if (!p) { p = { pos: [], nor: [], col: [], uv: [] }; parts.set(k, p) }; return p }
  for (const f of faceList(m)) {
    const mat = f.material ? m.materials?.[f.material] : undefined
    const n = conv(polygonNormal(facePoints(m, f))).map((v) => v * 1000)
    if (mat && images[mat.id]) {
      const p = part(mat.id)
      for (const { tri, uv } of faceTrianglesUV(m, f, mat.size)) tri.forEach((q, i) => { p.pos.push(...conv(q)); p.nor.push(...n); p.uv.push(uv[i]![0], -uv[i]![1]) })
    } else {
      const p = part('')
      const c = hexToLinear(mat?.color ?? f.color ?? DEFAULT_FACE_COLOR)
      for (const tri of faceTriangles(m, f)) for (const q of tri) { p.pos.push(...conv(q)); p.nor.push(...n); p.col.push(...c) }
    }
  }
  if (!parts.size) throw new Error('Mô hình chưa có mặt nào')

  // Bộ đệm nhị phân: mỗi khối căn 4 byte
  const chunks: Uint8Array[] = []
  let offset = 0
  const bufferViews: Record<string, unknown>[] = []
  const accessors: Record<string, unknown>[] = []
  const push = (bytes: Uint8Array, target?: number) => {
    const pad = (4 - (bytes.length % 4)) % 4
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length, ...(target ? { target } : {}) })
    chunks.push(bytes); if (pad) chunks.push(new Uint8Array(pad))
    offset += bytes.length + pad
    return bufferViews.length - 1
  }
  const accessor = (arr: number[], type: 'VEC2' | 'VEC3', withBounds = false) => {
    const f32 = new Float32Array(arr)
    const view = push(new Uint8Array(f32.buffer), 34962)
    const size = type === 'VEC2' ? 2 : 3
    const acc: Record<string, unknown> = { bufferView: view, componentType: 5126, count: arr.length / size, type }
    if (withBounds) {
      const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity]
      for (let i = 0; i < arr.length; i++) { const k = i % 3; min[k] = Math.min(min[k]!, arr[i]!); max[k] = Math.max(max[k]!, arr[i]!) }
      acc['min'] = min; acc['max'] = max
    }
    accessors.push(acc)
    return accessors.length - 1
  }
  const materials: Record<string, unknown>[] = []
  const textures: { source: number; sampler: number }[] = []
  const imagesJson: { bufferView: number; mimeType: string; name: string }[] = []
  const primitives: Record<string, unknown>[] = []
  for (const [key, p] of parts) {
    const POSITION = accessor(p.pos, 'VEC3', true), NORMAL = accessor(p.nor, 'VEC3')
    if (!key) {
      const COLOR_0 = accessor(p.col, 'VEC3')
      materials.push({ name: 'Màu', pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 0.9 }, doubleSided: true })
      primitives.push({ attributes: { POSITION, NORMAL, COLOR_0 }, material: materials.length - 1, mode: 4 })
    } else {
      const mat = m.materials![key]!, img = images[key]!
      const TEXCOORD_0 = accessor(p.uv, 'VEC2')
      imagesJson.push({ bufferView: push(img.data), mimeType: img.mime, name: mat.name })
      textures.push({ source: imagesJson.length - 1, sampler: 0 })
      materials.push({
        name: mat.name,
        pbrMetallicRoughness: { baseColorTexture: { index: textures.length - 1 }, metallicFactor: mat.metalness ?? 0, roughnessFactor: mat.roughness ?? 0.8 },
        doubleSided: true
      })
      primitives.push({ attributes: { POSITION, NORMAL, TEXCOORD_0 }, material: materials.length - 1, mode: 4 })
    }
  }
  const bin = new Uint8Array(offset)
  let o0 = 0
  for (const c of chunks) { bin.set(c, o0); o0 += c.length }
  const json = {
    asset: { version: '2.0', generator: 'S Draw' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: 'S Draw' }],
    meshes: [{ primitives }],
    materials,
    ...(textures.length ? { textures, images: imagesJson, samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }] } : {}),
    buffers: [{ byteLength: bin.length }],
    bufferViews,
    accessors
  }
  let jsonBytes = new TextEncoder().encode(JSON.stringify(json))
  const jsonPad = (4 - (jsonBytes.length % 4)) % 4
  if (jsonPad) { const p = new Uint8Array(jsonBytes.length + jsonPad).fill(0x20); p.set(jsonBytes); jsonBytes = p }
  const total = 12 + 8 + jsonBytes.length + 8 + bin.length
  const out = new Uint8Array(total)
  const dv = new DataView(out.buffer)
  dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true)
  dv.setUint32(12, jsonBytes.length, true); dv.setUint32(16, 0x4e4f534a, true)
  out.set(jsonBytes, 20)
  const o = 20 + jsonBytes.length
  dv.setUint32(o, bin.length, true); dv.setUint32(o + 4, 0x004e4942, true)
  out.set(bin, o + 8)
  return out
}

/** Đọc STL nhị phân hoặc văn bản. */
export function parseStl(bytes: Uint8Array): Mesh {
  const positions: number[] = []
  const triangles: number[] = []
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const nTri = bytes.length >= 84 ? dv.getUint32(80, true) : -1
  if (nTri >= 0 && 84 + nTri * 50 === bytes.length) {
    for (let t = 0; t < nTri; t++) {
      const o = 84 + t * 50 + 12
      for (let k = 0; k < 9; k++) positions.push(dv.getFloat32(o + k * 4, true))
      triangles.push(t * 3, t * 3 + 1, t * 3 + 2)
    }
  } else {
    const text = new TextDecoder().decode(bytes)
    for (const mt of text.matchAll(/vertex\s+(\S+)\s+(\S+)\s+(\S+)/g)) {
      const v = [Number(mt[1]), Number(mt[2]), Number(mt[3])]
      if (v.some((n) => !Number.isFinite(n))) throw new Error('Toạ độ không hợp lệ trong STL')
      positions.push(...v)
    }
    if (positions.length % 9) throw new Error('STL hỏng: số đỉnh không chia hết cho 3')
    for (let i = 0; i < positions.length / 3; i++) triangles.push(i)
  }
  if (!triangles.length) throw new Error('STL không có mặt nào')
  return { positions, triangles }
}

export type ImportKind = 'obj' | 'stl' | 'glb'
export const MAX_IMPORT_TRIANGLES = 50_000

/**
 * Đưa lưới tam giác vào mô hình thành một nhóm. Đơn vị nguồn: OBJ và STL coi là mm, .glb là mét trục Y lên.
 * Các tam giác cùng mặt phẳng nằm cạnh nhau không được gộp (sẽ làm sau).
 */
export function importMesh(m: Model3, kind: ImportKind, data: Uint8Array, name: string, unitMm?: number): { model: Model3; groupId: string; skipped: number } {
  const mesh = kind === 'obj' ? parseObj(new TextDecoder().decode(data)) : kind === 'stl' ? parseStl(data) : parseGlb(data)
  if (mesh.triangles.length / 3 > MAX_IMPORT_TRIANGLES) throw new Error(`Mô hình có hơn ${MAX_IMPORT_TRIANGLES.toLocaleString('vi-VN')} tam giác, quá nặng để dựng hình`)
  const k = unitMm ?? (kind === 'glb' ? 1000 : 1)
  const pt = (i: number): Vec3 => {
    const x = mesh.positions[i * 3]!, y = mesh.positions[i * 3 + 1]!, z = mesh.positions[i * 3 + 2]!
    return kind === 'glb' ? [x * k, -z * k, y * k] : [x * k, y * k, z * k]
  }
  const vertices = { ...m.vertices }
  const faces = { ...m.faces }
  let seq = m.seq
  const groupId = `g${seq++}`
  const weld = new Map<string, string>()
  const vid = (p: Vec3): string => {
    const key = p.map((c) => Math.round(c / WELD_MM)).join(',')
    let id = weld.get(key)
    if (!id) { id = `v${seq++}`; vertices[id] = p; weld.set(key, id) }
    return id
  }
  let skipped = 0
  for (let t = 0; t < mesh.triangles.length; t += 3) {
    const tri = [pt(mesh.triangles[t]!), pt(mesh.triangles[t + 1]!), pt(mesh.triangles[t + 2]!)]
    const loop = tri.map(vid)
    if (polygonArea(tri) < 1 || new Set(loop).size < 3) { skipped++; continue }
    const id = `f${seq++}`
    faces[id] = { id, loop, group: groupId }
  }
  if (Object.keys(faces).length === Object.keys(m.faces).length) throw new Error('Mô hình không có mặt nào dùng được')
  return { model: { ...m, version: 1, vertices, faces, groups: { ...m.groups, [groupId]: { id: groupId, name } }, seq }, groupId, skipped }
}

const SCENE_COLORS: Partial<Record<string, string>> = { floor: '#c9b79c', wall: '#eef0f2', furniture: '#7fa7b5' }

/** Dựng mô hình từ bố cục phòng (sàn, tường, đồ nội thất dạng khối hộp), mỗi khối là một nhóm. */
export function modelFromScene(scene: Scene3d): Model3 {
  let m = emptyModel()
  for (const b of scene.boxes) {
    const color = SCENE_COLORS[b.kind]
    if (!color) continue
    // Cảnh dùng mét, Y lên, Z theo trục y của bản vẽ (hướng xuống); mô hình dùng mm, Z lên, Y = -z cảnh
    const base: Vec3 = [b.x * 1000, -b.z * 1000, (b.y - b.h / 2) * 1000]
    const w = b.w * 1000, d = b.d * 1000, h = b.h * 1000
    if (w < 1 || d < 1 || h < 1) continue
    const name = b.label ?? (b.kind === 'floor' ? 'Sàn' : b.kind === 'wall' ? 'Tường' : 'Đồ nội thất')
    m = addBox(m, base, w, d, h, { rotDeg: (b.rotY * 180) / Math.PI, name, color }).model
  }
  return m
}
