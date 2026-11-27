/**
 * Vật liệu cho lõi dựng hình: thư viện vật liệu nội thất, gán vật liệu cho mặt,
 * toạ độ vân (chiếu phẳng theo mặt) và vân vẽ sẵn sinh bằng mã (không cần ảnh, không lo bản quyền ảnh).
 */
import { dot, faceNormal, faceTriangles, planeAxes, type Face3, type Material3, type MaterialPattern, type Model3, type Vec3 } from './model3d'

/** Thư viện vật liệu nội thất có sẵn. id cố định để tệp cũ vẫn khớp. */
export const MATERIAL_LIBRARY: Material3[] = [
  { id: 'm-go-soi', name: 'Gỗ sồi', color: '#c8a273', pattern: 'wood', size: 600 },
  { id: 'm-go-oc-cho', name: 'Gỗ óc chó', color: '#6b4a33', pattern: 'wood', size: 600 },
  { id: 'm-go-trang', name: 'Gỗ sơn trắng', color: '#eeeae2', pattern: 'plain', size: 1000, roughness: 0.5 },
  { id: 'm-mdf-xam', name: 'MDF phủ xám', color: '#8f949a', pattern: 'plain', size: 1000, roughness: 0.6 },
  { id: 'm-da-marble', name: 'Đá marble trắng', color: '#ecebe8', pattern: 'marble', size: 1200, roughness: 0.25 },
  { id: 'm-da-den', name: 'Đá granite đen', color: '#2f3134', pattern: 'marble', size: 1200, roughness: 0.3 },
  { id: 'm-gach-60', name: 'Gạch lát 60×60', color: '#d8d3ca', pattern: 'tile', size: 600, roughness: 0.4 },
  { id: 'm-gach-the', name: 'Gạch thẻ', color: '#a4573d', pattern: 'brick', size: 260 },
  { id: 'm-be-tong', name: 'Bê tông mài', color: '#a9a8a4', pattern: 'concrete', size: 1500 },
  { id: 'm-vai-ni', name: 'Vải nỉ', color: '#7c8a9a', pattern: 'fabric', size: 200, roughness: 1 },
  { id: 'm-vai-be', name: 'Vải bố be', color: '#d6c7ab', pattern: 'fabric', size: 200, roughness: 1 },
  { id: 'm-inox', name: 'Inox xước', color: '#c3c7cc', pattern: 'metal', size: 400, roughness: 0.35, metalness: 0.9 },
  { id: 'm-kinh', name: 'Kính mờ', color: '#cfe3e8', pattern: 'plain', size: 1000, roughness: 0.1 }
]

/** Gán vật liệu cho các mặt (vật liệu được chép vào mô hình). undefined là bỏ vật liệu. */
export function setFaceMaterial(m: Model3, faceIds: Iterable<string>, mat: Material3 | undefined): Model3 {
  const faces = { ...m.faces }
  const materials = { ...(m.materials ?? {}) }
  if (mat) materials[mat.id] = mat
  for (const id of faceIds) {
    const f = faces[id]
    if (!f) continue
    const { material: _old, color: _c, ...rest } = f
    faces[id] = mat ? { ...rest, material: mat.id } : rest
  }
  return pruneMaterials({ ...m, faces, materials })
}

/** Sửa thông số một vật liệu đã có trong mô hình (đổi cỡ vân, màu, tên). */
export function updateMaterial(m: Model3, id: string, patch: Partial<Omit<Material3, 'id'>>): Model3 {
  const cur = m.materials?.[id]
  if (!cur) return m
  const next: Material3 = { ...cur, ...patch, id }
  if (!(next.size > 0)) throw new Error('Cỡ vân phải lớn hơn 0')
  return { ...m, materials: { ...m.materials, [id]: next } }
}

/** Bỏ vật liệu không còn mặt nào dùng. */
export function pruneMaterials(m: Model3): Model3 {
  if (!m.materials) return m
  const used = new Set(Object.values(m.faces).map((f) => f.material).filter(Boolean))
  const materials = Object.fromEntries(Object.entries(m.materials).filter(([id]) => used.has(id)))
  if (!Object.keys(materials).length) { const { materials: _m, ...rest } = m; return rest }
  return { ...m, materials }
}

/** Vật liệu do người dùng tạo từ ảnh vân. */
export function textureMaterial(id: string, name: string, dataUrl: string, size = 600): Material3 {
  if (!/^data:image\/(png|jpeg|webp);base64,/.test(dataUrl)) throw new Error('Ảnh vân phải là PNG, JPEG hoặc WebP')
  if (dataUrl.length > 4_000_000) throw new Error('Ảnh vân quá lớn (tối đa khoảng 3 MB)')
  return { id, name: name.slice(0, 60) || 'Ảnh vân', color: '#ffffff', texture: dataUrl, size }
}

