/**
 * Kho skill: quy trình mẫu có tham số, gồm các bước gọi lệnh AI (aiTools).
 * Tham số viết trong chuỗi dạng "${ten}" hoặc biểu thức "${w/2 - 18}". Kết quả bước trước
 * dùng lại bằng "$1.group_id" (bước 1), "$prev.face_id" (bước ngay trước).
 * AI lưu skill mới qua lệnh save_skill; người dùng chạy lại từ bảng Skill trong app.
 */
import { runAiTool, type AiContext, type AiResult } from './aiTools'
import type { Model3 } from './model3d'

export interface SkillParam {
  name: string
  label?: string
  default: number | string
}

export interface SkillStep {
  tool: string
  args: Record<string, unknown>
}

export interface Skill {
  id: string
  name: string
  description: string
  params: SkillParam[]
  steps: SkillStep[]
  /** Skill có sẵn trong app (không xoá được) */
  builtin?: boolean
}

const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/

export function isSkill(x: unknown): x is Skill {
  if (!x || typeof x !== 'object') return false
  const s = x as Skill
  return typeof s.id === 'string' && /^[a-z0-9-]{1,64}$/.test(s.id) && typeof s.name === 'string' && s.name.length > 0 && s.name.length <= 80 &&
    typeof s.description === 'string' && s.description.length <= 2000 &&
    Array.isArray(s.params) && s.params.length <= 20 && s.params.every((p) => p && NAME.test(p.name) && (typeof p.default === 'number' || typeof p.default === 'string')) &&
    Array.isArray(s.steps) && s.steps.length > 0 && s.steps.length <= 200 && s.steps.every((st) => st && typeof st.tool === 'string' && st.args && typeof st.args === 'object' && !Array.isArray(st.args))
}

/** Tạo id skill từ tên (bỏ dấu tiếng Việt). */
export function skillId(name: string): string {
  const base = name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48)
  return base || 'skill'
}

// ---------- Biểu thức số an toàn (chỉ + - * / ngoặc, số, tên tham số) ----------

export function evalExpr(src: string, vars: Record<string, number>): number {
  const toks = src.match(/\d+(?:\.\d+)?|[A-Za-z_][A-Za-z0-9_]*|[-+*/()]|\S/g) ?? []
  let i = 0
  const peek = () => toks[i]
  const next = () => toks[i++]
  const primary = (): number => {
    const t = next()
    if (t === undefined) throw new Error(`Biểu thức chưa hết: ${src}`)
    if (t === '(') { const v = expr(); if (next() !== ')') throw new Error(`Thiếu ")" trong ${src}`); return v }
    if (t === '-') return -primary()
    if (t === '+') return primary()
    if (/^\d/.test(t)) return Number(t)
    if (NAME.test(t)) { if (!(t in vars)) throw new Error(`Không có tham số "${t}"`); return vars[t]! }
    throw new Error(`Ký tự lạ "${t}" trong ${src}`)
  }
  const term = (): number => {
    let v = primary()
    while (peek() === '*' || peek() === '/') { const op = next(); const r = primary(); v = op === '*' ? v * r : v / r }
    return v
  }
  const expr = (): number => {
    let v = term()
    while (peek() === '+' || peek() === '-') { const op = next(); const r = term(); v = op === '+' ? v + r : v - r }
    return v
  }
  const v = expr()
  if (i < toks.length) throw new Error(`Thừa "${toks[i]}" trong ${src}`)
  if (!Number.isFinite(v)) throw new Error(`Biểu thức không ra số: ${src}`)
  return v
}

/** Thay tham số và kết quả bước trước vào args. */
export function substitute(v: unknown, vars: Record<string, number | string>, results: AiResult[]): unknown {
  if (typeof v === 'string') {
    const ref = /^\$(\d+|prev)\.([A-Za-z_][A-Za-z0-9_]*)(?:\[(\d+)\])?$/.exec(v)
    if (ref) {
      const r = ref[1] === 'prev' ? results[results.length - 1] : results[Number(ref[1]) - 1]
      if (!r) throw new Error(`Chưa có kết quả bước ${ref[1]}`)
      let val = r.data?.[ref[2]!]
      if (ref[3] !== undefined) val = Array.isArray(val) ? val[Number(ref[3])] : undefined
      if (val === undefined) throw new Error(`Bước ${ref[1]} không trả về "${ref[2]}"`)
      return val
    }
    const nums = Object.fromEntries(Object.entries(vars).filter(([, x]) => typeof x === 'number')) as Record<string, number>
    const whole = /^\$\{([^}]+)\}$/.exec(v)
    if (whole) {
      const k = whole[1]!.trim()
      if (typeof vars[k] === 'string') return vars[k]
      return evalExpr(k, nums)
    }
    return v.replace(/\$\{([^}]+)\}/g, (_, e: string) => String(typeof vars[e.trim()] === 'string' ? vars[e.trim()] : evalExpr(e, nums)))
  }
  if (Array.isArray(v)) return v.map((x) => substitute(x, vars, results))
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, substitute(x, vars, results)]))
  return v
}

