import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { registerAiGateway } from './aiGateway'
import { registerGen3d } from './gen3dIpc'
import { watch, type FSWatcher } from 'node:fs'
import { readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { SEED_SAMPLES } from '../core/catalog'
import { DEFAULT_SERVER_URL } from '../core/server'
import { toDxf } from '../core/dxf'
import { IMPORT_EXTENSIONS, extensionOf, imagePixelSize, importFile, importLibrary } from '../core/importers'
import { isUnderlay, type SketchDoc } from '../core/shapes'
import type { ImageSettings, ImportItem, SourceFolder, NetResult, ProjectRec, ReferenceImage, Settings } from '../preload/api'
import { toSketchupPlan } from '../core/sketchup'
import { toNeonPlan, toNeonPlanHouse, type HouseRoom } from '../core/neonplan'
import { parseGlb, parseObj, type Mesh } from '../core/mesh'
import { isModel3, type Model3 } from '../core/model3d'
import type { Sample, SdrawDoc } from '../core/types'
import { writeBomXlsx } from './xlsx'

const MAX_SCAN_FILES = 20_000
const MAX_SCAN_DEPTH = 12

function catalogFile(): string {
  return join(app.getPath('userData'), 'catalog.json')
}

function cleanRooms(value: unknown): HouseRoom[] | undefined {
  if (!Array.isArray(value)) return undefined
  const out: HouseRoom[] = []
  for (const r of value.slice(0, 40) as HouseRoom[]) {
    if (!r || typeof r.id !== 'string' || !Number.isFinite(r.floor) || !isDoc(r.doc)) continue
    const rec: HouseRoom = { id: r.id.slice(0, 64), floor: Math.max(-5, Math.min(60, Math.round(r.floor))), doc: r.doc }
    if (Number.isFinite(r.x) && Number.isFinite(r.y)) { rec.x = r.x; rec.y = r.y }
    out.push(rec)
  }
  return out.length ? out : undefined
}

function isDoc(value: unknown): value is SdrawDoc {
  const d = value as SdrawDoc | null
  return (
    !!d &&
    d.version === 1 &&
    typeof d.name === 'string' &&
    typeof d.room?.widthMm === 'number' &&
    typeof d.room?.depthMm === 'number' &&
    Array.isArray(d.items) &&
    Array.isArray(d.doors)
  )
}

/** Cờ dừng quét do người dùng bấm; đặt lại mỗi lần bắt đầu quét. */
let scanCancelled = false
let scanDirs = 0
let scanProgress: ((found: number, dirs: number) => void) | null = null

async function walk(dir: string, depth: number, out: string[]): Promise<boolean> {
  if (depth > MAX_SCAN_DEPTH || scanCancelled) return false
  scanDirs += 1
  scanProgress?.(out.length, scanDirs)
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return false
  }
  for (const e of entries) {
    if (out.length >= MAX_SCAN_FILES) return true
    if (e.name.startsWith('.')) continue
    const full = join(dir, e.name)
    if (e.isDirectory()) {
      if (await walk(full, depth + 1, out)) return true
    } else if (e.isFile() && /\.skp$/i.test(e.name)) {
      out.push(full)
    }
  }
  return false
}

