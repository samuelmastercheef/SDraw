import { describe, expect, it } from 'vitest'
import { SEED_SAMPLES } from './catalog'
import { emptyDoc, itemFromSample } from './commands'
import { neonplanType, toNeonPlan, toNeonPlanHouse } from './neonplan'

const sofa = SEED_SAMPLES.find((s) => s.id === 'seed-sofa-l')!
const tv = SEED_SAMPLES.find((s) => s.id === 'seed-tv')!

describe('toNeonPlan', () => {
  it('dựng phòng chữ nhật cộng 0,3 m mỗi phía và dời đồ theo', () => {
    const doc = { ...emptyDoc('Phòng khách', 5000, 4000), items: [itemFromSample(sofa, 1000, 2000, 90, 'a')] }
    const { plan } = toNeonPlan(doc, SEED_SAMPLES)
    const f = plan.floors[0]!
    expect(plan.format).toBe('neonplan-import')
    expect(f.rooms[0]!.points).toEqual([[0, 0], [5.6, 0], [5.6, 4.6], [0, 4.6]])
    expect(f.furniture[0]).toMatchObject({ type: 'sofa', at: [1.3, 2.3], width: 2.7, depth: 0.9, rotation: 90 })
  })

  it('đặt cửa trên đường tường theo từng cạnh', () => {
    const doc = {
      ...emptyDoc('p', 4000, 3000),
      doors: [
        { id: '1', wall: 'top' as const, offsetMm: 500, widthMm: 900 },
        { id: '2', wall: 'right' as const, offsetMm: 1000, widthMm: 800 },
        { id: '3', wall: 'bottom' as const, offsetMm: 0, widthMm: 1000 },
        { id: '4', wall: 'left' as const, offsetMm: 200, widthMm: 900 }
      ]
    }
    const d = toNeonPlan(doc).plan.floors[0]!.doors
    expect(d[0]).toEqual({ at: [1.25, 0], width: 0.9 })
    expect(d[1]).toEqual({ at: [4.6, 1.7], width: 0.8 })
    expect(d[2]).toEqual({ at: [0.8, 3.6], width: 1 })
    expect(d[3]).toEqual({ at: [0, 0.95], width: 0.9 })
  })

  it('chuẩn hoá góc xoay và cảnh báo danh mục chưa chắc loại', () => {
    const doc = { ...emptyDoc('p', 5000, 4000), items: [itemFromSample(tv, 1000, 1000, -90, 'b')] }
    const r = toNeonPlan(doc, SEED_SAMPLES)
    expect(r.plan.floors[0]!.furniture[0]!.rotation).toBe(270)
    expect(r.warnings).toHaveLength(1)
  })

  it('ánh xạ danh mục tiếng Việt có dấu', () => {
    expect(neonplanType('Giường')).toEqual({ type: 'bed', known: true })
    expect(neonplanType('Bàn làm việc').type).toBe('desk')
    expect(neonplanType('Ghế thư giãn').type).toBe('armchair')
    expect(neonplanType('Lạ hoắc').known).toBe(false)
  })
})

describe('toNeonPlan cửa sổ', () => {
  it('xuất cửa sổ với chiều cao và bệ, bản vẽ cũ không có thì để trống', () => {
    const base = emptyDoc('p', 4000, 3000)
    expect(toNeonPlan(base).plan.floors[0]!.windows).toEqual([])
    const doc = { ...base, windows: [{ id: 'w', wall: 'top' as const, offsetMm: 1000, widthMm: 1200, heightMm: 1300, sillMm: 900, curtain: true }] }
    expect(toNeonPlan(doc).plan.floors[0]!.windows).toEqual([{ at: [1.9, 0], width: 1.2, height: 1.3, sill: 0.9 }])
  })

  it('ánh xạ đồ bếp và vệ sinh sang loại NeonPlan có tài liệu', () => {
    expect(neonplanType('Tủ lạnh')).toEqual({ type: 'fridge', known: true })
    expect(neonplanType('Bồn cầu').type).toBe('wc')
  })
})

describe('toNeonPlan Area Home Assistant', () => {
  it('dùng tên Area làm tên phòng và ghi kèm trường area', () => {
    const doc = { ...emptyDoc('Bản vẽ 1', 4000, 3000), haArea: ' Phòng khách ' }
    expect(toNeonPlan(doc).plan.floors[0]!.rooms[0]).toMatchObject({ name: 'Phòng khách', area: 'Phòng khách' })
  })
  it('không có Area thì giữ tên bản vẽ và không thêm trường area', () => {
    const r = toNeonPlan(emptyDoc('Bản vẽ 1', 4000, 3000)).plan.floors[0]!.rooms[0]!
    expect(r.name).toBe('Bản vẽ 1')
    expect('area' in r).toBe(false)
  })
})

describe('toNeonPlanHouse nhiều phòng', () => {
  const mk = (name: string, w: number, d: number, floor = 0, extra: object = {}) => ({ id: name, floor, doc: { ...emptyDoc(name, w, d), ...extra } })

  it('xếp phòng nối đuôi trong cùng tầng, tường chung trùng một đường', () => {
    const { plan } = toNeonPlanHouse([mk('A', 4000, 3000), mk('B', 3000, 3000)], SEED_SAMPLES)
    const [a, b] = plan.floors[0]!.rooms
    expect(a!.points).toEqual([[0, 0], [4.24, 0], [4.24, 3.24], [0, 3.24]])
    expect(b!.points[0]).toEqual([4.24, 0])
    expect(b!.points[1]).toEqual([7.48, 0])
  })

  it('tách tầng, đặt cao độ và đặt tên tầng', () => {
    const { plan } = toNeonPlanHouse([mk('Trệt', 4000, 3000, 0), mk('Lầu', 4000, 3000, 1), mk('Hầm', 4000, 3000, -1)])
    expect(plan.floors.map((f) => [f.name, f.elevation])).toEqual([['Hầm 1', -2.5], ['Tầng trệt', 0], ['Tầng 1', 2.5]])
  })

  it('dùng vị trí đặt tay và giữ nội thất theo phòng', () => {
    const r = { ...mk('A', 4000, 3000, 0, { items: [itemFromSample(sofa, 1000, 1000, 0, 'a')] }), x: 10000, y: 2000 }
    const { plan } = toNeonPlanHouse([r], SEED_SAMPLES)
    expect(plan.floors[0]!.rooms[0]!.points[0]).toEqual([10, 2])
    expect(plan.floors[0]!.furniture[0]!.at).toEqual([11.12, 3.12])
  })

  it('cửa trùng giữa hai phòng liền kề chỉ giữ một', () => {
    const a = mk('A', 4000, 3000, 0, { doors: [{ id: '1', wall: 'right', offsetMm: 1000, widthMm: 900 }] })
    const b = mk('B', 3000, 3000, 0, { doors: [{ id: '2', wall: 'left', offsetMm: 1000, widthMm: 900 }] })
    const { plan } = toNeonPlanHouse([a, b])
    expect(plan.floors[0]!.doors).toHaveLength(1)
  })
})
