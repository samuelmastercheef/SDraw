import { itemFromSample } from './commands'
import { corners, doorClearZone, polygonsOverlap, type Pt } from './geometry'
import { normalize } from './suggest'
import type { Item, Sample, SdrawDoc, WallSide } from './types'

/**
 * Tự xếp mẫu vào phòng theo quy tắc cố định (không đoán, không ngẫu nhiên):
 * - Đồ dựa tường (sofa, tủ, giường, kệ, bàn làm việc…): lưng sát tường, mặt hướng vào phòng.
 *   Quy ước: mặt trước của món ở phía +y khi góc quay 0, lưng ở phía −y.
 * - Đồ đặt giữa (bàn ăn, bàn trà, ghế…): gần tâm phòng, chừa lối đi.
 * - Không chồng nhau, không ra ngoài phòng, không chắn cửa. Món đã có (kể cả đã khoá) giữ nguyên.
 * - Món nào không còn chỗ thì không đặt và được báo lại, không ép vào.
 */
const WALL_WORDS = ['sofa', 'tu', 'giuong', 'ke', 'tivi', 'ban lam viec', 'ban trang diem', 'ban console', 'bep']
const WALL_GAP = 20
const WALK = 450
const STEP = 100

export function placement(sample: Pick<Sample, 'category' | 'name'>): 'wall' | 'center' {
  const c = normalize(sample.category)
  return WALL_WORDS.some((w) => c === w || c.startsWith(`${w} `) || c.includes(` ${w}`)) ? 'wall' : 'center'
}

const ROT: Record<WallSide, number> = { top: 0, right: 90, bottom: 180, left: 270 }

/** Khoảng cách tâm → tường để lưng món chạm tường (sau khi quay, chiều sâu d nằm vuông góc tường). */
function wallPose(side: WallSide, w: number, d: number, along: number, room: { widthMm: number; depthMm: number }) {
  switch (side) {
    case 'top': return { cx: along, cy: d / 2 + WALL_GAP, rotation: ROT.top }
    case 'bottom': return { cx: along, cy: room.depthMm - d / 2 - WALL_GAP, rotation: ROT.bottom }
    case 'left': return { cx: d / 2 + WALL_GAP, cy: along, rotation: ROT.left }
    case 'right': return { cx: room.widthMm - d / 2 - WALL_GAP, cy: along, rotation: ROT.right }
  }
}

const inflate = (it: Pick<Item, 'cx' | 'cy' | 'w' | 'd' | 'rotation'>, by: number): Pt[] =>
  corners({ ...it, w: it.w + 2 * by, d: it.d + 2 * by })

function fits(poly: Pt[], room: SdrawDoc['room']): boolean {
  return poly.every((p) => p.x >= -0.5 && p.y >= -0.5 && p.x <= room.widthMm + 0.5 && p.y <= room.depthMm + 0.5)
}

const isCoffeeTable = (s: Pick<Sample, 'category'>): boolean => normalize(s.category).startsWith('ban tra')
const isDiningTable = (s: Pick<Sample, 'category'>): boolean => normalize(s.category).startsWith('ban an')
const isChair = (s: Pick<Sample, 'category'>): boolean => /^ghe( |$)/.test(normalize(s.category)) && !normalize(s.category).includes('sofa')
const isSofa = (s: Pick<Sample, 'category'>): boolean => normalize(s.category).startsWith('sofa')

export interface LayoutResult {
  doc: SdrawDoc
  placed: string[]
  unplaced: string[]
}

