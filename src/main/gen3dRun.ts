/**
 * Chạy một lượt tạo hình 3D qua nhà cung cấp đã chọn. Không phụ thuộc Electron để test được.
 * Khoá API do main đọc (đã giải mã) và truyền vào; renderer không bao giờ thấy khoá.
 */
import { isGlb, parseImageDataUrl, parseMeshyTask, parseTripoTask, providerById, safeResultUrl, type Gen3dProviderId, type JobState } from '../core/gen3d'

export interface Gen3dRequest {
  provider: Gen3dProviderId
  prompt?: string
  /** data URL ảnh đầu vào */
  image?: string
}

export type Gen3dResult = { kind: 'glb'; name: string; data: Uint8Array } | { kind: 'image'; name: string; dataUrl: string }

export interface Gen3dDeps {
  key: (id: Gen3dProviderId) => Promise<string | null>
  fetchImpl?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  onProgress?: (p: { provider: string; progress: number; text: string }) => void
  /** Hết giờ chờ (ms) */
  timeoutMs?: number
  signal?: AbortSignal
}

export const TRIPO_BASE = 'https://openapi.tripo3d.com/v3'
export const TRIPO_MODEL = 'v3.1-20260211'
export const MESHY_BASE = 'https://api.meshy.ai'
const MAX_GLB = 150 * 1024 * 1024

const slug = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').replace(/[^\w]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'mo-hinh-ai'