/** Toạ độ vân của một điểm trên mặt: chiếu lên mặt phẳng của mặt, đơn vị là số ô vân. */
export function uvAt(p: Vec3, axes: [Vec3, Vec3], size: number): [number, number] {
  return [dot(p, axes[0]) / size, dot(p, axes[1]) / size]
}

/** Tam giác của mặt kèm toạ độ vân từng đỉnh. */
export function faceTrianglesUV(m: Model3, f: Face3, size: number): { tri: [Vec3, Vec3, Vec3]; uv: [number, number][] }[] {
  const axes = planeAxes(faceNormal(m, f))
  return faceTriangles(m, f).map((tri) => ({ tri, uv: tri.map((p) => uvAt(p, axes, size)) }))
}

// ---------- Vân vẽ sẵn ----------

function hexRgb(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number]
}

/** Nhiễu giá trị lặp liền (tileable) theo lưới period, dùng cho vân. */
function makeNoise(seed: number) {
  let s = seed >>> 0
  const rand = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 }
  const table = Array.from({ length: 64 * 64 }, rand)
  const at = (x: number, y: number, period: number) => table[(((x % period) + period) % period) * 64 + (((y % period) + period) % period)]!
  const smooth = (t: number) => t * t * (3 - 2 * t)
  const value = (x: number, y: number, period: number) => {
    const x0 = Math.floor(x), y0 = Math.floor(y)
    const fx = smooth(x - x0), fy = smooth(y - y0)
    const a = at(x0, y0, period), b = at(x0 + 1, y0, period), c = at(x0, y0 + 1, period), d = at(x0 + 1, y0 + 1, period)
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy
  }
  /** Nhiễu nhiều tầng, u v trong [0,1) */
  return (u: number, v: number, base = 4, octaves = 4) => {
    let sum = 0, amp = 1, norm = 0
    for (let o = 0; o < octaves; o++) {
      const p = base << o
      sum += value(u * p, v * p, p) * amp
      norm += amp
      amp *= 0.5
    }
    return sum / norm
  }
}

/**
 * Điểm ảnh RGBA (px × px) của vân vẽ sẵn, lặp liền khi lát kề nhau.
 * Cùng đầu vào luôn ra cùng ảnh, để xem trên màn hình và xuất GLB giống nhau.
 */
export function patternPixels(pattern: MaterialPattern, color: string, px = 256): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(px * px * 4)
  const [r, g, b] = hexRgb(color)
  const noise = makeNoise(pattern.length * 7919 + r * 31 + g * 17 + b)
  for (let y = 0; y < px; y++) for (let x = 0; x < px; x++) {
    const u = x / px, v = y / px
    let k = 1
    switch (pattern) {
      case 'wood': {
        // Thớ gỗ chạy theo trục u: sóng theo v bị nhiễu uốn
        const w = Math.sin((v * 18 + noise(u, v, 2, 3) * 3) * Math.PI * 2)
        k = 0.86 + 0.1 * w + 0.08 * (noise(u, v, 16, 2) - 0.5)
        break
      }
      case 'marble': {
        const n = noise(u, v, 2, 5)
        const vein = Math.abs(Math.sin((u + v + n * 2.5) * Math.PI * 3))
        k = 1 - 0.28 * Math.pow(1 - vein, 8) - 0.05 * (noise(u, v, 8, 3) - 0.5)
        break
      }
      case 'tile': {
        const e = Math.min(u, v, 1 - u, 1 - v)
        k = e < 0.008 ? 0.72 : 0.97 + 0.05 * (noise(u, v, 4, 3) - 0.5)
        break
      }
      case 'brick': {
        // 4 hàng gạch mỗi ô, hàng lẻ lệch nửa viên
        const row = Math.floor(v * 4)
        const bu = (u * 2 + (row % 2) * 0.5) % 1
        const bv = (v * 4) % 1
        const mortar = bu < 0.025 || bu > 0.975 || bv < 0.06 || bv > 0.94
        k = mortar ? 1.45 : 0.9 + 0.15 * (noise(u, v, 8, 3) - 0.5) + 0.08 * (((row * 7 + Math.floor(u * 2 + (row % 2) * 0.5)) % 5) / 5 - 0.4)
        break
      }
      case 'concrete':
        k = 0.92 + 0.18 * (noise(u, v, 4, 5) - 0.5) + (noise(u, v, 32, 1) > 0.93 ? -0.12 : 0)
        break
      case 'fabric': {
        const wx = Math.sin(u * px * Math.PI * 0.5), wy = Math.sin(v * px * Math.PI * 0.5)
        k = 0.92 + 0.05 * wx * wy + 0.06 * (noise(u, v, 8, 2) - 0.5)
        break
      }
      case 'metal':
        // Xước chạy theo trục u
        k = 0.93 + 0.1 * (noise(u * 0.02, v, 64, 2) - 0.5)
        break
      default:
        k = 1
    }
    const o = (y * px + x) * 4
    out[o] = r * k; out[o + 1] = g * k; out[o + 2] = b * k; out[o + 3] = 255
  }
  return out
}
