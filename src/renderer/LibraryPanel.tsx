import { useMemo, useState } from 'react'
import { formatVnd } from '@core/bom'
import type { Sample } from '@core/types'
import { Section } from './ui'

export function LibraryPanel(props: { catalog: Sample[]; onAdd: (s: Sample) => void; onManage: () => void }) {
  const [q, setQ] = useState('')
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return props.catalog
    return props.catalog.filter((s) => `${s.name} ${s.category}`.toLowerCase().includes(needle))
  }, [q, props.catalog])

  const pending = props.catalog.filter((s) => s.needsReview).length

  return (
    <Section title="Mẫu trong kho" right={<button className="btn-ghost" onClick={props.onManage}>Quản lý</button>}>
      <div className="field">
        <label htmlFor="lib-q">Tìm mẫu</label>
        <div className="input-wrap">
          <input id="lib-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Sofa, bàn trà, kệ" />
        </div>
      </div>
      {pending > 0 ? (
        <p className="hint">
          {pending} mẫu cần duyệt kích thước.{' '}
          <button className="btn-ghost" onClick={props.onManage}>Mở Thư viện để duyệt</button>
        </p>
      ) : null}
      <ul className="lib-list">
        {list.map((s) => (
          <li key={s.id}>
            <button className="lib-item" onClick={() => props.onAdd(s)} title="Thêm vào bản vẽ">
              <span className="lib-name">{s.name}</span>
              <span className="lib-meta">
                {s.category} · {s.w} × {s.d} mm
              </span>
              <span className="lib-tags">
                {s.listPrice != null ? <span className="tag src-list">{formatVnd(s.listPrice)}</span> : <span className="tag src-blank">Chưa có giá</span>}
                {s.needsReview ? <span className="tag warn">Cần duyệt kích thước</span> : null}
              </span>
            </button>
          </li>
        ))}
        {list.length === 0 ? <li className="hint">Không có mẫu phù hợp.</li> : null}
      </ul>
    </Section>
  )
}