export async function runGen3d(req: Gen3dRequest, deps: Gen3dDeps): Promise<Gen3dResult> {
  const p = providerById(req.provider)
  if (!p) throw new Error('Không có nhà cung cấp này')
  const prompt = (req.prompt ?? '').trim().slice(0, 1000)
  const image = req.image ? parseImageDataUrl(req.image) : null
  if (!prompt && !image) throw new Error('Cần mô tả hoặc ảnh')
  if (image && !p.inputs.includes('image')) throw new Error(`${p.name} không nhận ảnh`)
  if (!image && !p.inputs.includes('text')) throw new Error(`${p.name} cần ảnh đầu vào`)
  const f = deps.fetchImpl ?? fetch
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const progress = (n: number, text: string) => deps.onProgress?.({ provider: p.id, progress: Math.max(0, Math.min(100, Math.round(n))), text })
  const name = slug(prompt || 'anh')
  const deadline = Date.now() + (deps.timeoutMs ?? 15 * 60_000)

  const needKey = async () => {
    const k = await deps.key(p.id)
    if (!k) throw new Error(`Chưa có khoá API ${p.name}. Làm theo hướng dẫn để lấy khoá rồi dán vào.`)
    return k
  }
  const errOf = async (res: Response, who: string) => {
    const j = (await res.json().catch(() => ({}))) as Record<string, unknown>
    const msg = (j['message'] ?? (j['error'] as { message?: string } | undefined)?.message ?? j['error']) as string | undefined
    if (res.status === 401 || res.status === 403) return new Error(`${who} từ chối khoá API (mã ${res.status}). Kiểm tra lại khoá.`)
    if (res.status === 402 || res.status === 429) return new Error(`${who}: hết credit hoặc gọi quá nhiều (mã ${res.status}).`)
    return new Error(`${who} lỗi ${res.status}${msg ? `: ${String(msg).slice(0, 200)}` : ''}`)
  }
  const poll = async (get: () => Promise<JobState>): Promise<string> => {
    for (let i = 0; ; i++) {
      if (deps.signal?.aborted) throw new Error('Đã huỷ')
      if (Date.now() > deadline) throw new Error('Quá lâu chưa xong, thử lại sau')
      const st = await get()
      if (st.state === 'done') return st.url
      if (st.state === 'failed') throw new Error(st.error)
      progress(st.progress, `${p.name} đang dựng… ${st.progress}%`)
      await sleep(i < 5 ? 2000 : 5000)
    }
  }
  const download = async (url: string): Promise<Uint8Array> => {
    if (!safeResultUrl(url)) throw new Error('Địa chỉ tệp kết quả không an toàn')
    progress(95, 'Đang tải mô hình về…')
    const res = await f(url, { signal: AbortSignal.timeout(300_000) })
    if (!res.ok) throw new Error(`Tải mô hình lỗi ${res.status}`)
    const buf = new Uint8Array(await res.arrayBuffer())
    if (buf.length > MAX_GLB) throw new Error('Mô hình lớn hơn 150 MB')
    if (!isGlb(buf)) throw new Error('Tệp tải về không phải GLB')
    return buf
  }

  if (p.id === 'tripo') {
    const key = await needKey()
    const auth = { authorization: `Bearer ${key}` }
    let body: Record<string, unknown>
    let path: string
    if (image) {
      progress(2, 'Đang gửi ảnh lên Tripo…')
      const fd = new FormData()
      fd.append('file', new Blob([image.bytes], { type: image.mime }), `anh.${image.mime.split('/')[1]}`)
      const up = await f(`${TRIPO_BASE}/files`, { method: 'POST', headers: auth, body: fd })
      if (!up.ok) throw await errOf(up, 'Tripo')
      const token = ((await up.json()) as { data?: { file_token?: string } }).data?.file_token
      if (!token) throw new Error('Tripo không trả mã tệp')
      path = '/generation/image-to-model'
      body = { input: token, model: TRIPO_MODEL, texture: true, pbr: true }
    } else {
      path = '/generation/text-to-model'
      body = { prompt, model: TRIPO_MODEL, texture: true, pbr: true }
    }
    const res = await f(`${TRIPO_BASE}${path}`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify(body) })
    if (!res.ok) throw await errOf(res, 'Tripo')
    const taskId = ((await res.json()) as { data?: { task_id?: string } }).data?.task_id
    if (!taskId || !/^[\w-]{1,100}$/.test(taskId)) throw new Error('Tripo không trả mã việc')
    const url = await poll(async () => {
      const r = await f(`${TRIPO_BASE}/tasks/${taskId}`, { headers: auth })
      if (!r.ok) throw await errOf(r, 'Tripo')
      return parseTripoTask(await r.json())
    })
    return { kind: 'glb', name: `${name}.glb`, data: await download(url) }
  }

  if (p.id === 'meshy') {
    const key = await needKey()
    const headers = { authorization: `Bearer ${key}`, 'content-type': 'application/json' }
    const [create, get] = image
      ? [`${MESHY_BASE}/openapi/v1/image-to-3d`, `${MESHY_BASE}/openapi/v1/image-to-3d/`]
      : [`${MESHY_BASE}/openapi/v2/text-to-3d`, `${MESHY_BASE}/openapi/v2/text-to-3d/`]
    const body = image ? { image_url: req.image, should_texture: true, target_formats: ['glb'] } : { mode: 'preview', prompt, target_formats: ['glb'] }
    const res = await f(create, { method: 'POST', headers, body: JSON.stringify(body) })
    if (!res.ok) throw await errOf(res, 'Meshy')
    const id = ((await res.json()) as { result?: string }).result
    if (!id || !/^[\w-]{1,100}$/.test(id)) throw new Error('Meshy không trả mã việc')
    const url = await poll(async () => {
      const r = await f(get + id, { headers })
      if (!r.ok) throw await errOf(r, 'Meshy')
      return parseMeshyTask(await r.json())
    })
    return { kind: 'glb', name: `${name}.glb`, data: await download(url) }
  }

  if (p.id === 'hunyuan-local') {
    progress(5, 'Hunyuan3D đang dựng trên máy (vài phút)…')
    let res: Response
    try {
      res = await f(`${p.localUrl}/generate`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(image ? { image: req.image!.split(',')[1], type: 'glb' } : { text: prompt, type: 'glb' }),
        signal: AbortSignal.timeout(deps.timeoutMs ?? 15 * 60_000)
      })
    } catch { throw new Error('Máy chủ Hunyuan3D chưa chạy. Bấm "Chạy máy chủ Hunyuan" rồi thử lại.') }
    if (!res.ok) throw new Error(`Hunyuan3D lỗi ${res.status}`)
    const buf = new Uint8Array(await res.arrayBuffer())
    if (!isGlb(buf)) throw new Error('Hunyuan3D không trả tệp GLB')
    return { kind: 'glb', name: `${name}.glb`, data: buf }
  }

  // Draw Things: giao thức kiểu Automatic1111
  progress(5, 'Draw Things đang vẽ…')
  let res: Response
  try {
    res = await f(`${p.localUrl}/sdapi/v1/txt2img`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt, width: 768, height: 768, steps: 20 }), signal: AbortSignal.timeout(600_000) })
  } catch { throw new Error('Draw Things chưa bật API Server (Settings, API Server, HTTP, cổng 7860).') }
  if (!res.ok) throw new Error(`Draw Things lỗi ${res.status}`)
  const b64 = ((await res.json()) as { images?: string[] }).images?.[0]
  if (!b64 || !/^[A-Za-z0-9+/=]+$/.test(b64)) throw new Error('Draw Things không trả ảnh')
  return { kind: 'image', name: `${name}.png`, dataUrl: `data:image/png;base64,${b64}` }
}
