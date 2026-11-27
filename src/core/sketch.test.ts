import { describe, expect, it } from 'vitest'
import { entryToSample, indexKey, sanitizeIndexEntry, toIndexEntry } from './indexing'
import { importFile, imagePixelSize, parseDxf, parseSvg } from './importers'
import { applyLabel, evaluateSuggest, labelQueue } from './labels'
import {
  constrainAngle,
  insertNodeAfter,
  makeShape,
  mirrorShapeX,
  moveNode,
  outlineBounds,
  removeNode,
  shapeToSvgPath,
  sketchSize,
  sketchToSvg,
  snapPoint,
  updateShape
} from './shapes'
import {
  buildSofa,
  clampParams,
  newSofaSketch,
  paramsFromSample,
  rebuildSofa,
  SOFA_DEFAULTS,
  sketchToSample,
  syncParamsFromOutline
} from './sofa'
import { countSimilar, parseBudgetVnd, parseRequirement, parseWidthMm, rankSamples, recordPick } from './suggest'
import type { Sample } from './types'

const enc = (s: string): Uint8Array => new TextEncoder().encode(s)

describe('sửa nút', () => {
  const tri = makeShape({
    kind: 'path',
    closed: true,
    nodes: [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 }
    ]
  })

  it('kéo nút đổi đúng một nút', () => {
    const s = moveNode(tri, 2, { x: 80, y: 120 })
    expect(s.nodes[2]).toEqual({ x: 80, y: 120 })
    expect(s.nodes[0]).toEqual({ x: 0, y: 0 })
  })

  it('thêm nút ở giữa cạnh, kể cả cạnh đóng kín', () => {
    expect(insertNodeAfter(tri, 0).nodes[1]).toEqual({ x: 50, y: 0 })
    const closing = insertNodeAfter(tri, 2)
    expect(closing.nodes).toHaveLength(4)
    expect(closing.nodes[3]).toEqual({ x: 50, y: 50 })
  })

  it('đường mở không thêm nút sau điểm cuối', () => {
    const open = makeShape({ kind: 'path', nodes: [{ x: 0, y: 0 }, { x: 10, y: 0 }] })
    expect(insertNodeAfter(open, 1)).toBe(open)
  })

  it('không xoá quá số nút tối thiểu', () => {
    expect(removeNode(tri, 0)).toBe(tri)
    const quad = insertNodeAfter(tri, 0)
    expect(removeNode(quad, 1).nodes).toHaveLength(3)
  })

  it('snap bám nút khác trước, lưới sau', () => {
    const r = snapPoint({ x: 403, y: 598 }, 50, [{ x: 400, y: 900 }], 10)
    expect(r.p.x).toBe(400)
    expect(r.p.y).toBe(600)
    expect(r.hit).toEqual({ x: 400 })
  })

  it('giữ góc 45 độ', () => {
    const p = constrainAngle({ x: 0, y: 0 }, { x: 100, y: 12 })
    expect(p.y).toBeCloseTo(0, 1)
    const q = constrainAngle({ x: 0, y: 0 }, { x: 100, y: 90 })
    expect(Math.abs(q.x - q.y)).toBeLessThan(0.2)
  })

  it('lật đối xứng giữ thứ tự hợp lệ', () => {
    const m = mirrorShapeX(tri, 50)
    expect(m.nodes.map((n) => n.x).sort((a, b) => a - b)).toEqual([0, 0, 100])
  })

  it('hình khoá không bị xoá bằng removeShape ở mức tài liệu', () => {
    const doc = newSofaSketch('straight')
    const outline = doc.shapes.find((s) => s.role === 'outline')!
    const locked = updateShape(doc, outline.id, (s) => ({ ...s, locked: true }))
    expect(locked.shapes.find((s) => s.id === outline.id)?.locked).toBe(true)
  })

  it('đường cong mượt tạo lệnh C trong SVG', () => {
    const s = { ...tri, smooth: true }
    expect(shapeToSvgPath(s)).toContain('C')
    expect(shapeToSvgPath(tri)).not.toContain('C')
  })
})

