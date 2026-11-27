/**
 * Soạn prompt cho AI tạo hình (Tripo, Meshy, Hunyuan3D, Draw Things) từ ý tưởng tiếng Việt của người dùng.
 * - Có tài khoản Socin: máy chủ nhờ mô hình ngôn ngữ soạn (PROMPT3D_SYSTEM, đọc kết quả bằng parsePrompt3dReply).
 * - Ngoại tuyến hoặc máy chủ lỗi: localPrompt3d soạn theo mẫu, dịch từ khoá nội thất sang tiếng Anh.
 * Các dịch vụ tạo 3D hiểu tiếng Anh tốt nhất, và cần mô tả một vật duy nhất, đủ hình dáng, vật liệu, tỉ lệ.
 */

export type Prompt3dTarget = 'model' | 'image'

export interface Prompt3dRequest {
  /** Ý tưởng người dùng gõ, tiếng Việt hoặc tiếng Anh */
  text: string
  /** model: ra mô hình 3D; image: ra ảnh (ảnh ý tưởng để dựng 3D, hoặc ảnh vân) */
  target: Prompt3dTarget
  /** Tên dịch vụ sẽ nhận prompt (để mô hình viết hợp cách) */
  provider?: string
  /** Có kèm ảnh tham chiếu */
  hasImage?: boolean
  /** Skill loại sản phẩm (id trong PROMPT3D_SKILLS) */
  skill?: string
}

/**
 * Skill theo loại sản phẩm nội thất / xây dựng: tên tiếng Anh, các bộ phận và vật liệu thường gặp,
 * kích thước chuẩn (mm, rộng x sâu x cao). Bấm skill là prompt được bổ sung đúng chi tiết của loại đó.
 */
export interface Prompt3dSkill {
  id: string
  label: string
  group: 'Phòng khách' | 'Phòng ngủ' | 'Phòng ăn, bếp' | 'Làm việc' | 'Xây dựng, trang trí'
  en: string
  detail: string
  size: [number, number, number]
}

export const PROMPT3D_SKILLS: Prompt3dSkill[] = [
  { id: 'sofa', label: 'Sofa', group: 'Phòng khách', en: 'sofa', size: [2100, 900, 820], detail: 'seat cushions, backrest cushions, two armrests, low legs, upholstered fabric, seat height about 430 mm' },
  { id: 'sofa-l', label: 'Sofa góc chữ L', group: 'Phòng khách', en: 'L-shaped sectional sofa', size: [2700, 1600, 820], detail: 'chaise section on one side, seat and back cushions, armrests, low legs, upholstered fabric' },
  { id: 'armchair', label: 'Ghế bành', group: 'Phòng khách', en: 'armchair', size: [780, 820, 850], detail: 'padded seat and backrest, armrests, solid wood legs, upholstered' },
  { id: 'coffee-table', label: 'Bàn trà', group: 'Phòng khách', en: 'coffee table', size: [1000, 550, 420], detail: 'flat tabletop, four legs or solid base, optional lower shelf' },
  { id: 'tv-stand', label: 'Kệ tivi', group: 'Phòng khách', en: 'low TV stand cabinet', size: [1800, 400, 500], detail: 'long low cabinet, drawers and open compartments, flush handles, wood veneer' },
  { id: 'bookshelf', label: 'Kệ sách', group: 'Phòng khách', en: 'bookshelf', size: [800, 300, 1800], detail: 'side panels 18 mm thick, five evenly spaced shelves, back panel, plinth' },
  { id: 'bed', label: 'Giường', group: 'Phòng ngủ', en: 'double bed', size: [1600, 2000, 1000], detail: 'bed frame, upholstered or wooden headboard, mattress with bedding, low legs, mattress top about 500 mm' },
  { id: 'wardrobe', label: 'Tủ quần áo', group: 'Phòng ngủ', en: 'wardrobe', size: [1800, 600, 2200], detail: 'three hinged doors, slim handles, plinth base, wood laminate panels, closed front' },
  { id: 'nightstand', label: 'Tủ đầu giường', group: 'Phòng ngủ', en: 'nightstand', size: [500, 400, 500], detail: 'two drawers, small handles, short legs, wood' },
  { id: 'dresser', label: 'Bàn trang điểm', group: 'Phòng ngủ', en: 'dressing table with mirror', size: [1000, 450, 1400], detail: 'tabletop at 750 mm, drawers, wall mirror above, slim legs' },
  { id: 'dining-table', label: 'Bàn ăn', group: 'Phòng ăn, bếp', en: 'dining table', size: [1600, 900, 750], detail: 'thick solid tabletop, four sturdy legs, seats six' },
  { id: 'dining-chair', label: 'Ghế ăn', group: 'Phòng ăn, bếp', en: 'dining chair', size: [450, 520, 850], detail: 'seat at 450 mm, backrest, four legs, wood frame, padded seat' },
  { id: 'kitchen', label: 'Tủ bếp', group: 'Phòng ăn, bếp', en: 'straight kitchen cabinet run', size: [3000, 600, 2200], detail: 'base cabinets 850 mm high with countertop, wall cabinets above 350 mm deep, cabinet doors with handles, sink and cooktop cutouts' },
  { id: 'bar-stool', label: 'Ghế quầy bar', group: 'Phòng ăn, bếp', en: 'bar stool', size: [420, 420, 1000], detail: 'seat at 750 mm, footrest ring, slim metal legs' },
  { id: 'desk', label: 'Bàn làm việc', group: 'Làm việc', en: 'office desk', size: [1200, 600, 750], detail: 'rectangular desktop, side drawer unit, cable cutout, slim legs' },
  { id: 'office-chair', label: 'Ghế văn phòng', group: 'Làm việc', en: 'ergonomic office chair', size: [650, 650, 1100], detail: 'mesh backrest, padded seat, armrests, gas lift, five-star base with casters' },
  { id: 'door', label: 'Cửa đi', group: 'Xây dựng, trang trí', en: 'interior door with frame', size: [900, 50, 2100], detail: 'flat door leaf 40 mm thick, door frame and casing, lever handle, hinges' },
  { id: 'window', label: 'Cửa sổ', group: 'Xây dựng, trang trí', en: 'casement window with frame', size: [1200, 100, 1400], detail: 'aluminium or wood frame, two glass panes, sill' },
  { id: 'stairs', label: 'Cầu thang', group: 'Xây dựng, trang trí', en: 'straight interior staircase', size: [900, 3500, 3000], detail: 'treads 270 mm deep, risers 170 mm high, stringers, handrail with balusters' },
  { id: 'lamp', label: 'Đèn', group: 'Xây dựng, trang trí', en: 'floor lamp', size: [400, 400, 1600], detail: 'round base, slim stand, fabric lampshade' },
  { id: 'partition', label: 'Vách ngăn', group: 'Xây dựng, trang trí', en: 'decorative room divider partition', size: [1800, 40, 2400], detail: 'vertical wooden slats, top and bottom frame, floor to ceiling' }
]

