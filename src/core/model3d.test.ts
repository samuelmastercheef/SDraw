import { describe, expect, it } from 'vitest'
import {
  addBox, addCircle, addPolygon, addRectangle, bounds, closestOnAxis, connectedFaces, copyFaces, cross, deleteFaces, dot,
  edges, emptyModel, expandToGroups, faceArea, faceList, faceNormal, groupFaces, isModel3, pickFace, pushPull, rayPlane,
  rotateFacesZ, setFaceColor, snapPoint, toTriMesh, translateFaces, triangulatePolygon, ungroup, type Model3, type Vec3,
  drawRectangle, drawCircle, splitFaceByPath, faceForSegment, onFaceEdge,
  arcPoints, bulgePoint, drawArc, offsetFace, offsetPolygon, insetDistance, distance,
  rotateFaces, scaleFaces, arrayFaces
} from './model3d'
import { importMesh, modelFromScene, parseStl, toGlb, toObj, toStl } from './model3dIo'
import { parseGlb, parseObj } from './mesh'

/** Thể tích có dấu: dương khi mọi mặt quay ra ngoài khối kín. */
function volume(m: Model3): number {
  const t = toTriMesh(m)
  let v = 0
  for (let i = 0; i < t.triangles.length; i += 3) {
    const p = (k: number): Vec3 => [t.positions[k * 3]!, t.positions[k * 3 + 1]!, t.positions[k * 3 + 2]!]
    v += dot(p(t.triangles[i]!), cross(p(t.triangles[i + 1]!), p(t.triangles[i + 2]!))) / 6
  }
  return v
}

/** Khối kín: mỗi cạnh có đúng hai mặt dùng, đi ngược chiều nhau. */
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
  return { model: pushPull(r.model, r.faceId, h), base: r.faceId }
}

describe('vẽ mặt', () => {
  it('chữ nhật trên nền có pháp tuyến hướng lên và đúng diện tích', () => {
    const { model, faceId } = addRectangle(emptyModel(), [0, 0, 0], [2000, 1000, 0])
    const f = model.faces[faceId]!
    expect(faceNormal(model, f)).toEqual([0, 0, 1])
    expect(faceArea(model, f)).toBeCloseTo(2_000_000)
    expect(edges(model)).toHaveLength(4)
  })

  it('kéo ngược góc vẫn ra pháp tuyến đúng', () => {
    const { model, faceId } = addRectangle(emptyModel(), [2000, 1000, 0], [0, 0, 0])
    expect(faceNormal(model, model.faces[faceId]!)[2]).toBeCloseTo(1)
  })

  it('chữ nhật trên mặt đứng', () => {
    const { model, faceId } = addRectangle(emptyModel(), [0, 0, 0], [0, 1000, 2000], [1, 0, 0])
    expect(faceNormal(model, model.faces[faceId]!)[0]).toBeCloseTo(1)
    expect(faceArea(model, model.faces[faceId]!)).toBeCloseTo(2_000_000)
  })

  it('hai chữ nhật cạnh nhau dùng chung đỉnh', () => {
    let m = addRectangle(emptyModel(), [0, 0, 0], [1000, 1000, 0]).model
    m = addRectangle(m, [1000, 0, 0], [2000, 1000, 0]).model
    expect(Object.keys(m.vertices)).toHaveLength(6)
    expect(edges(m)).toHaveLength(7)
  })

  it('từ chối mặt suy biến hoặc không phẳng', () => {
    expect(() => addPolygon(emptyModel(), [[0, 0, 0], [1000, 0, 0], [2000, 0, 0]])).toThrow()
    expect(() => addPolygon(emptyModel(), [[0, 0, 0], [1000, 0, 0], [1000, 1000, 0], [0, 1000, 300]])).toThrow(/mặt phẳng/)
  })

  it('hình tròn 24 cạnh', () => {
    const { model, faceId } = addCircle(emptyModel(), [0, 0, 0], 500)
    expect(model.faces[faceId]!.loop).toHaveLength(24)
    expect(faceArea(model, model.faces[faceId]!)).toBeCloseTo(0.5 * 24 * 500 * 500 * Math.sin((2 * Math.PI) / 24))
  })
})

