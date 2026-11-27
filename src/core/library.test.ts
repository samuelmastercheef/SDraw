import { describe, expect, it } from 'vitest'
import { importFile, importLibrary } from './importers'

const lib = (items: unknown[], over: Record<string, unknown> = {}) => JSON.stringify({ format: 'sdraw-library', version: 1, units: 'mm', items, ...over })

describe('thư viện từ plugin SketchUp', () => {
  it('đọc kích thước đã đo, giữ đường dẫn .skp và phân loại', () => {
    const r = importLibrary('/x/thu-vien.sdlib.json', lib([{ name: 'Sofa góc L', path: '/m/sofa.skp', category: 'Sofa', w: 2700, d: 900, h: 800 }]))
    if ('error' in r) throw new Error(r.error)
    const it = r.items[0]!
    expect(it.needsDimensions).toBe(false)
    expect(it.sample).toMatchObject({ name: 'Sofa góc L', category: 'Sofa', w: 2700, d: 900, h: 800, skpPath: '/m/sofa.skp', origin: 'upload', sourceType: 'skp', needsReview: false })
  })
  it('thiếu hoặc sai kích thước thì bắt nhập tay, không bịa số', () => {
    const r = importLibrary('/x/a.json', lib([{ name: 'Lạ', path: '/m/a.skp', w: -5, d: 'x', h: 800 }, { name: 'Ghế', path: '/m/g.skp', w: 450, d: 480, h: 900 }]))
    if ('error' in r) throw new Error(r.error)
    expect(r.items[0]!.needsDimensions).toBe(true)
    expect(r.items[0]!.sample.needsReview).toBe(true)
    expect(r.items[1]!.sample.category).toBe('Ghế')
  })
  it('mẫu chưa phân loại vẫn cần duyệt dù có kích thước', () => {
    const r = importLibrary('/x/a.json', lib([{ name: 'abc123', path: '/m/a.skp', w: 100, d: 100, h: 100 }]))
    if ('error' in r) throw new Error(r.error)
    expect(r.items[0]!.sample.needsReview).toBe(true)
  })
  it('từ chối JSON lạ, sai phiên bản, hỏng', () => {
    expect('error' in importLibrary('/x', '{"a":1}')).toBe(true)
    expect('error' in importLibrary('/x', lib([], { version: 2 }))).toBe(true)
    expect('error' in importLibrary('/x', 'không phải json')).toBe(true)
    expect('error' in importLibrary('/x', lib([], { items: 'x' }))).toBe(true)
  })
  it('id ổn định: nhập lại cùng file ra cùng id', () => {
    const a = importLibrary('/x', lib([{ name: 'S', path: '/m/s.skp', w: 1, d: 2, h: 3 }]))
    const b = importLibrary('/x', lib([{ name: 'S', path: '/m/s.skp', w: 1, d: 2, h: 3 }]))
    if ('error' in a || 'error' in b) throw new Error('lỗi')
    expect(a.items[0]!.sample.id).toBe(b.items[0]!.sample.id)
  })
  it('importFile không nhầm file .json là mẫu thường', () => {
    expect('error' in importFile('/x/a.json', new TextEncoder().encode('{}'))).toBe(true)
  })
})

import { isUnderlay, withoutUnderlay } from './shapes'
import { newTableSketch } from './furniture'
import { sketchToSample } from './sofa'

describe('ảnh nền trong phác thảo', () => {
  const u = { src: 'data:image/png;base64,AAAA', name: 'mb.png', px: 800, py: 600, x: 10, y: -5, scale: 2.5, opacity: 0.5 }
  it('hợp lệ chỉ với png/jpeg dạng data URL và số hữu hạn', () => {
    expect(isUnderlay(u)).toBe(true)
    expect(isUnderlay({ ...u, src: 'https://x/y.png' })).toBe(false)
    expect(isUnderlay({ ...u, src: 'data:text/html;base64,AAAA' })).toBe(false)
    expect(isUnderlay({ ...u, scale: 0 })).toBe(false)
    expect(isUnderlay({ ...u, opacity: 2 })).toBe(false)
    expect(isUnderlay({ ...u, x: NaN })).toBe(false)
    expect(isUnderlay({ ...u, src: 'data:image/png;base64,' + 'A'.repeat(23 * 1024 * 1024) })).toBe(false)
  })
  it('đi qua JSON nguyên vẹn, và không lọt vào mẫu trong kho', () => {
    const doc = { ...newTableSketch('rect'), underlay: u }
    expect((JSON.parse(JSON.stringify(doc)) as typeof doc).underlay).toEqual(u)
    expect(withoutUnderlay(doc).underlay).toBeUndefined()
    expect(sketchToSample(doc, 'x').sketch?.underlay).toBeUndefined()
    expect(JSON.stringify(sketchToSample(doc, 'x'))).not.toContain('AAAA')
  })
})
