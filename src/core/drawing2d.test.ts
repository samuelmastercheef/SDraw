import { describe, expect, it } from 'vitest'
import { addCircle, addRectangle, drawRectangle, emptyModel, faceList, faceNormal, isModel3, pushPull, type Model3 } from './model3d'
import { addDimension, buildSheet, deleteDimensions, dimOffset, projectView, sheetToDxf, sheetToSvg } from './drawing2d'

function box(w = 2000, d = 1000, h = 500): Model3 {
  const r = addRectangle(emptyModel(), [0, 0, 0], [w, d, 0])
  return pushPull(r.model, r.faceId, h)
}
const topOf = (m: Model3) => faceList(m).find((f) => faceNormal(m, f)[2] > 0.9 && m.vertices[f.loop[0]!]![2] > 1)!

describe('bản vẽ 2D', () => {
  it('mặt bằng hộp: 4 nét thấy, khung đúng, 2 kích thước tổng', () => {
    const d = projectView(box(), 'top')
    expect(d.segments).toHaveLength(4)
    expect(d.segments.every((s) => !s.hidden)).toBe(true)
    expect(d.max[0] - d.min[0]).toBeCloseTo(2000)
    expect(d.max[1] - d.min[1]).toBeCloseTo(1000)
    expect(d.dims.map((k) => Math.round(k.value)).sort()).toEqual([1000, 2000])
  })

  it('mặt đứng trước của hộp có hốc trên nóc: hốc là nét khuất', () => {
    const m = box()
    const r = drawRectangle(m, [500, 250, 500], [1500, 750, 500], [0, 0, 1], { host: topOf(m).id })
    const pocket = pushPull(r.model, r.faceId, -200)
    const front = projectView(pocket, 'front', { hidden: true })
    expect(front.segments.filter((s) => !s.hidden)).toHaveLength(4)
    const hid = front.segments.filter((s) => s.hidden)
    expect(hid.length).toBeGreaterThanOrEqual(3)
    expect(hid.every((s) => Math.min(s.a[1], s.b[1]) >= 299)).toBe(true)
    expect(projectView(pocket, 'front').segments.some((s) => s.hidden)).toBe(false)
  })

  it('thân trụ không vẽ các cạnh mềm', () => {
    const c = addCircle(emptyModel(), [0, 0, 0], 300)
    const cyl = pushPull(c.model, c.faceId, 800)
    const front = projectView(cyl, 'front')
    // Hai đường bao trên dưới (gộp các đoạn), hai cạnh bên; không có hàng chục cạnh đứng
    expect(front.segments.length).toBeLessThan(80)
    expect(front.segments.filter((s) => Math.abs(s.a[0] - s.b[0]) < 1).length).toBeLessThanOrEqual(2)
  })

  it('kích thước người dùng: thêm, chỉ hiện ở hình chiếu song song, xoá', () => {
    const m0 = box()
    const { model, id } = addDimension(m0, [0, 0, 500], [2000, 0, 500], [0, -300, 500])
    expect(isModel3(model)).toBe(true)
    expect(dimOffset(model.dims![id]!)).toEqual([0, -300, 0])
    const top = projectView(model, 'top', { overall: false })
    expect(top.dims).toHaveLength(1)
    expect(top.dims[0]!.value).toBeCloseTo(2000)
    expect(top.dims[0]!.off).toEqual([0, -300])
    expect(projectView(model, 'right', { overall: false }).dims).toHaveLength(0)
    expect(deleteDimensions(model, [id]).dims).toBeUndefined()
    expect(() => addDimension(m0, [0, 0, 0], [0, 0, 0.5], [0, 0, 0])).toThrow()
  })

  it('dàn trang chọn tỉ lệ chuẩn, xuất SVG và DXF', () => {
    const sh = buildSheet(box(), ['top', 'front', 'right'], 'Tủ bếp', { hidden: true })
    expect([10, 20, 25, 50]).toContain(sh.scale)
    const svg = sheetToSvg(sh)
    expect(svg).toContain('<svg')
    expect(svg).toContain('MẶT BẰNG')
    expect(svg).toContain(`Tỉ lệ 1:${sh.scale}`)
    expect(svg).toContain('>2000<')
    const dxf = sheetToDxf(sh)
    expect(dxf).toContain('KHUAT')
    expect(dxf).toContain('KICHTHUOC')
    expect(dxf.trim().endsWith('EOF')).toBe(true)
    expect(() => buildSheet(emptyModel(), ['top'], 'x')).toThrow()
  })
})

describe('kích thước lệch theo hướng nhìn', () => {
  it('được đặt ra ngoài hình thay vì trùng nét', () => {
    const { model } = addDimension(box(), [0, 0, 0], [2000, 0, 0], [0, -300, 0])
    const front = projectView(model, 'front', { overall: false })
    expect(front.dims).toHaveLength(1)
    expect(front.dims[0]!.off[1]).toBeLessThan(-100)
  })
})
