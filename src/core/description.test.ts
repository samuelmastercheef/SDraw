import { describe, expect, it } from 'vitest'
import { toIndexEntry } from './indexing'
import type { Sample } from './types'

describe('mô tả mẫu', () => {
  const s: Sample = { id: 's1', name: 'Sofa A', description: 'Vải bố xám, khách Nguyễn Văn A đặt', category: 'Sofa', w: 2000, d: 900, h: 800 }
  it('không bị gửi lên hệ thống chung cùng chỉ mục ẩn danh', () => {
    const e = JSON.stringify(toIndexEntry(s, 'biz-a'))
    expect(e).not.toContain('Nguyễn')
    expect(e).not.toContain('Vải bố')
  })
})
