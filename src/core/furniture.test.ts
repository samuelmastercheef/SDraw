import { describe, expect, it } from 'vitest'
import { clampBed, clampShelf, clampWardrobe, newSimpleSketch, buildChair, buildTable, clampChair, clampTable, newChairSketch, newSketchFor, newTableSketch, rebuildFromParams, specsFor, syncFromOutline } from './furniture'
import { addShape, makeShape, moveNode, outlineBounds, sketchSize, updateShape } from './shapes'
import { sketchToSample } from './sofa'

describe('bàn', () => {
  it('bàn chữ nhật có đúng kích thước khung và 4 chân nằm trong mặt bàn', () => {
    const doc = newTableSketch('rect', { width: 1800, depth: 900 })
    expect(sketchSize(doc)).toEqual({ w: 1800, d: 900 })
    const legs = doc.shapes.filter((s) => s.name.startsWith('Chân'))
    expect(legs).toHaveLength(4)
    for (const l of legs) for (const n of l.nodes) {
      expect(n.x).toBeGreaterThanOrEqual(0); expect(n.x).toBeLessThanOrEqual(1800)
      expect(n.y).toBeGreaterThanOrEqual(0); expect(n.y).toBeLessThanOrEqual(900)
    }
  })
  it('bàn tròn luôn rộng bằng sâu và không có kích thước sâu riêng', () => {
    const doc = newTableSketch('round', { width: 1200, depth: 500 })
    expect(doc.params['depth']).toBe(1200)
    expect(sketchSize(doc)).toEqual({ w: 1200, d: 1200 })
    expect(doc.shapes.some((s) => s.name === 'Sâu')).toBe(false)
    expect(specsFor(doc).map((s) => s.key)).not.toContain('depth')
  })
  it('thông số vượt giới hạn bị kẹp lại, chân không thụt quá nửa mặt bàn', () => {
    const p = clampTable('rect', { width: 99999, depth: 1, height: 5, leg: 60, inset: 999 })
    expect(p['width']).toBe(4000); expect(p['depth']).toBe(300); expect(p['height']).toBe(250)
    expect(p['inset']).toBeLessThanOrEqual((300 - 60) / 2)
  })
  it('bàn elip dựng bằng hình elip với bán kính đúng', () => {
    const doc = newTableSketch('oval')
    const top = doc.shapes.find((s) => s.role === 'outline')!
    expect(top.kind).toBe('ellipse')
    expect(sketchSize(doc)).toEqual({ w: 1800, d: 900 })
    expect(buildTable('oval', doc.params)).toHaveLength(doc.shapes.length)
  })
})

describe('ghế', () => {
  it('ghế có lưng, 4 chân và chiều cao mặt ngồi luôn thấp hơn chiều cao tổng', () => {
    const doc = newChairSketch()
    expect(doc.shapes.filter((s) => s.name.startsWith('Chân'))).toHaveLength(4)
    expect(doc.shapes.some((s) => s.name === 'Lưng tựa')).toBe(true)
    const p = clampChair({ height: 700, seatHeight: 600, back: 900 })
    expect(p['seatHeight']).toBe(500)
    expect(p['back']).toBeLessThanOrEqual(p['depth']! / 2)
    expect(buildChair(p).length).toBeGreaterThan(5)
  })
})

describe('dựng lại và đồng bộ', () => {
  it('đổi thông số dựng lại khung nhưng giữ nét tự vẽ', () => {
    let doc = newTableSketch('rect')
    const free = makeShape({ kind: 'path', nodes: [{ x: 10, y: 10 }, { x: 100, y: 100 }], name: 'Nét tay' })
    doc = addShape(doc, free)
    const next = rebuildFromParams(doc, { width: 2000 })
    expect(sketchSize(next).w).toBe(2000)
    expect(next.shapes.some((s) => s.id === free.id)).toBe(true)
    expect(next.manualEdits).toBe(false)
  })
  it('đổi kiểu bàn từ chữ nhật sang tròn', () => {
    const next = rebuildFromParams(newTableSketch('rect'), {}, 'round')
    expect(next.kind).toBe('round')
    expect(next.shapes.find((s) => s.role === 'outline')?.kind).toBe('ellipse')
  })
  it('kéo nút khung bàn thì rộng và sâu theo khung', () => {
    let doc = newTableSketch('rect')
    const outline = doc.shapes.find((s) => s.role === 'outline')!
    doc = updateShape(doc, outline.id, (s) => moveNode(moveNode(s, 1, { x: 2000, y: 0 }), 2, { x: 2000, y: 1000 }), true)
    const synced = syncFromOutline(doc)
    expect(synced.params['width']).toBe(2000)
    expect(synced.params['depth']).toBe(1000)
    expect(outlineBounds(synced)?.maxX).toBe(2000)
  })
  it('lưu vào kho: bàn thành mẫu loại Bàn, ghế loại Ghế, có kích thước và cao', () => {
    const t = sketchToSample(newTableSketch('rect'), 'b1')
    expect(t).toMatchObject({ category: 'Bàn', w: 1600, d: 800, h: 750, origin: 'sketch' })
    const c = sketchToSample(newChairSketch(), 'g1')
    expect(c).toMatchObject({ category: 'Ghế', w: 450, d: 480, h: 900 })
  })
  it('newSketchFor chọn đúng loại', () => {
    expect(newSketchFor('Sofa', 'L').category).toBe('Sofa')
    expect(newSketchFor('Bàn', 'round').kind).toBe('round')
    expect(newSketchFor('Ghế').category).toBe('Ghế')
  })
})

