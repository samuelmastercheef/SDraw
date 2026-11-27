/**
 * Công cụ trên máy cho cổng tạo hình 3D: kiểm tra đã cài chưa, bấm là cài (brew trên Mac, winget trên Windows,
 * môi trường Python qua uv), chạy máy chủ Hunyuan3D-2, có nhật ký. Cùng cách làm với S Game trong S Hub.
 * Không phụ thuộc Electron để test được; index.ts nối vào IPC.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

export interface ToolDef {
  id: string
  name: string
  desc: string
  only?: 'darwin' | 'win32'
  optional?: boolean
  heavy?: string
  needs?: string[]
  detect: { bins?: string[]; apps?: string[]; files?: string[]; venv?: string; repo?: string; http?: string }
  install?: { brew?: { formula?: string; cask?: string }; winget?: string; steps?: 'hunyuan' }
  manual?: { text: string; url?: string; cmd?: string }
  /** Dịch vụ HTTP mà cổng tạo hình gọi tới (để báo đã cài nhưng chưa bật) */
  service?: string
}

export interface ToolStatus {
  id: string; name: string; desc: string; ok: boolean; where: string; note: string
  optional: boolean; heavy: string; needs: string[]; auto: boolean; manual: ToolDef['manual'] | null
  /** Dịch vụ: running = đang nghe; stopped = đã cài nhưng chưa bật; null = không phải dịch vụ */
  service: 'running' | 'stopped' | null
}

export interface ToolsOptions {
  /** Thư mục S Draw cài môi trường AI (thường là userData/tools) */
  root: string
  platform?: NodeJS.Platform
  home?: string
  pathEnv?: string
  appsDirs?: string[]
  fetchImpl?: typeof fetch
  /** Thay lệnh thật khi test: trả mã thoát */
  execImpl?: (bin: string, args: string[]) => Promise<number>
}

export const HUNYUAN_REPO = 'https://github.com/Tencent/Hunyuan3D-2'
export const HUNYUAN_PORT = 8081
const HUNYUAN_PKGS = ['torch', 'torchvision', 'transformers', 'diffusers', 'huggingface_hub', 'accelerate', 'einops', 'omegaconf', 'opencv-python', 'tqdm', 'trimesh', 'pymeshlab', 'pygltflib', 'xatlas', 'rembg', 'onnxruntime', 'fastapi', 'uvicorn', 'scikit-image', 'ninja', 'pybind11']

