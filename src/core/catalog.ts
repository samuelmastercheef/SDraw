import type { Sample } from './types'

/** Mẫu minh hoạ để app dùng được ngay khi chưa nhập thư mục mẫu thật. */
export const SEED_SAMPLES: Sample[] = [
  { id: 'seed-sofa-l', name: 'Sofa góc L', category: 'Sofa', w: 2700, d: 900, h: 800, listPrice: 14_000_000 },
  { id: 'seed-sofa-round', name: 'Sofa bo tròn', category: 'Sofa', w: 2400, d: 950, h: 780, listPrice: 15_200_000 },
  { id: 'seed-tv', name: 'Kệ tivi treo tường', category: 'Kệ tivi', w: 1800, d: 350, h: 400, listPrice: 6_000_000 },
  { id: 'seed-coffee', name: 'Bàn trà tròn bo góc', category: 'Bàn trà', w: 800, d: 800, h: 400, listPrice: 2_500_000 },
  { id: 'seed-armchair', name: 'Ghế đơn thư giãn', category: 'Ghế thư giãn', w: 750, d: 780, h: 850 },
  { id: 'seed-shelf', name: 'Kệ sách mở 5 tầng', category: 'Kệ sách', w: 900, d: 350, h: 1900 }
]

const IMAGE_OR_SKP = /\.skp$/i

/** Tên mẫu từ tên file: bỏ đuôi, đổi _ và - thành khoảng trắng. */
export function sampleNameFromPath(path: string): string {
  const base = path.split(/[\\/]/).pop() ?? path
  return base.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim() || base
}

/** Tạo mục kho từ danh sách đường dẫn file .skp đã quét. Bỏ qua file đã có trong kho. */
export function samplesFromScan(paths: string[], existing: Sample[]): Sample[] {
  const known = new Set(existing.map((s) => s.skpPath).filter(Boolean))
  const added: Sample[] = []
  for (const p of paths) {
    if (!IMAGE_OR_SKP.test(p) || known.has(p)) continue
    added.push({
      id: `scan-${hash(p)}`,
      name: sampleNameFromPath(p),
      category: 'Chưa phân loại',
      w: 1000,
      d: 600,
      h: 800,
      skpPath: p,
      origin: 'scan',
      sourceType: 'skp',
      needsReview: true
    })
  }
  return added
}

function hash(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}
