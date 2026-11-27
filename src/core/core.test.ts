import { describe, expect, it } from 'vitest'
import { buildBom } from './bom'
import { SEED_SAMPLES, samplesFromScan } from './catalog'
import { applyOps, emptyDoc, itemFromSample, patchItem } from './commands'
import { toDxf } from './dxf'
import { corners, findFreeSpot, findIssues, polygonsOverlap } from './geometry'
import { commit, createHistory, redo, undo } from './history'
import { toSketchupPlan } from './sketchup'
import { newSimpleSketch } from './furniture'
import { sketchToSample } from './sofa'
import type { SdrawDoc } from './types'

const sofa = SEED_SAMPLES.find((s) => s.id === 'seed-sofa-l')!
const tv = SEED_SAMPLES.find((s) => s.id === 'seed-tv')!
const armchair = SEED_SAMPLES.find((s) => s.id === 'seed-armchair')!

function docWith(...items: ReturnType<typeof itemFromSample>[]): SdrawDoc {
  return { ...emptyDoc('t', 5000, 4000), items }
}

describe('geometry', () => {
  it('quay 90 độ đổi chỗ rộng và sâu', () => {
    const c = corners({ cx: 1000, cy: 1000, w: 2000, d: 1000, rotation: 90 })
    const xs = c.map((p) => p.x)
    const ys = c.map((p) => p.y)
    expect(Math.round(Math.max(...xs) - Math.min(...xs))).toBe(1000)
    expect(Math.round(Math.max(...ys) - Math.min(...ys))).toBe(2000)
  })

  it('chạm mép không tính là chồng lên, chồng thật thì có', () => {
    const a = corners({ cx: 500, cy: 500, w: 1000, d: 1000, rotation: 0 })
    const touching = corners({ cx: 1500, cy: 500, w: 1000, d: 1000, rotation: 0 })
    const overlapping = corners({ cx: 1400, cy: 500, w: 1000, d: 1000, rotation: 0 })
    expect(polygonsOverlap(a, touching)).toBe(false)
    expect(polygonsOverlap(a, overlapping)).toBe(true)
  })

  it('báo món đè nhau, ra ngoài phòng và chắn cửa', () => {
    const a = itemFromSample(sofa, 1500, 3000, 0, 'a')
    const b = itemFromSample(tv, 1500, 3000, 0, 'b')
    const out = itemFromSample(armchair, -100, 500, 0, 'out')
    const doc: SdrawDoc = {
      ...docWith(a, b, out),
      doors: [{ id: 'd', wall: 'top', offsetMm: 1000, widthMm: 900 }]
    }
    const door = itemFromSample(armchair, 1400, 400, 0, 'door')
    const issues = findIssues({ ...doc, items: [...doc.items, door] })
    const kinds = issues.map((i) => i.kind)
    expect(kinds).toContain('collision')
    expect(kinds).toContain('outOfRoom')
    expect(kinds).toContain('doorBlocked')
  })

  it('bố trí hợp lệ thì không có lỗi', () => {
    const doc = docWith(itemFromSample(sofa, 1700, 3000, 0, 'a'), itemFromSample(tv, 2500, 300, 0, 'b'))
    expect(findIssues(doc)).toEqual([])
  })
})

describe('đặt món mới', () => {
  it('chọn chỗ trống, không đè món có sẵn', () => {
    const existing = itemFromSample(sofa, 2500, 2000, 0, 'a')
    const doc = docWith(existing)
    const spot = findFreeSpot(doc, { w: 800, d: 800 })
    const next = { ...doc, items: [...doc.items, itemFromSample(armchair, spot.cx, spot.cy, 0, 'n')] }
    expect(findIssues(next).filter((i) => i.kind !== 'doorBlocked')).toEqual([])
  })
})

describe('lệnh và khoá món', () => {
  it('AI bỏ qua món đã khoá và giữ nguyên bản vẽ', () => {
    const locked = { ...itemFromSample(armchair, 4000, 2000, 0, 'lock'), locked: true }
    const free = itemFromSample(tv, 2500, 300, 0, 'free')
    const doc = docWith(locked, free)
    const res = applyOps(doc, [
      { op: 'move', id: 'lock', cx: 100, cy: 100 },
      { op: 'nudge', id: 'free', dx: 300, dy: 0 },
      { op: 'remove', id: 'missing' }
    ])
    expect(res.skipped.map((s) => s.reason)).toEqual(['locked', 'notFound'])
    expect(res.applied).toHaveLength(1)
    expect(res.doc.items.find((i) => i.id === 'lock')).toEqual(locked)
    expect(res.doc.items.find((i) => i.id === 'free')?.cx).toBe(2800)
    expect(doc.items.find((i) => i.id === 'free')?.cx).toBe(2500)
  })

  it('thay mẫu giữ vị trí, góc xoay và vật liệu', () => {
    const base = { ...itemFromSample(sofa, 1700, 3000, 90, 'a'), material: 'Vải xám' }
    const round = SEED_SAMPLES.find((s) => s.id === 'seed-sofa-round')!
    const res = applyOps(docWith(base), [{ op: 'replace', id: 'a', sample: round }])
    const it = res.doc.items[0]!
    expect([it.cx, it.cy, it.rotation, it.material, it.w]).toEqual([1700, 3000, 90, 'Vải xám', round.w])
  })

  it('tay vẫn sửa được món đã khoá', () => {
    const locked = { ...itemFromSample(armchair, 4000, 2000, 0, 'lock'), locked: true }
    const next = patchItem(docWith(locked), 'lock', { cx: 3500 })
    expect(next.items[0]?.cx).toBe(3500)
  })
})