describe('đẩy kéo', () => {
  it('đùn chữ nhật thành hộp kín, mặt quay ra ngoài', () => {
    const { model } = rectBox()
    expect(faceList(model)).toHaveLength(6)
    expect(closed(model)).toBe(true)
    expect(volume(model)).toBeCloseTo(2000 * 1000 * 500)
    expect(bounds(model)!.max[2]).toBe(500)
  })

  it('đẩy âm mặt rời: khối nằm phía sau mặt, vẫn kín và quay ra ngoài', () => {
    const r = addRectangle(emptyModel(), [0, 0, 0], [1000, 1000, 0])
    const m = pushPull(r.model, r.faceId, -300)
    expect(closed(m)).toBe(true)
    expect(volume(m)).toBeCloseTo(1000 * 1000 * 300)
    expect(bounds(m)!.min[2]).toBe(-300)
  })

  it('kéo nóc hộp thì dãn khối, không thêm mặt', () => {
    const { model } = rectBox()
    const top = faceList(model).find((f) => faceNormal(model, f)[2] > 0.9)!
    const m = pushPull(model, top.id, 300)
    expect(faceList(m)).toHaveLength(6)
    expect(volume(m)).toBeCloseTo(2000 * 1000 * 800)
    const m2 = pushPull(model, top.id, -200)
    expect(volume(m2)).toBeCloseTo(2000 * 1000 * 300)
  })

  it('không cho đẩy xuyên qua đáy', () => {
    const { model } = rectBox()
    const top = faceList(model).find((f) => faceNormal(model, f)[2] > 0.9)!
    expect(() => pushPull(model, top.id, -500)).toThrow(/xuyên/)
  })

  it('kéo vách hộp sang bên', () => {
    const { model } = rectBox()
    const side = faceList(model).find((f) => faceNormal(model, f)[0] > 0.9)!
    const m = pushPull(model, side.id, 500)
    expect(bounds(m)!.max[0]).toBe(2500)
    expect(closed(m)).toBe(true)
  })

  it('đùn hình tròn thành trụ kín', () => {
    const c = addCircle(emptyModel(), [0, 0, 0], 300)
    const m = pushPull(c.model, c.faceId, 750)
    expect(faceList(m)).toHaveLength(26)
    expect(closed(m)).toBe(true)
    expect(volume(m)).toBeGreaterThan(0)
  })

  it('không đổi mô hình cũ (dùng được cho hoàn tác)', () => {
    const r = addRectangle(emptyModel(), [0, 0, 0], [1000, 1000, 0])
    const before = JSON.stringify(r.model)
    pushPull(r.model, r.faceId, 500)
    expect(JSON.stringify(r.model)).toBe(before)
  })
})

