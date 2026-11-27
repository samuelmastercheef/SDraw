import { useState } from 'react'
import { samplesFromScan } from '@core/catalog'
import { WarehouseButton } from './Warehouse'
import { MeshViewButton } from './MeshView'
import type { Sample } from '@core/types'
import { NumberField, TextAreaField, TextField } from './ui'

interface Props {
  catalog: Sample[]
  onChange: (catalog: Sample[]) => void
  onNotice: (text: string, tone?: 'ok' | 'error') => void
  onImport: () => void
}

/** Màn quản lý kho: quét thư mục, duyệt kích thước, nhập bảng giá doanh nghiệp. */
export function LibraryView({ catalog, onChange, onNotice, onImport }: Props) {
  const [busy, setBusy] = useState(false)

  const patch = (id: string, p: Partial<Sample>) =>
    onChange(catalog.map((s) => (s.id === id ? { ...s, ...p } : s)))

  const scan = async () => {
    setBusy(true)
    try {
      const res = await window.sdraw.scanFolder()
      if (!res) return
      const added = samplesFromScan(res.paths, catalog)
      if (added.length) onChange([...catalog, ...added])
      onNotice(
        `Quét ${res.folder}: tìm thấy ${res.paths.length} file .skp, thêm ${added.length} mẫu mới` +
          (res.truncated ? ' (đã dừng ở giới hạn, hãy quét thư mục con riêng)' : '')
      )
    } catch (e) {
      onNotice(`Không quét được thư mục: ${(e as Error).message}`, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="library-view">
      <div className="library-head">
        <div>
          <h1>Thư viện mẫu</h1>
          <p className="hint">
            {catalog.length} mẫu. File .skp nằm yên trên máy, app chỉ lưu đường dẫn và thông số. Bỏ trống giá nếu chưa báo giá.
          </p>
        </div>
        <WarehouseButton onNotice={onNotice} />
        <MeshViewButton onNotice={onNotice} catalog={catalog} onChange={onChange} />
        <button className="btn" onClick={onImport}>Tải mẫu lên…</button>
        <button className="btn-cta" disabled={busy} onClick={() => void scan()}>
          {busy ? 'Đang quét…' : 'Thêm thư mục mẫu'}
        </button>
      </div>
      <div className="table-wrap">
        <table className="lib-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Tên mẫu</th>
              <th>Mô tả</th>
              <th>Nhóm</th>
              <th>Rộng</th>
              <th>Sâu</th>
              <th>Cao</th>
              <th>Giá niêm yết (đ)</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {catalog.map((s) => (
              <tr key={s.id}>
                <td>
                  <button
                    className="id-chip"
                    title={`${s.id} (bấm để sao chép)`}
                    onClick={() => { void navigator.clipboard?.writeText(s.id).then(() => onNotice(`Đã sao chép ID ${s.id}`)).catch(() => onNotice('Không sao chép được ID', 'error')) }}
                  >
                    {s.id}
                  </button>
                </td>
                <td>
                  <TextField label="Tên" value={s.name} onCommit={(name) => patch(s.id, { name })} />
                  {s.skpPath ? <div className="path" title={s.skpPath}>{s.skpPath}</div> : null}
                </td>
                <td>
                  <TextAreaField
                    label="Mô tả"
                    value={s.description ?? ''}
                    placeholder="Chất liệu, phong cách, ghi chú…"
                    onCommit={(v) => patch(s.id, { description: v.trim() === '' ? undefined : v.trim().slice(0, 1000) })}
                  />
                </td>
                <td>
                  <TextField label="Nhóm" value={s.category} onCommit={(category) => patch(s.id, { category })} />
                </td>
                <td><NumberField label="Rộng" value={s.w} min={50} onCommit={(w) => patch(s.id, { w, needsReview: false })} /></td>
                <td><NumberField label="Sâu" value={s.d} min={50} onCommit={(d) => patch(s.id, { d, needsReview: false })} /></td>
                <td><NumberField label="Cao" value={s.h} min={50} onCommit={(h) => patch(s.id, { h })} /></td>
                <td>
                  <TextField
                    label="Giá"
                    value={s.listPrice != null ? String(s.listPrice) : ''}
                    onCommit={(v) => {
                      const n = Number(v.replace(/[^\d]/g, ''))
                      patch(s.id, { listPrice: v.trim() === '' || !Number.isFinite(n) ? undefined : n })
                    }}
                  />
                </td>
                <td>
                  <button
                    className="btn-ghost danger"
                    onClick={() => onChange(catalog.filter((x) => x.id !== s.id))}
                  >
                    Xoá
                  </button>
                  {s.needsReview ? (
                    <>
                      <span className="tag warn">Cần duyệt</span>
                      <button className="btn" title="Kích thước và nhóm đã đúng" onClick={() => patch(s.id, { needsReview: false })}>Duyệt</button>
                    </>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