describe('bảng kê', () => {
  it('giá từ bảng giá, nhập tay, hoặc để trống; món trống không vào tổng', () => {
    const a = itemFromSample(sofa, 1700, 3000, 0, 'a') // bảng giá 14 tr
    const b = { ...itemFromSample(tv, 2500, 300, 0, 'b'), priceMode: 'manual' as const, manualPrice: 5_500_000 }
    const c = itemFromSample(armchair, 4000, 2000, 0, 'c') // không có giá niêm yết
    const bom = buildBom(docWith(a, b, c), SEED_SAMPLES)
    expect(bom.rows.map((r) => r.source)).toEqual(['list', 'manual', 'blank'])
    expect(bom.total).toBe(19_500_000)
    expect(bom.unpriced).toBe(1)
    expect(bom.rows[2]?.unitPrice).toBeNull()
  })

  it('chọn bảng giá nhưng mẫu chưa có giá thì thành chưa báo giá', () => {
    const c = { ...itemFromSample(armchair, 0, 0, 0, 'c'), priceMode: 'list' as const }
    expect(buildBom(docWith(c), SEED_SAMPLES).rows[0]?.source).toBe('blank')
  })
})

describe('lịch sử', () => {
  it('hoàn tác và làm lại', () => {
    let h = createHistory(1)
    h = commit(h, 2)
    h = commit(h, 3)
    h = undo(h)
    expect(h.present).toBe(2)
    h = redo(h)
    expect(h.present).toBe(3)
    h = undo(undo(undo(h)))
    expect(h.present).toBe(1)
    expect(commit(h, 1)).toBe(h)
  })
})

describe('xuất file', () => {
  const doc: SdrawDoc = {
    ...docWith(itemFromSample(sofa, 1700, 3000, 0, 'a')),
    doors: [{ id: 'd', wall: 'right', offsetMm: 1000, widthMm: 900 }]
  }

  it('DXF có đủ phần và kết thúc bằng EOF', () => {
    const dxf = toDxf(doc)
    expect(dxf).toContain('ENTITIES')
    expect(dxf.trim().endsWith('EOF')).toBe(true)
    expect((dxf.match(/\nLINE\n/g) ?? []).length).toBe(4 + 1 + 4)
  })

  it('kế hoạch SketchUp mang theo đường dẫn .skp', () => {
    const samples = [{ ...sofa, skpPath: '/mau/sofa.skp' }]
    const plan = toSketchupPlan(doc, samples)
    expect(plan.items[0]?.skpPath).toBe('/mau/sofa.skp')
    expect(plan.items[0]?.heightMm).toBe(sofa.h)
    expect(plan.units).toBe('mm')
    expect(plan.items[0]?.parts).toBeNull()
  })

  it('mẫu phác thảo mang theo khối 3D đã co giãn theo kích thước trong bố cục', () => {
    const sk = newSimpleSketch('Giường')
    const bed = { ...sketchToSample(sk, 'bed1'), skpPath: undefined }
    const d2 = { ...doc, items: [{ ...doc.items[0]!, sampleId: 'bed1', w: 1800, d: 2000 }] }
    const item = toSketchupPlan(d2, [bed]).items[0]!
    expect(item.parts?.length).toBeGreaterThan(3)
    expect(item.parts?.find((p) => p.name === 'Khung giường')?.w).toBe(1800)
  })

  it('mẫu có meshPath mang lưới đã co giãn; không đọc được thì mesh là null', () => {
    const m = { ...sofa, id: 'm1', skpPath: undefined, meshPath: '/m/x.obj', h: 700 }
    const d2 = { ...doc, items: [{ ...doc.items[0]!, sampleId: 'm1', w: 1000, d: 400 }] }
    const mesh = { positions: [0, 0, 0, 2, 0, 0, 0, 1, 0, 0, 0, 3], triangles: [0, 1, 2, 0, 1, 3] }
    const item = toSketchupPlan(d2, [m], new Map([['/m/x.obj', mesh]])).items[0]!
    expect(item.mesh?.vertices.slice(3, 6)).toEqual([1000, 0, 0])
    expect(item.mesh?.vertices[11]).toBe(700)
    expect(toSketchupPlan(d2, [m]).items[0]!.mesh).toBeNull()
  })
})

describe('quét thư mục', () => {
  it('chỉ lấy .skp mới, bỏ file đã có trong kho', () => {
    const existing = [{ ...sofa, skpPath: '/m/a.skp' }]
    const added = samplesFromScan(['/m/a.skp', '/m/Ban_tra-tron.SKP', '/m/readme.txt'], existing)
    expect(added).toHaveLength(1)
    expect(added[0]?.name).toBe('Ban tra tron')
    expect(added[0]?.needsReview).toBe(true)
  })
})