function registerIpc(win: () => BrowserWindow | null): void {
  ipcMain.handle('catalog:load', async (): Promise<Sample[]> => {
    try {
      const parsed = JSON.parse(await readFile(catalogFile(), 'utf8')) as unknown
      if (Array.isArray(parsed)) return parsed as Sample[]
    } catch {
      /* chưa có kho: dùng mẫu minh hoạ */
    }
    return SEED_SAMPLES
  })

  ipcMain.handle('catalog:save', async (_e, samples: Sample[]) => {
    await writeFile(catalogFile(), JSON.stringify(samples, null, 2), 'utf8')
  })

  ipcMain.handle('catalog:scan', async () => {
    const w = win()
    if (!w) return null
    const res = await dialog.showOpenDialog(w, {
      title: 'Chọn thư mục chứa mẫu SketchUp',
      properties: ['openDirectory']
    })
    const folder = res.filePaths[0]
    if (res.canceled || !folder) return null
    const paths: string[] = []
    const truncated = await walk(folder, 0, paths)
    return { folder, paths, truncated }
  })

  ipcMain.handle('catalog:scanPath', async (_e, folder: string) => {
    const known = (await readSettings()).folders.some((f) => f.path === folder)
    if (!known) throw new Error('Thư mục chưa được thêm vào nguồn dữ liệu')
    const paths: string[] = []
    scanCancelled = false
    scanDirs = 0
    let last = 0
    scanProgress = (found, dirs) => {
      const t = Date.now()
      if (t - last < 150) return
      last = t
      win()?.webContents.send('scan:progress', { folder, found, dirs })
    }
    try {
      const truncated = await walk(folder, 0, paths)
      return { folder, paths, truncated, cancelled: scanCancelled }
    } finally {
      scanProgress = null
    }
  })
  ipcMain.handle('scan:cancel', () => { scanCancelled = true })

  ipcMain.handle('doc:open', async () => {
    const w = win()
    if (!w) return null
    const res = await dialog.showOpenDialog(w, {
      title: 'Mở bản vẽ',
      filters: [{ name: 'Bản vẽ Sdraw AI', extensions: ['sdraw'] }],
      properties: ['openFile']
    })
    const path = res.filePaths[0]
    if (res.canceled || !path) return null
    const parsed = JSON.parse(await readFile(path, 'utf8')) as unknown
    if (!isDoc(parsed)) throw new Error('Tệp không phải bản vẽ Sdraw AI hợp lệ')
    return { doc: parsed, path }
  })

  ipcMain.handle('doc:save', async (_e, doc: SdrawDoc, path: string | null) => {
    let target = path
    if (!target) {
      const w = win()
      if (!w) return null
      const res = await dialog.showSaveDialog(w, {
        title: 'Lưu bản vẽ',
        defaultPath: `${doc.name}.sdraw`,
        filters: [{ name: 'Bản vẽ Sdraw AI', extensions: ['sdraw'] }]
      })
      if (res.canceled || !res.filePath) return null
      target = res.filePath
    }
    await writeFile(target, JSON.stringify(doc, null, 2), 'utf8')
    return target
  })

  async function pickExport(name: string, ext: string, label: string): Promise<string | null> {
    const w = win()
    if (!w) return null
    const res = await dialog.showSaveDialog(w, {
      title: 'Xuất file',
      defaultPath: `${name}.${ext}`,
      filters: [{ name: label, extensions: [ext] }]
    })
    return res.canceled || !res.filePath ? null : res.filePath
  }

  ipcMain.handle('export:dxf', async (_e, doc: SdrawDoc) => {
    const file = await pickExport(doc.name, 'dxf', 'DXF')
    if (!file) return null
    await writeFile(file, toDxf(doc), 'utf8')
    return file
  })

  ipcMain.handle('export:xlsx', async (_e, doc: SdrawDoc, samples: Sample[]) => {
    const file = await pickExport(`${doc.name}-bang-ke`, 'xlsx', 'Excel')
    if (!file) return null
    await writeBomXlsx(doc, samples, file)
    return file
  })

  ipcMain.handle('export:neonplan', async (_e, doc: SdrawDoc, samples: Sample[]) => {
    const file = await pickExport(`${doc.name}-neonplan`, 'json', 'NeonPlan 3D (Home Assistant)')
    if (!file) return null
    const { plan, warnings } = toNeonPlan(doc, samples)
    await writeFile(file, JSON.stringify(plan, null, 2), 'utf8')
    return { file, warnings }
  })

  ipcMain.handle('export:neonplanHouse', async (_e, rooms: unknown, samples: Sample[], name: string) => {
    const list = cleanRooms(rooms)
    if (!list) throw new Error('Dự án chưa có phòng nào')
    const title = String(name ?? 'nha').slice(0, 100)
    const file = await pickExport(`${title}-neonplan`, 'json', 'NeonPlan 3D (Home Assistant)')
    if (!file) return null
    const { plan, warnings } = toNeonPlanHouse(list, samples, title)
    await writeFile(file, JSON.stringify(plan, null, 2), 'utf8')
    return { file, warnings }
  })

  ipcMain.handle('export:json', async (_e, doc: SdrawDoc, samples: Sample[]) => {
    const file = await pickExport(`${doc.name}-sketchup`, 'json', 'JSON cho SketchUp')
    if (!file) return null
    const meshes = new Map<string, Mesh>()
    const wanted = new Set(doc.items.map((it) => samples.find((s) => s.id === it.sampleId)?.meshPath).filter((p): p is string => !!p))
    for (const p of wanted) {
      try {
        const ext = extensionOf(p)
        if (ext !== 'obj' && ext !== 'glb') continue
        if ((await stat(p)).size > 50 * 1024 * 1024) continue
        const bytes = await readFile(p)
        meshes.set(p, ext === 'glb' ? parseGlb(new Uint8Array(bytes)) : parseObj(bytes.toString('utf8')))
      } catch {
        // Không đọc được: món đó dùng khối hộp thay thế, không làm hỏng cả bản xuất.
      }
    }
    await writeFile(file, JSON.stringify(toSketchupPlan(doc, samples, meshes)), 'utf8')
    return file
  })
}


function settingsFile(): string {
  return join(app.getPath('userData'), 'settings.json')
}

async function readCatalog(): Promise<Sample[]> {
  try {
    const parsed = JSON.parse(await readFile(catalogFile(), 'utf8')) as unknown
    if (Array.isArray(parsed)) return parsed as Sample[]
  } catch {
    /* chưa có kho */
  }
  return SEED_SAMPLES
}

async function pickSave(name: string, ext: string, label: string): Promise<string | null> {
  const w = BrowserWindow.getFocusedWindow()
  const opts = { title: 'Xuất file', defaultPath: `${name}.${ext}`, filters: [{ name: label, extensions: [ext] }] }
  const res = w ? await dialog.showSaveDialog(w, opts) : await dialog.showSaveDialog(opts)
  return res.canceled || !res.filePath ? null : res.filePath
}

function projectsFile(): string {
  return join(app.getPath('userData'), 'projects.json')
}

async function readProjects(): Promise<ProjectRec[]> {
  try {
    const list = JSON.parse(await readFile(projectsFile(), 'utf8')) as ProjectRec[]
    return Array.isArray(list) ? list.filter((p) => p && typeof p.id === 'string' && isDoc(p.doc)) : []
  } catch {
    return []
  }
}

/** Nội dung sao lưu: kho mẫu và dự án. Bỏ ảnh nền của phác thảo (nặng, chỉ ở máy) để bản sao lưu gọn. */
async function buildBackup(): Promise<{ raw: string; samples: number; projects: number }> {
  const samples = (await readCatalog()).map((s) => {
    if (!s.sketch?.underlay) return s
    const { underlay: _u, ...sketch } = s.sketch
    return { ...s, sketch }
  })
  const projects = await readProjects()
  return { raw: JSON.stringify({ format: 'sdraw-backup', version: 1, createdAt: Date.now(), samples, projects }), samples: samples.length, projects: projects.length }
}

