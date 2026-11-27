import { describe, expect, it } from 'vitest'
import { localPrompt3d, parsePrompt3dReply, PROMPT3D_SKILLS } from './prompt3d'

describe('soạn prompt tạo hình', () => {
  it('dịch ý tưởng tiếng Việt và đổi kích thước sang mm', () => {
    const r = localPrompt3d({ text: 'Ghế sofa 3 chỗ bọc nỉ xám, chân gỗ sồi, dài 2m2 sâu 90cm, phong cách Bắc Âu', target: 'model' })
    expect(r.source).toBe('local')
    expect(r.prompt).toMatch(/^Interior furniture 3D model: a single sofa 3 seats felt upholstery grey, legs oak wood, Scandinavian style, overall size about 2200 mm x 900 mm/)
    expect(r.prompt).toContain('2200 mm x 900 mm')
    expect(r.prompt).toContain('Scandinavian style')
    expect(r.prompt).toContain('no background')
    expect(r.prompt).not.toMatch(/[à-ỹđ]/i)
    expect(r.notes.join(' ')).not.toContain('kích thước')
  })

  it('ảnh sản phẩm nền trắng, ảnh vân, có ảnh tham chiếu', () => {
    expect(localPrompt3d({ text: 'bàn trà tròn mặt đá cẩm thạch', target: 'image' }).prompt).toMatch(/^Interior product photo of a single coffee table round top marble, .*plain white background/)
    expect(localPrompt3d({ text: 'vân gỗ óc chó', target: 'image' }).prompt).toMatch(/^Seamless tileable texture of wood walnut/)
    const ref = localPrompt3d({ text: '', target: 'model', hasImage: true })
    expect(ref.prompt).toMatch(/^Match the shape of the reference image\. Interior furniture 3D model: a single the object in the reference image/)
    expect(ref.notes.some((n) => n.includes('kích thước'))).toBe(true)
  })

  it('skill bổ sung bộ phận và kích thước chuẩn theo loại sản phẩm', () => {
    const r = localPrompt3d({ text: 'gỗ óc chó', target: 'model', skill: 'dining-table' })
    expect(r.prompt).toContain('dining table, wood walnut, thick solid tabletop, four sturdy legs')
    expect(r.prompt).toContain('standard size 1600 x 900 x 750 mm')
    expect(r.notes[0]).toContain('kích thước chuẩn bàn ăn')
    const own = localPrompt3d({ text: 'dài 2m4', target: 'model', skill: 'dining-table' })
    expect(own.prompt).toContain('about 2400 mm')
    expect(own.prompt).not.toContain('standard size')
    expect(new Set(PROMPT3D_SKILLS.map((k) => k.id)).size).toBe(PROMPT3D_SKILLS.length)
    for (const k of PROMPT3D_SKILLS) expect(localPrompt3d({ text: '', target: 'image', skill: k.id }).prompt, k.id).not.toMatch(/[à-ỹđ]/i)
  })

  it('báo khi còn chữ chưa dịch', () => {
    const r = localPrompt3d({ text: 'giường gỗ khung lùn', target: 'model' })
    expect(r.notes.some((n) => n.includes('chưa dịch'))).toBe(true)
  })

  it('đọc câu trả lời của mô hình', () => {
    expect(parsePrompt3dReply('Đây: {"prompt":"A walnut coffee table,  round top","notes":["Thêm kích thước",3]}')).toEqual({ prompt: 'A walnut coffee table, round top', notes: ['Thêm kích thước'] })
    expect(parsePrompt3dReply('không có json')).toBeNull()
    expect(parsePrompt3dReply('{"prompt":""}')).toBeNull()
    expect(parsePrompt3dReply('{"prompt": "x".repeat}')).toBeNull()
  })
})