describe('sofa tham số', () => {
  it('ba kiểu đều có khung ngoài, kích thước đúng thông số', () => {
    for (const kind of ['straight', 'L', 'round'] as const) {
      const doc = newSofaSketch(kind)
      const size = sketchSize(doc)
      const p = SOFA_DEFAULTS[kind]
      expect(size.w).toBe(p.width)
      expect(size.d).toBe(kind === 'L' ? p.chaise : p.depth)
      expect(doc.shapes.filter((s) => s.role === 'outline')).toHaveLength(1)
    }
  })

  it('kiểu L có 6 nút và vùng chaise dài hơn chiều sâu', () => {
    const outline = buildSofa(SOFA_DEFAULTS.L).find((s) => s.role === 'outline')!
    expect(outline.nodes).toHaveLength(6)
  })

  it('giới hạn thông số vô lý', () => {
    const p = clampParams({ ...SOFA_DEFAULTS.L, width: 99999, depth: 10, chaise: 100, seats: 0 })
    expect(p.width).toBe(5000)
    expect(p.depth).toBe(600)
    expect(p.chaise).toBeGreaterThanOrEqual(900)
    expect(p.seats).toBe(1)
  })

  it('số ghế quyết định số đường chia đệm', () => {
    const lines = (n: number): number => buildSofa({ ...SOFA_DEFAULTS.straight, seats: n }).filter((s) => s.name === 'Đệm').length
    expect(lines(3)).toBe(2)
    expect(lines(4)).toBe(3)
  })

  it('đổi thông số dựng lại khung nhưng giữ hình tự vẽ', () => {
    let doc = newSofaSketch('straight')
    doc = { ...doc, shapes: [...doc.shapes, makeShape({ kind: 'path', name: 'Gối', nodes: [{ x: 1, y: 1 }, { x: 2, y: 2 }] })] }
    const next = rebuildSofa(doc, { ...SOFA_DEFAULTS.straight, width: 2600 })
    expect(sketchSize(next).w).toBe(2600)
    expect(next.shapes.some((s) => s.name === 'Gối')).toBe(true)
    expect(next.manualEdits).toBe(false)
  })

  it('kéo nút cập nhật rộng và sâu theo khung', () => {
    let doc = newSofaSketch('straight')
    const outline = doc.shapes.find((s) => s.role === 'outline')!
    doc = updateShape(doc, outline.id, (s) => moveNode(moveNode(s, 1, { x: 2500, y: 0 }), 2, { x: 2500, y: 1000 }), true)
    doc = syncParamsFromOutline(doc)
    expect(doc.manualEdits).toBe(true)
    expect(doc.params['width']).toBe(2500)
    expect(doc.params['depth']).toBe(1000)
  })

  it('điểm bắt đầu từ mẫu có sẵn: đoán kiểu theo tên', () => {
    const sample: Sample = { id: 'a', name: 'Sofa góc L SF-108', category: 'Sofa', w: 2800, d: 950, h: 820 }
    const p = paramsFromSample(sample)
    expect(p.kind).toBe('L')
    expect(p.width).toBe(2800)
    expect(p.depth).toBe(950)
  })

  it('lưu thành mẫu kho kèm bản phác thảo để mở lại', () => {
    const doc = newSofaSketch('L')
    const sample = sketchToSample(doc, 'sk-1')
    expect(sample.origin).toBe('sketch')
    expect(sample.w).toBe(2700)
    expect(sample.sketch).toBe(doc)
    expect(sample.tags).toContain('chữ L')
  })

  it('xuất khung nét SVG không chứa đường kích thước', () => {
    const svg = sketchToSvg(newSofaSketch('straight'))
    expect(svg.startsWith('<svg')).toBe(true)
    expect(outlineBounds(newSofaSketch('straight'))).not.toBeNull()
    expect(svg).toContain('<path')
  })
})

