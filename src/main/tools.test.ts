import { describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, writeFileSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createTools } from './tools'

function fakeBin(dir: string, name: string) { const p = join(dir, name); writeFileSync(p, '#!/bin/sh\n'); chmodSync(p, 0o755) }
const down = (async () => { throw new Error('off') }) as unknown as typeof fetch

describe('công cụ trên máy', () => {
  it('Mac: dò lệnh, app, dịch vụ đang chạy hay chưa bật', async () => {
    const home = mkdtempSync(join(tmpdir(), 'sd-tools-')), bin = join(home, 'bin'), apps = join(home, 'Apps')
    mkdirSync(bin); mkdirSync(join(apps, 'Draw Things.app'), { recursive: true })
    fakeBin(bin, 'brew'); fakeBin(bin, 'git')
    const t = createTools({ root: join(home, 'tools'), platform: 'darwin', home, pathEnv: bin, appsDirs: [apps], fetchImpl: down })
    const s = await t.status()
    const get = (id: string) => s.tools.find((x) => x.id === id)!
    expect(get('brew').ok).toBe(true)
    expect(get('uv').ok).toBe(false)
    expect(get('drawthings')).toMatchObject({ ok: true, service: 'stopped', note: 'đã cài, chưa bật API Server' })
    expect(get('hunyuan')).toMatchObject({ ok: false, auto: true, needs: ['uv', 'git'] })
    expect(s.tools.some((x) => x.id === 'winget' || x.id === 'comfyui')).toBe(false)
    expect(s.missing).toContain('uv')
    const up = (async () => new Response('{}')) as unknown as typeof fetch
    const t2 = createTools({ root: join(home, 'tools'), platform: 'darwin', home, pathEnv: bin, appsDirs: [apps], fetchImpl: up })
    expect((await t2.status()).tools.find((x) => x.id === 'drawthings')!.note).toBe('đang chạy')
  })
  it('cài: tự thêm công cụ cần trước, đúng lệnh brew; cài tay thì từ chối', async () => {
    const home = mkdtempSync(join(tmpdir(), 'sd-tools-')), bin = join(home, 'bin')
    mkdirSync(bin); fakeBin(bin, 'brew'); fakeBin(bin, 'git')
    const ran: string[] = []
    const t = createTools({ root: join(home, 'tools'), platform: 'darwin', home, pathEnv: bin, appsDirs: [], fetchImpl: down, execImpl: async (b, a) => { ran.push([b.split('/').pop(), ...a].join(' ')); if (a[0] === 'install' && a[1] === 'uv') fakeBin(bin, 'uv'); return 0 } })
    await t.install(['hunyuan'])
    expect(ran[0]).toBe('brew install uv')
    expect(ran.some((x) => x.startsWith('git clone --depth 1 https://github.com/Tencent/Hunyuan3D-2'))).toBe(true)
    expect(ran.some((x) => x.startsWith('uv venv --python 3.11'))).toBe(true)
    expect(t.job()).toMatchObject({ running: false, order: ['uv', 'hunyuan'], done: ['uv', 'hunyuan'] })
    await expect(t.install(['brew'])).rejects.toThrow('cần cài tay')
    await expect(t.install(['khong-co'])).rejects.toThrow('Không rõ')
  })
  it('Windows: dùng winget, không có Draw Things', async () => {
    const home = mkdtempSync(join(tmpdir(), 'sd-tools-')), bin = join(home, 'bin')
    mkdirSync(bin); fakeBin(bin, 'winget.exe')
    const ran: string[] = []
    const t = createTools({ root: join(home, 'tools'), platform: 'win32', home, pathEnv: bin, fetchImpl: down, execImpl: async (b, a) => { ran.push(a.join(' ')); return 0 } })
    const s = await t.status()
    expect(s.pm).toBe('winget')
    expect(s.tools.some((x) => x.id === 'drawthings')).toBe(false)
    await t.install(['blender'])
    expect(ran[0]).toContain('install --id BlenderFoundation.Blender -e --silent')
  })
})
