import { describe, expect, it } from 'vitest'
import { aiToolList, aiTools, runAiTool, type AiContext } from './aiTools'
import { BUILTIN_SKILLS, evalExpr, isSkill, runSkill, skillId, substitute } from './skills'
import { bounds, emptyModel, faceList, isModel3, type Model3 } from './model3d'

const ctx = (model: Model3 = emptyModel()): AiContext => ({ model, name: 'Thử' })

describe('cổng AI: lệnh dựng hình', () => {
  it('cấu kiện: tạo, chép dãy, đẩy nóc một bản thì cả dãy đổi theo', async () => {
    const a = await runAiTool(ctx(), 'add_box', { x: 300, y: 200, width: 600, depth: 400, height: 720, name: 'Tủ' })
    const c = await runAiTool(ctx(a.model), 'make_component', { ids: [a.data!['group_id']] })
    const arr = await runAiTool(ctx(c.model), 'copy_array', { ids: [c.data!['group_id']], offset: [600, 0, 0], count: 3 })
    const list = await runAiTool(ctx(arr.model), 'list_components')
    expect((list.data!['components'] as { instances: number }[])[0]!.instances).toBe(4)
    const last = (arr.data!['new_groups'] as string[])[2]!
    const top = await runAiTool(ctx(arr.model), 'find_faces', { group_id: last, direction: 'up' })
    const pp = await runAiTool(ctx(arr.model), 'push_pull', { face_id: (top.data!['faces'] as { id: string }[])[0]!.id, distance: 100 })
    const b = bounds(pp.model!)!
    expect(b.max[2]).toBe(820)
    expect(faceList(pp.model!).filter((f) => f.loop.every((v) => pp.model!.vertices[v]![2] === 820))).toHaveLength(4)
    const one = await runAiTool(ctx(pp.model), 'place_component', { component_id: c.data!['component_id'], at: [0, 1000, 0], rot_deg: 90 })
    expect(isModel3(one.model)).toBe(true)
  })

  it('danh sách lệnh có schema, tên không trùng', () => {
    const list = aiToolList()
    expect(list.length).toBeGreaterThanOrEqual(22)
    expect(new Set(list.map((t) => t.name)).size).toBe(list.length)
    for (const t of list) { expect(t.description.length).toBeGreaterThan(10); expect(t.inputSchema['type']).toBe('object') }
  })

  it('thêm hộp, tìm mặt trên, đẩy lõm, gán vật liệu, ghi kích thước, xuất', async () => {
    const a = await runAiTool(ctx(), 'add_box', { x: 500, y: 300, width: 1000, depth: 600, height: 800, name: 'Tủ', material: 'm-go-soi' })
    const g = a.data!['group_id'] as string
    expect(isModel3(a.model)).toBe(true)
    expect(faceList(a.model!).every((f) => f.material === 'm-go-soi')).toBe(true)
    const info = await runAiTool(ctx(a.model), 'model_info')
    expect((info.data!['groups'] as { name: string }[])[0]!.name).toBe('Tủ')
    const top = await runAiTool(ctx(a.model), 'find_faces', { group_id: g, direction: 'up' })
    const topId = (top.data!['faces'] as { id: string }[])[0]!.id
    const rect = await runAiTool(ctx(a.model), 'draw_rectangle', { corner1: [200, 100, 800], corner2: [800, 500, 800], host_face: topId })
    const pocket = await runAiTool(ctx(rect.model), 'push_pull', { face_id: rect.data!['face_id'], distance: -100 })
    expect(faceList(pocket.model!).length).toBe(11)
    const dim = await runAiTool(ctx(pocket.model), 'add_dimension', { a: [0, 0, 0], b: [1000, 0, 0], p: [0, -200, 0] })
    expect(Object.keys(dim.model!.dims!)).toHaveLength(1)
    const pdf = await runAiTool(ctx(dim.model), 'export', { format: 'pdf', views: ['top', 'front'] })
    expect(pdf.file!.kind).toBe('pdf')
    expect(String(pdf.file!.data)).toContain('<svg')
    const glb = await runAiTool(ctx(dim.model), 'export', { format: 'glb' })
    expect(glb.file!.data).toBeInstanceOf(Uint8Array)
  })

  it('dời, xoay, co giãn, dãy, trừ khối, xoá theo id nhóm', async () => {
    let m = (await runAiTool(ctx(), 'add_box', { x: 0, y: 0, width: 1000, depth: 1000, height: 1000 })).model!
    const r2 = await runAiTool(ctx(m), 'add_box', { x: 0, y: 0, z: -100, width: 200, depth: 200, height: 1200 })
    const [ga, gb] = Object.keys(r2.model!.groups)
    const cut = await runAiTool(ctx(r2.model), 'boolean', { op: 'subtract', a: [ga], b: [gb] })
    expect(faceList(cut.model!)).toHaveLength(10)
    m = cut.model!
    m = (await runAiTool(ctx(m), 'move', { ids: [ga], offset: [500, 0, 0] })).model!
    expect(bounds(m)!.min[0]).toBeCloseTo(0)
    m = (await runAiTool(ctx(m), 'scale', { ids: [ga], factor: [2, 1, 1] })).model!
    expect(bounds(m)!.max[0] - bounds(m)!.min[0]).toBeCloseTo(2000)
    const arr = await runAiTool(ctx(m), 'copy_array', { ids: [ga], offset: [0, 1500, 0], count: 2 })
    expect(arr.data!['new_groups']).toHaveLength(2)
    const del = await runAiTool(ctx(arr.model), 'delete', { ids: arr.data!['new_groups'] as string[] })
    expect(faceList(del.model!)).toHaveLength(10)
    await expect(runAiTool(ctx(m), 'move', { ids: ['g999'], offset: [1, 0, 0] })).rejects.toThrow(/Không có/)
    await expect(runAiTool(ctx(m), 'khong-co')).rejects.toThrow(/Không có lệnh/)
    await expect(runAiTool(ctx(), 'add_box', { x: 0, y: 0, width: -1, depth: 1, height: 1 })).rejects.toThrow()
  })

  it('gói mở rộng đăng ký thêm lệnh', async () => {
    const off = aiTools.register({ id: 'test_hello', description: 'Lệnh thử của gói mở rộng', inputSchema: { type: 'object', properties: {} }, run: () => ({ text: 'xin chào' }) })
    expect(aiToolList().some((t) => t.name === 'test_hello')).toBe(true)
    expect((await runAiTool(ctx(), 'test_hello')).text).toBe('xin chào')
    off()
    expect(aiToolList().some((t) => t.name === 'test_hello')).toBe(false)
  })
})

