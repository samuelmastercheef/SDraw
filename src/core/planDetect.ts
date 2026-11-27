import type { Door, WallSide } from './types'

/** Ảnh xám: mỗi điểm ảnh một giá trị sáng 0 (đen) đến 255 (trắng). */
export interface Gray {
  width: number
  height: number
  data: ArrayLike<number>
}

export interface DetectedPlan {
  /** Góc trong của phòng (mép trong tường), điểm ảnh */
  x0: number
  y0: number
  x1: number
  y1: number
  /** Cửa là các khoảng hở trên tường ngoài, tính bằng mm theo mmPerPx đã cho */
  doors: Omit<Door, 'id'>[]
}

const DARK = 110
/** Khoảng hở trên tường coi là cửa: từ 600 đến 1500 mm. */
const DOOR_MIN_MM = 600
const DOOR_MAX_MM = 1500

interface Group { first: number; last: number }

/** Gom các chỉ số liên tiếp (cho phép hở 1) thành nhóm. */
function groups(flags: boolean[]): Group[] {
  const out: Group[] = []
  let cur: Group | null = null
  for (let i = 0; i < flags.length; i++) {
    if (flags[i]) {
      if (cur && i - cur.last <= 2) cur.last = i
      else { cur = { first: i, last: i }; out.push(cur) }
    }
  }
  return out
}

/**
 * Tìm phòng hình chữ nhật trên bản vẽ mặt bằng nét đen nền sáng: tường là các đường tối dài nhất ở rìa.
 * Chỉ là gợi ý để người dùng kiểm tra; trả về null nếu không thấy bốn tường rõ ràng.
 */
export function detectPlan(g: Gray, mmPerPx: number): DetectedPlan | null {
  const { width: W, height: H, data } = g
  if (W < 40 || H < 40 || !(mmPerPx > 0)) return null
  const dark = (x: number, y: number): boolean => (data[y * W + x] ?? 255) < DARK
  const col = new Array<number>(W).fill(0)
  const row = new Array<number>(H).fill(0)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (dark(x, y)) { col[x]! += 1; row[y]! += 1 }
  const maxC = Math.max(...col), maxR = Math.max(...row)
  if (maxC < 20 || maxR < 20) return null
  const gx = groups(col.map((v) => v >= maxC * 0.5))
  const gy = groups(row.map((v) => v >= maxR * 0.5))
  if (gx.length < 2 || gy.length < 2) return null
  const L = gx[0]!, R = gx[gx.length - 1]!, T = gy[0]!, B = gy[gy.length - 1]!
  // Mép trong tường
  const x0 = L.last + 1, x1 = R.first - 1, y0 = T.last + 1, y1 = B.first - 1
  if (x1 - x0 < 20 || y1 - y0 < 20) return null

  const doors: Omit<Door, 'id'>[] = []
  // Khoảng hở dọc theo một tường: những điểm trong dải tường không có điểm tối nào.
  const scan = (wall: WallSide, band: Group, from: number, to: number, horizontal: boolean): void => {
    let start = -1
    const flush = (end: number): void => {
      if (start < 0) return
      const mm = (end - start) * mmPerPx
      if (mm >= DOOR_MIN_MM && mm <= DOOR_MAX_MM) doors.push({ wall, offsetMm: Math.round(((start - from) * mmPerPx) / 10) * 10, widthMm: Math.round(mm / 10) * 10 })
      start = -1
    }
    for (let p = from; p <= to; p++) {
      let any = false
      for (let b = band.first; b <= band.last && !any; b++) any = horizontal ? dark(p, b) : dark(b, p)
      if (!any) { if (start < 0) start = p } else flush(p)
    }
    flush(to + 1)
  }
  scan('top', T, x0, x1, true)
  scan('bottom', B, x0, x1, true)
  scan('left', L, y0, y1, false)
  scan('right', R, y0, y1, false)
  return { x0, y0, x1, y1, doors }
}
