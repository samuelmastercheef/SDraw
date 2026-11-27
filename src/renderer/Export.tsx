import { useState, useSyncExternalStore } from 'react'
import type { Sample, SdrawDoc } from '@core/types'
import { exporters } from '@core/extensions'
import { registerBuiltinExporters } from './exporters'

registerBuiltinExporters()
const subscribe = (fn: () => void) => exporters.subscribe(fn)
let cache = exporters.list()
exporters.subscribe(() => { cache = exporters.list() })
const snapshot = () => cache

export function ExportView(props: { doc: SdrawDoc; catalog: Sample[]; onNotice: (text: string, tone?: 'ok' | 'error') => void }) {
  const outputs = useSyncExternalStore(subscribe, snapshot)
  const [chosen, setChosen] = useState<Record<string, boolean>>({})
  const picked = (o: (typeof outputs)[number]) => chosen[o.id] ?? o.defaultOn ?? false
  const [busy, setBusy] = useState(false)
  const { doc, catalog } = props
  const count = outputs.filter(picked).length

  const run = async () => {
    setBusy(true)
    const done: string[] = []
    try {
      for (const o of outputs) {
        if (!picked(o)) continue
        const r = await o.run({ doc, catalog })
        if (!r) continue
        done.push(r.file)
        if (r.warnings?.length) props.onNotice(`${o.label}: ${r.warnings.length} cảnh báo (${r.warnings[0]})`)
      }
      if (done.length) props.onNotice(`Đã xuất ${done.length} file: ${done.join(', ')}`)
    } catch (e) {
      props.onNotice(`Không xuất được: ${(e as Error).message}`, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page">
      <h2>Xuất bản vẽ</h2>
      <p className="muted">Dự án: <strong>{doc.name}</strong> · {doc.room.widthMm / 1000} × {doc.room.depthMm / 1000} m · {doc.items.length} món</p>
      <ul className="cards">
        {outputs.map((o) => (
          <li key={o.id} className="card">
            <label className="check">
              <input type="checkbox" checked={picked(o)} onChange={(e) => setChosen({ ...chosen, [o.id]: e.target.checked })} />
              <strong>{o.label}</strong>{o.tier === 'pro' && <span className="badge">Pro</span>}
            </label>
            <span className="muted">{o.note}</span>
          </li>
        ))}
      </ul>
      <div className="row">
        <button className="btn-cta" disabled={busy || count === 0} onClick={() => void run()}>Xuất {count} mục đã chọn</button>
      </div>
      <p className="hint">Mỗi mục sẽ hỏi nơi lưu riêng. Xuất ảnh phối cảnh bằng AI cần máy GPU riêng nên chưa có ở đây.</p>
    </div>
  )
}
