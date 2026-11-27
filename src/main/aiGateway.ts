/**
 * Cổng MCP cục bộ cho AI (Claude Desktop, Claude Code, ...): máy chủ HTTP chỉ nghe 127.0.0.1,
 * cần mã khoá Bearer, nói JSON-RPC theo MCP (Streamable HTTP, trả JSON). Lệnh dựng hình được
 * chuyển sang giao diện (nơi giữ mô hình và lịch sử hoàn tác); lệnh skill chạy ở đây với kho skill.
 */
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app, ipcMain, type BrowserWindow } from 'electron'
import { aiToolList, type AiFile } from '../core/aiTools'
import { BUILTIN_SKILLS, isSkill, skillId, type Skill } from '../core/skills'

export interface GatewayStatus {
  enabled: boolean
  running: boolean
  url: string
  token: string
  error: string | null
  /** Lần gọi gần nhất (để hiện cho người dùng thấy AI đang làm gì) */
  lastCall: string | null
}

interface Saved { enabled: boolean; port: number; token: string }

const DEFAULT_PORT = 39217
const PROTOCOL = '2025-06-18'

const cfgPath = () => join(app.getPath('userData'), 'ai-gateway.json')
const skillsPath = () => join(app.getPath('userData'), 'skills.json')
export const exportsDir = () => join(app.getPath('documents'), 'S Draw', 'AI')

let saved: Saved = { enabled: false, port: DEFAULT_PORT, token: '' }
let server: Server | null = null
let error: string | null = null
let lastCall: string | null = null
let seq = 0
const pending = new Map<number, (r: RendererResult) => void>()

interface RendererResult { ok: boolean; text: string; data?: Record<string, unknown>; file?: AiFile }

async function loadCfg(): Promise<void> {
  try { saved = { ...saved, ...(JSON.parse(await readFile(cfgPath(), 'utf8')) as Partial<Saved>) } } catch { /* chưa có */ }
  if (!saved.token) { saved.token = randomBytes(24).toString('base64url'); await saveCfg() }
}
async function saveCfg(): Promise<void> {
  await writeFile(cfgPath(), JSON.stringify(saved), 'utf8')
}

// ---------- Kho skill ----------

export async function userSkills(): Promise<Skill[]> {
  try {
    const raw = JSON.parse(await readFile(skillsPath(), 'utf8'))
    return Array.isArray(raw) ? raw.filter(isSkill).map((s) => ({ ...s, builtin: false })) : []
  } catch { return [] }
}
export async function allSkills(): Promise<Skill[]> {
  const mine = await userSkills()
  return [...BUILTIN_SKILLS.filter((b) => !mine.some((s) => s.id === b.id)), ...mine]
}
export async function saveSkill(input: unknown): Promise<Skill> {
  const s0 = input as Partial<Skill>
  const s: Skill = { id: s0.id && /^[a-z0-9-]{1,64}$/.test(s0.id) ? s0.id : skillId(String(s0.name ?? '')), name: String(s0.name ?? ''), description: String(s0.description ?? ''), params: s0.params ?? [], steps: s0.steps ?? [] }
  if (!isSkill(s)) throw new Error('Skill không hợp lệ: cần name, description, params [{name, default}], steps [{tool, args}]')
  const known = new Set(aiToolList().map((t) => t.name))
  const bad = s.steps.find((st) => !known.has(st.tool))
  if (bad) throw new Error(`Bước dùng lệnh không có: ${bad.tool}`)
  const mine = (await userSkills()).filter((x) => x.id !== s.id)
  mine.push(s)
  await writeFile(skillsPath(), JSON.stringify(mine, null, 1), 'utf8')
  return s
}
export async function deleteSkill(id: string): Promise<boolean> {
  const mine = await userSkills()
  const next = mine.filter((x) => x.id !== id)
  if (next.length === mine.length) return false
  await writeFile(skillsPath(), JSON.stringify(next, null, 1), 'utf8')
  return true
}

// ---------- Lệnh MCP ----------

const SKILL_TOOLS = [
  { name: 'list_skills', description: 'Liệt kê skill (quy trình mẫu có tham số) đã lưu trong S Draw: id, tên, mô tả, tham số.', inputSchema: { type: 'object', properties: {} } },
  { name: 'run_skill', description: 'Chạy một skill với tham số (mặc định nếu bỏ trống). Cả skill là một bước hoàn tác.', inputSchema: { type: 'object', required: ['skill_id'], properties: { skill_id: { type: 'string' }, params: { type: 'object' } } } },
  {
    name: 'save_skill',
    description: 'Lưu một quy trình thành skill để dùng lại. steps là danh sách {tool, args} dùng các lệnh của cổng này; trong args viết "${ten_tham_so}" hoặc biểu thức "${w/2 - 18}"; dùng kết quả bước trước bằng "$1.group_id", "$prev.face_id", "$3.new_groups[0]".',
    inputSchema: { type: 'object', required: ['name', 'description', 'steps'], properties: { id: { type: 'string' }, name: { type: 'string' }, description: { type: 'string' }, params: { type: 'array', items: { type: 'object', required: ['name', 'default'], properties: { name: { type: 'string' }, label: { type: 'string' }, default: { type: ['number', 'string'] } } } }, steps: { type: 'array', items: { type: 'object', required: ['tool', 'args'], properties: { tool: { type: 'string' }, args: { type: 'object' } } } } } }
  },
  { name: 'delete_skill', description: 'Xoá một skill do người dùng hoặc AI lưu (không xoá được skill có sẵn).', inputSchema: { type: 'object', required: ['skill_id'], properties: { skill_id: { type: 'string' } } } },
  { name: 'undo', description: 'Hoàn tác thao tác gần nhất trên mô hình.', inputSchema: { type: 'object', properties: {} } }
]

