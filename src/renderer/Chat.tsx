import { useEffect, useMemo, useRef, useState } from 'react'
import { autoLayout } from '@core/autolayout'
import { buildBom, formatVnd } from '@core/bom'
import { BASE_WEIGHTS, N_FEATURES, pairsFromChoice, rankWithModel } from '@core/ranker'
import { parseRequirement, type PickStats, type Requirement, type Suggestion } from '@core/suggest'
import type { Sample, SdrawDoc } from '@core/types'
import { WAREHOUSE_NOTE, WarehouseButton } from './Warehouse'

type Notify = (text: string, tone?: 'ok' | 'error') => void
const errText = (d: unknown): string => (d as { error?: string })?.error ?? 'Có lỗi xảy ra'

interface ServerItem { key: string; category: string; w: number; d: number; h: number; styles: string[]; score: number; reasons: string[]; own: boolean }

interface Turn {
  id: number
  q: string
  req: Requirement
  local: Suggestion[]
  reply: string
  shared: ServerItem[]
  storeSimilar: number | null
}

/** Hội thoại giữ trong phiên chạy để đổi màn hình rồi quay lại vẫn còn. */
let SAVED: Turn[] = []

const trieu = (v: number): string => `${new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 }).format(v / 1_000_000)} triệu`

/** Các nhãn app hiểu từ lời khách, để người dùng thấy ngay app hiểu đúng hay sai. */
export function requirementChips(r: Requirement): string[] {
  return [
    ...r.categories, ...r.shapes, ...r.styles, ...r.materials,
    ...(r.widthMm ? [`${Math.round(r.widthMm)} mm`] : []),
    ...(r.budgetVnd ? [`≤ ${trieu(r.budgetVnd)}`] : [])
  ]
}

const FOLLOW_UPS: { label: string; phrase: string; skip: (r: Requirement) => boolean }[] = [
  { label: 'Thêm kệ sách', phrase: 'thêm kệ sách', skip: (r) => r.categories.includes('Kệ sách') },
  { label: 'Thêm bàn trà', phrase: 'thêm bàn trà', skip: (r) => r.categories.includes('Bàn trà') },
  { label: 'Đổi sang sofa thẳng', phrase: 'sofa thẳng', skip: (r) => !r.shapes.includes('chữ L') },
  { label: 'Dùng chất liệu gỗ', phrase: 'gỗ', skip: (r) => r.materials.includes('gỗ') }
]

/** Mặt bằng thu nhỏ của một phương án bố trí. */
function PlanThumb(props: { doc: SdrawDoc; label: string }) {
  const { room, items, doors } = props.doc
  return (
    <svg viewBox={`-40 -40 ${room.widthMm + 80} ${room.depthMm + 80}`} width="100%" height={120} role="img" aria-label={props.label} className="plan-thumb">
      <rect x={0} y={0} width={room.widthMm} height={room.depthMm} fill="none" stroke="#0D1B2A" strokeWidth={60} />
      {doors.map((d) => {
        const horiz = d.wall === 'top' || d.wall === 'bottom'
        const x = horiz ? d.offsetMm : d.wall === 'left' ? -30 : room.widthMm - 30
        const y = horiz ? (d.wall === 'top' ? -30 : room.depthMm - 30) : d.offsetMm
        return <rect key={d.id} x={x} y={y} width={horiz ? d.widthMm : 60} height={horiz ? 60 : d.widthMm} fill="#D5E2E5" stroke="#0D1B2A" strokeWidth={10} />
      })}
      {items.map((it) => (
        <rect key={it.id} x={it.cx - it.w / 2} y={it.cy - it.d / 2} width={it.w} height={it.d} fill="#E7F3F4" stroke="#0B7F8F" strokeWidth={36}
          transform={`rotate(${it.rotation} ${it.cx} ${it.cy})`} />
      ))}
    </svg>
  )
}

