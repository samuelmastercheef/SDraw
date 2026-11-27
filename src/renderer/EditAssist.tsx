import { useState } from 'react'
import { applyProposals, parseEdit, type ParsedEdit } from '@core/editCommand'
import type { Sample, SdrawDoc } from '@core/types'
import { Section } from './ui'

interface Props {
  doc: SdrawDoc
  catalog: Sample[]
  selectedId: string | null
  onApply: (doc: SdrawDoc) => void
  onNotice: (text: string, tone?: 'ok' | 'error') => void
}

/** Gõ lệnh tiếng Việt, xem danh sách thay đổi đề xuất, bỏ tick cái không muốn rồi mới áp. Chạy hoàn toàn trên máy. */
export function EditAssist({ doc, catalog, selectedId, onApply, onNotice }: Props) {
  const [text, setText] = useState('')
  const [result, setResult] = useState<ParsedEdit | null>(null)
  const [off, setOff] = useState<Set<string>>(new Set())

  const propose = (): void => {
    if (!text.trim()) return
    setResult(parseEdit(text, doc, selectedId, catalog))
    setOff(new Set())
  }
  const chosen = result?.proposals.filter((p) => !off.has(p.key)) ?? []
  const apply = (): void => {
    if (chosen.length === 0) return
    onApply(applyProposals(doc, chosen))
    onNotice(`Đã áp ${chosen.length} thay đổi. Hoàn tác bằng Ctrl+Z.`)
    setResult(null)
    setText('')
  }

  return (
    <Section title="Sửa bằng lời">
      <div className="edit-assist">
      <div className="edit-row">
        <input
          className="edit-input"
          aria-label="Lệnh sửa bố cục"
          placeholder="VD: dịch kệ tivi sang phải 30 cm"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') propose() }}
        />
        <button className="btn" disabled={!text.trim()} onClick={propose}>Đề xuất</button>
      </div>
      {result ? (
        <div className="edit-result">
          {result.proposals.length > 0 ? (
            <>
              <p className="muted">AI đề xuất {result.proposals.length} thay đổi</p>
              <ul className="edit-list">
                {result.proposals.map((p) => (
                  <li key={p.key}>
                    <label>
                      <input type="checkbox" checked={!off.has(p.key)} onChange={() => setOff((o) => { const n = new Set(o); if (n.has(p.key)) n.delete(p.key); else n.add(p.key); return n })} />
                      <b>{p.verb}</b> {p.label}
                    </label>
                  </li>
                ))}
              </ul>
              <div className="edit-actions">
                <button className="btn-cta" disabled={chosen.length === 0} onClick={apply}>Áp dụng ({chosen.length})</button>
                <button className="btn-ghost" onClick={() => setResult(null)}>Bỏ</button>
              </div>
            </>
          ) : null}
          {result.skippedLocked.length > 0 ? <p className="muted">Không đụng tới món đã khoá: {result.skippedLocked.join(', ')}</p> : null}
          {result.notes.map((n) => <p key={n} className="edit-note">{n}</p>)}
        </div>
      ) : null}
      </div>
    </Section>
  )
}