describe('chọn, di chuyển, nhóm', () => {
  it('chọn các mặt nối nhau', () => {
    const { model } = rectBox()
    const other = addRectangle(model, [5000, 0, 0], [6000, 1000, 0])
    expect(connectedFaces(other.model, faceList(model)[0]!.id)).toHaveLength(6)
    expect(connectedFaces(other.model, other.faceId)).toEqual([other.faceId])
  })

  it('di chuyển và xoay', () => {
    const { model } = rectBox()
    const all = faceList(model).map((f) => f.id)
    const moved = translateFaces(model, all, [100, 0, 0])
    expect(bounds(moved)!.min[0]).toBe(100)
    const rot = rotateFacesZ(model, all, [0, 0, 0], 90)
    expect(bounds(rot)!.min[0]).toBeCloseTo(-1000)
    expect(volume(rot)).toBeCloseTo(volume(model))
  })

  it('nhóm tách đỉnh dùng chung để di chuyển riêng', () => {
    let m = addRectangle(emptyModel(), [0, 0, 0], [1000, 1000, 0]).model
    const b = addRectangle(m, [1000, 0, 0], [2000, 1000, 0])
    const g = groupFaces(b.model, [b.faceId], 'Bàn')
    m = translateFaces(g.model, expandToGroups(g.model, [b.faceId]), [0, 0, 500])
    expect(Object.keys(m.vertices)).toHaveLength(8)
    expect(bounds(m)!.min[2]).toBe(0)
    expect(m.groups[g.groupId]!.name).toBe('Bàn')
    const u = ungroup(m, g.groupId)
    expect(Object.keys(u.groups)).toHaveLength(0)
  })

  it('vẽ trong nhóm không hàn vào hình ngoài nhóm', () => {
    const box = addBox(emptyModel(), [0, 0, 0], 1000, 1000, 1000, { name: 'Tủ' })
    const r = addRectangle(box.model, [-500, -500, 0], [500, 500, 0])
    expect(r.model.faces[r.faceId]!.loop.every((v) => !box.model.vertices[v])).toBe(true)
  })

  it('chép, đổi màu, xoá', () => {
    const box = addBox(emptyModel(), [0, 0, 0], 600, 600, 450, { name: 'Ghế' })
    const ids = faceList(box.model).map((f) => f.id)
    const c = copyFaces(box.model, ids, [1000, 0, 0])
    expect(Object.keys(c.model.groups)).toHaveLength(2)
    const colored = setFaceColor(c.model, c.faceIds, '#aa3300')
    expect(colored.faces[c.faceIds[0]!]!.color).toBe('#aa3300')
    const del = deleteFaces(colored, ids)
    expect(Object.keys(del.groups)).toHaveLength(1)
    expect(Object.keys(del.vertices)).toHaveLength(8)
  })

  it('hộp có xoay vẫn kín và đúng thể tích', () => {
    const b = addBox(emptyModel(), [500, 500, 0], 2000, 900, 800, { rotDeg: 30 })
    expect(closed(b.model)).toBe(true)
    expect(volume(b.model)).toBeCloseTo(2000 * 900 * 800, -2)
  })
})

describe('chia tam giác, tia, bám điểm', () => {
  it('đa giác lõm chữ L', () => {
    const L: Vec3[] = [[0, 0, 0], [2000, 0, 0], [2000, 1000, 0], [1000, 1000, 0], [1000, 2000, 0], [0, 2000, 0]]
    const tris = triangulatePolygon(L)
    expect(tris).toHaveLength(4)
    const area = tris.reduce((s, [a, b, c]) => {
      const ab = [L[b]![0] - L[a]![0], L[b]![1] - L[a]![1]], ac = [L[c]![0] - L[a]![0], L[c]![1] - L[a]![1]]
      return s + (ab[0]! * ac[1]! - ab[1]! * ac[0]!) / 2
    }, 0)
    expect(area).toBeCloseTo(3_000_000)
  })

  it('tia chạm nóc hộp', () => {
    const { model } = rectBox()
    const hit = pickFace(model, [500, 500, 5000], [0, 0, -1])!
    expect(faceNormal(model, model.faces[hit.faceId]!)[2]).toBeCloseTo(1)
    expect(hit.point[2]).toBeCloseTo(500)
    expect(pickFace(model, [5000, 5000, 5000], [0, 0, -1])).toBeNull()
  })

  it('giao tia với nền và điểm gần trục', () => {
    expect(rayPlane([0, 0, 1000], [0, 0.6, -0.8], [0, 0, 0], [0, 0, 1])).toEqual([0, 750, 0])
    expect(closestOnAxis([0, 0, 0], [0, 0, 1], [1000, 0, 300], [-1, 0, 0])).toBeCloseTo(300)
  })

  it('bám đỉnh trước trung điểm và cạnh', () => {
    const { model } = addRectangle(emptyModel(), [0, 0, 0], [1000, 1000, 0])
    expect(snapPoint(model, [10, 8, 0], 30).kind).toBe('vertex')
    expect(snapPoint(model, [495, 6, 0], 30)).toEqual({ point: [500, 0, 0], kind: 'midpoint' })
    expect(snapPoint(model, [300, 10, 0], 30)).toEqual({ point: [300, 0, 0], kind: 'edge' })
    expect(snapPoint(model, [300, 300, 0], 30).kind).toBe('none')
  })
})

