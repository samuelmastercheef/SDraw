import { describe, expect, it } from 'vitest'
import { SEED_SAMPLES } from './catalog'
import { emptyDoc, itemFromSample } from './commands'
import { buildScene } from './scene3d'

const sofa = SEED_SAMPLES.find((s) => s.id === 'seed-sofa-l')!

describe('buildScene', () => {
  it('dựng sàn, bốn tường và nội thất đúng chỗ, cao theo mẫu', () => {
    const doc = { ...emptyDoc('p', 5000, 4000), items: [itemFromSample(sofa, 1000, 2000, 90, 'a')] }
    const s = buildScene([{ id: 'a', floor: 0, doc }], SEED_SAMPLES)
    expect(s.boxes.filter((b) => b.kind === 'wall')).toHaveLength(4)
    const f = s.boxes.find((b) => b.kind === 'furniture')!
    expect(f.x).toBeCloseTo(1.12)
    expect(f.z).toBeCloseTo(2.12)
    expect(f.h).toBeCloseTo(0.8)
    expect(f.rotY).toBeCloseTo(-Math.PI / 2)
    expect(s.bounds.maxX).toBeCloseTo(5.24)
    expect(s.bounds.maxZ).toBeCloseTo(4.24)
  })

  it('đặt cửa sổ đúng độ cao bệ và rèm lùi vào trong phòng', () => {
    const doc = { ...emptyDoc('p', 4000, 3000), windows: [{ id: 'w', wall: 'top' as const, offsetMm: 1000, widthMm: 1200, heightMm: 1300, sillMm: 900, curtain: true }] }
    const s = buildScene([{ id: 'a', floor: 0, doc }])
    const w = s.boxes.find((b) => b.kind === 'window')!
    const c = s.boxes.find((b) => b.kind === 'curtain')!
    expect(w.y).toBeCloseTo(1.55)
    expect(w.x).toBeCloseTo(0.12 + 1.6)
    expect(c.z).toBeGreaterThan(w.z)
  })

  it('xếp tầng trên cao 2,5 m và liệt kê các tầng', () => {
    const a = { id: 'a', floor: 0, doc: emptyDoc('a', 4000, 3000) }
    const b = { id: 'b', floor: 1, doc: emptyDoc('b', 4000, 3000) }
    const s = buildScene([b, a])
    expect(s.floors).toEqual([0, 1])
    const wall1 = s.boxes.find((x) => x.floor === 1 && x.kind === 'wall')!
    expect(wall1.y).toBeCloseTo(2.5 + 1.2)
  })

  it('không có phòng thì vẫn trả khung hợp lệ', () => {
    expect(buildScene([]).bounds.maxX).toBe(1)
  })
})

describe('buildScene đèn và mẫu', () => {
  it('mỗi phòng có một đèn trần và món thuộc danh mục Đèn được đánh dấu lamp', () => {
    const lampSample = { id: 'lamp1', name: 'Đèn cây', category: 'Đèn', w: 400, d: 400, h: 1600 }
    const doc = { ...emptyDoc('p', 4000, 3000), items: [itemFromSample(lampSample, 500, 500, 0, 'l'), itemFromSample(sofa, 2000, 2000, 0, 's')] }
    const s = buildScene([{ id: 'a', floor: 0, doc }], [...SEED_SAMPLES, lampSample])
    expect(s.boxes.filter((b) => b.kind === 'light')).toHaveLength(1)
    const f = s.boxes.filter((b) => b.kind === 'furniture')
    expect(f.find((b) => b.sampleId === 'lamp1')!.lamp).toBe(true)
    expect(f.find((b) => b.sampleId === sofa.id)!.lamp).toBeUndefined()
  })
})