export const skillById = (id?: string): Prompt3dSkill | undefined => (id ? PROMPT3D_SKILLS.find((k) => k.id === id) : undefined)

/** Câu bổ sung của skill (dùng cả cho mẫu cục bộ và gửi kèm cho mô hình ngôn ngữ). */
export function skillBrief(k: Prompt3dSkill): string {
  return `${k.en}: ${k.detail}; standard size ${k.size[0]} x ${k.size[1]} x ${k.size[2]} mm (width x depth x height)`
}

export interface Prompt3dResult {
  prompt: string
  /** Gợi ý ngắn cho người dùng (tiếng Việt) */
  notes: string[]
  source: 'llm' | 'local'
}

export const PROMPT3D_MAX = 900

export const PROMPT3D_SYSTEM = `Bạn là trợ lý soạn prompt cho AI tạo mô hình 3D và ảnh sản phẩm, CHỈ trong ngành nội thất và xây dựng
(đồ nội thất, tủ bếp, cửa, cửa sổ, cầu thang, vách ngăn, đèn, vật liệu hoàn thiện). Mọi ý tưởng đều hiểu theo nghĩa nội thất;
từ đa nghĩa thì chọn nghĩa đồ nội thất (ví dụ "ghế" là chair, "tủ" là cabinet). Nếu người dùng chọn loại sản phẩm (skill),
prompt phải là đúng loại đó, dùng các bộ phận và kích thước chuẩn của skill khi người dùng không nói kích thước.
Người dùng gõ ý tưởng (thường bằng tiếng Việt, có thể kèm ảnh tham chiếu). Hãy viết một prompt tiếng Anh, rõ và đủ chi tiết để AI dựng đúng:
- Một vật duy nhất, nêu loại đồ, hình dáng tổng thể, các bộ phận chính, tỉ lệ và kích thước nếu người dùng có nói (đổi sang mm hoặc cm).
- Vật liệu, màu sắc, bề mặt (gỗ, vải, da, kim loại...), phong cách.
- Với target "model": thêm yêu cầu toàn bộ vật, cân đối, không nền, không chữ, không người, phù hợp xuất GLB.
- Với target "image": ảnh sản phẩm nền trắng trơn, góc chéo ba phần tư, ánh sáng studio đều, thấy trọn vật (ảnh này sẽ dùng để dựng 3D); nếu người dùng muốn ảnh vân vật liệu thì viết ảnh vân phẳng, chụp thẳng, lặp liền.
- Có ảnh tham chiếu: mô tả đúng vật trong ảnh, giữ hình dáng, chỉ đổi những gì người dùng yêu cầu.
- Không bịa thêm chi tiết người dùng không nói nếu có thể làm sai ý; prompt dưới 120 từ.
Trả về đúng một đối tượng JSON, không giải thích: {"prompt":"...","notes":["gợi ý tiếng Việt ngắn", "..."]}
notes tối đa 3 ý, tiếng Việt, nhắc điều người dùng nên bổ sung (ví dụ kích thước, vật liệu) hoặc cách chụp ảnh tốt hơn.`