describe('nhập xuất', () => {
  const box = () => rectBox(1000, 1000, 1000).model

  it('OBJ đọc lại được, giữ số đỉnh và mặt đa giác', () => {
    const obj = toObj(box(), 'hộp')
    expect(obj.match(/^f /gm)).toHaveLength(6)
    const back = parseObj(obj)
    expect(back.positions).toHaveLength(8 * 3)
    expect(back.triangles).toHaveLength(12 * 3)
  })

  it('STL văn bản đọc lại được', () => {
    const stl = toStl(box())
    const back = parseStl(new TextEncoder().encode(stl))
    expect(back.triangles).toHaveLength(36)
  })

  it('STL nhị phân', () => {
    const buf = new Uint8Array(84 + 50)
    const dv = new DataView(buf.buffer)
    dv.setUint32(80, 1, true)
    ;[0, 0, 0, 1, 0, 0, 0, 1, 0].forEach((v, i) => dv.setFloat32(84 + 12 + i * 4, v, true))
    expect(parseStl(buf).positions).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0])
  })

  it('GLB đọc lại được, đổi sang mét trục Y lên', () => {
    const glb = toGlb(box())
    const back = parseGlb(glb)
    expect(back.triangles).toHaveLength(36)
    const ys = back.positions.filter((_, i) => i % 3 === 1)
    expect(Math.max(...ys)).toBeCloseTo(1)
  })

  it('nhập lại GLB vào mô hình thành một nhóm, đúng kích thước', () => {
    const r = importMesh(emptyModel(), 'glb', toGlb(box()), 'Hộp nhập')
    expect(Object.values(r.model.groups)[0]!.name).toBe('Hộp nhập')
    expect(faceList(r.model)).toHaveLength(12)
    const b = bounds(r.model)!
    expect(b.max[2] - b.min[2]).toBeCloseTo(1000, 0)
    expect(volume(r.model)).toBeCloseTo(1e9, -6)
    expect(isModel3(r.model)).toBe(true)
  })

  it('kiểm tra tệp mô hình', () => {
    expect(isModel3(box())).toBe(true)
    expect(isModel3({ version: 1, seq: 1, vertices: {}, faces: { f1: { id: 'f1', loop: ['a', 'b', 'c'] } }, groups: {} })).toBe(false)
    expect(isModel3(JSON.parse(JSON.stringify(box())))).toBe(true)
  })

  it('dựng từ bố cục phòng', () => {
    const m = modelFromScene({
      boxes: [
        { kind: 'floor', x: 2, y: -0.05, z: 1.5, w: 4, h: 0.1, d: 3, rotY: 0, floor: 0 },
        { kind: 'furniture', x: 1, y: 0.4, z: 1, w: 2, h: 0.8, d: 0.9, rotY: Math.PI / 2, floor: 0, label: 'Sofa' },
        { kind: 'light', x: 1, y: 2.3, z: 1, w: 0.3, h: 0.1, d: 0.3, rotY: 0, floor: 0 }
      ],
      floors: [0],
      bounds: { minX: 0, maxX: 4, minZ: 0, maxZ: 3, maxY: 2.4 }
    })
    expect(Object.values(m.groups).map((g) => g.name)).toEqual(['Sàn', 'Sofa'])
    expect(faceList(m)).toHaveLength(12)
    const b = bounds(m)!
    expect(b.min[2]).toBeCloseTo(-100)
    expect(b.max[2]).toBeCloseTo(800)
    expect(b.min[1]).toBeCloseTo(-3000)
  })
})