/** Khôi phục chỉ thêm mục còn thiếu, không ghi đè hay xoá dữ liệu đang có. */
async function mergeBackup(rawIn: unknown): Promise<{ samples: number; projects: number }> {
  const raw = rawIn as { format?: string; samples?: Sample[]; projects?: ProjectRec[] } | null
  if (!raw || raw.format !== 'sdraw-backup') throw new Error('Tệp không phải bản sao lưu Sdraw AI')
  const inSamples = (Array.isArray(raw.samples) ? raw.samples : []).filter((x) => x && typeof x.id === 'string' && typeof x.name === 'string')
  const inProjects = (Array.isArray(raw.projects) ? raw.projects : []).filter((p) => p && typeof p.id === 'string' && isDoc(p.doc))
  const samples = await readCatalog()
  const have = new Set(samples.map((x) => x.id))
  const addS = inSamples.filter((x) => !have.has(x.id))
  await writeFile(catalogFile(), JSON.stringify([...samples, ...addS]), 'utf8')
  const projects = await readProjects()
  const haveP = new Set(projects.map((x) => x.id))
  const addP = inProjects.filter((p) => !haveP.has(p.id))
  await writeFile(projectsFile(), JSON.stringify([...projects, ...addP]), 'utf8')
  return { samples: addS.length, projects: addP.length }
}

async function serverCall(method: 'GET' | 'PUT', path: string, body?: string): Promise<NetResult> {
  const s = await readSettings()
  if (!s.serverUrl || !s.token) return { status: 0, data: { error: 'Cần đăng nhập và cài địa chỉ máy chủ' } }
  try {
    const res = await fetch(s.serverUrl + path, {
      method,
      headers: { authorization: `Bearer ${s.token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body }),
      signal: AbortSignal.timeout(120_000)
    })
    return { status: res.status, data: (await res.json().catch(() => ({}))) as unknown }
  } catch {
    return { status: 0, data: { error: 'Không kết nối được máy chủ' } }
  }
}

/** Địa chỉ máy tạo ảnh cục bộ: Draw Things luôn ở máy này (cổng 7860), máy chủ văn phòng theo cài đặt. Cả hai nói giao thức kiểu Automatic1111. */
function localImageBase(img: Settings['image']): string | null {
  if (img.provider === 'drawthings') return 'http://127.0.0.1:7860'
  if (img.provider === 'lan') {
    const host = img.lanHost.trim().replace(/^https?:\/\//, '').replace(/\/+$/, '')
    if (!/^[A-Za-z0-9.-]+$/.test(host) || !Number.isInteger(img.lanPort) || img.lanPort < 1 || img.lanPort > 65535) return null
    return `http://${host}:${img.lanPort}`
  }
  return null
}

async function generateImageLocal(base: string, frame: string, prompt: string): Promise<NetResult> {
  try {
    const res = await fetch(`${base}/sdapi/v1/img2img`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        prompt: `${prompt}, interior furniture design illustration, clean background`,
        negative_prompt: 'text, watermark, people, blurry, deformed',
        init_images: [frame],
        denoising_strength: 0.8,
        width: 768,
        height: 512,
        steps: 20,
        cfg_scale: 7
      }),
      signal: AbortSignal.timeout(300_000)
    })
    if (!res.ok) return { status: 502, data: { error: `Máy tạo ảnh trả về ${res.status}. Kiểm tra máy chủ API đã bật chưa.` } }
    const body = (await res.json().catch(() => ({}))) as { images?: string[] }
    const image = body.images?.[0]
    if (!image) return { status: 502, data: { error: 'Máy tạo ảnh không trả ảnh' } }
    return { status: 200, data: { image } }
  } catch (e) {
    const cause = (e as { cause?: { code?: string } }).cause?.code ?? (e as Error).name
    return { status: 504, data: { error: `Không kết nối được máy tạo ảnh tại ${base} (${cause}). Hãy bật máy chủ API trong Draw Things hoặc kiểm tra địa chỉ.` } }
  }
}

function errText(r: NetResult): string {
  const e = (r.data as { error?: unknown } | null)?.error
  return typeof e === 'string' ? e : `Máy chủ trả lỗi ${r.status}`
}

async function pushBackup(): Promise<{ samples: number; projects: number }> {
  const { raw, samples, projects } = await buildBackup()
  const r = await serverCall('PUT', '/v1/backup', raw)
  if (r.status !== 200) throw new Error(errText(r))
  const s = await readSettings()
  await writeFile(settingsFile(), JSON.stringify({ ...s, lastBackupAt: Date.now() }), 'utf8')
  return { samples, projects }
}

/** Theo dõi các thư mục nguồn: có file .skp mới hoặc đổi thì báo renderer (sau 3 giây yên) để lập chỉ mục lại. */
const watchers = new Map<string, FSWatcher>()
const watchTimers = new Map<string, NodeJS.Timeout>()
async function syncWatchers(win: () => BrowserWindow | null): Promise<void> {
  const s = await readSettings()
  const want = new Set(s.autoDetect && s.autoWatch ? s.folders.map((f) => f.path) : [])
  for (const [p, w] of watchers) if (!want.has(p)) { w.close(); watchers.delete(p) }
  for (const p of want) {
    if (watchers.has(p)) continue
    try {
      const w = watch(p, { recursive: true }, (_ev, name) => {
        if (!name || !/\.skp$/i.test(String(name))) return
        clearTimeout(watchTimers.get(p))
        watchTimers.set(p, setTimeout(() => win()?.webContents.send('scan:changed', { folder: p }), 3000))
      })
      w.on('error', () => { w.close(); watchers.delete(p) })
      watchers.set(p, w)
    } catch {
      // Hệ thống không hỗ trợ theo dõi thư mục này: vẫn quét khi mở app hoặc bấm lập chỉ mục.
    }
  }
}

