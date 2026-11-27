import { describe, expect, it } from 'vitest'
import { newSimpleSketch, newTableSketch, newChairSketch, rebuildFromParams } from './furniture'
import { fitParts, partsFor } from './parts'
import { newSofaSketch } from './sofa'
import { sketchSize, type SketchDoc } from './shapes'

const all = (): SketchDoc[] => [
  newSofaSketch('straight'), newSofaSketch('L'), newSofaSketch('round'),
  newTableSketch('rect'), newTableSketch('round'), newTableSketch('oval'), newChairSketch(),
  newSimpleSketch('Giường'), newSimpleSketch('Kệ sách'), newSimpleSketch('Tủ quần áo')
]

describe('dựng 3D thô từ thông số', () => {
  it('mọi loại: khối có kích thước dương và nằm trong hộp bao w × d × cao', () => {
    for (const doc of all()) {
      const parts = partsFor(doc)!
      expect(parts.length, doc.name).toBeGreaterThan(1)
      const { w, d } = sketchSize(doc)
      for (const p of parts) {
        expect(p.w, `${doc.name}/${p.name}`).toBeGreaterThan(0)
        expect(p.d).toBeGreaterThan(0)
        expect(p.h).toBeGreaterThan(0)
        expect(p.x).toBeGreaterThanOrEqual(0)
        expect(p.y).toBeGreaterThanOrEqual(0)
        expect(p.z).toBeGreaterThanOrEqual(0)
        expect(p.x + p.w, `${doc.name}/${p.name} vượt rộng`).toBeLessThanOrEqual(w + 1)
        expect(p.y + p.d, `${doc.name}/${p.name} vượt sâu`).toBeLessThanOrEqual(d + 1)
        expect(p.z + p.h, `${doc.name}/${p.name} vượt cao`).toBeLessThanOrEqual(doc.heightMm + 1)
      }
    }
  })
  it('giá trị cực biên vẫn cho khối hợp lệ', () => {
    const tiny = rebuildFromParams(newSofaSketch('straight'), { width: 900, depth: 600, height: 300 })
    const tall = rebuildFromParams(newSimpleSketch('Tủ quần áo'), { width: 5000, depth: 900, height: 3000, doors: 8 })
    for (const doc of [tiny, tall]) for (const p of partsFor(doc)!) { expect(p.w).toBeGreaterThan(0); expect(p.h).toBeGreaterThan(0) }
  })
  it('bàn: mặt bàn ở trên cùng, bốn chân chạm sàn; bàn tròn có mặt elip', () => {
    const parts = partsFor(newTableSketch('rect'))!
    const top = parts.find((p) => p.name === 'Mặt bàn')!
    expect(top.z + top.h).toBe(750)
    expect(parts.filter((p) => p.name.startsWith('Chân') && p.z === 0)).toHaveLength(4)
    expect(partsFor(newTableSketch('round'))!.find((p) => p.name === 'Mặt bàn')!.kind).toBe('ellipse')
  })
  it('tủ chia đúng số cánh, kệ có n + 1 tấm ngang', () => {
    expect(partsFor(newSimpleSketch('Tủ quần áo', { doors: 4 }))!.filter((p) => p.name.startsWith('Cánh'))).toHaveLength(4)
    const shelf = partsFor(newSimpleSketch('Kệ sách', { shelves: 5 }))!
    expect(shelf.filter((p) => p.name === 'Đáy' || p.name === 'Nóc' || p.name.startsWith('Tầng'))).toHaveLength(6)
  })
  it('sofa chữ L có thêm đế và đệm chaise', () => {
    const names = partsFor(newSofaSketch('L'))!.map((p) => p.name)
    expect(names).toContain('Đế chaise')
    expect(names).toContain('Đệm chaise')
    expect(partsFor(newSofaSketch('straight'))!.map((p) => p.name)).not.toContain('Đế chaise')
  })
  it('co giãn theo kích thước trong bố cục', () => {
    const doc = newSimpleSketch('Giường')
    const fit = fitParts(partsFor(doc)!, doc, 2000, 2200, 1000)
    const frame = fit.find((p) => p.name === 'Khung giường')!
    expect(frame.w).toBe(2000)
    expect(frame.d).toBe(2200)
  })
  it('loại chưa hỗ trợ trả về null', () => {
    expect(partsFor({ ...newChairSketch(), category: 'Khác' })).toBeNull()
  })
})
