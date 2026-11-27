/**
 * Cổng tạo hình 3D bằng AI: danh sách nhà cung cấp (đám mây có khoá API, hoặc chạy trên máy),
 * hướng dẫn kết nối từng bước, và các hàm đọc phản hồi (thuần, có test). Phần gọi mạng ở src/main/gen3d.ts.
 * Thêm nhà cung cấp: thêm một mục vào GEN3D_PROVIDERS và một nhánh chạy trong main.
 */

export type Gen3dProviderId = 'tripo' | 'meshy' | 'hunyuan-local' | 'drawthings'
export type Gen3dInput = 'text' | 'image'

export interface Gen3dProvider {
  id: Gen3dProviderId
  name: string
  /** cloud: cần khoá API, có phí theo lượt; local: chạy trên máy, không gửi dữ liệu ra ngoài */
  where: 'cloud' | 'local'
  inputs: Gen3dInput[]
  /** glb: ra mô hình 3D; image: ra ảnh (ảnh ý tưởng, ảnh vân) */
  output: 'glb' | 'image'
  desc: string
  /** Công cụ trên máy cần có (id trong danh sách công cụ của main/tools.ts) */
  tool?: string
  /** Địa chỉ dịch vụ trên máy */
  localUrl?: string
  keyUrl?: string
  guide: string[]
}

export const GEN3D_PROVIDERS: Gen3dProvider[] = [
  {
    id: 'hunyuan-local', name: 'Hunyuan3D-2 (trên máy)', where: 'local', inputs: ['image', 'text'], output: 'glb', tool: 'hunyuan', localUrl: 'http://127.0.0.1:8081',
    desc: 'Mô hình mở của Tencent, chạy trên máy: ảnh hoặc mô tả thành GLB. Cần Mac Apple Silicon (M1 trở lên) hoặc card NVIDIA, khoảng 10 GB ổ đĩa.',
    guide: [
      'Bấm "Cài tự động" ở mục Hunyuan3D-2 trong phần Công cụ trên máy (tải mã nguồn và thư viện, khoảng 5 GB).',
      'Bấm "Chạy máy chủ Hunyuan". Lần đầu chạy sẽ tải thêm mô hình AI (vài GB), đợi tới khi trạng thái báo "đang chạy".',
      'Chọn ảnh sản phẩm nền trơn (tốt nhất là PNG nền trong suốt) hoặc gõ mô tả, rồi bấm Tạo.'
    ]
  },
  {
    id: 'tripo', name: 'Tripo', where: 'cloud', inputs: ['text', 'image'], output: 'glb', keyUrl: 'https://platform.tripo3d.ai/api-keys',
    desc: 'Dịch vụ đám mây, nhanh, có vân PBR. Trả phí theo lượt bằng tài khoản Tripo của bạn.',
    guide: [
      'Mở platform.tripo3d.ai, đăng ký hoặc đăng nhập.',
      'Vào mục API Keys, bấm tạo khoá mới (khoá bắt đầu bằng "tsk_").',
      'Nạp credit nếu tài khoản chưa có.',
      'Dán khoá vào ô bên dưới rồi bấm Lưu khoá. Khoá được mã hoá và chỉ lưu trên máy này.'
    ]
  },
  {
    id: 'meshy', name: 'Meshy', where: 'cloud', inputs: ['text', 'image'], output: 'glb', keyUrl: 'https://www.meshy.ai/settings/api',
    desc: 'Dịch vụ đám mây, ảnh hoặc mô tả thành mô hình có vân. Trả phí theo lượt bằng tài khoản Meshy của bạn.',
    guide: [
      'Mở meshy.ai, đăng nhập, vào Settings, mục API.',
      'Bấm Create API Key và chép khoá (bắt đầu bằng "msy_").',
      'Dán khoá vào ô bên dưới rồi bấm Lưu khoá. Khoá được mã hoá và chỉ lưu trên máy này.'
    ]
  },
  {
    id: 'drawthings', name: 'Draw Things (ảnh ý tưởng, ảnh vân)', where: 'local', inputs: ['text'], output: 'image', tool: 'drawthings', localUrl: 'http://127.0.0.1:7860',
    desc: 'Vẽ ảnh bằng AI ngay trên Mac, không cần mạng. Dùng làm ảnh ý tưởng để dựng 3D, hoặc làm ảnh vân vật liệu.',
    guide: [
      'Bấm "Cài tự động" ở mục Draw Things (hoặc tải từ App Store).',
      'Mở Draw Things, tải một mô hình vẽ ảnh (ví dụ SDXL hoặc FLUX) ở mục Model.',
      'Mở Settings (bánh răng), bật API Server, chọn HTTP, cổng 7860.',
      'Quay lại đây, bấm Kiểm tra lại: trạng thái báo "đang chạy" là dùng được.'
    ]
  }
]