export function toolList() {
  return [...aiToolList(), ...SKILL_TOOLS]
}

function safeName(s: string): string {
  return s.replace(/[^\p{L}\p{N} _.-]+/gu, '_').trim().slice(0, 80) || 'mo-hinh'
}

async function writeExport(f: AiFile, toPdf: (svg: string) => Promise<Buffer>): Promise<string> {
  await mkdir(exportsDir(), { recursive: true })
  const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)
  const path = join(exportsDir(), `${safeName(f.name)} ${stamp}.${f.kind}`)
  await writeFile(path, f.kind === 'pdf' ? await toPdf(String(f.data)) : f.data)
  return path
}

function callRenderer(win: BrowserWindow, payload: Record<string, unknown>): Promise<RendererResult> {
  const id = ++seq
  return new Promise((resolve) => {
    const timer = setTimeout(() => { pending.delete(id); resolve({ ok: false, text: 'S Draw không phản hồi (quá 60 giây). Mở cửa sổ S Draw rồi thử lại.' }) }, 60_000)
    pending.set(id, (r) => { clearTimeout(timer); resolve(r) })
    win.webContents.send('ai:call', { id, ...payload })
  })
}

async function callTool(win: () => BrowserWindow | null, name: string, args: Record<string, unknown>, toPdf: (svg: string) => Promise<Buffer>): Promise<{ text: string; isError: boolean }> {
  lastCall = `${new Date().toLocaleTimeString('vi-VN')} ${name}`
  try {
    if (name === 'list_skills') return { text: JSON.stringify((await allSkills()).map((s) => ({ id: s.id, name: s.name, description: s.description, params: s.params, builtin: !!s.builtin }))), isError: false }
    if (name === 'save_skill') { const s = await saveSkill(args); win()?.webContents.send('skills:changed'); return { text: `Đã lưu skill "${s.name}" (id ${s.id})`, isError: false } }
    if (name === 'delete_skill') {
      const ok = await deleteSkill(String(args['skill_id'] ?? ''))
      if (ok) win()?.webContents.send('skills:changed')
      return { text: ok ? 'Đã xoá skill' : 'Không có skill này hoặc đó là skill có sẵn', isError: !ok }
    }
    const w = win()
    if (!w) return { text: 'Cửa sổ S Draw đang đóng', isError: true }
    let payload: Record<string, unknown> = { name, args }
    if (name === 'run_skill') {
      const s = (await allSkills()).find((x) => x.id === args['skill_id'])
      if (!s) return { text: `Không có skill "${String(args['skill_id'])}" (xem list_skills)`, isError: true }
      payload = { name, args, skill: s }
    } else if (name !== 'undo' && !aiToolList().some((t) => t.name === name)) return { text: `Không có lệnh "${name}"`, isError: true }
    const r = await callRenderer(w, payload)
    let text = r.text
    if (r.ok && r.file) text += `\nĐã lưu: ${await writeExport(r.file, toPdf)}`
    if (r.ok && r.data && !r.file) text += `\n${JSON.stringify(r.data)}`
    return { text, isError: !r.ok }
  } catch (e) {
    return { text: (e as Error).message, isError: true }
  }
}

// ---------- HTTP ----------

function send(res: ServerResponse, status: number, body?: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
  res.end(body === undefined ? '' : JSON.stringify(body))
}

function authorized(req: IncomingMessage): boolean {
  const h = req.headers['authorization'] ?? ''
  const got = Buffer.from(h.startsWith('Bearer ') ? h.slice(7) : '')
  const want = Buffer.from(saved.token)
  return got.length === want.length && timingSafeEqual(got, want)
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => { size += c.length; if (size > 2_000_000) { reject(new Error('Yêu cầu quá lớn')); req.destroy() } else chunks.push(c) })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

type Rpc = { jsonrpc: '2.0'; id?: string | number | null; method: string; params?: Record<string, unknown> }