const DAY_MS = 24 * 3600 * 1000
/** Tự sao lưu lên máy chủ khi đã bật, đã đăng nhập bằng tài khoản chủ và bản gần nhất cũ hơn một ngày. Lỗi mạng bỏ qua, thử lại lần sau. */
async function autoBackupTick(): Promise<void> {
  try {
    const s = await readSettings()
    if (!s.autoBackup || !s.token || !s.user || s.user.role === 'staff') return
    if (Date.now() - s.lastBackupAt < DAY_MS) return
    await pushBackup()
  } catch {
    // thử lại ở lần kiểm tra sau
  }
}

const DEFAULT_IMAGE: ImageSettings = { provider: 'socin', monthlyLimit: 300, lanHost: '', lanPort: 7860, staffAllowed: true, watermark: true }
const DEFAULT_SETTINGS: Settings = { serverUrl: DEFAULT_SERVER_URL, token: '', user: null, folders: [], autoDetect: true, autoIndex: true, autoSync: false, autoWatch: true, autoBackup: false, offlineChosen: false, lastBackupAt: 0, image: DEFAULT_IMAGE }

async function readSettings(): Promise<Settings> {
  try {
    const p = JSON.parse(await readFile(settingsFile(), 'utf8')) as Partial<Settings>
    return { ...DEFAULT_SETTINGS, ...p, serverUrl: p.serverUrl || DEFAULT_SERVER_URL, image: { ...DEFAULT_IMAGE, ...(p.image ?? {}) } }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

function isSketch(value: unknown): value is SketchDoc {
  const d = value as SketchDoc | null
  return !!d && d.version === 1 && typeof d.name === 'string' && Array.isArray(d.shapes) && (d.underlay === undefined || isUnderlay(d.underlay))
}

const MAX_IMPORT_BYTES = 200 * 1024 * 1024

function registerExtraIpc(win: () => BrowserWindow | null): void {
  ipcMain.handle('catalog:import', async (): Promise<ImportItem[] | null> => {
    const w = win()
    if (!w) return null
    const res = await dialog.showOpenDialog(w, {
      title: 'Chọn mẫu để thêm vào kho',
      filters: [{ name: 'Mẫu', extensions: [...IMPORT_EXTENSIONS] }],
      properties: ['openFile', 'multiSelections']
    })
    if (res.canceled) return null
    const out: ImportItem[] = []
    for (const path of res.filePaths.slice(0, 200)) {
      const fileName = basename(path)
      try {
        const bytes = await readFile(path)
        if (bytes.length > MAX_IMPORT_BYTES) {
          out.push({ fileName, error: 'File lớn hơn 200 MB' })
          continue
        }
        if (extensionOf(path) === 'json') {
          const lib = importLibrary(path, bytes.toString('utf8'))
          if ('error' in lib) out.push({ fileName, error: lib.error })
          else for (const it of lib.items) out.push({ fileName: it.sample.name, sample: it.sample, needsDimensions: it.needsDimensions, warnings: it.warnings })
          continue
        }
        const r = importFile(path, new Uint8Array(bytes))
        out.push('error' in r ? { fileName, error: r.error } : { fileName, sample: r.sample, needsDimensions: r.needsDimensions, warnings: r.warnings })
      } catch (e) {
        out.push({ fileName, error: (e as Error).message })
      }
    }
    return out
  })

  ipcMain.handle('sketch:save', async (_e, doc: SketchDoc, path: string | null) => {
    if (!isSketch(doc)) throw new Error('Phác thảo không hợp lệ')
    let target = path
    if (!target) {
      const w = win()
      if (!w) return null
      const res = await dialog.showSaveDialog(w, {
        title: 'Lưu phác thảo',
        defaultPath: `${doc.name}.sdsketch`,
        filters: [{ name: 'Phác thảo Sdraw AI', extensions: ['sdsketch'] }]
      })
      if (res.canceled || !res.filePath) return null
      target = res.filePath
    }
    await writeFile(target, JSON.stringify(doc, null, 2), 'utf8')
    return target
  })

  ipcMain.handle('sketch:open', async () => {
    const w = win()
    if (!w) return null
    const res = await dialog.showOpenDialog(w, {
      title: 'Mở phác thảo',
      filters: [{ name: 'Phác thảo Sdraw AI', extensions: ['sdsketch'] }],
      properties: ['openFile']
    })
    const path = res.filePaths[0]
    if (res.canceled || !path) return null
    const parsed = JSON.parse(await readFile(path, 'utf8')) as unknown
    if (!isSketch(parsed)) throw new Error('Tệp không phải phác thảo Sdraw AI hợp lệ')
    return { doc: parsed, path }
  })

  // Mô hình 3D (.sdraw3d) và nhập/xuất OBJ, STL, GLB cho màn Dựng 3D
  ipcMain.handle('model3d:save', async (_e, model: Model3, name: string, path: string | null) => {
    if (!isModel3(model)) throw new Error('Mô hình không hợp lệ')
    let target = path
    if (!target) {
      const w = win()
      if (!w) return null
      const res = await dialog.showSaveDialog(w, {
        title: 'Lưu mô hình 3D',
        defaultPath: `${String(name || 'mo-hinh').slice(0, 80)}.sdraw3d`,
        filters: [{ name: 'Mô hình S Draw', extensions: ['sdraw3d'] }]
      })
      if (res.canceled || !res.filePath) return null
      target = res.filePath
    }
    await writeFile(target, JSON.stringify({ format: 'sdraw3d', name, model }), 'utf8')
    return target
  })

  ipcMain.handle('model3d:open', async () => {
    const w = win()
    if (!w) return null
    const res = await dialog.showOpenDialog(w, { title: 'Mở mô hình 3D', filters: [{ name: 'Mô hình S Draw', extensions: ['sdraw3d'] }], properties: ['openFile'] })
    const path = res.filePaths[0]
    if (res.canceled || !path) return null
    if ((await stat(path)).size > 100 * 1024 * 1024) throw new Error('Tệp lớn hơn 100 MB')
    const parsed = JSON.parse(await readFile(path, 'utf8')) as { format?: string; name?: unknown; model?: unknown }
    if (parsed?.format !== 'sdraw3d' || !isModel3(parsed.model)) throw new Error('Tệp không phải mô hình S Draw hợp lệ')
    return { model: parsed.model, name: typeof parsed.name === 'string' ? parsed.name : basename(path, '.sdraw3d'), path }
  })

  ipcMain.handle('model3d:export', async (_e, kind: string, data: string | Uint8Array, name: string) => {
    const w = win()
    if (!w || !['obj', 'stl', 'glb', 'dxf', 'svg', 'pdf'].includes(kind)) return null
    if (typeof data !== 'string' && !(data instanceof Uint8Array)) return null
    if (kind === 'pdf' && (typeof data !== 'string' || !data.startsWith('<svg'))) return null
    const label = kind === 'glb' ? 'glTF nhị phân' : kind === 'pdf' ? 'Bản vẽ PDF' : kind.toUpperCase()
    const res = await dialog.showSaveDialog(w, {
      title: `Xuất ${label}`,
      defaultPath: `${String(name || 'mo-hinh').slice(0, 80)}.${kind}`,
      filters: [{ name: label, extensions: [kind] }]
    })
    if (res.canceled || !res.filePath) return null
    await writeFile(res.filePath, kind === 'pdf' ? await svgToPdf(data as string) : data)
    return res.filePath
  })

  ipcMain.handle('model3d:import', async () => {
    const w = win()
    if (!w) return null
    const res = await dialog.showOpenDialog(w, { title: 'Nhập mô hình 3D', filters: [{ name: 'Mô hình 3D', extensions: ['obj', 'stl', 'glb'] }], properties: ['openFile'] })
    const path = res.filePaths[0]
    if (res.canceled || !path) return null
    const ext = extensionOf(path)
    if (ext !== 'obj' && ext !== 'stl' && ext !== 'glb') throw new Error('Chỉ hỗ trợ .obj, .stl và .glb')
    if ((await stat(path)).size > 50 * 1024 * 1024) throw new Error('Tệp lớn hơn 50 MB')
    return { name: basename(path).replace(/\.[^.]+$/, ''), kind: ext, data: new Uint8Array(await readFile(path)) }
  })

  ipcMain.handle('export:svg', async (_e, svg: string, name: string) => {
    const w = win()
    if (!w || typeof svg !== 'string') return null
    const res = await dialog.showSaveDialog(w, {
      title: 'Xuất nét vẽ',
      defaultPath: `${name}.svg`,
      filters: [{ name: 'SVG', extensions: ['svg'] }]
    })
    if (res.canceled || !res.filePath) return null
    await writeFile(res.filePath, svg, 'utf8')
    return res.filePath
  })

  ipcMain.handle('mesh:open', async () => {
    const w = win()
    if (!w) return null
    const res = await dialog.showOpenDialog(w, { title: 'Chọn mô hình 3D', filters: [{ name: 'Mô hình 3D', extensions: ['obj', 'glb'] }], properties: ['openFile'] })
    const path = res.filePaths[0]
    if (res.canceled || !path) return null
    const ext = extensionOf(path)
    if (ext !== 'obj' && ext !== 'glb') throw new Error('Chỉ hỗ trợ .obj và .glb')
    const bytes = await readFile(path)
    if (bytes.length > 50 * 1024 * 1024) throw new Error('Tệp lớn hơn 50 MB')
    return { path, name: basename(path), kind: ext, data: new Uint8Array(bytes) }
  })

  // Đọc lưới 3D của một mẫu trong kho để xem 3D; chỉ nhận đường dẫn đã có trong kho mẫu, không đọc file tuỳ ý.
  ipcMain.handle('mesh:read', async (_e, path: string): Promise<{ kind: 'obj' | 'glb'; data: Uint8Array } | null> => {
    if (typeof path !== 'string') return null
    const known = (await readCatalog()).some((s) => s.meshPath === path)
    if (!known) return null
    const ext = extensionOf(path)
    if (ext !== 'obj' && ext !== 'glb') return null
    try {
      if ((await stat(path)).size > 50 * 1024 * 1024) return null
      return { kind: ext, data: new Uint8Array(await readFile(path)) }
    } catch {
      return null
    }
  })

  ipcMain.handle('sketch:openImage', async (): Promise<ReferenceImage | null> => {
    const w = win()
    if (!w) return null
    const res = await dialog.showOpenDialog(w, {
      title: 'Chọn ảnh mặt bằng hoặc ảnh tham khảo',
      filters: [{ name: 'Ảnh hoặc PDF', extensions: ['png', 'jpg', 'jpeg', 'pdf'] }],
      properties: ['openFile']
    })
    const path = res.filePaths[0]
    if (res.canceled || !path) return null
    const bytes = await readFile(path)
    if (bytes.length > 15 * 1024 * 1024) throw new Error('Tệp lớn hơn 15 MB')
    if (extensionOf(path) === 'pdf') {
      if (bytes.subarray(0, 5).toString('latin1') !== '%PDF-') throw new Error('Không phải tệp PDF hợp lệ')
      // Trang đầu được vẽ thành ảnh ở renderer; kích thước thật do renderer điền.
      return { src: `data:application/pdf;base64,${bytes.toString('base64')}`, width: 0, height: 0, name: basename(path) }
    }
    const size = imagePixelSize(new Uint8Array(bytes))
    if (!size) throw new Error('Không đọc được ảnh (chỉ hỗ trợ PNG và JPG)')
    const mime = extensionOf(path) === 'png' ? 'image/png' : 'image/jpeg'
    return { src: `data:${mime};base64,${bytes.toString('base64')}`, width: size.width, height: size.height, name: basename(path) }
  })

  ipcMain.handle('backup:export', async () => {
    const stamp = new Date().toISOString().slice(0, 10)
    const file = await pickSave(`sdraw-sao-luu-${stamp}`, 'json', 'Sao lưu Sdraw AI')
    if (!file) return null
    const { raw, samples, projects } = await buildBackup()
    await writeFile(file, raw, 'utf8')
    return { file, samples, projects }
  })
  ipcMain.handle('backup:push', async () => pushBackup())
  ipcMain.handle('backup:list', async () => {
    const r = await serverCall('GET', '/v1/backup')
    if (r.status !== 200) throw new Error(errText(r))
    return (r.data as { items: unknown[] }).items
  })
  ipcMain.handle('backup:pull', async (_e, id: number) => {
    if (!Number.isInteger(id)) throw new Error('Mã bản sao lưu không hợp lệ')
    const r = await serverCall('GET', `/v1/backup/${id}`)
    if (r.status !== 200) throw new Error(errText(r))
    return mergeBackup(r.data)
  })
  ipcMain.handle('backup:restore', async () => {
    const r = await dialog.showOpenDialog({ title: 'Chọn file sao lưu', properties: ['openFile'], filters: [{ name: 'Sao lưu Sdraw AI', extensions: ['json'] }] })
    const file = r.filePaths[0]
    if (r.canceled || !file) return null
    return mergeBackup(JSON.parse(await readFile(file, 'utf8')))
  })
  const MAX_SKP = 100 * 1024 * 1024
  const validId = (id: unknown): id is string => typeof id === 'string' && /^[\w-]{8,64}$/.test(id)

  // Tải file .skp của gói đăng bán lên Store. Chỉ file người dùng chọn ở đây mới rời khỏi máy.
  ipcMain.handle('store:upload', async (_e, id: string): Promise<NetResult | null> => {
    if (!validId(id)) return { status: 0, data: { error: 'Mã gói không hợp lệ' } }
    const s = await readSettings()
    if (!s.serverUrl || !s.token) return { status: 0, data: { error: 'Cần đăng nhập Socin' } }
    const r = await dialog.showOpenDialog({ title: 'Chọn file SketchUp của gói đăng bán', properties: ['openFile'], filters: [{ name: 'SketchUp', extensions: ['skp'] }] })
    const file = r.filePaths[0]
    if (r.canceled || !file) return null
    if ((await stat(file)).size > MAX_SKP) return { status: 0, data: { error: 'File lớn hơn 100 MB' } }
    const data = await readFile(file)
    try {
      const res = await fetch(`${s.serverUrl}/v1/store/listings/${id}/file`, {
        method: 'PUT',
        headers: { authorization: `Bearer ${s.token}`, 'x-file-name': basename(file), 'content-type': 'application/octet-stream' },
        body: data,
        signal: AbortSignal.timeout(600_000)
      })
      return { status: res.status, data: await res.json().catch(() => ({})) }
    } catch {
      return { status: 0, data: { error: 'Không kết nối được máy chủ' } }
    }
  })

  // Ảnh bìa: renderer gửi data URL JPEG/PNG đã thu nhỏ, main đẩy lên máy chủ bằng token.
  ipcMain.handle('store:putCover', async (_e, id: string, dataUrl: string): Promise<NetResult> => {
    if (!validId(id)) return { status: 0, data: { error: 'Mã gói không hợp lệ' } }
    const s = await readSettings()
    if (!s.serverUrl || !s.token) return { status: 0, data: { error: 'Cần đăng nhập Socin' } }
    const mm = /^data:image\/(?:jpeg|png);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl))
    if (!mm) return { status: 0, data: { error: 'Ảnh bìa không hợp lệ' } }
    const body = Buffer.from(mm[1]!, 'base64')
    try {
      const res = await fetch(`${s.serverUrl}/v1/store/listings/${id}/cover`, { method: 'PUT', headers: { authorization: `Bearer ${s.token}`, 'content-type': 'application/octet-stream' }, body, signal: AbortSignal.timeout(60_000) })
      return { status: res.status, data: await res.json().catch(() => ({})) }
    } catch {
      return { status: 0, data: { error: 'Không kết nối được máy chủ' } }
    }
  })
  ipcMain.handle('store:cover', async (_e, id: string): Promise<string | null> => {
    if (!validId(id)) return null
    const s = await readSettings()
    if (!s.serverUrl || !s.token) return null
    try {
      const res = await fetch(`${s.serverUrl}/v1/store/listings/${id}/cover`, { headers: { authorization: `Bearer ${s.token}` }, signal: AbortSignal.timeout(30_000) })
      if (!res.ok) return null
      const type = res.headers.get('content-type') === 'image/png' ? 'image/png' : 'image/jpeg'
      return `data:${type};base64,${Buffer.from(await res.arrayBuffer()).toString('base64')}`
    } catch {
      return null
    }
  })

  ipcMain.handle('store:download', async (_e, id: string, suggestedName: string): Promise<string | null> => {
    if (!validId(id)) throw new Error('Mã gói không hợp lệ')
    const s = await readSettings()
    if (!s.serverUrl || !s.token) throw new Error('Cần đăng nhập Socin')
    const res = await fetch(`${s.serverUrl}/v1/store/listings/${id}/file`, { headers: { authorization: `Bearer ${s.token}` }, signal: AbortSignal.timeout(600_000) })
    if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `Lỗi ${res.status}`)
    const name = String(suggestedName || 'mau').replace(/[^\w.\- ]+/g, '_').replace(/\.skp$/i, '').slice(0, 100)
    const pick = await dialog.showSaveDialog({ title: 'Lưu file mẫu', defaultPath: `${name}.skp`, filters: [{ name: 'SketchUp', extensions: ['skp'] }] })
    if (pick.canceled || !pick.filePath) return null
    await writeFile(pick.filePath, Buffer.from(await res.arrayBuffer()))
    return pick.filePath
  })

  // Tải mô hình do app tạo (.sdraw3d) lên gói Store nháp. Nội dung do renderer dựng từ mô hình đang mở.
  ipcMain.handle('store:uploadData', async (_e, id: string, fileName: string, data: string): Promise<NetResult> => {
    if (!validId(id)) return { status: 0, data: { error: 'Mã gói không hợp lệ' } }
    if (typeof data !== 'string' || data.length > MAX_SKP) return { status: 0, data: { error: 'Mô hình quá lớn' } }
    const s = await readSettings()
    if (!s.serverUrl || !s.token) return { status: 0, data: { error: 'Cần đăng nhập Socin' } }
    const body = Buffer.from(data, 'utf8')
    try {
      const res = await fetch(`${s.serverUrl}/v1/store/listings/${id}/file`, {
        method: 'PUT',
        headers: { authorization: `Bearer ${s.token}`, 'x-file-name': String(fileName || 'mo-hinh.sdraw3d').replace(/[^\w.\- ]+/g, '_').slice(0, 100), 'content-type': 'application/octet-stream' },
        body,
        signal: AbortSignal.timeout(600_000)
      })
      return { status: res.status, data: await res.json().catch(() => ({})) }
    } catch {
      return { status: 0, data: { error: 'Không kết nối được máy chủ' } }
    }
  })

  // Lấy file mô hình 3D của gói Store để mở thẳng trong Dựng 3D (không ghi ra đĩa).
  ipcMain.handle('store:fetch', async (_e, id: string): Promise<{ kind: 'sdraw3d' | 'glb'; name: string; data: Uint8Array }> => {
    if (!validId(id)) throw new Error('Mã gói không hợp lệ')
    const s = await readSettings()
    if (!s.serverUrl || !s.token) throw new Error('Cần đăng nhập Socin')
    const res = await fetch(`${s.serverUrl}/v1/store/listings/${id}/file`, { headers: { authorization: `Bearer ${s.token}` }, signal: AbortSignal.timeout(600_000) })
    if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `Lỗi ${res.status}`)
    const kind = res.headers.get('x-file-kind')
    if (kind !== 'sdraw3d' && kind !== 'glb') throw new Error('Gói này không phải mô hình 3D mở được trong S Draw')
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length > 50 * 1024 * 1024) throw new Error('Tệp lớn hơn 50 MB')
    return { kind, name: decodeURIComponent(res.headers.get('x-file-name') ?? `mo-hinh.${kind}`), data: new Uint8Array(buf) }
  })

  // Chỉ mở đúng trang tìm kiếm 3D Warehouse; từ khoá được mã hoá, không nhận địa chỉ tuỳ ý từ giao diện.
  ipcMain.handle('warehouse:open', async (_e, query: string) => {
    const q = String(query ?? '').replace(/\s+/g, ' ').trim().slice(0, 100)
    const url = new URL('https://3dwarehouse.sketchup.com/search/')
    if (q) url.searchParams.set('q', q)
    await shell.openExternal(url.toString())
  })

  ipcMain.handle('projects:list', () => readProjects())
  ipcMain.handle('projects:save', async (_e, p: ProjectRec) => {
    if (!p || typeof p.id !== 'string' || typeof p.name !== 'string' || !isDoc(p.doc)) throw new Error('Dự án không hợp lệ')
    const rooms = cleanRooms(p.rooms)
    const rec: ProjectRec = { id: p.id.slice(0, 64), name: p.name.slice(0, 200), customer: String(p.customer ?? '').slice(0, 200), updatedAt: Date.now(), doc: rooms ? rooms[0]!.doc : p.doc, ...(rooms ? { rooms } : {}) }
    const list = (await readProjects()).filter((x) => x.id !== rec.id)
    list.unshift(rec)
    await writeFile(projectsFile(), JSON.stringify(list), 'utf8')
  })
  ipcMain.handle('projects:delete', async (_e, id: string) => {
    const list = (await readProjects()).filter((x) => x.id !== id)
    await writeFile(projectsFile(), JSON.stringify(list), 'utf8')
  })
  ipcMain.handle('image:generate', async (_e, frame: unknown, prompt: unknown): Promise<NetResult> => {
    if (typeof prompt !== 'string' || prompt.length === 0 || prompt.length > 1000) return { status: 400, data: { error: 'Lời nhắc phải dài 1 đến 1000 ký tự' } }
    if (typeof frame !== 'string' || frame.length === 0 || frame.length > 3_000_000 || !/^[A-Za-z0-9+/=]+$/.test(frame)) return { status: 400, data: { error: 'Khung nét không hợp lệ hoặc quá lớn' } }
    const s = await readSettings()
    if (s.image.provider === 'socin') {
      if (!s.serverUrl || !s.token) return { status: 0, data: { error: 'Cần đăng nhập Socin để tạo ảnh qua máy chủ' } }
      try {
        const res = await fetch(`${s.serverUrl}/v1/ai/image`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${s.token}` },
          body: JSON.stringify({ prompt, frame }),
          signal: AbortSignal.timeout(130_000)
        })
        return { status: res.status, data: (await res.json().catch(() => ({}))) as unknown }
      } catch {
        return { status: 0, data: { error: 'Không kết nối được máy chủ' } }
      }
    }
    const base = localImageBase(s.image)
    if (!base) return { status: 400, data: { error: 'Địa chỉ máy tạo ảnh trong văn phòng chưa hợp lệ. Kiểm tra Cài đặt.' } }
    return generateImageLocal(base, frame, prompt)
  })

  ipcMain.handle('settings:get', () => readSettings())

  ipcMain.handle('settings:set', async (_e, patch: Partial<Settings>) => {
    const cur = await readSettings()
    const next: Settings = { ...cur }
    if (typeof patch.serverUrl === 'string') next.serverUrl = patch.serverUrl.trim().replace(/\/+$/, '')
    if (typeof patch.token === 'string') next.token = patch.token
    if (patch.user !== undefined) next.user = patch.user
    if (Array.isArray(patch.folders)) {
      next.folders = patch.folders
        .filter((f): f is SourceFolder => !!f && typeof f.path === 'string' && f.path.length > 0 && f.path.length < 1024)
        .slice(0, 50)
        .map((f) => ({ path: f.path, name: String(f.name ?? basename(f.path)).slice(0, 200), lastScan: Number(f.lastScan) || 0, count: Number(f.count) || 0 }))
    }
    for (const k of ['autoDetect', 'autoIndex', 'autoSync', 'autoBackup', 'autoWatch', 'offlineChosen'] as const) if (typeof patch[k] === 'boolean') next[k] = patch[k]
    if (patch.image) {
      const i = patch.image
      const cur2 = next.image
      next.image = {
        provider: i.provider === 'lan' || i.provider === 'drawthings' || i.provider === 'socin' ? i.provider : cur2.provider,
        monthlyLimit: Number.isFinite(i.monthlyLimit) ? Math.min(100000, Math.max(0, Math.round(i.monthlyLimit))) : cur2.monthlyLimit,
        lanHost: typeof i.lanHost === 'string' ? i.lanHost.trim().slice(0, 200) : cur2.lanHost,
        lanPort: Number.isInteger(i.lanPort) && i.lanPort > 0 && i.lanPort < 65536 ? i.lanPort : cur2.lanPort,
        staffAllowed: typeof i.staffAllowed === 'boolean' ? i.staffAllowed : cur2.staffAllowed,
        watermark: typeof i.watermark === 'boolean' ? i.watermark : cur2.watermark
      }
    }
    if (next.serverUrl && !/^https?:\/\//.test(next.serverUrl)) throw new Error('Địa chỉ máy chủ phải bắt đầu bằng https://')
    await writeFile(settingsFile(), JSON.stringify(next, null, 2), { encoding: 'utf8', mode: 0o600 })
    void syncWatchers(win)
    return next
  })

  // Mọi cuộc gọi tới máy chủ đi qua đây: renderer không giữ token và không gọi mạng trực tiếp.
  ipcMain.handle('net:call', async (_e, method: string, path: string, body?: unknown): Promise<NetResult> => {
    const s = await readSettings()
    if (!s.serverUrl) return { status: 0, data: { error: 'Chưa cài địa chỉ máy chủ. Vào Cài đặt.' } }
    if (!/^\/(v1\/|health$)/.test(path) || !/^(GET|POST|PUT|DELETE)$/.test(method)) {
      return { status: 0, data: { error: 'Yêu cầu không hợp lệ' } }
    }
    try {
      const headers: Record<string, string> = { 'content-type': 'application/json' }
      if (s.token) headers['authorization'] = `Bearer ${s.token}`
      const res = await fetch(s.serverUrl + path, {
        method,
        headers,
        ...(body === undefined || method === 'GET' ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(130_000)
      })
      const data = (await res.json().catch(() => ({}))) as unknown
      return { status: res.status, data }
    } catch (e) {
      const cause = (e as { cause?: { code?: string; message?: string } }).cause
      const why = cause?.code ?? cause?.message ?? (e as Error).message
      return { status: 0, data: { error: `Không kết nối được máy chủ (${why}). Dữ liệu riêng vẫn dùng được khi không có mạng.` } }
    }
  })
}

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    title: 'Sdraw AI',
    backgroundColor: '#EEF6F7',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  if (process.env['ELECTRON_RENDERER_URL']) {
    void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app.whenReady().then(() => {
  registerIpc(() => mainWindow)
  registerExtraIpc(() => mainWindow)
  void registerAiGateway(() => mainWindow, svgToPdf)
  const stopGen3d = registerGen3d(() => mainWindow)
  app.on('will-quit', stopGen3d)
  createWindow()
  void syncWatchers(() => mainWindow)
  setTimeout(() => void autoBackupTick(), 30_000)
  setInterval(() => void autoBackupTick(), 3600_000)
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

/** In một bản vẽ SVG (khổ A3 ngang) ra PDF bằng cửa sổ ẩn, không chạy script. */
async function svgToPdf(svg: string): Promise<Buffer> {
  const pdfWin = new BrowserWindow({ show: false, webPreferences: { javascript: false, sandbox: true } })
  try {
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>@page{size:A3 landscape;margin:0}html,body{margin:0;padding:0}svg{display:block;width:420mm;height:297mm}</style></head><body>${svg}</body></html>`
    await pdfWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    return await pdfWin.webContents.printToPDF({ pageSize: 'A3', landscape: true, printBackground: true, margins: { marginType: 'none' } })
  } finally {
    pdfWin.destroy()
  }
}
