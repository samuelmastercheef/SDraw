import { describe, expect, it, vi } from 'vitest'
import { createRegistry, type ExporterExtension } from './extensions'

const make = (id: string, order?: number): ExporterExtension => ({ id, order, label: id, note: '', run: async () => null })

describe('sổ đăng ký mở rộng', () => {
  it('sắp theo order rồi theo thứ tự đăng ký', () => {
    const r = createRegistry<ExporterExtension>()
    r.register(make('b'))
    r.register(make('a', 10))
    r.register(make('c'))
    expect(r.list().map((e) => e.id)).toEqual(['a', 'b', 'c'])
  })

  it('từ chối trùng id trừ khi thay thế', () => {
    const r = createRegistry<ExporterExtension>()
    r.register(make('dxf'))
    expect(() => r.register(make('dxf'))).toThrow(/dxf/)
    const pro = { ...make('dxf'), label: 'DXF Pro' }
    r.register(pro, { replace: true })
    expect(r.get('dxf')?.label).toBe('DXF Pro')
    expect(r.list()).toHaveLength(1)
  })

  it('hàm gỡ chỉ gỡ đúng bản đã đăng ký', () => {
    const r = createRegistry<ExporterExtension>()
    const off = r.register(make('x'))
    r.register({ ...make('x'), label: 'mới' }, { replace: true })
    off()
    expect(r.get('x')?.label).toBe('mới')
  })

  it('báo người theo dõi khi thay đổi', () => {
    const r = createRegistry<ExporterExtension>()
    const fn = vi.fn()
    const stop = r.subscribe(fn)
    const off = r.register(make('a'))
    off()
    stop()
    r.register(make('b'))
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('bắt buộc có id', () => {
    const r = createRegistry<ExporterExtension>()
    expect(() => r.register(make(''))).toThrow()
  })
})