/** Đọc câu trả lời của mô hình; null nếu không đúng dạng. */
export function parsePrompt3dReply(raw: string): { prompt: string; notes: string[] } | null {
  const json = /\{[\s\S]*\}/.exec(raw)?.[0]
  if (!json) return null
  try {
    const o = JSON.parse(json) as Record<string, unknown>
    const prompt = typeof o['prompt'] === 'string' ? o['prompt'].replace(/\s+/g, ' ').trim().slice(0, PROMPT3D_MAX) : ''
    if (prompt.length < 3) return null
    const notes = Array.isArray(o['notes']) ? o['notes'].filter((n): n is string => typeof n === 'string' && n.trim().length > 0).map((n) => n.trim().slice(0, 200)).slice(0, 3) : []
    return { prompt, notes }
  } catch {
    return null
  }
}

/** Từ khoá nội thất tiếng Việt → tiếng Anh. Cụm dài đứng trước để khớp trước; khớp trọn từ. */
const TERM_LIST: [string, string][] = [
  ['sofa góc|sô ?fa góc|sofa chữ l', 'L-shaped sectional sofa'], ['ghế sofa|sofa|sô ?fa', 'sofa'],
  ['ghế bành', 'armchair'], ['ghế thư giãn', 'lounge chair'], ['ghế ăn', 'dining chair'], ['ghế đẩu', 'stool'], ['ghế', 'chair'],
  ['bàn trà|bàn nước', 'coffee table'], ['bàn ăn', 'dining table'], ['bàn làm việc', 'desk'], ['bàn trang điểm', 'dressing table'], ['bàn', 'table'],
  ['tủ quần áo', 'wardrobe'], ['tủ giày', 'shoe cabinet'], ['tủ bếp', 'kitchen cabinet'], ['tủ đầu giường|tab đầu giường', 'nightstand'], ['kệ tivi|kệ ti vi|tủ tivi', 'TV stand'], ['tủ', 'cabinet'],
  ['kệ sách', 'bookshelf'], ['kệ', 'shelf'], ['giường', 'bed'], ['đèn', 'lamp'], ['gương', 'mirror'], ['thảm', 'rug'], ['gối', 'cushion'],
  ['chân', 'legs'], ['tay vịn', 'armrests'], ['lưng tựa', 'backrest'], ['ngăn kéo|hộc kéo|hộc tủ|hộc', 'drawers'], ['cánh', 'doors'], ['đệm', 'cushions'], ['mặt', 'top'],
  ['óc chó', 'walnut'], ['gỗ sồi', 'oak wood'], ['gỗ tần bì', 'ash wood'], ['gỗ thông', 'pine wood'], ['gỗ công nghiệp|mdf', 'MDF'], ['gỗ', 'wood'],
  ['bọc nỉ|vải nỉ|nỉ', 'felt upholstery'], ['bọc vải|vải', 'fabric upholstery'], ['da thật|bọc da|da', 'leather'], ['nhung', 'velvet'], ['mây|tre', 'rattan'],
  ['kính', 'glass'], ['đá cẩm thạch|đá marble', 'marble'], ['đá', 'stone'], ['inox|thép', 'steel'], ['sắt', 'iron'], ['kim loại', 'metal'],
  ['chữ nhật', 'rectangular'], ['bo tròn|bo góc', 'rounded corners'], ['tròn', 'round'], ['vuông', 'square'],
  ['bắc âu', 'Scandinavian style'], ['hiện đại', 'modern style'], ['tối giản', 'minimalist'], ['cổ điển', 'classic style'], ['công nghiệp', 'industrial style'], ['đông dương', 'Indochine style'], ['nhật bản|nhật', 'Japanese style'],
  ['xanh lá', 'green'], ['xanh dương|xanh navy|xanh', 'blue'], ['xám', 'grey'], ['trắng', 'white'], ['đen', 'black'], ['be|kem', 'beige'], ['nâu', 'brown'], ['đỏ', 'red'], ['vàng', 'yellow'], ['hồng', 'pink'],
  ['chỗ ngồi|chỗ', 'seats'], ['và', 'and'], ['với|có', 'with'], ['màu|kiểu|phong cách|cái|chiếc|một|ngủ|dài|sâu|cao|rộng|ngang|kích thước|khoảng', '']
]
const TERMS: [RegExp, string][] = TERM_LIST.map(([src, en]) => [new RegExp(`(?<![\\p{L}])(?:${src})(?![\\p{L}])`, 'gu'), en])

