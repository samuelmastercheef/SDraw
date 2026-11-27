import { describe, expect, it } from 'vitest'
import { parseImageDataUrl, parseMeshyTask, parseTripoTask, safeResultUrl, validKey } from '../core/gen3d'
import { MESHY_BASE, TRIPO_BASE, runGen3d } from './gen3dRun'

const glb = () => new Uint8Array([0x67, 0x6c, 0x54, 0x46, 2, 0, 0, 0, ...new Array(40).fill(0)])
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } })
const nosleep = async () => {}

describe('cổng tạo hình 3D: đọc phản hồi', () => {
  it('khoá, ảnh, địa chỉ kết quả', () => {
    expect(validKey('tripo', 'tsk_abcdefghijklmnop')).toBe(true)
    expect(validKey('tripo', 'msy_abcdefghijklmnop')).toBe(false)
    expect(validKey('meshy', 'msy_abc def ghijklmnop')).toBe(false)
    expect(parseImageDataUrl(png).mime).toBe('image/png')
    expect(() => parseImageDataUrl('data:image/svg+xml;base64,PHN2Zz4=')).toThrow()
    expect(safeResultUrl('https://cdn.tripo3d.ai/x.glb')).toBe(true)
    expect(safeResultUrl('http://cdn.tripo3d.ai/x.glb')).toBe(false)
    expect(safeResultUrl('https://127.0.0.1/x.glb')).toBe(false)
    expect(safeResultUrl('https://192.168.1.4/x.glb')).toBe(false)
  })
  it('trạng thái Tripo và Meshy', () => {
    expect(parseTripoTask({ data: { status: 'running', progress: 40 } })).toEqual({ state: 'running', progress: 40 })
    expect(parseTripoTask({ data: { status: 'success', output: { model_url: 'https://a/b.glb' } } })).toEqual({ state: 'done', url: 'https://a/b.glb' })
    expect(parseTripoTask({ data: { status: 'failed', error_message: 'ảnh mờ' } }).state).toBe('failed')
    expect(parseMeshyTask({ status: 'IN_PROGRESS', progress: 10 })).toEqual({ state: 'running', progress: 10 })
    expect(parseMeshyTask({ status: 'SUCCEEDED', model_urls: { glb: 'https://m/x.glb' } })).toEqual({ state: 'done', url: 'https://m/x.glb' })
    expect(parseMeshyTask({ status: 'FAILED', task_error: { message: 'x' } })).toEqual({ state: 'failed', error: 'Meshy báo FAILED: x' })
  })
})

describe('cổng tạo hình 3D: chạy', () => {
  it('Tripo từ ảnh: tải ảnh lên, tạo việc, chờ, tải GLB', async () => {
    const calls: string[] = []
    let polls = 0
    const f = (async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`)
      expect((init?.headers as Record<string, string> | undefined)?.authorization ?? 'Bearer tsk_k').toBe('Bearer tsk_k')
      if (url === `${TRIPO_BASE}/files`) return json({ code: 0, data: { file_token: 'file_1' } })
      if (url.endsWith('/generation/image-to-model')) { expect(JSON.parse(String(init!.body)).input).toBe('file_1'); return json({ code: 0, data: { task_id: 't-1' } }) }
      if (url.endsWith('/tasks/t-1')) return json({ data: ++polls < 3 ? { status: 'running', progress: polls * 30 } : { status: 'success', output: { model_url: 'https://cdn.tripo3d.ai/o.glb' } } })
      if (url === 'https://cdn.tripo3d.ai/o.glb') return new Response(glb())
      throw new Error(url)
    }) as typeof fetch
    const prog: number[] = []
    const r = await runGen3d({ provider: 'tripo', image: png, prompt: 'Ghế gỗ' }, { key: async () => 'tsk_k', fetchImpl: f, sleep: nosleep, onProgress: (p) => prog.push(p.progress) })
    expect(r.kind).toBe('glb')
    expect(r.name).toBe('Ghe-go.glb')
    expect(calls[0]).toBe(`POST ${TRIPO_BASE}/files`)
    expect(prog).toContain(60)
  })
  it('Meshy từ mô tả; thiếu khoá thì báo; khoá sai thì báo rõ', async () => {
    const f = (async (url: string, init?: RequestInit) => {
      if (url === `${MESHY_BASE}/openapi/v2/text-to-3d`) { expect(JSON.parse(String(init!.body)).mode).toBe('preview'); return json({ result: 'm-1' }) }
      if (url.endsWith('/text-to-3d/m-1')) return json({ status: 'SUCCEEDED', model_urls: { glb: 'https://assets.meshy.ai/x.glb' } })
      return new Response(glb())
    }) as typeof fetch
    expect((await runGen3d({ provider: 'meshy', prompt: 'tủ' }, { key: async () => 'msy_k', fetchImpl: f, sleep: nosleep })).kind).toBe('glb')
    await expect(runGen3d({ provider: 'meshy', prompt: 'tủ' }, { key: async () => null, fetchImpl: f })).rejects.toThrow('Chưa có khoá API')
    const deny = (async () => json({ message: 'bad key' }, 401)) as unknown as typeof fetch
    await expect(runGen3d({ provider: 'meshy', prompt: 'tủ' }, { key: async () => 'msy_k', fetchImpl: deny })).rejects.toThrow('từ chối khoá API')
  })
  it('Hunyuan trên máy trả GLB thẳng; chưa chạy thì hướng dẫn bấm chạy', async () => {
    const ok = (async (url: string, init?: RequestInit) => { expect(url).toBe('http://127.0.0.1:8081/generate'); expect(JSON.parse(String(init!.body)).image).toBeTruthy(); return new Response(glb()) }) as typeof fetch
    expect((await runGen3d({ provider: 'hunyuan-local', image: png }, { key: async () => null, fetchImpl: ok })).kind).toBe('glb')
    const down = (async () => { throw new Error('ECONNREFUSED') }) as typeof fetch
    await expect(runGen3d({ provider: 'hunyuan-local', image: png }, { key: async () => null, fetchImpl: down })).rejects.toThrow('Chạy máy chủ Hunyuan')
  })
  it('Draw Things ra ảnh; không nhận ảnh đầu vào; tệp kết quả lạ bị từ chối', async () => {
    const f = (async () => json({ images: ['iVBORw0KGgo='] })) as unknown as typeof fetch
    const r = await runGen3d({ provider: 'drawthings', prompt: 'vân gỗ sồi' }, { key: async () => null, fetchImpl: f })
    expect(r.kind === 'image' && r.dataUrl.startsWith('data:image/png;base64,')).toBe(true)
    await expect(runGen3d({ provider: 'drawthings', image: png }, { key: async () => null, fetchImpl: f })).rejects.toThrow('không nhận ảnh')
    const evil = (async (url: string) => url.endsWith('/text-to-3d') ? json({ result: 'm-2' }) : json({ status: 'SUCCEEDED', model_urls: { glb: 'http://10.0.0.1/x.glb' } })) as typeof fetch
    await expect(runGen3d({ provider: 'meshy', prompt: 'x' }, { key: async () => 'msy_k', fetchImpl: evil, sleep: nosleep })).rejects.toThrow('không an toàn')
  })
})