describe('cắt mặt', () => {
  const topOf = (m: Model3) => faceList(m).find((f) => faceNormal(m, f)[2] > 0.9 && bounds(m)!.max[2] - m.vertices[f.loop[0]!]![2] < 1)!

  it('vẽ chữ nhật trong nóc hộp: nóc có lỗ, hình mới thành mặt riêng', () => {
    const { model } = rectBox(2000, 1000, 500)
    const top = topOf(model)
    const r = drawRectangle(model, [500, 250, 500], [1500, 750, 500], [0, 0, 1], { host: top.id })
    expect(faceList(r.model)).toHaveLength(7)
    expect(r.model.faces[top.id]!.holes).toHaveLength(1)
    expect(faceArea(r.model, r.model.faces[top.id]!)).toBeCloseTo(2_000_000 - 500_000)
    expect(closed(r.model)).toBe(true)
    expect(volume(r.model)).toBeCloseTo(2000 * 1000 * 500)
  })

  it('kéo hình trong nóc lên thành khối nhô, đẩy xuống thành hốc, vẫn kín', () => {
    const { model } = rectBox(2000, 1000, 500)
    const r = drawRectangle(model, [500, 250, 500], [1500, 750, 500], [0, 0, 1], { host: topOf(model).id })
    const up = pushPull(r.model, r.faceId, 300)
    expect(closed(up)).toBe(true)
    expect(volume(up)).toBeCloseTo(2000 * 1000 * 500 + 1000 * 500 * 300)
    const down = pushPull(r.model, r.faceId, -200)
    expect(closed(down)).toBe(true)
    expect(volume(down)).toBeCloseTo(2000 * 1000 * 500 - 1000 * 500 * 200)
  })

  it('hình tròn trong mặt thành lỗ tròn; tia không chạm vào lỗ của mặt chủ', () => {
    const r0 = addRectangle(emptyModel(), [0, 0, 0], [2000, 2000, 0])
    const c = drawCircle(r0.model, [1000, 1000, 0], 400, [0, 0, 1], { host: r0.faceId })
    const hit = pickFace(c.model, [1000, 1000, 1000], [0, 0, -1])!
    expect(hit.faceId).toBe(c.faceId)
    expect(pickFace(c.model, [100, 100, 1000], [0, 0, -1])!.faceId).toBe(r0.faceId)
    const hole = deleteFaces(c.model, [c.faceId])
    expect(pickFace(hole, [1000, 1000, 1000], [0, 0, -1])).toBeNull()
  })

  it('chữ nhật chạm mép chia mặt làm hai, không để khe với thành hộp', () => {
    const { model } = rectBox(2000, 1000, 500)
    const top = topOf(model)
    const r = drawRectangle(model, [0, 0, 500], [800, 1000, 500], [0, 0, 1], { host: top.id })
    const tops = faceList(r.model).filter((f) => faceNormal(r.model, f)[2] > 0.9 && r.model.vertices[f.loop[0]!]![2] === 500)
    expect(tops).toHaveLength(2)
    expect(faceArea(r.model, r.model.faces[r.faceId]!)).toBeCloseTo(800_000)
    expect(closed(r.model)).toBe(true)
    expect(volume(r.model)).toBeCloseTo(2000 * 1000 * 500)
    const up = pushPull(r.model, r.faceId, 400)
    expect(closed(up)).toBe(true)
    expect(volume(up)).toBeCloseTo(2000 * 1000 * 500 + 800 * 1000 * 400)
  })

  it('chữ nhật ở góc chạm hai cạnh', () => {
    const r0 = addRectangle(emptyModel(), [0, 0, 0], [2000, 2000, 0])
    const r = drawRectangle(r0.model, [0, 0, 0], [600, 600, 0], [0, 0, 1], { host: r0.faceId })
    expect(faceList(r.model)).toHaveLength(2)
    expect(faceArea(r.model, r.model.faces[r.faceId]!)).toBeCloseTo(360_000)
    expect(faceArea(r.model, r.model.faces[r0.faceId]!) + faceArea(r.model, r.model.faces[r.faceId]!)).toBeCloseTo(4_000_000)
  })

  it('đường thẳng nối hai cạnh chia đôi mặt', () => {
    const { model } = rectBox(2000, 1000, 500)
    const top = topOf(model)
    const m = splitFaceByPath(model, top.id, [[1000, 0, 500], [1000, 1000, 500]])
    expect(faceList(m)).toHaveLength(7)
    expect(closed(m)).toBe(true)
    const host = faceForSegment(model, [1000, 0, 500], [1000, 1000, 500])
    expect(host).toBe(top.id)
    expect(onFaceEdge(model, top.id, [1000, 0, 500])).toBe(true)
    expect(onFaceEdge(model, top.id, [1000, 500, 500])).toBe(false)
  })

  it('đường gấp khúc qua điểm bên trong', () => {
    const r0 = addRectangle(emptyModel(), [0, 0, 0], [2000, 2000, 0])
    const m = splitFaceByPath(r0.model, r0.faceId, [[0, 1000, 0], [1000, 1500, 0], [2000, 1000, 0]])
    expect(faceList(m)).toHaveLength(2)
    const areas = faceList(m).map((f) => faceArea(m, f)).sort((a, b) => a - b)
    expect(areas[0]! + areas[1]!).toBeCloseTo(4_000_000)
    expect(areas[0]).toBeCloseTo(1_500_000)
  })

  it('từ chối hình vượt ra ngoài mặt hoặc đường không chạm mép', () => {
    const r0 = addRectangle(emptyModel(), [0, 0, 0], [1000, 1000, 0])
    expect(() => drawRectangle(r0.model, [500, 500, 0], [1500, 800, 0], [0, 0, 1], { host: r0.faceId })).toThrow(/ra ngoài/)
    expect(() => splitFaceByPath(r0.model, r0.faceId, [[100, 100, 0], [900, 900, 0]])).toThrow(/mép/)
  })

  it('mặt có lỗ: xuất OBJ thành tam giác, GLB đọc lại đúng diện tích, lưu và kiểm tra tệp', () => {
    const r0 = addRectangle(emptyModel(), [0, 0, 0], [2000, 2000, 0])
    const r = drawRectangle(r0.model, [500, 500, 0], [1500, 1500, 0], [0, 0, 1], { host: r0.faceId })
    const m = deleteFaces(r.model, [r.faceId])
    expect(isModel3(JSON.parse(JSON.stringify(m)))).toBe(true)
    const obj = parseObj(toObj(m))
    let area = 0
    for (let i = 0; i < obj.triangles.length; i += 3) {
      const p = (k: number): Vec3 => [obj.positions[k * 3]!, obj.positions[k * 3 + 1]!, obj.positions[k * 3 + 2]!]
      const a = p(obj.triangles[i]!), b = p(obj.triangles[i + 1]!), c = p(obj.triangles[i + 2]!)
      area += cross([b[0] - a[0], b[1] - a[1], b[2] - a[2]], [c[0] - a[0], c[1] - a[1], c[2] - a[2]])[2] / 2
    }
    expect(area).toBeCloseTo(3_000_000)
    const g = groupFaces(m, faceList(m).map((f) => f.id))
    const moved = translateFaces(g.model, expandToGroups(g.model, faceList(g.model).map((f) => f.id)), [0, 0, 100])
    expect(bounds(moved)!.min[2]).toBe(100)
    const copy = copyFaces(m, faceList(m).map((f) => f.id), [3000, 0, 0])
    expect(copy.model.faces[copy.faceIds[0]!]!.holes).toHaveLength(1)
  })

  it('đẩy kéo mặt có lỗ (vành khuyên) thành khối rỗng kín', () => {
    const r0 = addRectangle(emptyModel(), [0, 0, 0], [2000, 2000, 0])
    const r = drawRectangle(r0.model, [500, 500, 0], [1500, 1500, 0], [0, 0, 1], { host: r0.faceId })
    const ring = deleteFaces(r.model, [r.faceId])
    const m = pushPull(ring, r0.faceId, 300)
    expect(closed(m)).toBe(true)
    expect(volume(m)).toBeCloseTo(3_000_000 * 300)
  })
})

