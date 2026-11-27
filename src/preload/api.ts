import type { AiFile } from '../core/aiTools'
import type { Skill } from '../core/skills'
import type { Model3 } from '../core/model3d'
import type { SketchDoc } from '../core/shapes'
import type { Sample, SdrawDoc } from '../core/types'
import type { HouseRoom } from '../core/neonplan'

export interface ImportItem {
  fileName: string
  sample?: Sample
  needsDimensions?: boolean
  warnings?: string[]
  error?: string
}

export interface SourceFolder {
  path: string
  name: string
  /** Mốc lập chỉ mục gần nhất (ms), 0 nếu chưa */
  lastScan: number
  count: number
}

export type ImageProvider = 'socin' | 'lan' | 'drawthings'

export interface ImageSettings {
  provider: ImageProvider
  monthlyLimit: number
  lanHost: string
  lanPort: number
  staffAllowed: boolean
  watermark: boolean
}

export interface Settings {
  serverUrl: string
  token: string
  user: { id: string; name: string; businessId: string; role: string } | null
  folders: SourceFolder[]
  autoDetect: boolean
  autoIndex: boolean
  autoSync: boolean
  /** Theo dõi thư mục nguồn và lập chỉ mục khi có file .skp mới (khi app đang mở) */
  autoWatch: boolean
  /** Tự sao lưu lên máy chủ mỗi ngày (chỉ chủ doanh nghiệp) */
  autoBackup: boolean
  /** Người dùng đã chọn dùng ngoại tuyến (không hiện màn đăng nhập khi mở app) */
  offlineChosen: boolean
  /** Lần sao lưu lên máy chủ gần nhất (ms), do app ghi */
  lastBackupAt: number
  image: ImageSettings
}

export interface ReferenceImage {
  src: string
  width: number
  height: number
  name: string
}

export interface NetResult {
  status: number
  data: unknown
}

export interface ProjectRec {
  id: string
  name: string
  customer: string
  updatedAt: number
  /** Phòng đang mở hoặc phòng đầu tiên; luôn trùng rooms[0].doc khi có rooms */
  doc: SdrawDoc
  /** Dự án nhiều phòng. Bỏ trống = dự án một phòng (doc) */
  rooms?: HouseRoom[]
}