export function ChatView(props: {
  doc: SdrawDoc
  catalog: Sample[]
  stats: PickStats
  online: boolean
  onUse: (s: Sample) => void
  onPick: (s: Sample) => void
  onLayout: (samples: Sample[]) => void
  onOpenStore: (q: string) => void
  onOpenLayout: () => void
  onNotice: Notify
}) {
  const [text, setText] = useState('')
  const [turns, setTurns] = useState<Turn[]>(SAVED)
  const [busy, setBusy] = useState(false)
  const [weights, setWeights] = useState<readonly number[]>(BASE_WEIGHTS)
  const end = useRef<HTMLDivElement>(null)
  const nextId = useRef(SAVED.reduce((m, t) => Math.max(m, t.id), 0) + 1)
  SAVED = turns

  useEffect(() => { end.current?.scrollIntoView?.({ block: 'end' }) }, [turns.length])

  // Mô hình chung (chỉ vài chục con số) tải về dùng ngay trên máy.
  useEffect(() => {
    if (!props.online) { setWeights(BASE_WEIGHTS); return }
    void window.sdraw.net('GET', '/v1/model').then((r) => {
      const w = (r.data as { weights?: unknown }).weights
      if (r.status === 200 && Array.isArray(w) && w.length === N_FEATURES && w.every((x) => typeof x === 'number' && Number.isFinite(x))) setWeights(w as number[])
    }).catch(() => undefined)
  }, [props.online])

  /** Gửi lên hệ thống chỉ hiệu đặc trưng (số), không gửi tên mẫu, khoá hay lời khách. */
  const learnFrom = (t: Turn, picked: Sample) => {
    if (!props.online) return
    const pairs = pairsFromChoice(t.local.map((r) => r.sample), picked, t.req, props.stats)
    if (pairs.length > 0) void window.sdraw.net('POST', '/v1/events/feedback', { pairs }).catch(() => undefined)
  }

  const ask = async (raw: string) => {
    const q = raw.trim()
    if (!q || busy) return
    setBusy(true)
    setText('')
    // Phần riêng chạy ngay trên máy, không cần mạng.
    const req = parseRequirement(q)
    const turn: Turn = { id: nextId.current++, q, req, local: rankWithModel(props.catalog, req, weights, props.stats, 8), reply: '', shared: [], storeSimilar: null }
    setTurns((t) => [...t, turn])
    if (props.online) {
      const res = await window.sdraw.net('POST', '/v1/ai/chat', { text: q })
      if (res.status === 200) {
        const d = res.data as { reply: string; items: ServerItem[]; storeSimilar: number }
        setTurns((t) => t.map((x) => (x.id === turn.id ? { ...x, reply: d.reply, shared: d.items.filter((i) => !i.own), storeSimilar: d.storeSimilar } : x)))
      } else props.onNotice(`Gợi ý từ hệ thống chung chưa có: ${errText(res.data)}`, 'error')
    }
    setBusy(false)
  }

  const picksOf = (t: Turn): Sample[] => {
    const top = new Map<string, Sample>()
    for (const r of t.local) if (!top.has(r.sample.category)) top.set(r.sample.category, r.sample)
    return [...top.values()].slice(0, 6)
  }

  const last = turns[turns.length - 1]
  const bom = useMemo(() => buildBom(props.doc, props.catalog), [props.doc, props.catalog])

  return (
    <div className="chat-page">
      <header className="chat-head">
        <div><span className="muted">Dự án: {props.doc.name}</span><h2>Chat thiết kế AI</h2></div>
        <span className="pill">{props.online ? 'Đã kết nối' : 'Chỉ kho riêng'}</span>
      </header>
      <div className="chat-body">
        <section className="chat-main">
          <div className="chat-scroll" aria-live="polite">
            {turns.length === 0 ? (
              <div className="chat-empty">
                <p>Nói yêu cầu của khách, ví dụ: “sofa chữ L vải xám rộng 2m4 ngân sách 15 triệu”.</p>
                <p className="hint">Mẫu trong kho của bạn được tìm ngay trên máy; gợi ý từ hệ thống chung và hiểu yêu cầu bằng AI cần mạng.</p>
                {!props.online ? <p className="hint">Chưa đăng nhập Socin: chỉ có gợi ý từ kho riêng. Vào Cài đặt để đăng nhập.</p> : null}
              </div>
            ) : null}
            {turns.map((t) => {
              const picks = picksOf(t)
              const plan = picks.length > 0 ? autoLayout({ ...props.doc, items: [] }, picks) : null
              const chips = requirementChips(t.req)
              return (
                <div key={t.id} className="turn">
                  <div className="msg-user">{t.q}</div>
                  <div className="msg-ai">
                    <strong>{chips.length > 0 ? 'Mình hiểu yêu cầu như sau:' : 'Mình chưa nhận ra loại đồ cụ thể, thử nêu rõ hơn (ví dụ: sofa, bàn trà, kệ tivi).'}</strong>
                    {chips.length > 0 ? <div className="chips-row">{chips.map((c) => <span key={c} className="pill">{c}</span>)}</div> : null}
                    {t.reply ? <p>{t.reply}</p> : null}
                    {plan && plan.placed.length > 0 ? (
                      <div className="plan-card">
                        <PlanThumb doc={plan.doc} label="Mặt bằng phương án bố trí" />
                        <div><b>Phương án bố trí: {plan.placed.length} mẫu đứng đầu mỗi loại</b><br /><span className="muted">{picks.map((p) => p.name).join(', ')}</span></div>
                        <button className="btn" title="Xếp theo quy tắc: dựa tường, chừa lối đi, không chắn cửa" onClick={() => { picks.forEach((p) => { learnFrom(t, p); props.onPick(p) }); props.onLayout(picks) }}>Mở trong Bố cục</button>
                      </div>
                    ) : null}
                    {t.local.length === 0 ? <p className="hint">Không có mẫu nào đúng loại khách cần trong kho của bạn.</p> : (
                      <>
                        <h3>Trong kho của bạn ({t.local.length})</h3>
                        <ul className="cards">
                          {t.local.map((r) => (
                            <li key={r.sample.id} className="card">
                              <strong>{r.sample.name}</strong>
                              <span className="muted">{r.sample.category} · {r.sample.w}×{r.sample.d}×{r.sample.h} mm</span>
                              <ul className="reasons">{r.reasons.map((x) => <li key={x}>{x}</li>)}</ul>
                              <button className="btn" onClick={() => { learnFrom(t, r.sample); props.onPick(r.sample); props.onUse(r.sample) }}>Đưa vào bản vẽ</button>
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                    {t.shared.length > 0 ? (
                      <>
                        <h3>Từ hệ thống học chung</h3>
                        <p className="hint">Chỉ có thông số ẩn danh (loại, kích thước, nhãn), không có tên, giá hay file của doanh nghiệp khác.</p>
                        <ul className="cards">
                          {t.shared.map((i) => (
                            <li key={i.key} className="card"><strong>{i.category}</strong><span className="muted">{i.w}×{i.d}×{i.h} mm</span><ul className="reasons">{i.reasons.map((x) => <li key={x}>{x}</li>)}</ul></li>
                          ))}
                        </ul>
                      </>
                    ) : null}
                    {t.storeSimilar ? (
                      <div className="store-hint"><span><strong>Trên Store có {t.storeSimilar} mẫu giống yêu cầu này.</strong> Bạn có thể xem và mua thêm.</span><button className="btn" onClick={() => props.onOpenStore(t.q)}>Xem trên Store</button></div>
                    ) : null}
                    {t.id === last?.id ? (
                      <div className="store-hint">
                        <span>Chưa thấy mẫu ưng ý? Tìm thêm trên 3D Warehouse, tải về bằng tài khoản SketchUp của bạn. <span className="hint">{WAREHOUSE_NOTE}</span></span>
                        <WarehouseButton query={t.q} onNotice={props.onNotice} />
                      </div>
                    ) : null}
                  </div>
                </div>
              )
            })}
            {last ? (
              <div className="follow-ups">
                {FOLLOW_UPS.filter((f) => !f.skip(last.req)).map((f) => (
                  <button key={f.label} className="chip" disabled={busy} onClick={() => void ask(`${last.q}, ${f.phrase}`)}>{f.label}</button>
                ))}
              </div>
            ) : null}
            <div ref={end} />
          </div>
          <div className="chat-input">
            <label className="sr-only" htmlFor="msg">Nhập yêu cầu</label>
            <textarea id="msg" rows={2} value={text} placeholder="Mô tả yêu cầu của khách" onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void ask(text) } }} />
            <button className="btn-cta" disabled={busy || !text.trim()} onClick={() => void ask(text)}>{busy ? 'Đang tìm…' : 'Gửi'}</button>
          </div>
        </section>
        <aside className="chat-side">
          <h3>Phác thảo hiện tại</h3>
          {props.doc.items.length === 0 ? <p className="hint">Chưa có món nào trong bản vẽ. Đưa mẫu vào bản vẽ hoặc mở phương án trong Bố cục.</p> : (
            <>
              <PlanThumb doc={props.doc} label="Mặt bằng hiện tại" />
              <ul className="side-list">
                {bom.rows.map((r) => <li key={r.itemId}><span>{r.name}</span><span className="muted">{r.unitPrice === null ? 'Chưa báo giá' : formatVnd(r.unitPrice)}</span></li>)}
              </ul>
              <div className="side-total"><span>Tạm tính</span><span>{formatVnd(bom.total)}</span></div>
              {bom.unpriced > 0 ? <p className="hint">{bom.unpriced} món chưa có giá, chưa tính vào tổng.</p> : null}
            </>
          )}
          <p className="hint">Kích thước và giá lấy từ thông số mẫu trong kho.</p>
          <div className="grow" />
          <button className="btn-cta" onClick={props.onOpenLayout}>Mở trong Bố cục</button>
        </aside>
      </div>
    </div>
  )
}
