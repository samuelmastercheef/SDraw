import { describe, expect, it } from 'vitest'
import { addBox, addRectangle, copyFaces, emptyModel, faceList, isModel3, pushPull, setFaceColor, type Model3 } from './model3d'
import { MATERIAL_LIBRARY, faceTrianglesUV, patternPixels, pruneMaterials, setFaceMaterial, textureMaterial, updateMaterial } from './materials'
import { booleanOp } from './model3dBool'
import { toGlb, toObj } from './model3dIo'
import { parseGlb } from './mesh'

const oak = MATERIAL_LIBRARY.find((m) => m.id === 'm-go-soi')!
function box(): Model3 {
  const r = addRectangle(emptyModel(), [0, 0, 0], [1200, 600, 0])
  return pushPull(r.model, r.faceId, 750)
}

describe('vật liệu', () => {
  it('thư viện hợp lệ, id không trùng', () => {
    expect(new Set(MATERIAL_LIBRARY.map((m) => m.id)).size).toBe(MATERIAL_LIBRARY.length)
    const m = setFaceMaterial(box(), [faceList(box())[0]!.id], MATERIAL_LIBRARY[0])
    for (const mat of MATERIAL_LIBRARY) expect(isModel3(setFaceMaterial(m, [faceList(m)[0]!.id], mat))).toBe(true)
  })

  it('gán, đổi màu thì bỏ vật liệu, bỏ vật liệu thừa', () => {
    const m0 = box()
    const ids = faceList(m0).map((f) => f.id)
    const m = setFaceMaterial(m0, ids, oak)
    expect(faceList(m).every((f) => f.material === oak.id)).toBe(true)
    expect(m.materials?.[oak.id]?.name).toBe('Gỗ sồi')
    expect(isModel3(m)).toBe(true)
    const c = pruneMaterials(setFaceColor(m, ids, '#aa3300'))
    expect(faceList(c).some((f) => f.material)).toBe(false)
    expect(c.materials).toBeUndefined()
    expect(isModel3({ ...m, materials: {} })).toBe(false)
  })

  it('mặt sinh ra khi đẩy kéo, chép, trừ khối giữ vật liệu', async () => {
    const r = addRectangle(emptyModel(), [0, 0, 0], [1000, 1000, 0])
    const painted = setFaceMaterial(r.model, [r.faceId], oak)
    const ext = pushPull(painted, r.faceId, 500)
    expect(faceList(ext).every((f) => f.material === oak.id)).toBe(true)
    const cp = copyFaces(ext, faceList(ext).map((f) => f.id), [2000, 0, 0])
    expect(cp.faceIds.every((id) => cp.model.faces[id]!.material === oak.id)).toBe(true)
    const a = faceList(ext).map((f) => f.id)
    const withB = addBox(ext, [500, 500, -100], 200, 200, 700).model
    const bIds = faceList(withB).map((f) => f.id).filter((id) => !a.includes(id))
    const cut = await booleanOp(withB, a, bIds, 'subtract')
    expect(faceList(cut).length).toBe(10)
    expect(cut.materials?.[oak.id]).toBeTruthy()
    expect(faceList(cut).filter((f) => f.material === oak.id).length).toBeGreaterThanOrEqual(6)
  })

  it('toạ độ vân tính theo cỡ ô vân', () => {
    const r = addRectangle(emptyModel(), [0, 0, 0], [1200, 600, 0])
    const t = faceTrianglesUV(r.model, r.model.faces[r.faceId]!, 600)
    const us = t.flatMap((x) => x.uv.map((p) => p[0])), vs = t.flatMap((x) => x.uv.map((p) => p[1]))
    expect(Math.max(...us) - Math.min(...us)).toBeCloseTo(2)
    expect(Math.max(...vs) - Math.min(...vs)).toBeCloseTo(1)
  })

  it('vân vẽ sẵn: đủ điểm ảnh, lặp lại giống nhau, khác màu nền', () => {
    for (const p of ['wood', 'marble', 'tile', 'brick', 'concrete', 'fabric', 'metal', 'plain'] as const) {
      const a = patternPixels(p, '#c8a273', 32)
      expect(a.length).toBe(32 * 32 * 4)
      expect(patternPixels(p, '#c8a273', 32)).toEqual(a)
    }
    expect(patternPixels('wood', '#c8a273', 16)).not.toEqual(patternPixels('wood', '#333333', 16))
  })

  it('ảnh vân, sửa cỡ vân', () => {
    expect(() => textureMaterial('t1', 'Gỗ', 'data:text/plain;base64,AAAA')).toThrow(/PNG/)
    const t = textureMaterial('t1', 'Gỗ nhà', 'data:image/png;base64,iVBORw0KGgo=', 800)
    const m = setFaceMaterial(box(), [faceList(box())[0]!.id], t)
    expect(isModel3(m)).toBe(true)
    expect(updateMaterial(m, 't1', { size: 300 }).materials!['t1']!.size).toBe(300)
    expect(() => updateMaterial(m, 't1', { size: 0 })).toThrow(/Cỡ vân/)
  })

  it('xuất GLB có ảnh vân: phần riêng có TEXCOORD_0, ảnh nhúng, đọc lại đủ tam giác', () => {
    const m0 = box()
    const top = faceList(m0)[1]!.id
    const m = setFaceMaterial(m0, [top], oak)
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])
    const glb = toGlb(m, { [oak.id]: { mime: 'image/png', data: png } })
    const jsonLen = new DataView(glb.buffer).getUint32(12, true)
    const json = JSON.parse(new TextDecoder().decode(glb.slice(20, 20 + jsonLen)))
    expect(json.meshes[0].primitives).toHaveLength(2)
    expect(json.meshes[0].primitives[1].attributes.TEXCOORD_0).toBeDefined()
    expect(json.images[0].mimeType).toBe('image/png')
    expect(json.materials[1].name).toBe('Gỗ sồi')
    expect(parseGlb(glb).triangles.length / 3).toBe(12)
    // Không truyền ảnh thì dùng màu nền của vật liệu
    const plain = JSON.parse(new TextDecoder().decode(toGlb(m).slice(20, 20 + new DataView(toGlb(m).buffer).getUint32(12, true))))
    expect(plain.meshes[0].primitives).toHaveLength(1)
    expect(toObj(m)).toContain('f ')
  })
})
