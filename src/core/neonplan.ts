import type { Sample, SdrawDoc, WallSide } from './types'

/**
 * Xuất bản vẽ Sdraw sang định dạng nhập của NeonPlan 3D (tích hợp Home Assistant,
 * https://github.com/Mastershort/neonplan3d, xem docs/ai-import.md của họ).
 * Đơn vị mét, x sang phải, z xuống dưới, góc trên trái của nhà là [0, 0].
 * Một phòng Sdraw = một tầng một phòng; mọi tường coi là tường ngoài (cộng 0,3 m mỗi phía theo tài liệu NeonPlan).
 */
export const NEONPLAN_WALL_M = 0.3

/** Loại đồ NeonPlan đã được tài liệu của họ liệt kê. */
const KNOWN_TYPES = new Set(['sofa', 'armchair', 'table', 'chair', 'bed', 'desk', 'kitchen', 'sink', 'stove', 'fridge', 'wc', 'bathtub', 'shower'])

/** Danh mục Sdraw -> loại đồ NeonPlan. Danh mục chưa có loại tương ứng rơi về 'cabinet' kèm cảnh báo. */
const TYPE_BY_CATEGORY: Record<string, string> = {
  sofa: 'sofa',
  'ghe thu gian': 'armchair',
  ghe: 'chair',
  'ban tra': 'table',
  'ban an': 'table',
  ban: 'table',
  'ban lam viec': 'desk',
  giuong: 'bed',
  'ke tivi': 'cabinet',
  'ke sach': 'cabinet',
  'tu quan ao': 'cabinet',
  'tu giay': 'cabinet',
  'tu lanh': 'fridge',
  bep: 'stove',
  'bep tu': 'stove',
  'chau rua': 'sink',
  'bon rua': 'sink',
  'tu bep': 'kitchen',
  'bon cau': 'wc',
  'bon tam': 'bathtub',
  'voi sen': 'shower',
  'phong tam': 'shower'
}

export const NEONPLAN_FALLBACK_TYPE = 'cabinet'

function norm(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().trim()
}

export function neonplanType(category: string): { type: string; known: boolean } {
  const type = TYPE_BY_CATEGORY[norm(category)] ?? NEONPLAN_FALLBACK_TYPE
  return { type, known: KNOWN_TYPES.has(type) }
}

export interface NeonPlanImport {
  format: 'neonplan-import'
  units: 'm'
  rooms_at: 'centre'
  /** Thông tin thêm từ Sdraw, NeonPlan có thể bỏ qua. */
  source: { app: 'sdrawai'; name: string }
  floors: Array<{
    name: string
    elevation: number
    height: number
    rooms: Array<{ name: string; area?: string; points: [number, number][] }>
    doors: Array<{ at: [number, number]; width: number }>
    windows: Array<{ at: [number, number]; width: number; height: number; sill: number }>
    furniture: Array<{ type: string; name: string; at: [number, number]; width: number; depth: number; rotation: number }>
  }>
}

export interface NeonPlanResult {
  plan: NeonPlanImport
  /** Món có danh mục chưa có loại NeonPlan chắc chắn: người dùng nên kiểm tra sau khi nhập. */
  warnings: string[]
}

const m = (mm: number): number => Math.round(mm) / 1000
const r3 = (v: number): number => Math.round(v * 1000) / 1000

function doorPoint(wall: WallSide, offsetMm: number, widthMm: number, W: number, D: number, t: number): [number, number] {
  const mid = m(offsetMm + widthMm / 2)
  switch (wall) {
    case 'top':
      return [r3(t + mid), 0]
    case 'bottom':
      return [r3(t + mid), r3(2 * t + m(D))]
    case 'left':
      return [0, r3(t + mid)]
    case 'right':
      return [r3(2 * t + m(W)), r3(t + mid)]
  }
}

type Floor = NeonPlanImport['floors'][number]

/** Nội dung một phòng, dời tới (ox, oy) mét; t là phần cộng từ mép trong tới tâm tường. */
function roomContent(doc: SdrawDoc, samples: Sample[], t: number, ox: number, oy: number, warnings: string[]) {
  const W = doc.room.widthMm
  const D = doc.room.depthMm
  const outW = r3(m(W) + 2 * t)
  const outD = r3(m(D) + 2 * t)
  const shift = (p: [number, number]): [number, number] => [r3(p[0] + ox), r3(p[1] + oy)]
  const area = doc.haArea?.trim()
  const room: Floor['rooms'][number] = {
    name: area || doc.name || 'Phòng',
    ...(area ? { area } : {}),
    points: ([[0, 0], [outW, 0], [outW, outD], [0, outD]] as [number, number][]).map(shift)
  }
  const doors: Floor['doors'] = doc.doors.map((d) => ({ at: shift(doorPoint(d.wall, d.offsetMm, d.widthMm, W, D, t)), width: m(d.widthMm) }))
  const windows: Floor['windows'] = (doc.windows ?? []).map((w) => ({
    at: shift(doorPoint(w.wall, w.offsetMm, w.widthMm, W, D, t)),
    width: m(w.widthMm),
    height: m(w.heightMm),
    sill: m(w.sillMm)
  }))
  const furniture: Floor['furniture'] = doc.items.map((it) => {
    const { type, known } = neonplanType(sampleCategory(it.sampleId, samples))
    if (!known) warnings.push(`${doc.name}: ${it.name}: danh mục chưa có loại NeonPlan chắc chắn, dùng "${type}"`)
    return {
      type,
      name: it.name,
      at: shift([r3(t + m(it.cx)), r3(t + m(it.cy))]),
      width: m(it.w),
      depth: m(it.d),
      rotation: ((Math.round(it.rotation) % 360) + 360) % 360
    }
  })
  return { room, doors, windows, furniture }
}

