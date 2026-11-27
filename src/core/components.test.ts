import { describe, expect, it } from 'vitest'
import { addBox, copyFaces, faceList, faceNormal, isModel3, pushPull, rotateFaces, scaleFaces, setFaceColor, translateFaces, type Model3 } from './model3d'
import { componentList, faceBounds, groupFaceIds, makeComponent, makeUnique, placeComponent, propagateComponents, renameComponent } from './components'

const groupBounds = (m: Model3, g: string) => faceBounds(m, groupFaceIds(m, g))!
const size = (m: Model3, g: string) => { const b = groupBounds(m, g); return b.max.map((x, i) => Math.round(x - b.min[i]!)) }

function setup() {
  const box = addBox({ version: 1, vertices: {}, faces: {}, groups: {}, seq: 1 }, [300, 200, 0], 600, 400, 720, { name: 'Thân tủ' })
  return makeComponent(box.model, groupFaceIds(box.model, box.groupId))
}

describe('cấu kiện dùng lại', () => {
  it('biến nhóm thành cấu kiện, giữ tên nhóm, hợp lệ khi lưu', () => {
    const r = setup()
    expect(r.model.groups[r.groupId]!.component).toBe(r.componentId)
    expect(r.model.components![r.componentId]!.name).toBe('Thân tủ')
    expect(r.model.components![r.componentId]!.faces).toHaveLength(6)
    expect(r.model.groups[r.groupId]!.frame!.o).toEqual([0, 0, 0])
    expect(isModel3(JSON.parse(JSON.stringify(r.model)))).toBe(true)
    expect(() => makeComponent(r.model, groupFaceIds(r.model, r.groupId))).toThrow('đã là cấu kiện')
  })

  it('chép, xoay, di chuyển cả bản không đổi định nghĩa', () => {
    const r = setup()
    let m = copyFaces(r.model, groupFaceIds(r.model, r.groupId), [1000, 0, 0]).model
    const g2 = Object.values(m.groups).find((g) => g.id !== r.groupId)!.id
    expect(m.groups[g2]!.component).toBe(r.componentId)
    m = rotateFaces(m, groupFaceIds(m, g2), [1300, 200, 0], [0, 0, 1], 37)
    m = translateFaces(m, groupFaceIds(m, g2), [0, 500, 0])
    expect(propagateComponents(m)).toBe(m)
    expect(componentList(m)).toEqual([{ id: r.componentId, name: 'Thân tủ', instances: 2, faces: 6 }])
  })

  it('sửa một bản thì mọi bản khác đổi theo, kể cả bản đã xoay và bản bị lật', () => {
    const r = setup()
    let m = r.model
    const a = placeComponent(m, r.componentId, [2000, 0, 0], 90); m = a.model
    const b = placeComponent(m, r.componentId, [4000, 0, 0]); m = b.model
    m = scaleFaces(m, b.faceIds, [4000, 0, 0], [-1, 1, 1])
    expect(propagateComponents(m)).toBe(m)
    // Đẩy nóc bản gốc lên 100 mm
    const top = groupFaceIds(m, r.groupId).find((id) => faceNormal(m, m.faces[id]!)[2] > 0.9)!
    m = propagateComponents(pushPull(m, top, 100))
    expect(size(m, r.groupId)).toEqual([600, 400, 820])
    expect(size(m, a.groupId)).toEqual([400, 600, 820])
    expect(size(m, b.groupId)).toEqual([600, 400, 820])
    expect(groupBounds(m, b.groupId).min[0]).toBeCloseTo(3400)
    // Bản bị lật vẫn quay mặt ra ngoài: nóc hướng lên
    expect(groupFaceIds(m, b.groupId).some((id) => faceNormal(m, m.faces[id]!)[2] > 0.9 && groupBounds(m, b.groupId).max[2] === 820)).toBe(true)
    expect(isModel3(m)).toBe(true)
  })

  it('tô màu một mặt cũng lan sang các bản', () => {
    const r = setup()
    const a = placeComponent(r.model, r.componentId, [2000, 0, 0])
    const m = propagateComponents(setFaceColor(a.model, [a.faceIds[0]!], '#ff0000'))
    const red = faceList(m).filter((f) => f.color === '#ff0000')
    expect(red).toHaveLength(2)
    expect(new Set(red.map((f) => f.group))).toEqual(new Set([r.groupId, a.groupId]))
  })

  it('tách bản khỏi cấu kiện thì sửa riêng; đổi tên đổi cả các bản', () => {
    const r = setup()
    const a = placeComponent(r.model, r.componentId, [2000, 0, 0])
    let m = makeUnique(a.model, a.groupId)
    const top = groupFaceIds(m, a.groupId).find((id) => faceNormal(m, m.faces[id]!)[2] > 0.9)!
    m = propagateComponents(pushPull(m, top, 100))
    expect(size(m, r.groupId)).toEqual([600, 400, 720])
    expect(size(m, a.groupId)).toEqual([600, 400, 820])
    m = renameComponent(m, r.componentId, 'Tủ 600')
    expect(m.groups[r.groupId]!.name).toBe('Tủ 600')
    // Bản cuối bị tách thì định nghĩa bị bỏ
    expect(makeUnique(m, r.groupId).components).toBeUndefined()
  })
})