describe('nhập mẫu', () => {
  it('đọc DXF có đơn vị mm', () => {
    const dxf = ['0', 'SECTION', '2', 'HEADER', '9', '$INSUNITS', '70', '4', '0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES', '0', 'LINE', '10', '0', '20', '0', '11', '800', '21', '0', '0', 'LINE', '10', '800', '20', '0', '11', '800', '21', '400', '0', 'ENDSEC', '0', 'EOF'].join('\n')
    const box = parseDxf(dxf)!
    expect(Math.round(box.w)).toBe(800)
    expect(Math.round(box.d)).toBe(400)
    expect(box.unitKnown).toBe(true)
  })

  it('DXF đơn vị mét được đổi sang mm', () => {
    const dxf = ['9', '$INSUNITS', '70', '6', '0', 'LINE', '10', '0', '20', '0', '11', '2', '21', '1'].join('\n')
    const box = parseDxf(dxf)!
    expect(Math.round(box.w)).toBe(2000)
  })

  it('DXF có hình tròn tính theo bán kính', () => {
    const dxf = ['0', 'CIRCLE', '10', '0', '20', '0', '40', '400', '0', 'EOF'].join('\n')
    const box = parseDxf(dxf)!
    expect(box.w).toBe(800)
  })

  it('SVG có đơn vị mm đọc được, không đơn vị thì cảnh báo', () => {
    expect(parseSvg('<svg width="750mm" height="780mm"></svg>')).toMatchObject({ w: 750, d: 780, explicitUnit: true })
    expect(parseSvg('<svg viewBox="0 0 300 200"></svg>')).toMatchObject({ w: 300, d: 200, explicitUnit: false })
    expect(parseSvg('<div></div>')).toBeNull()
  })

  it('đọc kích thước điểm ảnh PNG', () => {
    const png = new Uint8Array(32)
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    new DataView(png.buffer).setUint32(16, 640)
    new DataView(png.buffer).setUint32(20, 480)
    expect(imagePixelSize(png)).toEqual({ width: 640, height: 480 })
  })

  it('file .skp và ảnh luôn cần nhập kích thước', () => {
    const skp = importFile('/mau/sofa_goc_L_SF-131.skp', enc('x'))
    expect('error' in skp).toBe(false)
    if ('sample' in skp) {
      expect(skp.needsDimensions).toBe(true)
      expect(skp.sample.skpPath).toBe('/mau/sofa_goc_L_SF-131.skp')
      expect(skp.sample.category).toBe('Sofa')
      expect(skp.sample.needsReview).toBe(true)
    }
  })

  it('DXF và SVG đọc kích thước tự động nhưng vẫn cần duyệt', () => {
    const r = importFile('ghe_don.svg', enc('<svg width="750mm" height="780mm"/>'))
    expect('sample' in r && r.needsDimensions).toBe(false)
    if ('sample' in r) {
      expect(r.sample.w).toBe(750)
      expect(r.sample.needsReview).toBe(true)
      expect(r.sample.category).toBe('Ghế')
    }
  })

  it('từ chối định dạng lạ', () => {
    expect(importFile('a.exe', enc('x'))).toEqual({ error: 'Không hỗ trợ định dạng .exe' })
  })

  it('nhập lại tệp phác thảo giữ nguyên bản vẽ', () => {
    const doc = newSofaSketch('round')
    const r = importFile('sofa.sdsketch', enc(JSON.stringify(doc)))
    expect('sample' in r && r.sample.sketch?.kind).toBe('round')
  })

  it('tệp phác thảo hỏng báo lỗi, không ném ngoại lệ', () => {
    expect(importFile('x.sdsketch', enc('{không phải json'))).toEqual({ error: 'Tệp phác thảo (.sdsketch) không hợp lệ' })
  })
})

