import type { SketchDoc } from './shapes'

/** Mọi kích thước tính bằng milimét. Toạ độ: gốc ở góc trên trái của phòng, y hướng xuống. */

export type WallSide = 'top' | 'right' | 'bottom' | 'left'

export interface Room {
  widthMm: number
  depthMm: number
}

export interface Door {
  id: string
  wall: WallSide
  /** Khoảng cách từ đầu tường (góc trên hoặc trái) tới mép cửa */
  offsetMm: number
  widthMm: number
}

/** Cửa sổ trên tường; rèm đi kèm để xuất sang nhà thông minh (rèm điện). */
export interface Window {
  id: string
  wall: WallSide
  offsetMm: number
  widthMm: number
  heightMm: number
  /** Chiều cao từ sàn tới mép dưới cửa sổ */
  sillMm: number
  curtain?: boolean
}

export type PriceMode = 'list' | 'manual' | 'blank'

export interface Item {
  id: string
  sampleId: string
  name: string
  /** Tâm của món */
  cx: number
  cy: number
  w: number
  d: number
  /** Độ, quay theo chiều kim đồng hồ quanh tâm */
  rotation: number
  locked: boolean
  material: string
  priceMode: PriceMode
  /** Chỉ dùng khi priceMode = 'manual' */
  manualPrice?: number
}

export interface SdrawDoc {
  version: 1
  name: string
  room: Room
  doors: Door[]
  /** Cửa sổ; bản vẽ cũ không có trường này */
  windows?: Window[]
  /** Tên Area Home Assistant của phòng (để NeonPlan gắn đèn, rèm, cảm biến tự động) */
  haArea?: string
  items: Item[]
  /** Ảnh mặt bằng làm nền, đã cắt đúng vùng phòng (cùng tỉ lệ với room); chỉ để đối chiếu khi bố trí */
  plan?: PlanImage
}

/** Ảnh nền mặt bằng, data URL JPEG đã thu nhỏ. */
export interface PlanImage {
  src: string
}

/** Một mẫu trong kho (thông số, không chứa file gốc). */
export interface Sample {
  id: string
  name: string
  /** Mô tả do người dùng nhập (chất liệu, phong cách, ghi chú). Ở lại trên máy, không gửi lên hệ thống chung. */
  description?: string
  category: string
  w: number
  d: number
  h: number
  /** Đường dẫn file .skp trên máy người dùng */
  skpPath?: string
  /** Đường dẫn file .obj hoặc .glb trên máy; app đọc lưới khi xuất SketchUp */
  meshPath?: string
  /** Xoay lưới quanh trục đứng (độ, bội của 90) để mặt trước quay về phía y lớn */
  meshRotation?: 0 | 90 | 180 | 270
  /** Giá niêm yết trong bảng giá doanh nghiệp (đồng). Trống = chưa có giá. */
  listPrice?: number
  /** Mẫu quét từ thư mục, kích thước là mặc định, cần người duyệt */
  needsReview?: boolean
  /** Nguồn gốc mẫu */
  origin?: SampleOrigin
  /** Loại file gốc */
  sourceType?: SourceType
  /** Nhãn do người dùng hoặc admin gắn: dùng cho gợi ý và học chung */
  tags?: string[]
  styles?: string[]
  materials?: string[]
  /** Đã được người có quyền duyệt và gắn nhãn */
  labeled?: boolean
  /** Ảnh xem trước trên máy (không gửi lên hệ thống chung) */
  imagePath?: string
  /** Bản phác thảo vector để mở lại sửa */
  sketch?: SketchDoc
}

export type SampleOrigin = 'seed' | 'scan' | 'upload' | 'sketch' | 'store'
export type SourceType = 'mesh' | 'skp' | 'dxf' | 'svg' | 'image' | 'sdraw' | 'sketch'

export type PriceSource = 'list' | 'manual' | 'blank'

export interface BomRow {
  itemId: string
  index: number
  name: string
  sizeText: string
  material: string
  quantity: 1
  unitPrice: number | null
  source: PriceSource
}

export interface Bom {
  rows: BomRow[]
  /** Tổng các món đã có giá */
  total: number
  /** Số món chưa báo giá (không tính vào total) */
  unpriced: number
}

export type IssueKind = 'collision' | 'outOfRoom' | 'doorBlocked'

export interface Issue {
  kind: IssueKind
  itemIds: string[]
  message: string
}

/** Lệnh sửa bản vẽ. Chat AI sau này cũng chỉ được phát ra các lệnh này. */
export type Op =
  | { op: 'add'; sample: Sample; cx: number; cy: number; rotation?: number }
  | { op: 'move'; id: string; cx: number; cy: number }
  | { op: 'nudge'; id: string; dx: number; dy: number }
  | { op: 'rotate'; id: string; rotation: number }
  | { op: 'replace'; id: string; sample: Sample }
  | { op: 'remove'; id: string }
  | { op: 'setMaterial'; id: string; material: string }

export interface SkippedOp {
  op: Op
  reason: 'locked' | 'notFound'
}

export interface ApplyResult {
  doc: SdrawDoc
  applied: Op[]
  skipped: SkippedOp[]
}
