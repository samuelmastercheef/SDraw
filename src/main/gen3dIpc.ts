/**
 * Nối cổng tạo hình 3D và công cụ trên máy vào IPC. Khoá API mã hoá bằng safeStorage của hệ điều hành
 * (Keychain trên Mac, DPAPI trên Windows), lưu ở userData/gen3d-keys.json; renderer chỉ biết "đã có khoá".
 */
import { app, ipcMain, safeStorage, shell, type BrowserWindow } from 'electron'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { GEN3D_PROVIDERS, providerById, validKey, type Gen3dProviderId } from '../core/gen3d'
import { runGen3d, type Gen3dRequest } from './gen3dRun'
import { createTools, toolDefs } from './tools'

const keysFile = () => join(app.getPath('userData'), 'gen3d-keys.json')

async function readKeys(): Promise<Record<string, string>> {
  try { return JSON.parse(await readFile(keysFile(), 'utf8')) as Record<string, string> } catch { return {} }
}

async function getKey(id: Gen3dProviderId): Promise<string | null> {
  const enc = (await readKeys())[id]
  if (!enc || !safeStorage.isEncryptionAvailable()) return null
  try { return safeStorage.decryptString(Buffer.from(enc, 'base64')) } catch { return null }
}

export function registerGen3d(win: () => BrowserWindow | null): () => void {
  const tools = createTools({ root: join(app.getPath('userData'), 'tools') })
  let running: AbortController | null = null

  ipcMain.handle('gen3d:status', async () => {
    const keys = await readKeys()
    return { providers: GEN3D_PROVIDERS.map((p) => ({ id: p.id, hasKey: !!keys[p.id] })), encryption: safeStorage.isEncryptionAvailable() }
  })
  ipcMain.handle('gen3d:setKey', async (_e, id: string, key: string | null) => {
    const p = providerById(id)
    if (!p || p.where !== 'cloud') throw new Error('Nhà cung cấp này không dùng khoá')
    const keys = await readKeys()
    if (key === null) delete keys[p.id]
    else {
      if (!validKey(p.id, String(key))) throw new Error(`Khoá ${p.name} không đúng dạng`)
      if (!safeStorage.isEncryptionAvailable()) throw new Error('Máy này chưa hỗ trợ mã hoá khoá (cần đăng nhập phiên người dùng của hệ điều hành)')
      keys[p.id] = safeStorage.encryptString(String(key).trim()).toString('base64')
    }
    await writeFile(keysFile(), JSON.stringify(keys), { encoding: 'utf8', mode: 0o600 })
    return true
  })
  ipcMain.handle('gen3d:run', async (_e, req: Gen3dRequest) => {
    if (running) throw new Error('Đang tạo một mô hình, chờ xong hoặc bấm Huỷ')
    running = new AbortController()
    try {
      return await runGen3d(req, { key: getKey, signal: running.signal, onProgress: (p) => win()?.webContents.send('gen3d:progress', p) })
    } finally { running = null }
  })
  ipcMain.handle('gen3d:cancel', () => { running?.abort() })

  ipcMain.handle('tools:status', async () => ({ ...(await tools.status()), job: tools.job(), hunyuanRunning: tools.hunyuanRunning() }))
  ipcMain.handle('tools:install', (_e, ids: unknown) => {
    const list = Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string').slice(0, 20) : []
    // Chạy nền; giao diện hỏi tools:status và tools:logs để xem tiến độ
    void tools.install(list).catch((e: Error) => win()?.webContents.send('tools:error', e.message))
    return true
  })
  ipcMain.handle('tools:logs', () => tools.logs())
  ipcMain.handle('tools:startHunyuan', () => { tools.startHunyuan(); return true })
  ipcMain.handle('tools:stopHunyuan', () => { tools.stopHunyuan(); return true })
  // Chỉ mở các trang hướng dẫn có trong danh sách
  const allowed = new Set([...GEN3D_PROVIDERS.map((p) => p.keyUrl), ...toolDefs('', process.platform).map((t) => t.manual?.url)].filter((u): u is string => !!u))
  ipcMain.handle('tools:openUrl', async (_e, url: string) => { if (allowed.has(url)) await shell.openExternal(url) })

  return () => tools.stopHunyuan()
}