describe('hiểu yêu cầu và gợi ý', () => {
  const samples: Sample[] = [
    { id: 'l', name: 'Sofa góc L', category: 'Sofa', w: 2700, d: 900, h: 800, listPrice: 14_000_000, tags: ['chữ L'], styles: ['hiện đại'], materials: ['vải'] },
    { id: 'r', name: 'Sofa bo tròn', category: 'Sofa', w: 2400, d: 950, h: 780, listPrice: 15_200_000, tags: ['bo tròn'] },
    { id: 'tv', name: 'Kệ tivi treo tường', category: 'Kệ tivi', w: 1800, d: 350, h: 400, listPrice: 6_000_000 },
    { id: 'c', name: 'Bàn trà tròn', category: 'Bàn trà', w: 800, d: 800, h: 400, tags: ['bo tròn'] },
    { id: 'scan', name: 'sofa scan', category: 'Sofa', w: 1000, d: 600, h: 800, needsReview: true }
  ]

  it('tách loại, kích thước và ngân sách', () => {
    const req = parseRequirement('Khách cần sofa góc L rộng 2m7, phong cách hiện đại, ngân sách 15 triệu, bọc vải')
    expect(req.categories).toEqual(['Sofa'])
    expect(req.shapes).toContain('chữ L')
    expect(req.styles).toEqual(['hiện đại'])
    expect(req.materials).toContain('vải')
    expect(req.widthMm).toBe(2700)
    expect(req.budgetVnd).toBe(15_000_000)
  })

  it('phân biệt da và đá dù bỏ dấu giống nhau', () => {
    expect(parseRequirement('sofa bọc da').materials).toEqual(['da'])
    expect(parseRequirement('bàn trà mặt đá').materials).toEqual(['đá'])
  })

  it('đọc chiều dài ở nhiều cách viết', () => {
    expect(parseWidthMm('rong 2m4')).toBe(2400)
    expect(parseWidthMm('rong 2,4m')).toBe(2400)
    expect(parseWidthMm('rong 2400mm')).toBe(2400)
    expect(parseWidthMm('phong 20m2')).toBeUndefined()
    expect(parseBudgetVnd('15,5 trieu')).toBe(15_500_000)
  })

  it('gợi ý đúng loại và đúng dáng lên đầu, mẫu chưa duyệt xuống thấp', () => {
    const top = rankSamples(samples, parseRequirement('sofa chữ L 2m7'))
    expect(top[0]?.sample.id).toBe('l')
    expect(top[0]?.reasons.join(' ')).toContain('Đúng loại Sofa')
    expect(top.findIndex((r) => r.sample.id === 'scan')).toBeGreaterThan(top.findIndex((r) => r.sample.id === 'r'))
  })

  it('vượt ngân sách bị trừ điểm và nêu lý do', () => {
    const top = rankSamples(samples, parseRequirement('sofa 14 triệu'))
    const round = top.find((r) => r.sample.id === 'r')!
    expect(round.reasons).toContain('Vượt ngân sách')
    expect(top[0]?.sample.id).toBe('l')
  })

  it('thống kê lượt chọn đẩy mẫu được chọn nhiều lên', () => {
    const req = parseRequirement('sofa')
    // Hai mẫu sofa ngang điểm: lượt chọn là thứ phân biệt.
    const plain = rankSamples(samples, req).find((r) => r.sample.id === 'l')!
    let stats = {}
    for (let i = 0; i < 20; i++) stats = recordPick(stats, 'l')
    const boosted = rankSamples(samples, req, stats)
    expect(boosted[0]?.sample.id).toBe('l')
    expect(boosted[0]!.score).toBeGreaterThan(plain.score)
    expect(boosted[0]?.reasons.join(' ')).toContain('Được chọn 20 lần')
  })

  it('"Ghế" khớp "Ghế thư giãn" nhưng "Bàn trà" không khớp "Bàn ăn"', () => {
    const chairs: Sample[] = [
      { id: 'g', name: 'g', category: 'Ghế thư giãn', w: 700, d: 700, h: 800 },
      { id: 'b', name: 'b', category: 'Bàn ăn', w: 1600, d: 800, h: 750 }
    ]
    expect(rankSamples(chairs, parseRequirement('ghế')).map((r) => r.sample.id)).toEqual(['g'])
    expect(rankSamples(chairs, parseRequirement('bàn trà'))).toEqual([])
  })

  it('đếm mẫu giống để nhắc người dùng', () => {
    expect(countSimilar(samples, parseRequirement('sofa'))).toBe(2)
    expect(countSimilar(samples, parseRequirement('giường'))).toBe(0)
  })
})