export function toNeonPlan(doc: SdrawDoc, samples: Sample[] = [], wallM = NEONPLAN_WALL_M): NeonPlanResult {
  // Sdraw đo mép trong phòng; NeonPlan vẽ tường theo tâm. Tài liệu NeonPlan: cộng 0,3 m cho tường ngoài.
  const warnings: string[] = []
  const c = roomContent(doc, samples, wallM, 0, 0, warnings)
  return {
    plan: {
      format: 'neonplan-import',
      units: 'm',
      rooms_at: 'centre',
      source: { app: 'sdrawai', name: doc.name },
      floors: [{ name: doc.name || 'Tầng 1', elevation: 0, height: 2.5, rooms: [c.room], doors: c.doors, windows: c.windows, furniture: c.furniture }]
    },
    warnings: warnings.map((w) => w.replace(`${doc.name}: `, ''))
  }
}

/** Một phòng trong dự án nhiều phòng. floor: 0 = tầng trệt, 1 = tầng 1, -1 = hầm. x, y (mm) là góc trên trái của phòng tính cả tường; bỏ trống thì tự xếp. */
export interface HouseRoom {
  id: string
  floor: number
  x?: number
  y?: number
  doc: SdrawDoc
}

/** Phần cộng từ mép trong tới tâm tường khi nhiều phòng liền nhau (tường trong theo tài liệu NeonPlan). */
export const NEONPLAN_INNER_M = 0.12
export const FLOOR_HEIGHT_M = 2.5

/**
 * Vị trí từng phòng (mm, góc trên trái gồm tường). Phòng chưa đặt vị trí được xếp nối đuôi nhau theo chiều ngang trong cùng tầng,
 * tường chung nằm đúng một đường để NeonPlan coi là hai phòng liền kề.
 */
export function packHouse(rooms: HouseRoom[], wallM = NEONPLAN_INNER_M): Array<{ room: HouseRoom; x: number; y: number }> {
  const wallMm = Math.round(wallM * 1000)
  const right = new Map<number, number>()
  const out: Array<{ room: HouseRoom; x: number; y: number }> = []
  for (const r of rooms) {
    const outW = r.doc.room.widthMm + 2 * wallMm
    const placed = r.x !== undefined && r.y !== undefined
    const x = placed ? (r.x as number) : (right.get(r.floor) ?? 0)
    const y = placed ? (r.y as number) : 0
    right.set(r.floor, Math.max(right.get(r.floor) ?? 0, x + outW))
    out.push({ room: r, x, y })
  }
  return out
}

/** Xuất cả nhà: mỗi tầng một mục, các phòng đặt đúng vị trí, cửa trùng giữa hai phòng chỉ giữ một. */
export function toNeonPlanHouse(rooms: HouseRoom[], samples: Sample[] = [], name = 'Nhà'): NeonPlanResult {
  const warnings: string[] = []
  const floors = new Map<number, Floor>()
  const t = NEONPLAN_INNER_M
  for (const { room, x, y } of packHouse(rooms, t)) {
    let f = floors.get(room.floor)
    if (!f) {
      f = {
        name: room.floor === 0 ? 'Tầng trệt' : room.floor < 0 ? `Hầm ${-room.floor}` : `Tầng ${room.floor}`,
        elevation: r3(room.floor * FLOOR_HEIGHT_M),
        height: FLOOR_HEIGHT_M,
        rooms: [],
        doors: [],
        windows: [],
        furniture: []
      }
      floors.set(room.floor, f)
    }
    const c = roomContent(room.doc, samples, t, m(x), m(y), warnings)
    f.rooms.push(c.room)
    for (const d of c.doors) {
      const dup = f.doors.some((e) => Math.abs(e.at[0] - d.at[0]) <= 0.06 && Math.abs(e.at[1] - d.at[1]) <= 0.06)
      if (!dup) f.doors.push(d)
    }
    f.windows.push(...c.windows)
    f.furniture.push(...c.furniture)
  }
  return {
    plan: {
      format: 'neonplan-import',
      units: 'm',
      rooms_at: 'centre',
      source: { app: 'sdrawai', name },
      floors: [...floors.entries()].sort((a, b) => a[0] - b[0]).map(([, f]) => f)
    },
    warnings
  }
}

function sampleCategory(sampleId: string, samples: Sample[]): string {
  return samples.find((s) => s.id === sampleId)?.category ?? ''
}
