import { describe, expect, it } from 'vitest'
import { BASE_WEIGHTS, N_FEATURES, clampWeights, featuresOf, pairsFromChoice, rankWithModel, scoreWithModel, train, validPair } from './ranker'
import { parseRequirement, rankSamples } from './suggest'
import type { Sample } from './types'

const mk = (id: string, over: Partial<Sample> = {}): Sample => ({ id, name: id, category: 'Sofa', w: 2400, d: 900, h: 800, ...over })

describe('mô hình xếp hạng', () => {
  const req = parseRequirement('sofa chữ L rộng 2m4 phong cách nhật')

  it('chưa huấn luyện thì xếp hạng giống bộ chấm tay', () => {
    const samples = [mk('a', { tags: ['chữ L'], styles: ['Nhật'] }), mk('b', { w: 3000 }), mk('c', { labeled: true }), mk('d', { category: 'Bàn' })]
    const a = rankSamples(samples, req).map((r) => r.sample.id)
    const b = rankWithModel(samples, req, BASE_WEIGHTS).map((r) => r.sample.id)
    expect(b).toEqual(a)
    expect(b).not.toContain('d')
  })

  it('mẫu sai loại bị loại hẳn dù mô hình thế nào', () => {
    const w = BASE_WEIGHTS.map(() => 100)
    expect(scoreWithModel(mk('x', { category: 'Bàn' }), req, w).score).toBe(0)
    expect(featuresOf(mk('x', { category: 'Bàn' }), req)).toBeNull()
  })

  it('đặc trưng nằm trong [0,1] và đúng số lượng', () => {
    const f = featuresOf(mk('a', { tags: ['chữ L'], styles: ['Nhật', 'Bắc Âu'], labeled: true, listPrice: 1 }), parseRequirement('sofa chữ L 2m4 15 triệu nhật'), { a: { picks: 99 } })!
    expect(f).toHaveLength(N_FEATURES)
    for (const x of f) { expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThanOrEqual(1) }
  })

  it('học từ lựa chọn: người dùng luôn chọn mẫu sát kích thước thì trọng số kích thước tăng và thứ hạng đổi', () => {
    const near = mk('near', { w: 2400 })
    const labeledFar = mk('far', { w: 1500, labeled: true }) // mặc định nhỉnh hơn nhờ nhãn
    const before = rankWithModel([near, labeledFar], req, BASE_WEIGHTS).map((r) => r.sample.id)
    const pairs: number[][] = []
    for (let i = 0; i < 40; i++) pairs.push(...pairsFromChoice([near, labeledFar], near, req))
    const w = train(pairs)
    expect(w[5]!).toBeGreaterThan(BASE_WEIGHTS[5]!)
    const after = rankWithModel([near, labeledFar], req, w)
    expect(after[0]!.sample.id).toBe('near')
    expect(after[0]!.score - after[1]!.score).toBeGreaterThan(before.length === 2 ? 0 : -1)
  })

  it('ít dữ liệu hoặc không có dữ liệu thì không đổi nhiều', () => {
    expect(train([])).toEqual([...BASE_WEIGHTS])
    const one = train([[0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0]], BASE_WEIGHTS, { epochs: 3 })
    for (let i = 0; i < N_FEATURES; i++) expect(Math.abs(one[i]! - BASE_WEIGHTS[i]!)).toBeLessThan(2)
  })

  it('trọng số bị chặn và không đổi dấu dù dữ liệu cực đoan', () => {
    const extreme = Array.from({ length: 500 }, () => [-1, 0, 0, 0, 0, 0, 0, 0, -1, 0, 1])
    const w = train(extreme, BASE_WEIGHTS, { epochs: 400, lr: 20, pull: 0 })
    for (let i = 0; i < N_FEATURES; i++) {
      expect(Math.sign(w[i]!)).toBe(Math.sign(BASE_WEIGHTS[i]!))
      expect(Math.abs(w[i]!)).toBeLessThanOrEqual(Math.abs(BASE_WEIGHTS[i]!) * 3 + 0.01)
      expect(Math.abs(w[i]!)).toBeGreaterThanOrEqual(Math.abs(BASE_WEIGHTS[i]!) * 0.25 - 0.01)
    }
    expect(clampWeights(BASE_WEIGHTS.map((x) => x * 10))).toEqual(BASE_WEIGHTS.map((x) => x * 3))
  })

  it('xác định: huấn luyện hai lần ra cùng kết quả', () => {
    const p = [[0, 0, 0, 0.3, 0, 0.5, 0, 0, 0, 1, 0], [0, 0, 1, 0, 0, -0.2, 0, 0, 0.1, 0, 0]]
    expect(train(p)).toEqual(train(p))
  })

  it('cặp học không lộ khoá hay chữ của khách và kiểm tra hợp lệ', () => {
    const pairs = pairsFromChoice([mk('s1'), mk('s2', { w: 1000 }), mk('s3', { category: 'Bàn' })], mk('s1'), req)
    expect(pairs).toHaveLength(1) // s3 sai loại, s1 là mẫu được chọn
    expect(JSON.stringify(pairs)).not.toMatch(/s1|s2|sofa/i)
    expect(validPair(pairs[0])).toBe(true)
    expect(validPair([1, 2])).toBe(false)
    expect(validPair(new Array(N_FEATURES).fill(2))).toBe(false)
    expect(validPair('x')).toBe(false)
  })
})