describe('kho skill', () => {
  it('biểu thức và thay tham số an toàn', () => {
    expect(evalExpr('x + n*w/2', { x: 10, n: 4, w: 600 })).toBe(1210)
    expect(evalExpr('-(2+3)*2', {})).toBe(-10)
    expect(() => evalExpr('process.exit()', {})).toThrow()
    expect(() => evalExpr('a', {})).toThrow(/Không có tham số/)
    expect(substitute({ a: '${w/2}', b: ['$1.group_id', 'x${n}'] }, { w: 600, n: 3 }, [{ text: '', data: { group_id: 'g5' } }])).toEqual({ a: 300, b: ['g5', 'x3'] })
    expect(skillId('Tủ bếp dưới 2m')).toBe('tu-bep-duoi-2m')
  })

  it('skill có sẵn đều hợp lệ và chạy được', async () => {
    for (const s of BUILTIN_SKILLS) {
      expect(isSkill(s)).toBe(true)
      const r = await runSkill(ctx(), s)
      expect(isModel3(r.model)).toBe(true)
      expect(faceList(r.model).length).toBeGreaterThan(0)
    }
  })

  it('tủ bếp dưới 3 khoang: đúng chiều dài và chiều cao', async () => {
    const s = BUILTIN_SKILLS.find((x) => x.id === 'tu-bep-duoi')!
    const r = await runSkill(ctx(), s, { n: 3, w: 600 })
    const b = bounds(r.model)!
    expect(b.max[0] - b.min[0]).toBeCloseTo(1800)
    expect(b.max[2]).toBeCloseTo(840)
    expect(Object.keys(r.model.groups)).toHaveLength(5)
  })

  it('bước lỗi báo rõ số bước', async () => {
    const bad = { id: 'x', name: 'X', description: '', params: [], steps: [{ tool: 'add_box', args: { x: 0, y: 0, width: 1, depth: 1, height: 1 } }, { tool: 'push_pull', args: { face_id: 'f0', distance: 1 } }] }
    await expect(runSkill(ctx(), bad)).rejects.toThrow(/Bước 2 \(push_pull\)/)
    expect(isSkill({ ...bad, id: 'Có Dấu' })).toBe(false)
  })
})
