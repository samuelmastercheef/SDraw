import { describe, expect, it } from 'vitest'
import { emptyDoc, itemFromSample } from './commands'
import { applyProposals, parseEdit } from './editCommand'
import type { Sample } from './types'

const S = (id: string, name: string, category: string, w: number, d: number, tags: string[] = []): Sample => ({ id, name, category, w, d, h: 800, tags })
const sofaL = S('sofaL', 'Sofa góc L', 'Sofa', 2700, 900, ['chữ L'])
const sofaRound = S('sofaR', 'Sofa bo tròn SF-212', 'Sofa', 2400, 900, ['bo tròn'])
const tv = S('tv', 'Kệ tivi', 'Kệ tivi', 1800, 400)
const tea = S('tea', 'Bàn trà tròn', 'Bàn trà', 800, 800)
const chair = S('chair', 'Ghế đơn', 'Ghế', 700, 720)
const catalog = [sofaL, sofaRound, tv, tea, chair]

function room() {
  const base = emptyDoc('t', 5000, 4000)
  const items = [
    itemFromSample(sofaL, 1500, 3400, 0, 'i-sofa'), itemFromSample(tv, 2500, 300, 0, 'i-tv'),
    itemFromSample(tea, 2000, 2000, 0, 'i-tea'), { ...itemFromSample(chair, 4000, 2000, 0, 'i-chair'), locked: true }
  ]
  return { ...base, items }
}

describe('hiểu lệnh sửa bố cục', () => {
  it('dịch theo hướng và khoảng cách, app có y hướng xuống', () => {
    const r = parseEdit('Dịch kệ tivi sang phải 30 cm', room(), null, catalog)
    expect(r.proposals).toHaveLength(1)
    expect(r.proposals[0]!.op).toEqual({ op: 'nudge', id: 'i-tv', dx: 300, dy: 0 })
    expect(r.proposals[0]!.label).toBe('Kệ tivi sang phải 30 cm')
    expect(parseEdit('đẩy bàn trà xuống 0,2 m', room(), null, catalog).proposals[0]!.op).toEqual({ op: 'nudge', id: 'i-tea', dx: 0, dy: 200 })
    expect(parseEdit('dịch bàn trà lên 100mm', room(), null, catalog).proposals[0]!.op).toEqual({ op: 'nudge', id: 'i-tea', dx: 0, dy: -100 })
  })
  it('nhiều lệnh trong một câu, "bàn trà" không bị "bàn" nuốt', () => {
    const r = parseEdit('Thay sofa này bằng mẫu bo tròn, rồi dịch kệ tivi sang phải 30 cm, dịch bàn trà xuống 20 cm', room(), 'i-sofa', catalog)
    expect(r.proposals.map((p) => p.verb)).toEqual(['Thay', 'Dịch', 'Dịch'])
    expect(r.proposals[0]!.op).toMatchObject({ op: 'replace', id: 'i-sofa' })
    expect((r.proposals[0]!.op as { sample: Sample }).sample.id).toBe('sofaR')
    expect(r.proposals[2]!.op).toMatchObject({ id: 'i-tea', dy: 200 })
  })
  it('món đã khoá không được sửa, chỉ được báo', () => {
    const r = parseEdit('dịch ghế sang trái 50 cm', room(), null, catalog)
    expect(r.proposals).toEqual([])
    expect(r.skippedLocked).toEqual(['Ghế đơn'])
  })
  it('dùng món đang chọn khi câu nói "món này"', () => {
    const r = parseEdit('xoay món này 90 độ', room(), 'i-tea', catalog)
    expect(r.proposals[0]!.op).toEqual({ op: 'rotate', id: 'i-tea', rotation: 90 })
    expect(parseEdit('xoá món này', room(), 'i-tv', catalog).proposals[0]!.op).toEqual({ op: 'remove', id: 'i-tv' })
  })
  it('đổi vật liệu', () => {
    const r = parseEdit('đổi vật liệu sofa sang vải xám', room(), null, catalog)
    expect(r.proposals[0]!.op).toEqual({ op: 'setMaterial', id: 'i-sofa', material: 'vải xám' })
  })
  it('không rõ thì báo lý do thay vì đoán', () => {
    expect(parseEdit('làm cho đẹp hơn', room(), null, catalog).notes[0]).toMatch(/Chưa rõ món/)
    expect(parseEdit('dịch kệ tivi sang phải', room(), null, catalog).notes[0]).toMatch(/khoảng cách/)
    expect(parseEdit('hãy sofa', room(), null, catalog).notes[0]).toMatch(/Chưa hiểu lệnh/)
  })
  it('áp dụng các đề xuất được chọn lên bản vẽ', () => {
    const doc = room()
    const r = parseEdit('dịch kệ tivi sang phải 30 cm, xoay bàn trà 90 độ', doc, null, catalog)
    const next = applyProposals(doc, r.proposals)
    expect(next.items.find((i) => i.id === 'i-tv')!.cx).toBe(2800)
    expect(next.items.find((i) => i.id === 'i-tea')!.rotation).toBe(90)
    expect(applyProposals(doc, [r.proposals[0]!]).items.find((i) => i.id === 'i-tea')!.rotation).toBe(0)
  })
})
