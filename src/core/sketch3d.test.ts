import { describe, expect, it } from 'vitest'
import { addSketchTo3d, shapeOutline } from './sketch3d'
import { bounds, emptyModel, faceList } from './model3d'
import { newSketchFor } from './furniture'
import { makeShape, type SketchDoc } from './shapes'

const free = (shapes: SketchDoc['shapes'], heightMm = 900): SketchDoc => ({ version: 1, name: 'Tự do', category: 'Khác', kind: '', params: {}, heightMm, manualEdits: true, shapes })

describe('dựng 3D từ phác thảo', () => {
  it('mẫu có thông số dựng theo bộ phận, đúng kích thước', () => {
    const doc = newSketchFor('Bàn', 'rect')
    const r = addSketchTo3d(emptyModel(), doc)
    expect(r.mode).toBe('parts')
    expect(r.groupIds.length).toBeGreaterThanOrEqual(5)
    const b = bounds(r.model)!
    expect(Math.round(b.max[2] - b.min[2])).toBe(Math.round(doc.params['height']!))
    expect(Math.round(b.max[0] - b.min[0])).toBe(Math.round(doc.params['width']!))
    expect(b.max[1]).toBeLessThanOrEqual(0.5)
  })

  it('mọi loại mẫu có sẵn đều dựng được', () => {
    for (const c of ['Sofa', 'Bàn', 'Ghế', 'Giường', 'Kệ sách', 'Tủ quần áo'] as const) {
      const r = addSketchTo3d(emptyModel(), newSketchFor(c))
      expect(r.groupIds.length, c).toBeGreaterThan(0)
      expect(faceList(r.model).length, c).toBeGreaterThan(0)
    }
  })

  it('vẽ tự do: đùn hình khép kín, bỏ đường hở và kích thước', () => {
    const doc = free([
      makeShape({ kind: 'path', role: 'outline', closed: true, nodes: [{ x: 100, y: 100 }, { x: 1100, y: 100 }, { x: 1100, y: 600 }, { x: 600, y: 600 }, { x: 600, y: 400 }, { x: 100, y: 400 }] }),
      makeShape({ kind: 'ellipse', role: 'detail', nodes: [{ x: 300, y: 250 }, { x: 380, y: 310 }] }),
      makeShape({ kind: 'path', role: 'detail', closed: false, nodes: [{ x: 0, y: 0 }, { x: 50, y: 50 }] }),
      makeShape({ kind: 'dim', role: 'dimension', nodes: [{ x: 0, y: 0 }, { x: 1000, y: 0 }] })
    ])
    const r = addSketchTo3d(emptyModel(), doc)
    expect(r.mode).toBe('extrude')
    expect(r.groupIds).toHaveLength(2)
    expect(r.skipped).toBe(0)
    const b = bounds(r.model)!
    expect(b.min).toEqual([0, -500, 0])
    expect(b.max).toEqual([1000, 0, 900])
    // Khối chữ L: đáy, nóc và 6 vách
    const g = r.groupIds[0]!
    expect(faceList(r.model).filter((f) => f.group === g)).toHaveLength(8)
  })

  it('đường cong làm mượt thành nhiều điểm, đặt theo gốc và thêm vào mô hình sẵn có', () => {
    const s = makeShape({ kind: 'path', role: 'outline', closed: true, smooth: true, nodes: [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 300 }, { x: 0, y: 300 }] })
    expect(shapeOutline(s).length).toBe(48)
    const first = addSketchTo3d(emptyModel(), free([s], 0))
    const second = addSketchTo3d(first.model, free([s], 0), [2000, 0, 0])
    expect(Object.keys(second.model.groups)).toHaveLength(2)
    const b = bounds(second.model)!
    expect(b.max[0]).toBeGreaterThan(2300)
    expect(b.max[2]).toBe(750)
  })

  it('hình tự cắt được bỏ qua và đếm', () => {
    const bow = makeShape({ kind: 'path', role: 'outline', closed: true, nodes: [{ x: 0, y: 0 }, { x: 100, y: 100 }, { x: 100, y: 0 }, { x: 0, y: 100 }] })
    const ok = makeShape({ kind: 'path', role: 'detail', closed: true, nodes: [{ x: 200, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 100 }] })
    const r = addSketchTo3d(emptyModel(), free([bow, ok]))
    expect(r.groupIds.length + r.skipped).toBe(2)
    expect(r.groupIds.length).toBeGreaterThanOrEqual(1)
  })
})