describe('cung tròn và offset', () => {
  it('cung qua ba điểm: nửa đường tròn', () => {
    const pts = arcPoints([0, 0, 0], [500, 500, 0], [1000, 0, 0], 24)
    expect(pts[0]).toEqual([0, 0, 0])
    expect(pts[pts.length - 1]).toEqual([1000, 0, 0])
    expect(pts.length).toBe(13)
    for (const p of pts) expect(distance(p, [500, 0, 0])).toBeCloseTo(500)
    expect(Math.max(...pts.map((p) => p[1]))).toBeCloseTo(500)
  })

  it('cung đi đúng phía điểm giữa', () => {
    const below = arcPoints([0, 0, 0], [500, -200, 0], [1000, 0, 0])
    expect(Math.min(...below.map((p) => p[1]))).toBeCloseTo(-200, 0)
    expect(Math.max(...below.map((p) => p[1]))).toBeLessThan(1)
    expect(bulgePoint([0, 0, 0], [1000, 0, 0], [0, 0, 1], 200, [500, -50, 0])).toEqual([500, -200, 0])
  })

  it('bo góc mặt bằng cung nối hai cạnh', () => {
    const r0 = addRectangle(emptyModel(), [0, 0, 0], [2000, 2000, 0])
    // cung từ (1600,2000) tới (2000,1600), lõm vào trong qua (1717,1717)
    const c = 2000 - 400 + 400 * Math.SQRT1_2 - 400 + 400 - 400 * (1 - Math.SQRT1_2)
    const r = drawArc(r0.model, [1600, 2000, 0], [c, c, 0], [2000, 1600, 0])
    expect(faceList(r.model)).toHaveLength(2)
    const areas = faceList(r.model).map((f) => faceArea(r.model, f)).sort((a, b) => a - b)
    expect(areas[0]! + areas[1]!).toBeCloseTo(4_000_000)
    expect(areas[0]).toBeGreaterThan(0)
  })

  it('cung tự do khép bằng dây cung thành mặt', () => {
    const r = drawArc(emptyModel(), [0, 0, 0], [500, 500, 0], [1000, 0, 0])
    expect(r.faceId).not.toBeNull()
    expect(faceArea(r.model, r.model.faces[r.faceId!]!)).toBeCloseTo((Math.PI * 500 * 500) / 2, -4)
    expect(faceNormal(r.model, r.model.faces[r.faceId!]!)[2]).toBeCloseTo(1)
  })

  it('offset vào trong nóc hộp: viền + mặt giữa, kéo mặt giữa vẫn kín', () => {
    const { model } = rectBox(2000, 1000, 500)
    const top = faceList(model).find((f) => faceNormal(model, f)[2] > 0.9)!
    const r = offsetFace(model, top.id, 100)
    expect(faceArea(r.model, r.model.faces[r.faceId]!)).toBeCloseTo(1800 * 800)
    expect(r.model.faces[top.id]!.holes).toHaveLength(1)
    const sink = pushPull(r.model, r.faceId, -300)
    expect(closed(sink)).toBe(true)
    expect(volume(sink)).toBeCloseTo(2000 * 1000 * 500 - 1800 * 800 * 300)
  })

  it('offset đa giác lõm chữ L', () => {
    const L: Vec3[] = [[0, 0, 0], [2000, 0, 0], [2000, 1000, 0], [1000, 1000, 0], [1000, 2000, 0], [0, 2000, 0]]
    const o = offsetPolygon(L, 100, [0, 0, 1])
    expect(o[0]).toEqual([100, 100, 0])
    expect(o[3]![0]).toBeCloseTo(900); expect(o[3]![1]).toBeCloseTo(900)
  })

  it('offset ra ngoài chỉ với mặt rời', () => {
    const r0 = addRectangle(emptyModel(), [0, 0, 0], [1000, 1000, 0])
    const r = offsetFace(r0.model, r0.faceId, -200)
    expect(faceArea(r.model, r.model.faces[r.faceId]!)).toBeCloseTo(1400 * 1400 - 1000 * 1000)
    expect(edges(r.model)).toHaveLength(8)
    const { model } = rectBox()
    const top = faceList(model).find((f) => faceNormal(model, f)[2] > 0.9)!
    expect(() => offsetFace(model, top.id, -100)).toThrow(/mặt rời/)
    expect(() => offsetFace(model, top.id, 600)).toThrow()
  })

  it('khoảng cách vào trong để rê chuột khi offset', () => {
    const r0 = addRectangle(emptyModel(), [0, 0, 0], [1000, 1000, 0])
    expect(insetDistance(r0.model, r0.faceId, [100, 500, 0])).toBeCloseTo(100)
    expect(insetDistance(r0.model, r0.faceId, [-50, 500, 0])).toBeCloseTo(-50)
  })
})