/** Chạy skill trên mô hình; dừng ở bước lỗi và báo rõ bước nào. */
export async function runSkill(ctx: AiContext, skill: Skill, input: Record<string, unknown> = {}): Promise<{ model: Model3; results: AiResult[] }> {
  const vars: Record<string, number | string> = {}
  for (const p of skill.params) {
    const v = input[p.name] ?? p.default
    if (typeof p.default === 'number') {
      const n = typeof v === 'string' ? Number(v) : v
      if (typeof n !== 'number' || !Number.isFinite(n)) throw new Error(`Tham số "${p.name}" phải là số`)
      vars[p.name] = n
    } else vars[p.name] = String(v)
  }
  let model = ctx.model
  const results: AiResult[] = []
  for (const [i, st] of skill.steps.entries()) {
    if (st.tool === 'run_skill' || st.tool === 'save_skill') throw new Error('Skill không được gọi skill khác')
    try {
      const r = await runAiTool({ ...ctx, model }, st.tool, substitute(st.args, vars, results) as Record<string, unknown>)
      if (r.model) model = r.model
      results.push(r)
    } catch (e) {
      throw new Error(`Bước ${i + 1} (${st.tool}): ${(e as Error).message}`)
    }
  }
  return { model, results }
}

/** Skill có sẵn: mẫu nội thất hay dùng. */
export const BUILTIN_SKILLS: Skill[] = [
  {
    id: 'tu-bep-duoi', builtin: true,
    name: 'Tủ bếp dưới',
    description: 'Dãy tủ bếp dưới: n khoang rộng bằng nhau, chân đế lùi, mặt đá phủ trên.',
    params: [
      { name: 'n', label: 'Số khoang', default: 4 },
      { name: 'w', label: 'Rộng mỗi khoang (mm)', default: 600 },
      { name: 'd', label: 'Sâu (mm)', default: 580 },
      { name: 'h', label: 'Cao thân tủ (mm)', default: 720 },
      { name: 'x', label: 'Toạ độ X đầu dãy', default: 0 },
      { name: 'y', label: 'Toạ độ Y mép sau', default: 0 }
    ],
    steps: [
      { tool: 'add_box', args: { name: 'Chân tủ', x: '${x + n*w/2}', y: '${y + d/2 - 25}', z: 0, width: '${n*w}', depth: '${d - 50}', height: 100, material: 'm-mdf-xam' } },
      { tool: 'add_box', args: { name: 'Thân tủ', x: '${x + w/2}', y: '${y + d/2}', z: 100, width: '${w - 4}', depth: '${d}', height: '${h}', material: 'm-go-trang' } },
      { tool: 'copy_array', args: { ids: ['$2.group_id'], offset: ['${w}', 0, 0], count: '${n - 1}' } },
      { tool: 'add_box', args: { name: 'Mặt đá', x: '${x + n*w/2}', y: '${y + (d + 20)/2}', z: '${100 + h}', width: '${n*w}', depth: '${d + 20}', height: 20, material: 'm-da-marble' } }
    ]
  },
  {
    id: 'ke-sach', builtin: true,
    name: 'Kệ sách',
    description: 'Kệ sách khung gỗ: hai vách, nóc, đáy và các đợt chia đều.',
    params: [
      { name: 'w', label: 'Rộng (mm)', default: 900 },
      { name: 'd', label: 'Sâu (mm)', default: 300 },
      { name: 'h', label: 'Cao (mm)', default: 1800 },
      { name: 'shelves', label: 'Số đợt giữa', default: 4 },
      { name: 't', label: 'Dày ván (mm)', default: 18 }
    ],
    steps: [
      { tool: 'add_box', args: { name: 'Vách trái', x: '${t/2}', y: '${d/2}', z: 0, width: '${t}', depth: '${d}', height: '${h}', material: 'm-go-soi' } },
      { tool: 'add_box', args: { name: 'Vách phải', x: '${w - t/2}', y: '${d/2}', z: 0, width: '${t}', depth: '${d}', height: '${h}', material: 'm-go-soi' } },
      { tool: 'add_box', args: { name: 'Đáy', x: '${w/2}', y: '${d/2}', z: 0, width: '${w - 2*t}', depth: '${d}', height: '${t}', material: 'm-go-soi' } },
      { tool: 'add_box', args: { name: 'Nóc', x: '${w/2}', y: '${d/2}', z: '${h - t}', width: '${w - 2*t}', depth: '${d}', height: '${t}', material: 'm-go-soi' } },
      { tool: 'add_box', args: { name: 'Đợt', x: '${w/2}', y: '${d/2}', z: '${(h - t)/(shelves + 1)}', width: '${w - 2*t}', depth: '${d - 20}', height: '${t}', material: 'm-go-soi' } },
      { tool: 'copy_array', args: { ids: ['$5.group_id'], offset: [0, 0, '${(h - t)/(shelves + 1)}'], count: '${shelves - 1}' } }
    ]
  },
  {
    id: 'ban-lam-viec', builtin: true,
    name: 'Bàn làm việc',
    description: 'Bàn làm việc mặt gỗ, bốn chân vuông.',
    params: [
      { name: 'w', label: 'Dài (mm)', default: 1400 },
      { name: 'd', label: 'Sâu (mm)', default: 700 },
      { name: 'h', label: 'Cao (mm)', default: 750 },
      { name: 'leg', label: 'Cạnh chân (mm)', default: 50 }
    ],
    steps: [
      { tool: 'add_box', args: { name: 'Mặt bàn', x: '${w/2}', y: '${d/2}', z: '${h - 25}', width: '${w}', depth: '${d}', height: 25, material: 'm-go-oc-cho' } },
      { tool: 'add_box', args: { name: 'Chân', x: '${leg/2 + 30}', y: '${leg/2 + 30}', z: 0, width: '${leg}', depth: '${leg}', height: '${h - 25}', material: 'm-inox' } },
      { tool: 'copy_array', args: { ids: ['$2.group_id'], offset: ['${w - leg - 60}', 0, 0], count: 1 } },
      { tool: 'copy_array', args: { ids: ['$2.group_id', '$3.new_groups[0]'], offset: [0, '${d - leg - 60}', 0], count: 1 } }
    ]
  }
]