export interface SdrawApi {
  /** Sao lưu kho mẫu và dự án trên máy ra một file .json; null nếu huỷ */
  backupExport(): Promise<{ file: string; samples: number; projects: number } | null>
  /** Khôi phục từ file sao lưu (gộp theo id, không xoá dữ liệu hiện có); null nếu huỷ */
  backupRestore(): Promise<{ samples: number; projects: number } | null>
  /** Sao lưu lên máy chủ VPS (chỉ chủ doanh nghiệp). Server giữ 5 bản mới nhất. */
  /** Đặt ảnh bìa cho gói của doanh nghiệp (data URL JPEG hoặc PNG, tối đa 600 KB). */
  storePutCover(id: string, dataUrl: string): Promise<NetResult>
  /** Lấy ảnh bìa của gói, null nếu không có. */
  storeCover(id: string): Promise<string | null>
  backupPush(): Promise<{ samples: number; projects: number }>
  backupList(): Promise<{ id: number; createdAt: number; size: number; samples: number; projects: number }[]>
  backupPull(id: number): Promise<{ samples: number; projects: number }>
  /** Chọn file .skp và tải lên gói đăng bán trên Store; null nếu huỷ */
  storeUploadFile(listingId: string): Promise<NetResult | null>
  /** Tải file .skp của gói về máy (hỏi nơi lưu); trả về đường dẫn, null nếu huỷ */
  storeDownloadFile(listingId: string, suggestedName: string): Promise<string | null>
  /** Tải file do app tạo (mô hình .sdraw3d) lên gói Store nháp */
  storeUploadData(listingId: string, fileName: string, data: string): Promise<NetResult>
  /** Lấy file mô hình 3D của gói Store (sdraw3d hoặc glb) để mở trong Dựng 3D */
  storeFetch(listingId: string): Promise<{ kind: 'sdraw3d' | 'glb'; name: string; data: Uint8Array }>
  // ---- Cổng tạo hình 3D và công cụ trên máy ----
  gen3dStatus(): Promise<{ providers: { id: string; hasKey: boolean }[]; encryption: boolean }>
  gen3dSetKey(provider: string, key: string | null): Promise<boolean>
  gen3dRun(req: { provider: string; prompt?: string; image?: string }): Promise<Gen3dResultMsg>
  gen3dCancel(): Promise<void>
  onGen3dProgress(cb: (p: { provider: string; progress: number; text: string }) => void): () => void
  toolsStatus(): Promise<ToolsStatusMsg>
  toolsInstall(ids: string[]): Promise<boolean>
  toolsLogs(): Promise<{ t: number; s: string }[]>
  toolsStartHunyuan(): Promise<boolean>
  toolsStopHunyuan(): Promise<boolean>
  toolsOpenUrl(url: string): Promise<void>
  onToolsError(cb: (msg: string) => void): () => void
  /** Mở trang tìm kiếm 3D Warehouse bằng trình duyệt của máy. Người dùng tự đăng nhập và tải bằng tài khoản SketchUp của mình. */
  openWarehouse(query: string): Promise<void>
  listProjects(): Promise<ProjectRec[]>
  saveProject(p: ProjectRec): Promise<void>
  deleteProject(id: string): Promise<void>
  loadCatalog(): Promise<Sample[]>
  saveCatalog(samples: Sample[]): Promise<void>
  /** Mở hộp chọn thư mục, trả về các file .skp tìm thấy; null nếu người dùng huỷ */
  /** Quét lại một thư mục đã thêm (không hỏi hộp thoại) */
  scanPath(path: string): Promise<{ folder: string; paths: string[]; truncated: boolean; cancelled?: boolean } | null>
  /** Dừng lần quét đang chạy; kết quả tìm được đến lúc dừng vẫn được dùng. */
  scanCancel(): Promise<void>
  /** Tiến độ quét thư mục; trả về hàm huỷ đăng ký. */
  onScanProgress(cb: (p: { folder: string; found: number; dirs: number }) => void): () => void
  /** Có file .skp mới hoặc đổi trong thư mục đang theo dõi; trả về hàm huỷ đăng ký. */
  onFolderChanged(cb: (p: { folder: string }) => void): () => void
  /** Cổng MCP cho AI */
  aiStatus(): Promise<AiGatewayStatus>
  aiSetEnabled(on: boolean): Promise<AiGatewayStatus>
  aiNewToken(): Promise<AiGatewayStatus>
  onAiCall(cb: (call: AiCall) => void): () => void
  aiResult(r: { id: number; ok: boolean; text: string; data?: Record<string, unknown>; file?: AiFile }): void
  /** Kho skill */
  listSkills(): Promise<Skill[]>
  saveSkill(s: Skill): Promise<Skill>
  deleteSkill(id: string): Promise<boolean>
  onSkillsChanged(cb: () => void): () => void
  scanFolder(): Promise<{ folder: string; paths: string[]; truncated: boolean } | null>
  openDoc(): Promise<{ doc: SdrawDoc; path: string } | null>
  /** path = null: hỏi nơi lưu. Trả về đường dẫn đã lưu, hoặc null nếu huỷ */
  saveDoc(doc: SdrawDoc, path: string | null): Promise<string | null>
  exportDxf(doc: SdrawDoc): Promise<string | null>
  exportXlsx(doc: SdrawDoc, samples: Sample[]): Promise<string | null>
  exportSketchupJson(doc: SdrawDoc, samples: Sample[]): Promise<string | null>
  /** Xuất file nhập cho NeonPlan 3D (Home Assistant); null nếu huỷ */
  exportNeonPlan(doc: SdrawDoc, samples: Sample[]): Promise<{ file: string; warnings: string[] } | null>
  /** Xuất cả nhà (nhiều phòng, nhiều tầng) cho NeonPlan 3D; null nếu huỷ */
  exportNeonPlanHouse(rooms: HouseRoom[], samples: Sample[], name: string): Promise<{ file: string; warnings: string[] } | null>
  /** Chọn nhiều file (.skp .dxf .svg ảnh .sdraw .sdsketch) và đọc thành mẫu */
  importFiles(): Promise<ImportItem[] | null>
  saveSketch(doc: SketchDoc, path: string | null): Promise<string | null>
  openSketch(): Promise<{ doc: SketchDoc; path: string } | null>
  exportSvg(svg: string, name: string): Promise<string | null>
  /** Lưu mô hình 3D (.sdraw3d); path = null: hỏi nơi lưu */
  saveModel3d(model: Model3, name: string, path: string | null): Promise<string | null>
  openModel3d(): Promise<{ model: Model3; name: string; path: string } | null>
  /** Xuất mô hình 3D: OBJ/STL là văn bản, GLB là nhị phân */
  exportModel3d(kind: 'obj' | 'stl' | 'glb' | 'dxf' | 'svg' | 'pdf', data: string | Uint8Array, name: string): Promise<string | null>
  /** Chọn file .obj, .stl hoặc .glb để đưa vào mô hình */
  importModel3d(): Promise<{ name: string; kind: 'obj' | 'stl' | 'glb'; data: Uint8Array } | null>
  /** Ảnh mặt bằng hoặc ảnh tham khảo để đặt làm nền khi vẽ (PNG/JPG/PDF, tối đa 15 MB; PDF lấy trang đầu) */
  openReferenceImage(): Promise<ReferenceImage | null>
  /** Chọn file .obj hoặc .glb trên máy để xem trước 3D; file không rời máy. */
  /** Đọc lưới 3D của mẫu trong kho (chỉ đường dẫn đã có trong kho); null nếu không đọc được */
  readMesh(path: string): Promise<{ kind: 'obj' | 'glb'; data: Uint8Array } | null>
  openMesh(): Promise<{ path: string; name: string; kind: 'obj' | 'glb'; data: Uint8Array } | null>
  getSettings(): Promise<Settings>
  setSettings(s: Partial<Settings>): Promise<Settings>
  /** Gọi máy chủ Sdraw qua tiến trình chính, tự gắn token */
  /** Tạo ảnh minh hoạ theo nơi đã chọn trong Cài đặt (máy chủ Socin, Draw Things hoặc máy trong văn phòng). */
  generateImage(frame: string, prompt: string): Promise<NetResult>
  net(method: string, path: string, body?: unknown): Promise<NetResult>
}

export interface AiGatewayStatus { enabled: boolean; running: boolean; url: string; token: string; error: string | null; lastCall: string | null }
export interface AiCall { id: number; name: string; args: Record<string, unknown>; skill?: Skill }

export type Gen3dResultMsg = { kind: 'glb'; name: string; data: Uint8Array } | { kind: 'image'; name: string; dataUrl: string }

export interface ToolStatusMsg {
  id: string; name: string; desc: string; ok: boolean; where: string; note: string
  optional: boolean; heavy: string; needs: string[]; auto: boolean
  manual: { text: string; url?: string; cmd?: string } | null
  service: 'running' | 'stopped' | null
}

export interface ToolsStatusMsg {
  platform: string; supported: boolean; pm: string; tools: ToolStatusMsg[]; missing: string[]
  job: { running: boolean; order: string[]; done: string[]; failed: { id: string; error: string }[]; current: string | null } | null
  hunyuanRunning: boolean
}
