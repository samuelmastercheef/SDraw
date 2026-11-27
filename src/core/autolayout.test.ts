import { describe, expect, it } from 'vitest'
import { autoLayout, placement } from './autolayout'
import { emptyDoc, itemFromSample } from './commands'
import { findIssues } from './geometry'
import type { Sample } from './types'

const S = (id: string, category: string, w: number, d: number): Sample => ({ id, name: id, category, w, d, h: 800 })
const sofa = S('sofa', 'Sofa', 2400, 900)
const tv = S('tv', 'Kệ tivi', 1800, 400)
const table = S('table', 'Bàn trà', 1000, 600)
const bed = S('bed', 'Giường', 1800, 2000)

describe('tự xếp vào phòng', () => {
  it('phân loại dựa tường hay đặt giữa', () => {
    expect(placement(sofa)).toBe('wall')
    expect(placement(tv)).toBe('wall')
    expect(placement(bed)).toBe('wall')
    expect(placement(table)).toBe('center')
    expect(placement(S('x', 'Bàn ăn', 1, 1))).toBe('center')
    expect(placement(S('x', 'Tủ bếp', 1, 1))).toBe('wall')
  })

  it('không lỗi bố trí: không chồng, không ra ngoài, không chắn cửa', () => {
    const doc = { ...emptyDoc('t', 5000, 4000), doors: [{ id: 'd', wall: 'bottom' as const, offsetMm: 500, widthMm: 900 }] }
    const r = autoLayout(doc, [sofa, tv, table])
    expect(r.unplaced).toEqual([])
    expect(r.placed).toHaveLength(3)
    expect(findIssues(r.doc)).toEqual([])
  })

  it('sofa sát tường, mặt hướng vào phòng; tường có cửa được tránh', () => {
    const doc = { ...emptyDoc('t', 5000, 4000), doors: [{ id: 'd', wall: 'top' as const, offsetMm: 500, widthMm: 900 }] }
    const r = autoLayout(doc, [sofa])
    const it = r.doc.items[0]!
    expect(it.rotation).toBe(180) // tường dưới (dài, không có cửa), lưng sát đáy
    expect(it.cy + it.d / 2).toBeCloseTo(4000 - 20, 0)
  })

  it('đủ bốn hướng quay đúng quy ước (chặn ba tường bằng cửa để buộc vào tường còn lại)', () => {
    const walls = { top: 0, right: 90, bottom: 180, left: 270 } as const
    for (const [wall, rot] of Object.entries(walls) as [keyof typeof walls, number][]) {
      const others = (Object.keys(walls) as (keyof typeof walls)[]).filter((w) => w !== wall)
      const doc = { ...emptyDoc('t', 4000, 4000), doors: others.map((w, i) => ({ id: `d${i}`, wall: w, offsetMm: 1500, widthMm: 900 })) }
      const r = autoLayout(doc, [S('c', 'Tủ', 1200, 500)])
      const it = r.doc.items[0]!
      expect(it.rotation).toBe(rot)
      expect(findIssues(r.doc)).toEqual([])
    }
  })

  it('giữ nguyên món đã có và đã khoá', () => {
    const base = emptyDoc('t', 5000, 4000)
    const locked = { ...itemFromSample(sofa, 1300, 2000), locked: true }
    const r = autoLayout({ ...base, items: [locked] }, [tv])
    expect(r.doc.items[0]).toEqual(locked)
    expect(findIssues(r.doc)).toEqual([])
  })

  it('hết chỗ thì báo lại, không ép vào', () => {
    const r = autoLayout(emptyDoc('t', 2000, 2000), [bed, sofa])
    expect(r.unplaced.length).toBeGreaterThan(0)
    expect(findIssues(r.doc)).toEqual([])
  })

  it('xác định: chạy hai lần cho cùng kết quả', () => {
    const d = emptyDoc('t', 5000, 4000)
    const strip = (x: ReturnType<typeof autoLayout>) => x.doc.items.map((i) => [i.sampleId, i.cx, i.cy, i.rotation])
    expect(strip(autoLayout(d, [table, sofa, tv]))).toEqual(strip(autoLayout(d, [table, sofa, tv])))
  })

  it('bàn trà đặt ngay trước sofa, cùng hướng, cách 450 mm', () => {
    const r = autoLayout(emptyDoc('t', 5000, 4000), [sofa, table])
    const so = r.doc.items.find((i) => i.sampleId === 'sofa')!
    const ta = r.doc.items.find((i) => i.sampleId === 'table')!
    expect(ta.rotation).toBe(so.rotation)
    const a = (so.rotation * Math.PI) / 180
    const dx = ta.cx - so.cx, dy = ta.cy - so.cy
    const front = dx * -Math.sin(a) + dy * Math.cos(a)
    expect(front).toBeCloseTo(so.d / 2 + 450 + ta.d / 2, 0)
    expect(findIssues(r.doc)).toEqual([])
  })

  it('ghế quanh bàn ăn: hai cạnh dài, mặt hướng vào bàn, không vướng', () => {
    const dining = S('dt', 'Bàn ăn', 1600, 800)
    const chair = S('ch', 'Ghế ăn', 450, 480)
    const r = autoLayout(emptyDoc('t', 5000, 4000), [dining, chair], { chairs: 4 })
    const t = r.doc.items.find((i) => i.sampleId === 'dt')!
    const cs = r.doc.items.filter((i) => i.sampleId === 'ch')
    expect(cs).toHaveLength(4)
    for (const c of cs) {
      expect(c.rotation).toBe(c.cy < t.cy ? 0 : 180) // ghế phía trên bàn nhìn xuống, phía dưới nhìn lên
      expect(Math.abs(c.cy - t.cy)).toBeCloseTo(t.d / 2 + c.d / 2 + 50, 0)
    }
    expect(findIssues(r.doc)).toEqual([])
  })

  it('ghế không vừa chỗ thì báo, không đặt chồng', () => {
    const dining = S('dt', 'Bàn ăn', 1600, 800)
    const chair = S('ch', 'Ghế ăn', 450, 480)
    const r = autoLayout(emptyDoc('t', 2000, 1500), [dining, chair], { chairs: 6 })
    expect(findIssues(r.doc)).toEqual([])
  })
})