async function handleRpc(msg: Rpc, win: () => BrowserWindow | null, toPdf: (svg: string) => Promise<Buffer>): Promise<unknown | undefined> {
  const reply = (result: unknown) => ({ jsonrpc: '2.0', id: msg.id ?? null, result })
  const fail = (code: number, message: string) => ({ jsonrpc: '2.0', id: msg.id ?? null, error: { code, message } })
  if (msg.id === undefined) return undefined // thông báo (notifications/initialized...)
  switch (msg.method) {
    case 'initialize':
      return reply({
        protocolVersion: typeof msg.params?.['protocolVersion'] === 'string' ? msg.params['protocolVersion'] : PROTOCOL,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'sdraw', title: 'S Draw', version: app.getVersion() },
        instructions: 'S Draw: phần mềm dựng hình nội thất. Đơn vị mm, trục Z hướng lên. Gọi model_info trước, find_faces để lấy id mặt, list_materials để lấy id vật liệu. Mỗi lệnh là một bước hoàn tác trong app. Dùng save_skill để lưu quy trình hay dùng.'
      })
    case 'ping':
      return reply({})
    case 'tools/list':
      return reply({ tools: toolList() })
    case 'tools/call': {
      const name = String(msg.params?.['name'] ?? '')
      const args = (msg.params?.['arguments'] ?? {}) as Record<string, unknown>
      const r = await callTool(win, name, args, toPdf)
      return reply({ content: [{ type: 'text', text: r.text }], isError: r.isError })
    }
    default:
      return fail(-32601, `Không hỗ trợ ${msg.method}`)
  }
}

function hostOk(req: IncomingMessage, port: number): boolean {
  const host = req.headers.host ?? ''
  return host === `127.0.0.1:${port}` || host === `localhost:${port}`
}

async function start(win: () => BrowserWindow | null, toPdf: (svg: string) => Promise<Buffer>): Promise<void> {
  if (server) return
  const srv = createServer((req, res) => {
    const port = (srv.address() as { port: number } | null)?.port ?? 0
    // Chặn trang web gọi vào (DNS rebinding, CSRF): chỉ nhận Host cục bộ và không có Origin của trình duyệt
    if (!hostOk(req, port) || req.headers.origin) return send(res, 403, { error: 'forbidden' })
    if (!authorized(req)) return send(res, 401, { error: 'unauthorized' })
    if (req.url !== '/mcp') return send(res, 404, { error: 'not found' })
    if (req.method === 'GET' || req.method === 'DELETE') return send(res, 405)
    if (req.method !== 'POST') return send(res, 405)
    readBody(req).then(async (raw) => {
      let msg: Rpc | Rpc[]
      try { msg = JSON.parse(raw) } catch { return send(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'JSON lỗi' } }) }
      const batch = Array.isArray(msg) ? msg : [msg]
      const out = (await Promise.all(batch.map((m) => handleRpc(m, win, toPdf)))).filter((x) => x !== undefined)
      if (!out.length) { res.writeHead(202); res.end(); return }
      send(res, 200, Array.isArray(msg) ? out : out[0])
    }).catch((e: Error) => send(res, 400, { error: e.message }))
  })
  await new Promise<void>((resolve) => {
    srv.once('error', (e: NodeJS.ErrnoException) => {
      if (e.code === 'EADDRINUSE' && saved.port === DEFAULT_PORT) {
        // Cổng mặc định bận: lấy cổng trống bất kỳ
        srv.listen(0, '127.0.0.1', () => resolve())
      } else { error = e.message; resolve() }
    })
    srv.listen(saved.port, '127.0.0.1', () => resolve())
  })
  if (srv.listening) { server = srv; error = null } else srv.close()
}

function stop(): void {
  server?.close()
  server = null
}

export function status(): GatewayStatus {
  const port = (server?.address() as { port: number } | null)?.port ?? saved.port
  return { enabled: saved.enabled, running: !!server, url: `http://127.0.0.1:${port}/mcp`, token: saved.token, error, lastCall }
}

export async function registerAiGateway(win: () => BrowserWindow | null, toPdf: (svg: string) => Promise<Buffer>): Promise<void> {
  await loadCfg()
  ipcMain.on('ai:result', (_e, r: { id: number } & RendererResult) => {
    const done = pending.get(r?.id)
    if (done) { pending.delete(r.id); done({ ok: !!r.ok, text: String(r.text ?? ''), ...(r.data ? { data: r.data } : {}), ...(r.file ? { file: r.file } : {}) }) }
  })
  ipcMain.handle('ai:status', () => status())
  ipcMain.handle('ai:setEnabled', async (_e, on: boolean) => {
    saved.enabled = !!on
    await saveCfg()
    if (saved.enabled) await start(win, toPdf)
    else stop()
    return status()
  })
  ipcMain.handle('ai:newToken', async () => {
    saved.token = randomBytes(24).toString('base64url')
    await saveCfg()
    return status()
  })
  ipcMain.handle('skills:list', () => allSkills())
  ipcMain.handle('skills:save', (_e, s: unknown) => saveSkill(s))
  ipcMain.handle('skills:delete', (_e, id: string) => deleteSkill(String(id)))
  if (saved.enabled) await start(win, toPdf)
  app.on('before-quit', stop)
}