export const providerById = (id: string): Gen3dProvider | undefined => GEN3D_PROVIDERS.find((p) => p.id === id)

/** Kiểm tra khoá có đúng dạng không (không gửi đi đâu). */
export function validKey(id: Gen3dProviderId, key: string): boolean {
  const k = key.trim()
  if (k.length < 16 || k.length > 200 || /\s/.test(k)) return false
  if (id === 'tripo') return /^tsk_/.test(k)
  if (id === 'meshy') return /^msy_/.test(k)
  return false
}

/** Ảnh đầu vào: data URL PNG/JPEG/WebP, tối đa 20 MB. Trả về loại và byte. */
export function parseImageDataUrl(src: string): { mime: string; bytes: Uint8Array<ArrayBuffer> } {
  const m = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(src)
  if (!m) throw new Error('Ảnh phải là PNG, JPEG hoặc WebP')
  const bin = atob(m[2]!)
  if (bin.length > 20 * 1024 * 1024) throw new Error('Ảnh lớn hơn 20 MB')
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return { mime: m[1]!, bytes }
}

export type JobState = { state: 'running'; progress: number } | { state: 'done'; url: string } | { state: 'failed'; error: string }

/** Đọc trạng thái việc Tripo (GET /v3/tasks/:id). */
export function parseTripoTask(json: unknown): JobState {
  const d = (json as { data?: Record<string, unknown> })?.data
  if (!d) return { state: 'failed', error: 'Tripo trả về dữ liệu lạ' }
  const st = String(d['status'] ?? 'unknown')
  if (st === 'success') {
    const out = (d['output'] ?? {}) as Record<string, unknown>
    const url = out['model_url'] ?? out['pbr_model'] ?? out['model']
    return typeof url === 'string' && url ? { state: 'done', url } : { state: 'failed', error: 'Tripo xong nhưng không có tệp mô hình' }
  }
  if (st === 'queued' || st === 'running' || st === 'unknown') return { state: 'running', progress: Number(d['progress']) || 0 }
  return { state: 'failed', error: `Tripo báo ${st}${d['error_message'] ? `: ${String(d['error_message'])}` : ''}` }
}

/** Đọc trạng thái việc Meshy (GET /openapi/v1/image-to-3d/:id hoặc v2/text-to-3d/:id). */
export function parseMeshyTask(json: unknown): JobState {
  const d = json as Record<string, unknown> | null
  if (!d || typeof d !== 'object') return { state: 'failed', error: 'Meshy trả về dữ liệu lạ' }
  const st = String(d['status'] ?? '')
  if (st === 'SUCCEEDED') {
    const url = (d['model_urls'] as Record<string, unknown> | undefined)?.['glb']
    return typeof url === 'string' && url ? { state: 'done', url } : { state: 'failed', error: 'Meshy xong nhưng không có tệp GLB' }
  }
  if (st === 'PENDING' || st === 'IN_PROGRESS') return { state: 'running', progress: Number(d['progress']) || 0 }
  const err = (d['task_error'] as { message?: string } | undefined)?.message
  return { state: 'failed', error: `Meshy báo ${st || 'lỗi'}${err ? `: ${err}` : ''}` }
}

/** Tệp GLB hợp lệ (đầu "glTF", bản 2). */
export function isGlb(b: Uint8Array): boolean {
  return b.length > 20 && b[0] === 0x67 && b[1] === 0x6c && b[2] === 0x54 && b[3] === 0x46 && b[4] === 2
}

/** Chỉ tải tệp kết quả qua https từ máy chủ ngoài (không cho trỏ về mạng nội bộ). */
export function safeResultUrl(u: string): boolean {
  try {
    const url = new URL(u)
    if (url.protocol !== 'https:') return false
    const h = url.hostname
    return !(h === 'localhost' || /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h) || h.endsWith('.local') || h.includes(':'))
  } catch {
    return false
  }
}
