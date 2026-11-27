import { describe, expect, it } from 'vitest'
import { addPolygon, addRectangle, cross, dot, emptyModel, faceList, isModel3, toTriMesh, type Model3, type Vec3 } from './model3d'
import { faceLoopPath, followPath, sweepSections } from './sweep'

function volume(m: Model3): number {
  const t = toTriMesh(m)
  let v = 0
  for (let i = 0; i < t.triangles.length; i += 3) {
    const p = (k: number): Vec3 => [t.positions[k * 3]!, t.positions[k * 3 + 1]!, t.positions[k * 3 + 2]!]
    v += dot(p(t.triangles[i]!), cross(p(t.triangles[i + 1]!), p(t.triangles[i + 2]!))) / 6
  }
  return v
}
function closed(m: Model3): boolean {
  const dir = new Map<string, number>()
  for (const f of faceList(m)) for (const loop of [f.loop, ...(f.holes ?? [])]) for (let i = 0; i < loop.length; i++) {
    const k = `${loop[i]}>${loop[(i + 1) % loop.length]}`
    dir.set(k, (dir.get(k) ?? 0) + 1)
  }
  for (const k of dir.keys()) { const [a, b] = k.split('>'); if (dir.get(k) !== 1 || dir.get(`${b}>${a}`) !== 1) return false }
  return true
}

describe('chạy dọc đường', () => {
  it('len chân tường chạy quanh mặt sàn: vòng kín, đúng thể tích, không nắp', () => {
    const floor = addRectangle(emptyModel(), [0, 0, 0], [2000, 1000, 0])
    // Mặt cắt 20 × 100 mm dựng đứng ở góc phòng, vuông góc với cạnh đầu (trục X)
    const prof = addPolygon(floor.model, [[0, 0, 0], [0, 20, 0], [0, 20, 100], [0, 0, 100]])
    const r = followPath(prof.model, prof.faceId, faceLoopPath(prof.model, floor.faceId), { closed: true, name: 'Len chân tường' })
    const ring = { ...r.model, faces: Object.fromEntries(faceList(r.model).filter((f) => f.group === r.groupId).map((f) => [f.id, f])) }
    expect(faceList(ring)).toHaveLength(16)
    expect(closed(ring)).toBe(true)
    expect(volume(ring)).toBeCloseTo((2000 * 1000 - 1960 * 960) * 100, -2)
    expect(r.model.faces[prof.faceId]).toBeUndefined()
    expect(r.model.groups[r.groupId]!.name).toBe('Len chân tường')
    expect(isModel3(r.model)).toBe(true)
  })

  it('đường hở hình chữ L: có hai nắp, khối kín, thể tích dương', () => {
    const prof = addPolygon(emptyModel(), [[0, -10, 0], [0, 10, 0], [0, 10, 50], [0, -10, 50]])
    const r = followPath(prof.model, prof.faceId, [[0, 0, 0], [1000, 0, 0], [1000, 800, 0]])
    expect(closed(r.model)).toBe(true)
    // Đường tâm dài 1000 + 800, mặt cắt 20 × 50
    expect(volume(r.model)).toBeCloseTo(1800 * 20 * 50, -2)
    expect(faceList(r.model)).toHaveLength(4 * 2 + 2)
  })

  it('mặt cắt nằm song song với đường thì báo lỗi', () => {
    expect(() => sweepSections([[0, 0, 0], [100, 0, 0], [100, 100, 0]], [[0, 0, 0], [1000, 0, 0]], false)).toThrow(/vuông góc/)
  })
})
