/**
 * Điểm cắm mở rộng của S Draw. Bộ xuất file (và sau này công cụ, panel) được đăng ký vào sổ đăng ký
 * thay vì viết cứng trong giao diện. Bản mã nguồn mở đăng ký các mục có sẵn; bản chính thức dùng cùng
 * cơ chế này để nạp các gói Pro đã ký số.
 */
import type { Sample, SdrawDoc } from './types'

export type ExtensionTier = 'core' | 'pro'

export interface Extension {
  /** Mã duy nhất, ví dụ "dxf" hoặc "pro.pdf-sheet" */
  id: string
  /** Thứ tự hiển thị, nhỏ lên trước (mặc định 100) */
  order?: number
  /** "core" là phần mở; "pro" chỉ có khi đã nạp gói Pro */
  tier?: ExtensionTier
}

export interface ExportContext {
  doc: SdrawDoc
  catalog: Sample[]
}

export interface ExportResult {
  /** Đường dẫn file đã ghi */
  file: string
  /** Cảnh báo để báo cho người dùng sau khi xuất */
  warnings?: string[]
}

export interface ExporterExtension extends Extension {
  label: string
  note: string
  /** Được chọn sẵn trong màn Xuất */
  defaultOn?: boolean
  /** Trả về null khi người dùng huỷ hộp thoại lưu */
  run(ctx: ExportContext): Promise<ExportResult | null>
}

export interface Registry<T extends Extension> {
  /** Đăng ký; trả về hàm gỡ. Trùng id thì báo lỗi, trừ khi replace = true. */
  register(ext: T, opts?: { replace?: boolean }): () => void
  get(id: string): T | undefined
  /** Danh sách theo order rồi theo thứ tự đăng ký */
  list(): T[]
  /** Gọi lại mỗi khi danh sách thay đổi; trả về hàm huỷ theo dõi */
  subscribe(fn: () => void): () => void
}

export function createRegistry<T extends Extension>(): Registry<T> {
  const items = new Map<string, { ext: T; seq: number }>()
  const listeners = new Set<() => void>()
  let seq = 0
  const emit = () => listeners.forEach((fn) => fn())
  return {
    register(ext, opts) {
      if (!ext.id || typeof ext.id !== 'string') throw new Error('Mở rộng cần có id')
      if (items.has(ext.id) && !opts?.replace) throw new Error(`Đã có mở rộng với id "${ext.id}"`)
      const entry = { ext, seq: seq++ }
      items.set(ext.id, entry)
      emit()
      return () => {
        if (items.get(ext.id) === entry) {
          items.delete(ext.id)
          emit()
        }
      }
    },
    get: (id) => items.get(id)?.ext,
    list: () =>
      [...items.values()]
        .sort((a, b) => (a.ext.order ?? 100) - (b.ext.order ?? 100) || a.seq - b.seq)
        .map((e) => e.ext),
    subscribe(fn) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    }
  }
}

/** Sổ đăng ký bộ xuất file dùng chung cho toàn app */
export const exporters: Registry<ExporterExtension> = createRegistry<ExporterExtension>()