import { insertNodeAfter, isSharp, removeNode, shapeToSvgPath, toggleSharp } from './shapes'

describe('làm mượt từng nút', () => {
  const base = makeShape({ kind: 'path', nodes: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }], closed: true, smooth: true })
  it('nút góc nhọn có tay cầm trùng nút, nút khác vẫn cong', () => {
    const sharp = toggleSharp(base, 1)
    expect(isSharp(sharp, 1)).toBe(true)
    const d = shapeToSvgPath(sharp)
    expect(d).not.toBe(shapeToSvgPath(base))
    // đoạn 0→1 kết thúc ở nút 1 (góc): tay cầm thứ hai chính là (100 0)
    expect(d).toContain('100 0 100 0')
    // đoạn 1→2 bắt đầu từ nút 1 (góc): tay cầm đầu là (100 0)
    expect(d.split('C')[2]).toMatch(/^100 0 /)
  })
  it('bật rồi tắt trả về như cũ', () => {
    expect(shapeToSvgPath(toggleSharp(toggleSharp(base, 2), 2))).toBe(shapeToSvgPath(base))
  })
  it('chèn hoặc xoá nút giữ đúng nút góc', () => {
    const s = toggleSharp(base, 2)
    expect(isSharp(insertNodeAfter(s, 0), 3)).toBe(true)
    expect(isSharp(removeNode(s, 0), 1)).toBe(true)
    expect(removeNode(toggleSharp(base, 1), 1).sharp).toEqual([])
  })
  it('hình không làm mượt thì nút góc không đổi đường', () => {
    const plain = { ...base, smooth: false }
    expect(shapeToSvgPath(toggleSharp(plain, 1))).toBe(shapeToSvgPath(plain))
  })
})

describe('giường, kệ sách, tủ áo', () => {
  it('giường 1m6 x 2m có đầu giường, 2 gối nằm trong khung; giường đơn có 1 gối', () => {
    const bed = newSimpleSketch('Giường')
    expect(sketchSize(bed)).toEqual({ w: 1600, d: 2000 })
    expect(bed.shapes.filter((s) => s.name.startsWith('Gối'))).toHaveLength(2)
    for (const g of bed.shapes.filter((s) => s.name.startsWith('Gối'))) for (const n of g.nodes) {
      expect(n.x).toBeGreaterThanOrEqual(0); expect(n.x).toBeLessThanOrEqual(1600)
      expect(n.y).toBeLessThanOrEqual(2000)
    }
    expect(newSimpleSketch('Giường', { width: 1000 }).shapes.filter((s) => s.name.startsWith('Gối'))).toHaveLength(1)
  })
  it('kệ sách và tủ áo: đúng kích thước, tủ chia đúng số cánh', () => {
    expect(sketchSize(newSimpleSketch('Kệ sách'))).toEqual({ w: 800, d: 300 })
    const w = newSimpleSketch('Tủ quần áo', { doors: 4, width: 2000 })
    expect(w.shapes.filter((s) => s.name.startsWith('Cánh'))).toHaveLength(4)
    expect(sketchSize(w)).toEqual({ w: 2000, d: 600 })
  })
  it('giới hạn thông số và dựng lại khi đổi thông số', () => {
    expect(clampBed({ width: 99999, depth: 10, headboard: 9999 })).toMatchObject({ width: 2400, depth: 1600, headboard: 300 })
    expect(clampShelf({ shelves: 99, panel: 999 })['shelves']).toBe(12)
    expect(clampWardrobe({ doors: 0 })['doors']).toBe(1)
    const r = rebuildFromParams(newSimpleSketch('Kệ sách'), { width: 1200, height: 2000 })
    expect(sketchSize(r).w).toBe(1200)
    expect(r.heightMm).toBe(2000)
    expect(specsFor(r).map((x) => x.key)).toContain('shelves')
  })
  it('lưu vào kho đúng loại trong danh mục', () => {
    expect(sketchToSample(newSimpleSketch('Giường'), 'g').category).toBe('Giường')
    expect(sketchToSample(newSimpleSketch('Kệ sách'), 'k')).toMatchObject({ category: 'Kệ sách', h: 1800 })
    expect(sketchToSample(newSimpleSketch('Tủ quần áo'), 't')).toMatchObject({ category: 'Tủ quần áo', h: 2200 })
  })
})