export function toolDefs(home: string, platform: NodeJS.Platform): ToolDef[] {
  const win = platform === 'win32'
  const PF = process.env['ProgramFiles'] || 'C:\\Program Files'
  return [
    { id: 'brew', name: 'Homebrew', only: 'darwin', desc: 'Trình cài gói cho Mac, S Draw dùng để tự cài các công cụ khác.', detect: { bins: ['brew'] },
      manual: { text: 'Mở Terminal, dán lệnh dưới, nhập mật khẩu Mac. Cài xong bấm Kiểm tra lại.', cmd: '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"', url: 'https://brew.sh' } },
    { id: 'winget', name: 'winget', only: 'win32', desc: 'Trình cài gói có sẵn trên Windows 10/11, S Draw dùng để tự cài các công cụ khác.', detect: { bins: ['winget'] },
      manual: { text: 'Cài "App Installer" từ Microsoft Store rồi bấm Kiểm tra lại.', url: 'https://apps.microsoft.com/detail/9NBLGGH4NNS1' } },
    { id: 'git', name: 'git', desc: 'Tải mã nguồn Hunyuan3D-2.', detect: { bins: ['git'] }, install: { brew: { formula: 'git' }, winget: 'Git.Git' } },
    { id: 'uv', name: 'uv', desc: 'Tạo môi trường Python riêng cho AI dựng 3D.', detect: { bins: ['uv'], files: [join(home, '.local', 'bin', win ? 'uv.exe' : 'uv')] }, install: { brew: { formula: 'uv' }, winget: 'astral-sh.uv' } },
    { id: 'hunyuan', name: 'Hunyuan3D-2 (AI dựng 3D trên máy)', needs: ['uv', 'git'], heavy: '~5 GB, mô hình tải thêm ở lần chạy đầu', service: `http://127.0.0.1:${HUNYUAN_PORT}`,
      desc: 'Ảnh hoặc mô tả thành mô hình GLB, chạy GPU Apple (M1 trở lên) hoặc card NVIDIA. Dữ liệu không ra khỏi máy.', detect: { venv: 'hunyuan', repo: 'Hunyuan3D-2' }, install: { steps: 'hunyuan' } },
    { id: 'drawthings', name: 'Draw Things', only: 'darwin', service: 'http://127.0.0.1:7860', desc: 'Vẽ ảnh ý tưởng và ảnh vân bằng AI trên Mac, không cần mạng.', detect: { apps: ['Draw Things.app'] }, install: { brew: { cask: 'draw-things' } } },
    { id: 'comfyui', name: 'ComfyUI', only: 'win32', optional: true, service: 'http://127.0.0.1:8188', desc: 'Vẽ ảnh bằng AI trên Windows (thay cho Draw Things).',
      detect: { files: [join(process.env['LOCALAPPDATA'] || join(home, 'AppData', 'Local'), 'Programs', '@comfyorgcomfyui-electron', 'ComfyUI.exe')] },
      manual: { text: 'Tải ComfyUI Desktop cho Windows rồi cài như app thường.', url: 'https://www.comfy.org/download' } },
    { id: 'blender', name: 'Blender', optional: true, desc: 'Sửa lưới, giảm mặt, gắn xương cho mô hình AI tạo ra trước khi đưa vào S Draw.',
      detect: { bins: ['blender'], apps: ['Blender.app'], files: win ? [join(PF, 'Blender Foundation', 'Blender*', 'blender.exe')] : [] }, install: { brew: { cask: 'blender' }, winget: 'BlenderFoundation.Blender' } }
  ]
}

