import { describe, expect, it } from 'vitest'
import { newTableSketch } from './furniture'
import { isoDrawing } from './isometric'
import { partsFor } from './parts'

describe('xem trước 3D', () => {
  it('một khối hộp cho đúng 3 mặt nhìn thấy: trên, trước, phải', () => {
    const d = isoDrawing([{ name: 'k', kind: 'box', x: 0, y: 0, z: 0, w: 100, d: 100, h: 100 }])
    expect(d.polys).toHaveLength(3)
    expect(d.polys.filter((p) => p.fill === '#E7F3F4')).toHaveLength(1)
  })
  it('bàn có mặt trên và các chân; hình nằm trong khung và có kích thước dương', () => {
    const d = isoDrawing(partsFor(newTableSketch('rect'))!, 400)
    expect(d.polys.length).toBeGreaterThan(10)
    expect(d.width).toBeGreaterThan(0)
    expect(d.width).toBeLessThanOrEqual(420)
    for (const p of d.polys) for (const pt of p.points.split(' ')) {
      const [x, y] = pt.split(',').map(Number)
      expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThanOrEqual(d.width)
      expect(y).toBeGreaterThanOrEqual(0); expect(y).toBeLessThanOrEqual(d.height)
    }
  })
  it('mặt elip được vẽ bằng nhiều đoạn, không rỗng', () => {
    const d = isoDrawing([{ name: 'e', kind: 'ellipse', x: 0, y: 0, z: 700, w: 1000, d: 1000, h: 30 }])
    expect(d.polys.length).toBeGreaterThan(5)
  })
  it('danh sách rỗng', () => {
    expect(isoDrawing([])).toEqual({ polys: [], width: 0, height: 0 })
  })
})