/** Kích thước kiểu "2m2", "220cm", "2200 mm", "1m8 x 60cm" → mm. */
function sizesMm(text: string): number[] {
  const out: number[] = []
  const re = /(\d+(?:[.,]\d+)?)\s*(mm|cm|m)(\d{1,2})?(?![a-zà-ỹ])/gi
  for (const m of text.matchAll(re)) {
    const v = Number(m[1]!.replace(',', '.'))
    const unit = m[2]!.toLowerCase()
    let mm = unit === 'mm' ? v : unit === 'cm' ? v * 10 : v * 1000
    if (unit === 'm' && m[3]) mm += Number(m[3].padEnd(2, '0').slice(0, 2)) * 10
    if (mm >= 50 && mm <= 20000) out.push(Math.round(mm))
  }
  return out.slice(0, 3)
}

function translate(text: string): string {
  let s = ` ${text.toLowerCase()} `
  for (const [re, en] of TERMS) s = s.replace(re, ` ${en} `)
  return s.replace(/\d+(?:[.,]\d+)?\s*(mm|cm|m)(\d{1,2})?(?![a-zà-ỹ])/gi, ' ').replace(/[,;]/g, ',').replace(/\s+/g, ' ').replace(/\s*,(\s*,)*/g, ', ').replace(/^[\s,]+|[\s,]+$/g, '')
}

const hasVietnamese = (s: string) => /[à-ỹđ]/i.test(s)

/** Soạn prompt theo mẫu, không cần mạng. */
export function localPrompt3d(req: Prompt3dRequest): Prompt3dResult {
  const text = req.text.trim().slice(0, 600)
  const notes: string[] = []
  const skill = skillById(req.skill)
  const extra = text ? translate(text) : ''
  const subject = skill
    ? `${skill.en}${extra ? `, ${extra}` : ''}, ${skill.detail}`
    : extra || (req.hasImage ? 'the object in the reference image' : 'piece of interior furniture')
  const dims = sizesMm(text)
  const dimText = dims.length
    ? `, overall size about ${dims.map((d) => `${d} mm`).join(' x ')}`
    : skill ? `, standard size ${skill.size.join(' x ')} mm (width x depth x height)` : ''
  const texture = /\bvân\b|texture|pattern/i.test(text)
  let prompt: string
  if (req.target === 'image') {
    prompt = texture
      ? `Seamless tileable texture of ${subject.replace(/\bvân\b/g, '').trim()}, flat top-down view, even lighting, no shadows, high detail`
      : `Interior product photo of a single ${subject}${dimText}, full object visible, three-quarter front view, plain white background, soft even studio lighting, sharp details, realistic materials, no text, no people`
  } else {
    prompt = `Interior furniture 3D model: a single ${subject}${dimText}, complete object, real-world scale and proportions, clean geometry, detailed realistic materials, centered, no background, no text, no people`
  }
  if (req.hasImage && req.target === 'model') prompt = `Match the shape of the reference image. ${prompt}`
  if (!dims.length && !texture) notes.push(skill ? `Đang dùng kích thước chuẩn ${skill.label.toLowerCase()} ${skill.size.join(' x ')} mm; gõ kích thước riêng nếu khác.` : 'Thêm kích thước (ví dụ 2m2 x 90cm) hoặc chọn loại sản phẩm để AI dựng đúng tỉ lệ.')
  if (hasVietnamese(prompt)) notes.push('Còn từ chưa dịch được sang tiếng Anh, hãy sửa lại trong ô prompt.')
  if (req.target === 'model' && !req.hasImage) notes.push('Có ảnh sản phẩm nền trơn sẽ cho kết quả sát hơn mô tả chữ.')
  return { prompt: prompt.replace(/\s+/g, ' ').slice(0, PROMPT3D_MAX), notes: notes.slice(0, 3), source: 'local' }
}