export function createTools(opts: ToolsOptions) {
  const P = opts.platform ?? process.platform
  const win = P === 'win32'
  const H = opts.home ?? process.env['HOME'] ?? process.env['USERPROFILE'] ?? ''
  const SEP = win ? ';' : ':'
  const EXTRA_BIN = win ? [join(process.env['LOCALAPPDATA'] || join(H, 'AppData', 'Local'), 'Microsoft', 'WinGet', 'Links')] : ['/opt/homebrew/bin', '/usr/local/bin', join(H, '.local', 'bin')]
  const pathDirs = () => [...(opts.pathEnv ?? process.env['PATH'] ?? '').split(SEP), ...(opts.pathEnv !== undefined ? [] : EXTRA_BIN)].filter(Boolean)
  const appsDirs = opts.appsDirs ?? ['/Applications', join(H, 'Applications')]
  const fetchImpl = opts.fetchImpl ?? fetch
  const exts = win ? ['.exe', '.cmd', '.bat', ''] : ['']
  const isFile = (p: string) => { try { return statSync(p).isFile() } catch { return false } }
  const isDir = (p: string) => { try { return statSync(p).isDirectory() } catch { return false } }
  const which = (bin: string) => { for (const d of pathDirs()) for (const e of exts) { const p = join(d, bin + e); if (isFile(p)) return p } return '' }
  const glob = (pat: string): string[] => {
    if (!pat.includes('*')) return existsSync(pat) ? [pat] : []
    const dir = dirname(pat), seg = basename(pat)
    const parents = glob(dir)
    const re = new RegExp('^' + seg.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$', 'i')
    return parents.flatMap((p) => { try { return readdirSync(p).sort().reverse().filter((n) => re.test(n)).map((n) => join(p, n)) } catch { return [] } })
  }
  const venvPy = (dir: string) => join(dir, '.venv', win ? 'Scripts' : 'bin', win ? 'python.exe' : 'python')
  const LIST = toolDefs(H, P).filter((t) => !t.only || t.only === P)
  const byId = (id: string) => LIST.find((t) => t.id === id)
  const canAuto = (t: ToolDef) => !!(t.install && (t.install.steps || (win ? t.install.winget : t.install.brew)))

  async function alive(url: string): Promise<boolean> {
    try { await fetchImpl(url, { signal: AbortSignal.timeout(1500) }); return true } catch { return false }
  }

  async function check(t: ToolDef): Promise<ToolStatus> {
    const d = t.detect
    let where = '', note = ''
    for (const b of d.bins ?? []) { where = which(b); if (where) break }
    if (!where && !win) for (const a of d.apps ?? []) { const hit = appsDirs.map((x) => join(x, a)).find(isDir); if (hit) { where = hit; break } }
    if (!where) for (const f of d.files ?? []) { const hit = glob(f)[0]; if (hit) { where = hit; break } }
    if (!where && d.venv) {
      const dir = join(opts.root, d.venv)
      if (isFile(venvPy(dir)) && (!d.repo || isDir(join(dir, d.repo)))) where = dir
      else if (isDir(join(dir, d.repo ?? ''))) note = 'đã tải mã nguồn, chưa cài xong thư viện'
    }
    let service: ToolStatus['service'] = null
    if (t.service) {
      service = (await alive(t.service)) ? 'running' : 'stopped'
      if (service === 'running' && !where) { where = t.service; note = 'đang chạy' }
      else if (where) note = service === 'running' ? 'đang chạy' : t.id === 'drawthings' ? 'đã cài, chưa bật API Server' : 'đã cài, chưa chạy'
    }
    return { id: t.id, name: t.name, desc: t.desc, ok: !!where, where: H ? where.replace(H, '~') : where, note, optional: !!t.optional, heavy: t.heavy ?? '', needs: t.needs ?? [], auto: canAuto(t), manual: t.manual ?? null, service }
  }

  async function status() {
    const tools = await Promise.all(LIST.map(check))
    return { platform: P, supported: P === 'darwin' || P === 'win32', pm: win ? 'winget' : 'brew', tools, missing: tools.filter((t) => !t.ok && !t.optional).map((t) => t.name) }
  }

  // ---- Cài đặt: một việc một lúc, có nhật ký ----
  const LOG: { t: number; s: string }[] = []
  const log = (s: unknown) => { for (const l of String(s).split(/\r?\n/).filter((x) => x.trim())) { LOG.push({ t: Date.now(), s: l.slice(0, 1000) }); if (LOG.length > 500) LOG.shift() } }
  let job: { running: boolean; order: string[]; done: string[]; failed: { id: string; error: string }[]; current: string | null } | null = null

  const exec = opts.execImpl ?? ((bin: string, args: string[], env: Record<string, string> = {}) => new Promise<number>((resolve) => {
    log(`$ ${[basename(bin), ...args].join(' ')}`)
    let p: ChildProcess
    try { p = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env }, windowsHide: true }) } catch (e) { log((e as Error).message); resolve(1); return }
    p.stdout?.on('data', log); p.stderr?.on('data', log)
    p.on('error', (e) => { log(e.message); resolve(1) }); p.on('close', (c) => resolve(c ?? 1))
  }))
  const fail = (m: string): never => { throw new Error(m) }

  async function installOne(t: ToolDef): Promise<void> {
    const i = t.install ?? {}
    if (i.steps === 'hunyuan') {
      const uv = which('uv') || (isFile(join(H, '.local', 'bin', win ? 'uv.exe' : 'uv')) ? join(H, '.local', 'bin', win ? 'uv.exe' : 'uv') : '')
      if (!uv) fail('Cần uv trước.')
      const dir = join(opts.root, 'hunyuan'); mkdirSync(dir, { recursive: true })
      const repo = join(dir, 'Hunyuan3D-2')
      if (!isDir(repo) && await exec(which('git') || 'git', ['clone', '--depth', '1', HUNYUAN_REPO, repo])) fail('Tải mã nguồn Hunyuan3D-2 lỗi.')
      if (!isFile(venvPy(dir)) && await exec(uv, ['venv', '--python', '3.11', join(dir, '.venv')])) fail('Tạo môi trường Python lỗi.')
      if (await exec(uv, ['pip', 'install', '--python', venvPy(dir), ...HUNYUAN_PKGS])) fail('Cài thư viện Python lỗi, xem nhật ký.')
      if (await exec(uv, ['pip', 'install', '--python', venvPy(dir), '-e', repo])) fail('Cài Hunyuan3D-2 lỗi, xem nhật ký.')
      return
    }
    if (win) {
      const wg = which('winget')
      if (!wg) fail('Chưa có winget: cài "App Installer" từ Microsoft Store.')
      if (!i.winget) fail(`${t.name} chưa có gói winget, cài theo hướng dẫn.`)
      const c = await exec(wg, ['install', '--id', i.winget!, '-e', '--silent', '--accept-source-agreements', '--accept-package-agreements', '--disable-interactivity'])
      // -1978335189: đã cài, không có bản mới
      if (c && c !== -1978335189 && c !== 2316632107) fail(`Cài ${t.name} lỗi (mã ${c}), xem nhật ký.`)
      return
    }
    const br = which('brew')
    if (!br) fail('Chưa có Homebrew: cài Homebrew trước (xem hướng dẫn).')
    if (!i.brew) fail(`${t.name} chưa có gói Homebrew, cài theo hướng dẫn.`)
    const args = i.brew!.cask ? ['install', '--cask', i.brew!.cask] : ['install', i.brew!.formula!]
    if (await exec(br, args)) fail(`Cài ${t.name} lỗi, xem nhật ký.`)
  }

  async function install(ids: string[]): Promise<void> {
    if (job?.running) throw new Error('Đang cài, chờ xong.')
    const unknown = ids.filter((id) => !byId(id))
    if (unknown.length) throw new Error(`Không rõ công cụ: ${unknown.join(', ')}`)
    const manual = ids.filter((id) => !canAuto(byId(id)!))
    if (manual.length) throw new Error(`${manual.map((id) => byId(id)!.name).join(', ')} cần cài tay, xem hướng dẫn.`)
    const st = await status()
    const have = new Set(st.tools.filter((t) => t.ok).map((t) => t.id))
    // Công cụ cần trước còn thiếu thì cài trước
    const order: string[] = []
    const add = (id: string) => { const t = byId(id); if (!t || have.has(id) || order.includes(id)) return; (t.needs ?? []).forEach(add); order.push(id) }
    ids.forEach(add)
    LOG.length = 0
    job = { running: true, order, done: [], failed: [], current: null }
    const j = job
    if (!order.length) log('Không có gì cần cài.')
    for (const id of order) {
      const t = byId(id)!
      j.current = id; log(`— Cài ${t.name} —`)
      try { await installOne(t); j.done.push(id); log(`✓ Xong ${t.name}`) } catch (e) {
        j.failed.push({ id, error: (e as Error).message }); log(`✕ ${t.name}: ${(e as Error).message}`)
        if (order.some((x) => (byId(x)!.needs ?? []).includes(id))) { log(`Dừng vì công cụ sau cần ${t.name}.`); break }
      }
    }
    j.current = null; j.running = false
  }

  // ---- Máy chủ Hunyuan3D-2 ----
  let server: ChildProcess | null = null
  function startHunyuan(): void {
    if (server && server.exitCode === null) return
    const dir = join(opts.root, 'hunyuan'), repo = join(dir, 'Hunyuan3D-2')
    if (!isFile(venvPy(dir)) || !isDir(repo)) throw new Error('Chưa cài Hunyuan3D-2. Bấm Cài tự động trước.')
    const device = P === 'darwin' ? 'mps' : 'cuda'
    log(`$ python api_server.py --host 127.0.0.1 --port ${HUNYUAN_PORT} --device ${device}`)
    server = spawn(venvPy(dir), ['api_server.py', '--host', '127.0.0.1', '--port', String(HUNYUAN_PORT), '--model_path', 'tencent/Hunyuan3D-2mini', '--device', device], { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, env: { ...process.env, PYTORCH_ENABLE_MPS_FALLBACK: '1' } })
    server.stdout?.on('data', log); server.stderr?.on('data', log)
    server.on('close', (c) => { log(`Máy chủ Hunyuan dừng (mã ${c ?? '?'})`); server = null })
  }
  function stopHunyuan(): void { if (server) { server.kill(); server = null } }

  return {
    status, install, startHunyuan, stopHunyuan,
    logs: () => [...LOG],
    job: () => (job ? { ...job } : null),
    hunyuanRunning: () => !!server && server.exitCode === null
  }
}
