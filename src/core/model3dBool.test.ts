import { describe, expect, it } from 'vitest'
import {
  addBox, addRectangle, cross, dot, drawRectangle, emptyModel, faceList, faceNormal, bounds, pushPull, toTriMesh,
  type Model3, type Vec3
} from './model3d'
import { booleanOp, depthBehind, pushPullCut } from './model3dBool'

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
  for (const k of dir.keys()) {
    const [a, b] = k.split('>')
    if (dir.get(k) !== 1 || dir.get(`${b}>${a}`) !== 1) return false
  }
  return true
}

function rectBox(w = 2000, d = 1000, h = 500) {
  const r = addRectangle(emptyModel(), [0, 0, 0], [w, d, 0])
  return pushPull(r.model, r.faceId, h)
}
const topOf = (m: Model3) => faceList(m).find((f) => faceNormal(m, f)[2] > 0.9 && bounds(m)!.max[2] - m.vertices[f.loop[0]!]![2] < 1)!
const ids = (m: Model3) => faceList(m).map((f) => f.id)

describe('phép toán khối', () => {
  it('trừ hộp nhỏ xuyên qua hộp lớn: thành lỗ xuyên, khối vẫn kín, giữ màu', async () => {
    const a = rectBox(2000, 1000, 500)
    const aIds = ids(a)
    const b = addBox(a, [1000, 500, -100], 400, 400, 700, { name: 'Dao' })
    const bIds = ids(b.model).filter((id) => !aIds.includes(id))
    const r = await booleanOp(b.model, aIds, bIds, 'subtract')
    expect(volume(r)).toBeCloseTo(2000 * 1000 * 500 - 400 * 400 * 500, 0)
    expect(closed(r)).toBe(true)
    expect(faceList(r)).toHaveLength(10)
    expect(faceList(r).filter((f) => f.holes?.length)).toHaveLength(2)
    expect(Object.keys(r.groups)).toHaveLength(0)
  })

  it('hợp và giao hai hộp chồng nhau', async () => {
    const a = addBox(emptyModel(), [0, 0, 0], 1000, 1000, 1000)
    const b = addBox(a.model, [500, 0, 0], 1000, 1000, 1000)
    const aIds = faceList(b.model).filter((f) => f.group === a.groupId).map((f) => f.id)
    const bIds = faceList(b.model).filter((f) => f.group === b.groupId).map((f) => f.id)
    const u = await booleanOp(b.model, aIds, bIds, 'union')
    expect(volume(u)).toBeCloseTo(1500 * 1000 * 1000, -2)
    expect(closed(u)).toBe(true)
    expect(faceList(u)).toHaveLength(6)
    expect(faceList(u).every((f) => f.group === a.groupId)).toBe(true)
    expect(Object.keys(u.groups)).toEqual([a.groupId])
    const x = await booleanOp(b.model, aIds, bIds, 'intersect')
    expect(volume(x)).toBeCloseTo(500 * 1000 * 1000, -2)
    expect(closed(x)).toBe(true)
  })

  it('khối hở thì báo lỗi rõ ràng', async () => {
    const a = rectBox()
    const open = { ...a, faces: Object.fromEntries(Object.entries(a.faces).slice(1)) }
    const b = addBox(open, [1000, 500, 0], 200, 200, 200)
    const bIds = faceList(b.model).filter((f) => f.group === b.groupId).map((f) => f.id)
    await expect(booleanOp(b.model, ids(open), bIds, 'subtract')).rejects.toThrow(/chưa kín/)
  })
})

describe('đẩy lõm bằng phép trừ', () => {
  it('hốc nằm sát mép khối', async () => {
    const m = rectBox(2000, 1000, 500)
    const r = drawRectangle(m, [0, 250, 500], [600, 750, 500], [0, 0, 1], { host: topOf(m).id })
    expect(() => pushPull(r.model, r.faceId, -200)).toThrow(/sát mép/)
    const cut = await pushPullCut(r.model, r.faceId, -200)
    expect(volume(cut)).toBeCloseTo(2000 * 1000 * 500 - 600 * 500 * 200, 0)
    expect(closed(cut)).toBe(true)
  })

  it('đẩy hết chiều dày thì khoét xuyên', async () => {
    const m = rectBox(2000, 1000, 500)
    const r = drawRectangle(m, [500, 250, 500], [1500, 750, 500], [0, 0, 1], { host: topOf(m).id })
    expect(depthBehind(r.model, r.faceId)).toBeCloseTo(500)
    const cut = await pushPullCut(r.model, r.faceId, -500)
    expect(volume(cut)).toBeCloseTo(2000 * 1000 * 500 - 1000 * 500 * 500, 0)
    expect(closed(cut)).toBe(true)
    expect(faceList(cut)).toHaveLength(10)
  })
})
