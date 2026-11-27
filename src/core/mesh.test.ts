import { describe, expect, it } from 'vitest'
import { fitMesh, rotateMeshZ, meshBounds, meshIso, parseGlb, parseObj } from './mesh'

const CUBE = 'v 0 0 0\nv 100 0 0\nv 100 200 0\nv 0 200 0\nv 0 0 300\nv 100 0 300\nv 100 200 300\nv 0 200 300\n' +
  'f 1 2 3 4\nf 5 6 7 8\nf 1 2 6 5\nf 2 3 7 6\nf 3 4 8 7\nf 4 1 5 8\n'

function glb(): Uint8Array {
  const pos = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]) // tam giác trong mặt phẳng x-y của glTF
  const idx = new Uint16Array([0, 1, 2, 0])
  const bin = new Uint8Array(pos.byteLength + 8)
  bin.set(new Uint8Array(pos.buffer), 0); bin.set(new Uint8Array(idx.buffer), pos.byteLength)
  const json = new TextEncoder().encode(JSON.stringify({
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' }, { bufferView: 1, componentType: 5123, count: 3, type: 'SCALAR' }],
    bufferViews: [{ byteOffset: 0, byteLength: 36 }, { byteOffset: 36, byteLength: 6 }]
  }))
  const jpad = new Uint8Array(Math.ceil(json.length / 4) * 4).fill(0x20); jpad.set(json)
  const total = 12 + 8 + jpad.length + 8 + bin.length
  const out = new Uint8Array(total), dv = new DataView(out.buffer)
  dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true)
  dv.setUint32(12, jpad.length, true); dv.setUint32(16, 0x4e4f534a, true); out.set(jpad, 20)
  const o = 20 + jpad.length
  dv.setUint32(o, bin.length, true); dv.setUint32(o + 4, 0x004e4942, true); out.set(bin, o + 8)
  return out
}

describe('đọc lưới 3D', () => {
  it('obj: mặt bốn cạnh tách thành hai tam giác, kích thước đúng', () => {
    const m = parseObj(CUBE)
    expect(m.triangles.length / 3).toBe(12)
    expect(meshBounds(m).size).toEqual([100, 200, 300])
  })
  it('obj: chỉ số âm và lỗi', () => {
    expect(parseObj('v 0 0 0\nv 1 0 0\nv 0 1 0\nf -3 -2 -1').triangles).toEqual([0, 1, 2])
    expect(() => parseObj('v 0 0 0\nf 1 2 3')).toThrow()
    expect(() => parseObj('v 0 0 0')).toThrow()
    expect(() => parseObj('v a b c\nf 1 1 1')).toThrow()
  })
  it('glb: đọc tam giác và đổi y hướng lên thành z hướng lên', () => {
    const m = parseGlb(glb())
    expect(m.triangles).toEqual([0, 1, 2])
    // đỉnh (0,1,0) của glTF thành (0, -0, 1): cao 1 theo z
    expect(m.positions.slice(6, 9).map((n) => Math.abs(n))).toEqual([0, 0, 1])
  })
  it('glb: từ chối dữ liệu hỏng', () => {
    expect(() => parseGlb(new Uint8Array(30))).toThrow()
    expect(() => parseGlb(glb().subarray(0, 60))).toThrow()
  })
  it('vẽ trục đo cho ra đa giác trong khung', () => {
    const d = meshIso(parseObj(CUBE), 300)
    expect(d.polys).toHaveLength(12)
    expect(d.width).toBeLessThanOrEqual(320)
  })
  it('fitMesh co về đúng kích thước, gốc ở 0', () => {
    const f = fitMesh(parseObj(CUBE), 1000, 500, 800)!
    expect(f.vertices.slice(0, 3)).toEqual([0, 0, 0])
    expect(Math.max(...f.vertices.filter((_, i) => i % 3 === 0))).toBe(1000)
    expect(Math.max(...f.vertices.filter((_, i) => i % 3 === 1))).toBe(500)
    expect(Math.max(...f.vertices.filter((_, i) => i % 3 === 2))).toBe(800)
    expect(fitMesh(parseObj(CUBE), 0, 1, 1)).toBeNull()
    expect(fitMesh({ positions: [0, 0, 0, 1, 0, 0, 2, 0, 0], triangles: [0, 1, 2] }, 10, 10, 10)).toBeNull()
  })
  it('rotateMeshZ xoay 90 độ đổi rộng và sâu, 360 độ giữ nguyên', () => {
    const m = parseObj(CUBE)
    expect(meshBounds(rotateMeshZ(m, 90)).size).toEqual([200, 100, 300])
    expect(meshBounds(rotateMeshZ(m, 180)).size).toEqual([100, 200, 300])
    expect(rotateMeshZ(m, 360)).toBe(m)
    expect(rotateMeshZ(m, -90).positions.slice(3, 6)).toEqual([0, -100, 0])
  })
})