export function autoLayout(doc: SdrawDoc, samples: Sample[], opts: { chairs?: number } = {}): LayoutResult {
  const { room } = doc
  const zones = doc.doors.map((d) => doorClearZone(d, room))
  const doorWalls = new Set(doc.doors.map((d) => d.wall))
  const sides: WallSide[] = (['top', 'right', 'bottom', 'left'] as WallSide[]).sort((a, b) => {
    const da = doorWalls.has(a) ? 1 : 0, db = doorWalls.has(b) ? 1 : 0
    const la = a === 'top' || a === 'bottom' ? room.widthMm : room.depthMm
    const lb = b === 'top' || b === 'bottom' ? room.widthMm : room.depthMm
    return da - db || lb - la || a.localeCompare(b)
  })

  const items = doc.items.slice()
  const placed: string[] = []
  const unplaced: string[] = []
  // Đồ lớn trước, đồ dựa tường trước đồ đặt giữa.
  const order = [...samples].sort((a, b) => {
    const pa = placement(a) === 'wall' ? 0 : 1, pb = placement(b) === 'wall' ? 0 : 1
    return pa - pb || b.w * b.d - a.w * a.d || a.id.localeCompare(b.id)
  })

  const free = (c: Pick<Item, 'cx' | 'cy' | 'w' | 'd' | 'rotation'>, gap: number): boolean => {
    const poly = corners(c)
    if (!fits(poly, room)) return false
    if (zones.some((z) => polygonsOverlap(poly, z))) return false
    return !items.some((o) => polygonsOverlap(inflate(c, gap), corners(o)))
  }

  const placedSofas = new Set<string>()
  const tables: { item: Item }[] = []
  const chairsViaTable = samples.some(isDiningTable) && samples.some(isChair)
  for (const s of order) {
    if (chairsViaTable && isChair(s)) continue
    let found: Item | null = null
    if (placement(s) === 'wall') {
      search: for (const side of sides) {
        const len = side === 'top' || side === 'bottom' ? room.widthMm : room.depthMm
        for (let along = s.w / 2 + WALL_GAP; along <= len - s.w / 2 - WALL_GAP + 0.5; along += STEP) {
          const pose = wallPose(side, s.w, s.d, along, room)
          if (free({ ...pose, w: s.w, d: s.d }, 0)) { found = itemFromSample(s, pose.cx, pose.cy, pose.rotation); break search }
        }
      }
    } else {
      const sofaIt = isCoffeeTable(s) ? items.find((it) => placedSofas.has(it.id)) : undefined
      if (sofaIt) {
        // Bàn trà: ngay trước sofa, cách 450 mm, cùng hướng.
        const a = (sofaIt.rotation * Math.PI) / 180
        const dist = sofaIt.d / 2 + 450 + s.d / 2
        const c = { cx: sofaIt.cx - Math.sin(a) * dist, cy: sofaIt.cy + Math.cos(a) * dist, w: s.w, d: s.d, rotation: sofaIt.rotation }
        if (free(c, 0)) found = itemFromSample(s, c.cx, c.cy, c.rotation)
      }
      if (!found) {
        const hasChair = isDiningTable(s) && samples.some(isChair)
        const chairD = hasChair ? Math.max(...samples.filter(isChair).map((x) => x.d)) : 0
        const gap = WALK / 2 + (hasChair ? chairD + 50 : 0)
        const cands: { cx: number; cy: number }[] = []
        for (let x = s.w / 2; x <= room.widthMm - s.w / 2; x += 250) for (let y = s.d / 2; y <= room.depthMm - s.d / 2; y += 250) cands.push({ cx: x, cy: y })
        const c0 = { x: room.widthMm / 2, y: room.depthMm / 2 }
        cands.sort((a, b) => Math.hypot(a.cx - c0.x, a.cy - c0.y) - Math.hypot(b.cx - c0.x, b.cy - c0.y) || a.cx - b.cx || a.cy - b.cy)
        for (const c of cands) {
          if (free({ ...c, w: s.w, d: s.d, rotation: 0 }, gap)) { found = itemFromSample(s, c.cx, c.cy, 0); break }
        }
      }
    }
    if (found) {
      items.push(found); placed.push(found.id)
      if (isSofa(s)) placedSofas.add(found.id)
      if (isDiningTable(s)) tables.push({ item: found })
    } else unplaced.push(s.name)
  }

  // Ghế quanh bàn ăn: chia đều hai cạnh dài, mặt ghế hướng vào bàn. Chỗ nào vướng thì bỏ chỗ đó.
  const chair = samples.find(isChair)
  if (chair && tables.length > 0) {
    const want = Math.max(0, Math.min(8, opts.chairs ?? 4))
    const { item: t } = tables[0]!
    const a = (t.rotation * Math.PI) / 180
    const ux = Math.cos(a), uy = Math.sin(a) // dọc theo bàn
    const vx = -Math.sin(a), vy = Math.cos(a) // vuông góc bàn
    const perSide = [Math.ceil(want / 2), Math.floor(want / 2)]
    let made = 0
    ;[-1, 1].forEach((side, k) => {
      const n = perSide[k]!
      for (let i = 0; i < n; i++) {
        const off = ((i + 0.5) / n - 0.5) * t.w
        const dist = t.d / 2 + chair.d / 2 + 50
        const cx = t.cx + ux * off + vx * dist * side, cy = t.cy + uy * off + vy * dist * side
        const rotation = (t.rotation + (side === -1 ? 0 : 180)) % 360 // phía −v: mặt trước (+v) hướng vào bàn
        if (free({ cx, cy, w: chair.w, d: chair.d, rotation }, 0)) { const it = itemFromSample(chair, cx, cy, rotation); items.push(it); placed.push(it.id); made++ }
      }
    })
    if (made < want) unplaced.push(`${chair.name} (${want - made} chỗ không vừa)`)
  }

  return { doc: { ...doc, items }, placed, unplaced }
}