describe('gắn nhãn và đo chất lượng', () => {
  const a: Sample = { id: 'a', name: 'ghe a', category: 'Chưa phân loại', w: 1000, d: 600, h: 800, needsReview: true }
  const b: Sample = { id: 'b', name: 'ban b', category: 'Bàn trà', w: 800, d: 800, h: 400 }

  it('áp nhãn bỏ trạng thái cần duyệt và khử trùng lặp', () => {
    const next = applyLabel(a, { category: 'Ghế thư giãn', tags: ['tay vịn', 'Tay vịn', ' '], w: 750, d: 780 })
    expect(next.labeled).toBe(true)
    expect(next.needsReview).toBe(false)
    expect(next.tags).toEqual(['tay vịn'])
    expect(next.w).toBe(750)
  })

  it('hàng chờ ưu tiên mẫu cần duyệt', () => {
    expect(labelQueue([b, a]).map((s) => s.id)).toEqual(['a', 'b'])
    expect(labelQueue([applyLabel(a, {}), b]).map((s) => s.id)).toEqual(['b'])
  })

  it('đo tỉ lệ top-1 và top-3', () => {
    const labeled = [applyLabel(a, { category: 'Ghế thư giãn' }), applyLabel(b, {})]
    const report = evaluateSuggest(labeled, [
      { text: 'bàn trà', expected: ['b'] },
      { text: 'ghế thư giãn', expected: ['a'] },
      { text: 'giường', expected: ['a'] }
    ])
    expect(report.total).toBe(3)
    expect(report.top1).toBe(2)
    expect(report.top3Rate).toBeCloseTo(2 / 3)
    expect(report.misses[0]?.text).toBe('giường')
  })
})

describe('ranh giới quyền riêng tư của chỉ mục', () => {
  const secret: Sample = {
    id: 'id-khach-A',
    name: 'Sofa nhà chị Lan',
    category: 'Sofa',
    w: 2700,
    d: 900,
    h: 800,
    skpPath: 'C:\\Khach\\ChiLan\\sofa.skp',
    imagePath: 'C:\\Khach\\anh.png',
    listPrice: 14_000_000,
    tags: ['chữ L']
  }

  it('bản ghi gửi đi không chứa tên, đường dẫn hay giá', () => {
    const json = JSON.stringify(toIndexEntry(secret, 'muối-doanh-nghiệp'))
    for (const leak of ['ChiLan', 'Khach', 'sofa.skp', 'anh.png', '14000000', 'Sofa nhà chị Lan', 'id-khach-A']) {
      expect(json).not.toContain(leak)
    }
  })

  it('cùng mẫu ở hai doanh nghiệp cho khoá khác nhau', () => {
    expect(indexKey('x', 'A')).not.toBe(indexKey('x', 'B'))
    expect(indexKey('x', 'A')).toBe(indexKey('x', 'A'))
  })

  it('máy chủ từ chối trường lạ như giá hoặc đường dẫn', () => {
    const entry = toIndexEntry(secret, 's')
    expect(sanitizeIndexEntry(entry).ok).toBe(true)
    expect(sanitizeIndexEntry({ ...entry, skpPath: 'C:\\x.skp' })).toMatchObject({ ok: false })
    expect(sanitizeIndexEntry({ ...entry, listPrice: 1 })).toMatchObject({ ok: false })
    expect(sanitizeIndexEntry({ ...entry, w: -5 })).toMatchObject({ ok: false })
    expect(sanitizeIndexEntry({ ...entry, tags: Array(50).fill('x') })).toMatchObject({ ok: false })
    expect(sanitizeIndexEntry(null)).toMatchObject({ ok: false })
  })

  it('chỉ mục của phác thảo mang thông số số học', () => {
    const e = toIndexEntry(sketchToSample(newSofaSketch('L'), 'sk'), 's')
    expect(e.kind).toBe('L')
    expect(e.params?.['width']).toBe(2700)
    const s = sanitizeIndexEntry(e)
    expect(s.ok).toBe(true)
    if (s.ok) expect(entryToSample(s.entry).category).toBe('Sofa')
  })
})