describe('xoay, co giãn, chép thành dãy', () => {
  const allIds = (m: Model3) => faceList(m).map((f) => f.id)

  it('xoay quanh trục ngang 90° giữ thể tích, đổi chiều cao thành chiều sâu', () => {
    const { model } = rectBox(2000, 1000, 500)
    const r = rotateFaces(model, allIds(model), [0, 0, 0], [1, 0, 0], 90)
    const b = bounds(r)!
    expect(b.max[2] - b.min[2]).toBeCloseTo(1000)
    expect(b.max[1] - b.min[1]).toBeCloseTo(500)
    expect(volume(r)).toBeCloseTo(2000 * 1000 * 500, 0)
    expect(closed(r)).toBe(true)
  })

  it('xoay quanh trục đứng 30° giống rotateFacesZ', () => {
    const { model } = rectBox(2000, 1000, 500)
    const a = rotateFaces(model, allIds(model), [100, 200, 0], [0, 0, 1], 30)
    const b = rotateFacesZ(model, allIds(model), [100, 200, 0], 30)
    for (const v of Object.keys(a.vertices)) a.vertices[v]!.forEach((c, i) => expect(c).toBeCloseTo(b.vertices[v]![i]!))
  })

  it('co giãn đều và theo trục, thể tích đúng', () => {
    const { model } = rectBox(2000, 1000, 500)
    const s2 = scaleFaces(model, allIds(model), [0, 0, 0], 2)
    expect(volume(s2)).toBeCloseTo(8 * 2000 * 1000 * 500, -2)
    const sx = scaleFaces(model, allIds(model), [0, 0, 0], [0.5, 1, 1.2])
    expect(bounds(sx)!.max[0]).toBeCloseTo(1000)
    expect(bounds(sx)!.max[2]).toBeCloseTo(600)
    expect(() => scaleFaces(model, allIds(model), [0, 0, 0], 0)).toThrow(/khác 0/)
  })

  it('lật (hệ số âm) vẫn quay mặt ra ngoài', () => {
    const { model } = rectBox(2000, 1000, 500)
    const m = scaleFaces(model, allIds(model), [0, 0, 0], [-1, 1, 1])
    expect(volume(m)).toBeCloseTo(2000 * 1000 * 500, 0)
    expect(closed(m)).toBe(true)
    expect(bounds(m)!.min[0]).toBeCloseTo(-2000)
  })

  it('chép thành dãy 4 bản cách 600 mm', () => {
    const box = addBox(emptyModel(), [0, 0, 0], 500, 400, 800, { name: 'Lam' })
    const r = arrayFaces(box.model, allIds(box.model), [600, 0, 0], 4)
    expect(r.copies).toHaveLength(4)
    expect(Object.keys(r.model.groups)).toHaveLength(5)
    expect(bounds(r.model)!.max[0]).toBeCloseTo(250 + 4 * 600)
    expect(volume(r.model)).toBeCloseTo(5 * 500 * 400 * 800, -2)
    expect(() => arrayFaces(box.model, allIds(box.model), [0, 0, 0], 3)).toThrow()
  })
})
