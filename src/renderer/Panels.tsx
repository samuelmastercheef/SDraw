import { ImagePanel, SourcesPanel, Switch } from './Sources'
import { Cover } from './Cover'
import { StoreSellView } from './StoreSell'
import { WAREHOUSE_NOTE, WarehouseButton } from './Warehouse'
import { useCallback, useEffect, useRef, useState } from 'react'
import { DEFAULT_SERVER_URL } from '@core/server'
import { toIndexEntry, type IndexEntry } from '@core/indexing'
import { parseRequirement, type PickStats, type Requirement, type Suggestion } from '@core/suggest'
import { BASE_WEIGHTS, N_FEATURES, pairsFromChoice, rankWithModel } from '@core/ranker'
import type { Sample } from '@core/types'
import type { ImportItem, Settings } from '../preload/api'

type Notify = (text: string, tone?: 'ok' | 'error') => void

const CATEGORIES = ['Sofa', 'Bàn trà', 'Kệ tivi', 'Ghế thư giãn', 'Kệ sách', 'Bàn ăn', 'Giường']
const errText = (d: unknown): string => (d as { error?: string })?.error ?? 'Có lỗi xảy ra'

export function useSettings() {
  const [settings, setSettings] = useState<Settings>({ serverUrl: DEFAULT_SERVER_URL, token: '', user: null, folders: [], autoDetect: true, autoIndex: true, autoSync: false, autoWatch: true, autoBackup: false, offlineChosen: false, lastBackupAt: 0, image: { provider: 'socin', monthlyLimit: 300, lanHost: '', lanPort: 7860, staffAllowed: true, watermark: true } })
  const [ready, setReady] = useState(false)
  useEffect(() => { void window.sdraw.getSettings().then((s) => { setSettings(s); setReady(true) }) }, [])
  const update = async (patch: Partial<Settings>): Promise<Settings> => {
    const s = await window.sdraw.setSettings(patch)
    setSettings(s)
    return s
  }
  return { settings, update, ready, online: !!settings.token && !!settings.user }
}

/** Đẩy chỉ mục ẩn danh lên hệ thống chung. Chỉ đi qua toIndexEntry: không tên, đường dẫn, giá, ảnh. */
export async function syncIndex(catalog: Sample[], businessId: string): Promise<{ accepted: number; rejected: number }> {
  let accepted = 0
  let rejected = 0
  const entries = catalog.map((s) => toIndexEntry(s, businessId))
  for (let i = 0; i < entries.length; i += 500) {
    const res = await window.sdraw.net('PUT', '/v1/index', { entries: entries.slice(i, i + 500) })
    if (res.status !== 200) throw new Error(errText(res.data))
    const d = res.data as { accepted: number; rejected: unknown[] }
    accepted += d.accepted
    rejected += d.rejected.length
  }
  return { accepted, rejected }
}

// ---------------------------------------------------------------- tải mẫu lên

export function ImportPanel(props: { catalog: Sample[]; onChange: (c: Sample[]) => void; onNotice: Notify; onClose: () => void }) {
  const [rights, setRights] = useState(false)
  const [items, setItems] = useState<ImportItem[]>([])
  const pick = async () => {
    try {
      const res = await window.sdraw.importFiles()
      if (res) setItems(res)
    } catch (e) {
      props.onNotice(`Không đọc được file: ${(e as Error).message}`, 'error')
    }
  }
  const patch = (i: number, p: Partial<Sample>) =>
    setItems((list) => list.map((it, k) => (k === i && it.sample ? { ...it, sample: { ...it.sample, ...p } } : it)))
  const ready = items.filter((it) => it.sample && (!it.needsDimensions || (it.sample.w > 0 && it.sample.d > 0 && it.sample.h > 0)))
  const add = () => {
    const known = new Set(props.catalog.map((s) => s.id))
    const fresh = ready.map((it) => ({ ...it.sample!, origin: 'upload' as const })).filter((s) => !known.has(s.id))
    props.onChange([...props.catalog, ...fresh])
    props.onNotice(`Đã thêm ${fresh.length} mẫu vào kho`)
    props.onClose()
  }
  return (
    <div className="modal" role="dialog" aria-label="Tải mẫu lên kho">
      <div className="modal-card">
        <h2>Tải mẫu lên kho</h2>
        <p className="hint">Hỗ trợ .skp, .dxf, .svg, ảnh PNG/JPG, .sdraw, .sdsketch và thư viện .json do plugin SketchUp xuất (đã có kích thước). Với .skp và ảnh, app chưa đọc được kích thước nên bạn nhập tay. File gốc vẫn nằm trên máy bạn, không được tải đi đâu.</p>
        <button className="btn-cta" onClick={() => void pick()}>Chọn file…</button>
        {items.length > 0 ? (
          <table className="import-table">
            <thead><tr><th>File</th><th>Loại</th><th>Rộng</th><th>Sâu</th><th>Cao</th><th>Ghi chú</th></tr></thead>
            <tbody>
              {items.map((it, i) => it.error || !it.sample ? (
                <tr key={i} className="bad"><td>{it.fileName}</td><td colSpan={5}>{it.error}</td></tr>
              ) : (
                <tr key={i}>
                  <td>{it.sample.name}</td>
                  <td>
                    <select value={it.sample.category} onChange={(e) => patch(i, { category: e.target.value })}>
                      {[...new Set([it.sample.category, ...CATEGORIES])].map((c) => <option key={c}>{c}</option>)}
                    </select>
                  </td>
                  {(['w', 'd', 'h'] as const).map((k) => (
                    <td key={k}><input className={it.needsDimensions && !it.sample![k] ? 'need' : ''} inputMode="numeric" value={it.sample![k] || ''} placeholder="mm"
                      onChange={(e) => patch(i, { [k]: Math.max(0, Math.round(Number(e.target.value) || 0)) })} /></td>
                  ))}
                  <td className="hint">{(it.warnings ?? []).join(' ') || (it.needsDimensions ? 'Nhập kích thước' : 'Đã đọc kích thước')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
        <label className="check"><input type="checkbox" checked={rights} onChange={(e) => setRights(e.target.checked)} />Mẫu do doanh nghiệp tự làm hoặc có quyền dùng</label>
        <p className="hint">Mẫu thêm vào kho chỉ ở trong doanh nghiệp của bạn. Muốn bán, hãy đăng riêng lên Store. {WAREHOUSE_NOTE}</p>
        <div className="row end">
          <button className="btn" onClick={props.onClose}>Đóng</button>
          <button className="btn-cta" disabled={ready.length === 0 || !rights} onClick={add}>Thêm {ready.length} mẫu vào kho</button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- Store

interface Listing { hasFile?: boolean; hasCover?: boolean; fileKind?: 'skp' | 'sdraw3d' | 'glb'; id: string; title: string; category: string; w: number; d: number; h: number; tags: string[]; styles: string[]; materials: string[] }

export function StoreView(props: { catalog: Sample[]; online: boolean; role: string; initialQuery: string; onChange: (c: Sample[]) => void; onNotice: Notify; onOpen3d?: (f: { kind: 'sdraw3d' | 'glb'; name: string; data: Uint8Array }) => void }) {
  const [q, setQ] = useState(props.initialQuery)
  const [category, setCategory] = useState('')
  const [items, setItems] = useState<Listing[]>([])
  const [total, setTotal] = useState(0)
  const [listing, setListing] = useState(false)
  const [detail, setDetail] = useState<Listing | null>(null)
  const search = useCallback(async () => {
    if (!props.online) return
    const res = await window.sdraw.net('GET', `/v1/store/search?q=${encodeURIComponent(q)}&category=${encodeURIComponent(category)}`)
    if (res.status === 200) { const d = res.data as { items: Listing[]; total: number }; setItems(d.items); setTotal(d.total) }
    else props.onNotice(errText(res.data), 'error')
  }, [q, category, props.online]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void search() }, [category, props.online]) // eslint-disable-line react-hooks/exhaustive-deps

  const take = (l: Listing) => {
    const id = `store-${l.id}`
    if (props.catalog.some((s) => s.id === id)) return props.onNotice('Mẫu này đã có trong kho')
    props.onChange([...props.catalog, { id, name: l.title, category: l.category, w: l.w, d: l.d, h: l.h, tags: l.tags, styles: l.styles, materials: l.materials, origin: 'store', labeled: true }])
    props.onNotice(l.hasFile ? 'Đã thêm thông số mẫu vào kho. Bấm "Tải file .skp" để lấy file về máy.' : 'Đã thêm thông số mẫu vào kho. Gói này chỉ có thông số, không kèm file .skp.')
  }
  const download = async (l: Listing) => {
    try {
      const file = await window.sdraw.storeDownloadFile(l.id, l.title)
      if (file) props.onNotice(`Đã lưu file vào ${file}. Thêm thư mục chứa file vào Cài đặt, Nguồn dữ liệu để app nhận ra.`)
    } catch (e) { props.onNotice(`Không tải được: ${(e as Error).message}`, 'error') }
  }

  const is3d = (l: Listing) => l.hasFile && (l.fileKind === 'sdraw3d' || l.fileKind === 'glb')
  const open3d = async (l: Listing) => {
    try { const f = await window.sdraw.storeFetch(l.id); props.onOpen3d?.(f) } catch (e) { props.onNotice(`Không mở được: ${(e as Error).message}`, 'error') }
  }
  const fileButton = (l: Listing, cls: string) => !l.hasFile ? null : is3d(l)
    ? <button className={cls} onClick={() => void open3d(l)}>Mở trong Dựng 3D</button>
    : <button className={cls} onClick={() => void download(l)}>Tải file .skp</button>

  if (detail) {
    const l = detail
    return (
      <div className="store-detail">
        <header className="detail-head">
          <button className="btn" onClick={() => setDetail(null)}>← Về Store</button>
          <span className="detail-title">{l.title}</span>
        </header>
        <div className="detail-body">
          <section className="detail-media">
            <Cover id={l.id} has={!!l.hasCover} alt={l.title} large />
            {!l.hasCover ? <div className="detail-placeholder">Gói này chưa có ảnh bìa</div> : null}
          </section>
          <aside className="detail-side">
            <div><h1>{l.title}</h1><span className="muted">{l.category}</span></div>
            <div className="detail-price">Miễn phí <span className="muted">giai đoạn đầu</span></div>
            <div>
              <h2>Trong gói có</h2>
              <ul>
                <li>1 mẫu {l.category.toLowerCase()}{!l.hasFile ? ', chỉ có thông số' : l.fileKind === 'sdraw3d' ? ', kèm mô hình S Draw 3D' : l.fileKind === 'glb' ? ', kèm mô hình GLB' : ', kèm file .skp'}</li>
                <li>Kích thước {l.w} × {l.d} × {l.h} mm</li>
                {[...l.styles, ...l.materials].length > 0 ? <li>Nhãn: {[...l.styles, ...l.materials].join(', ')}</li> : null}
              </ul>
            </div>
            <div>
              <h2>Giấy phép sử dụng</h2>
              <p className="hint">Dùng cho dự án của doanh nghiệp bạn. Không đăng bán lại gói này trên Store.</p>
            </div>
            <div className="notice-card">Sau khi tải về, thêm thư mục chứa file vào Cài đặt, Nguồn dữ liệu để app tự lập chỉ mục và đưa mẫu vào gợi ý của bạn.</div>
            <div className="grow" />
            <button className="btn-cta" onClick={() => take(l)}>Thêm vào kho của tôi</button>
            {fileButton(l, 'btn')}
          </aside>
        </div>
      </div>
    )
  }
  if (listing) return <StoreSellView catalog={props.catalog} onBack={() => { setListing(false); void search() }} onNotice={props.onNotice} />
  if (!props.online) return <div className="page"><h2>Store mẫu</h2><p className="hint">Store cần mạng và tài khoản Socin. Bấm "Ngoại tuyến · Liên kết Socin" ở thanh trên để liên kết.</p></div>
  return (
    <div className="page">
      <h2>Store mẫu <span className="badge">Miễn phí giai đoạn đầu</span></h2>
      <div className="row">
        <input className="grow" value={q} placeholder="Tìm mẫu, ví dụ: sofa chữ L 2m4" onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void search() }} />
        <button className="btn-cta" onClick={() => void search()}>Tìm</button>
        {props.role !== 'staff' ? <button className="btn" onClick={() => setListing(true)}>Đăng mẫu của tôi</button> : null}
      </div>
      <div className="chips">
        {['', ...CATEGORIES].map((c) => <button key={c} className={category === c ? 'chip on' : 'chip'} onClick={() => setCategory(c)}>{c || 'Tất cả'}</button>)}
      </div>
      <p className="muted">{total} mẫu</p>
      <ul className="cards">
        {items.map((l) => (
          <li key={l.id} className="card">
            <Cover id={l.id} has={!!l.hasCover} alt={l.title} />
            <strong>{l.title}</strong>
            <button className="btn-ghost" onClick={() => setDetail(l)}>Xem chi tiết</button>
            <span className="muted">{l.category} · {l.w}×{l.d}×{l.h} mm</span>
            <span className="muted">{[...l.styles, ...l.materials].join(', ')}</span>
            <span className="price">Miễn phí</span>
            <span className="row"><button className="btn" onClick={() => take(l)}>Thêm vào kho</button>{fileButton(l, 'btn-cta')}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

// ---------------------------------------------------------------- chủ cấp quyền nhân viên

interface GrantRow { user_id: string; name: string }

function StaffGrants(props: { onNotice: Notify }) {
  const [rows, setRows] = useState<GrantRow[]>([])
  const [who, setWho] = useState('')
  const load = useCallback(async () => {
    const r = await window.sdraw.net('GET', '/v1/owner/staff')
    const list = (r.data as { staff?: unknown } | null)?.staff
    if (r.status === 200 && Array.isArray(list)) setRows(list as GrantRow[])
  }, [])
  useEffect(() => { void load() }, [load])
  const set = async (id: string, allowed: boolean) => {
    const r = await window.sdraw.net('PUT', `/v1/owner/staff/${encodeURIComponent(id.trim())}`, { allowed, name: id.trim() })
    if (r.status !== 200) return props.onNotice(errText(r.data), 'error')
    props.onNotice(allowed ? `Đã cấp quyền cho ${id.trim()}. Có hiệu lực ở lần đăng nhập kế tiếp của họ.` : `Đã thu quyền của ${id.trim()}`)
    setWho(''); await load()
  }
  return (
    <div className="staff-grants">
      <h4>Nhân viên được dùng Sdraw AI</h4>
      <p className="hint">Nhập tên đăng nhập Socin của nhân viên. Chủ doanh nghiệp luôn được dùng.</p>
      <ul>{rows.map((r) => <li key={r.user_id}>{r.name} <button className="btn danger" onClick={() => void set(r.user_id, false)}>Thu quyền</button></li>)}</ul>
      {rows.length === 0 ? <p className="muted">Chưa cấp cho ai.</p> : null}
      <div className="row">
        <div className="input-wrap"><input aria-label="Tên đăng nhập nhân viên" value={who} placeholder="tên đăng nhập Socin" onChange={(e) => setWho(e.target.value)} /></div>
        <button className="btn" disabled={!who.trim()} onClick={() => void set(who, true)}>Cấp quyền</button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- Cài đặt / đăng nhập

export function SettingsView(props: { settings: Settings; catalog: Sample[]; update: (p: Partial<Settings>) => Promise<Settings>; onNotice: Notify; onCatalog: (c: Sample[]) => void }) {
  const { settings } = props
  const [url, setUrl] = useState(settings.serverUrl)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [tab, setTab] = useState<'staff' | 'data' | 'image' | 'backup' | 'account'>(settings.user ? 'data' : 'account')
  useEffect(() => setUrl(settings.serverUrl), [settings.serverUrl])

  const login = async () => {
    setBusy(true)
    try {
      await props.update({ serverUrl: url })
      const res = await window.sdraw.net('POST', '/v1/auth/login', { username: email, password })
      setPassword('')
      if (res.status !== 200) return props.onNotice(errText(res.data), 'error')
      const d = res.data as { token: string; user: NonNullable<Settings['user']> }
      await props.update({ token: d.token, user: d.user })
      props.onNotice(`Đã đăng nhập: ${d.user.name}`)
    } catch (e) {
      props.onNotice((e as Error).message, 'error')
    } finally { setBusy(false) }
  }
  const sync = async () => {
    if (!settings.user) return
    setBusy(true)
    try {
      const r = await syncIndex(props.catalog, settings.user.businessId)
      props.onNotice(`Đã đồng bộ chỉ mục: ${r.accepted} mục` + (r.rejected ? `, ${r.rejected} bị từ chối` : ''))
    } catch (e) { props.onNotice((e as Error).message, 'error') } finally { setBusy(false) }
  }
  const withdraw = async () => {
    const res = await window.sdraw.net('DELETE', '/v1/index')
    props.onNotice(res.status === 200 ? `Đã rút ${(res.data as { deleted: number }).deleted} mục khỏi hệ thống chung` : errText(res.data), res.status === 200 ? 'ok' : 'error')
  }

  return (
    <div className="page settings">
      <h2>Cài đặt</h2>
      <div className="tabs" role="tablist" aria-label="Mục cài đặt">
        {([['staff', 'Nhân viên và quyền'], ['data', 'Nguồn dữ liệu'], ['image', 'Tạo ảnh'], ['backup', 'Sao lưu'], ['account', 'Tài khoản']] as const).map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'tab on' : 'tab'} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>
      {tab === 'account' ? <section>
        <h3>Máy chủ Sdraw AI</h3>
        <div className="field"><label htmlFor="srv">Địa chỉ máy chủ</label><div className="input-wrap"><input id="srv" value={url} placeholder="https://sdraw.example.com" onChange={(e) => setUrl(e.target.value)} /></div></div>
        {settings.user ? (
          <>
            <p>Đang đăng nhập: <strong>{settings.user.name}</strong> · vai trò {settings.user.role === 'admin' ? 'admin' : settings.user.role === 'owner' ? 'chủ doanh nghiệp' : 'nhân viên'}</p>
            <div className="row">
              <button className="btn danger" onClick={() => void props.update({ token: '', user: null, offlineChosen: false })}>Đăng xuất</button>
            </div>
          </>
        ) : (
          <>
            <p className="hint">Đăng nhập bằng tài khoản Socin (tên đăng nhập và mật khẩu như ở app.socin.org). Nhân viên cần được chủ doanh nghiệp cấp quyền dùng Sdraw AI.</p>
            <div className="field"><label htmlFor="em">Tên đăng nhập Socin</label><div className="input-wrap"><input id="em" type="text" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} /></div></div>
            <div className="field"><label htmlFor="pw">Mật khẩu</label><div className="input-wrap"><input id="pw" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void login() }} /></div></div>
            <button className="btn-cta" disabled={busy || !url || !email || !password} onClick={() => void login()}>Đăng nhập</button>
          </>
        )}
      </section> : null}
      {tab === 'staff' ? <section>
        <h3>Nhân viên và quyền</h3>
        {settings.user && settings.user.role !== 'staff' ? <StaffGrants onNotice={props.onNotice} /> : <p className="hint">{settings.user ? 'Chỉ chủ doanh nghiệp hoặc admin cấp được quyền cho nhân viên.' : 'Đăng nhập ở tab Tài khoản để quản lý nhân viên.'}</p>}
      </section> : null}
      {tab === 'backup' ? <section>
        <h3>Sao lưu trên máy</h3>
        <p>Xuất toàn bộ kho mẫu và danh sách dự án ra một file .json để cất giữ, hoặc khôi phục từ file đã xuất. Khôi phục chỉ thêm mục còn thiếu, không xoá hay ghi đè dữ liệu đang có.</p>
        <div className="row">
          <button className="btn-cta" onClick={() => void (async () => {
            try {
              const r = await window.sdraw.backupExport()
              if (r) props.onNotice(`Đã sao lưu ${r.samples} mẫu và ${r.projects} dự án vào ${r.file}`)
            } catch (e) { props.onNotice(`Không sao lưu được: ${(e as Error).message}`, 'error') }
          })()}>Sao lưu ngay</button>
          <button className="btn" onClick={() => void (async () => {
            try {
              const r = await window.sdraw.backupRestore()
              if (r) {
                props.onCatalog(await window.sdraw.loadCatalog())
                props.onNotice(`Đã khôi phục thêm ${r.samples} mẫu và ${r.projects} dự án`)
              }
            } catch (e) { props.onNotice(`Không khôi phục được: ${(e as Error).message}`, 'error') }
          })()}>Khôi phục từ file…</button>
        </div>
      </section> : null}
      {tab === 'backup' ? <ServerBackup settings={settings} update={props.update} onCatalog={props.onCatalog} onNotice={props.onNotice} /> : null}
      {tab === 'data' ? <SourcesPanel settings={settings} catalog={props.catalog} update={props.update} onCatalog={props.onCatalog} onNotice={props.onNotice} /> : null}
      {tab === 'image' ? <ImagePanel settings={settings} update={props.update} onNotice={props.onNotice} /> : null}
      {tab === 'data' ? <section>
        <h3>Đồng bộ chỉ mục</h3>
        {settings.user ? (
          <div className="row">
            <button className="btn" disabled={busy} onClick={() => void sync()}>Đồng bộ chỉ mục ngay</button>
            <button className="btn" onClick={() => void withdraw()}>Rút chỉ mục khỏi hệ thống chung</button>
          </div>
        ) : <p className="hint">Đăng nhập ở tab Tài khoản để đồng bộ.</p>}
      </section> : null}
      {tab === 'data' ? <section>
        <h3>Dữ liệu và quyền riêng tư</h3>
        <p>Hệ thống AI tự động học từ dữ liệu và hành vi để nâng cấp dài hạn. Chỉ gửi <strong>chỉ mục ẩn danh</strong>: loại, kích thước, nhãn, thông số. Không gửi tên mẫu, đường dẫn, giá, ảnh hay file .skp. Dữ liệu của doanh nghiệp nào được giữ riêng cho doanh nghiệp đó; chỉ admin có toàn quyền.</p>
        <p className="hint">Kho mẫu riêng luôn dùng được khi mất mạng. Gợi ý từ hệ thống chung, hiểu yêu cầu bằng AI, Store và tạo ảnh cần mạng.</p>
      </section> : null}
    </div>
  )
}

interface PendingRow { id: string; title: string; category: string; fileName: string | null; fileSize: number; description: string }

function PendingListings(props: { onNotice: Notify }) {
  const [rows, setRows] = useState<PendingRow[]>([])
  const [reason, setReason] = useState<Record<string, string>>({})
  const load = useCallback(async () => {
    const r = await window.sdraw.net('GET', '/v1/admin/listings')
    if (r.status === 200) setRows((r.data as { items: PendingRow[] }).items)
  }, [])
  useEffect(() => { void load() }, [load])
  const review = async (m: PendingRow, approve: boolean) => {
    const r = await window.sdraw.net('POST', `/v1/admin/listings/${m.id}/review`, { approve, reason: reason[m.id] ?? '' })
    props.onNotice(r.status === 200 ? (approve ? `Đã duyệt "${m.title}"` : `Đã từ chối "${m.title}"`) : errText(r.data), r.status === 200 ? 'ok' : 'error')
    await load()
  }
  const open = async (m: PendingRow) => {
    try { const f = await window.sdraw.storeDownloadFile(m.id, m.title); if (f) props.onNotice(`Đã lưu file để xem xét: ${f}`) } catch (e) { props.onNotice((e as Error).message, 'error') }
  }
  return (
    <>
      <h3>Gói Store chờ duyệt ({rows.length})</h3>
      {rows.length === 0 ? <p className="hint">Không có gói nào chờ duyệt.</p> : null}
      <ul className="cards">
        {rows.map((m) => (
          <li key={m.id} className="card">
            <strong>{m.title}</strong>
            <span className="muted">{m.category} · {m.fileName} ({(m.fileSize / 1048576).toFixed(1)} MB)</span>
            <span className="muted">{m.description || 'Không có mô tả'}</span>
            <div className="field"><label htmlFor={`rs-${m.id}`}>Lý do (bắt buộc khi từ chối)</label><div className="input-wrap"><input id={`rs-${m.id}`} value={reason[m.id] ?? ''} onChange={(e) => setReason({ ...reason, [m.id]: e.target.value })} /></div></div>
            <span className="row">
              <button className="btn" onClick={() => void open(m)}>Tải file xem xét</button>
              <button className="btn-cta" onClick={() => void review(m, true)}>Duyệt</button>
              <button className="btn" onClick={() => void review(m, false)}>Từ chối</button>
            </span>
          </li>
        ))}
      </ul>
    </>
  )
}

// ---------------------------------------------------------------- Admin: gắn nhãn

export function AdminView(props: { onNotice: Notify }) {
  const [queue, setQueue] = useState<IndexEntry[]>([])
  const [stats, setStats] = useState<{ total: number; labeled: number; businesses: number } | null>(null)
  const load = useCallback(async () => {
    const [q, s] = await Promise.all([window.sdraw.net('GET', '/v1/admin/queue'), window.sdraw.net('GET', '/v1/admin/stats')])
    if (q.status === 200) setQueue((q.data as { items: IndexEntry[] }).items)
    else props.onNotice(errText(q.data), 'error')
    if (s.status === 200) setStats(s.data as typeof stats)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void load() }, [load])
  const save = async (e: IndexEntry, p: { category: string; tags: string; w: number; d: number; h: number }) => {
    const res = await window.sdraw.net('PUT', `/v1/admin/labels/${e.key}`, { category: p.category, tags: p.tags.split(',').map((x) => x.trim()).filter(Boolean), w: p.w, d: p.d, h: p.h })
    if (res.status === 200) { setQueue((l) => l.filter((x) => x.key !== e.key)); props.onNotice('Đã gắn nhãn') } else props.onNotice(errText(res.data), 'error')
  }
  return (
    <div className="page">
      <h2>Gắn nhãn bộ mẫu kiểm chứng</h2>
      {stats ? <p className="muted">{stats.total} mục từ {stats.businesses} doanh nghiệp, đã gắn nhãn {stats.labeled}.</p> : null}
      {queue.length === 0 ? <p className="hint">Không còn mục nào chờ gắn nhãn.</p> : null}
      <PendingListings onNotice={props.onNotice} />
      <FilterEditor onNotice={props.onNotice} />
      <h3>Hàng chờ gắn nhãn</h3>
      <ul className="cards">{queue.map((e) => <LabelCard key={e.key} entry={e} onSave={(p) => void save(e, p)} />)}</ul>
    </div>
  )
}

function LabelCard(props: { entry: IndexEntry; onSave: (p: { category: string; tags: string; w: number; d: number; h: number }) => void }) {
  const e = props.entry
  const [category, setCategory] = useState(e.category)
  const [tags, setTags] = useState(e.tags.join(', '))
  const [w, setW] = useState(e.w); const [d, setD] = useState(e.d); const [h, setH] = useState(e.h)
  const num = (set: (n: number) => void) => (ev: React.ChangeEvent<HTMLInputElement>) => set(Math.round(Number(ev.target.value) || 0))
  return (
    <li className="card">
      <select value={category} onChange={(ev) => setCategory(ev.target.value)}>{[...new Set([e.category, ...CATEGORIES])].map((c) => <option key={c}>{c}</option>)}</select>
      <input value={tags} onChange={(ev) => setTags(ev.target.value)} placeholder="Nhãn, cách nhau bằng dấu phẩy" />
      <div className="row"><input value={w} onChange={num(setW)} aria-label="Rộng" /><input value={d} onChange={num(setD)} aria-label="Sâu" /><input value={h} onChange={num(setH)} aria-label="Cao" /></div>
      <button className="btn-cta" onClick={() => props.onSave({ category, tags, w, d, h })}>Xác nhận nhãn</button>
    </li>
  )
}

/** Bộ lọc loại dữ liệu: doanh nghiệp được nhận loại mẫu nào từ doanh nghiệp khác. */
function FilterEditor(props: { onNotice: Notify }) {
  const [list, setList] = useState<{ businessId: string; receiveShared: boolean; categories: string[] }[]>([])
  const [biz, setBiz] = useState('')
  const [receive, setReceive] = useState(true)
  const [cats, setCats] = useState('')
  const load = useCallback(async () => {
    const r = await window.sdraw.net('GET', '/v1/admin/filters')
    if (r.status === 200) setList((r.data as { items: typeof list }).items)
  }, [])
  useEffect(() => { void load() }, [load])
  const save = async () => {
    const res = await window.sdraw.net('PUT', `/v1/admin/filters/${encodeURIComponent(biz.trim())}`, {
      receiveShared: receive, categories: cats.split(',').map((x) => x.trim()).filter(Boolean)
    })
    if (res.status === 200) { props.onNotice('Đã lưu bộ lọc'); void load() } else props.onNotice(errText(res.data), 'error')
  }
  return (
    <section>
      <h3>Bộ lọc dữ liệu theo doanh nghiệp</h3>
      <p className="hint">Mặc định mọi doanh nghiệp nhận mọi loại. Ở đây bạn giới hạn loại mẫu (ví dụ Sofa, Bàn trà) mà doanh nghiệp được nhận từ doanh nghiệp khác. Dữ liệu của chính doanh nghiệp luôn thấy.</p>
      <div className="row">
        <input value={biz} onChange={(e) => setBiz(e.target.value)} placeholder="Mã doanh nghiệp" aria-label="Mã doanh nghiệp" />
        <label className="check"><input type="checkbox" checked={receive} onChange={(e) => setReceive(e.target.checked)} /> Nhận dữ liệu chung</label>
        <input className="grow" value={cats} onChange={(e) => setCats(e.target.value)} placeholder="Loại được nhận, cách nhau dấu phẩy (trống = mọi loại)" aria-label="Loại được nhận" disabled={!receive} />
        <button className="btn-cta" disabled={!biz.trim()} onClick={() => void save()}>Lưu</button>
      </div>
      <ul className="filters">
        {list.map((f) => (
          <li key={f.businessId}><button className="link" onClick={() => { setBiz(f.businessId); setReceive(f.receiveShared); setCats(f.categories.join(', ')) }}>{f.businessId}</button>
            {' '}{f.receiveShared ? (f.categories.length ? f.categories.join(', ') : 'mọi loại') : 'không nhận'}</li>
        ))}
      </ul>
    </section>
  )
}

interface BackupRow { id: number; createdAt: number; size: number; samples: number; projects: number }

/** Sao lưu lên máy chủ: thủ công hoặc tự động mỗi ngày. Chỉ chủ doanh nghiệp; server giữ 5 bản mới nhất và chỉ doanh nghiệp đó đọc được. */
function ServerBackup(props: { settings: Settings; update: (p: Partial<Settings>) => Promise<Settings>; onCatalog: (c: Sample[]) => void; onNotice: (t: string, tone?: 'ok' | 'error') => void }) {
  const { settings } = props
  const [rows, setRows] = useState<BackupRow[] | null>(null)
  const [busy, setBusy] = useState(false)
  const canUse = !!settings.user && settings.user.role !== 'staff'

  const load = useCallback(async () => {
    try { setRows(await window.sdraw.backupList()) } catch { setRows(null) }
  }, [])
  useEffect(() => { if (settings.user) void load() }, [settings.user, load])

  async function run(job: () => Promise<string>) {
    setBusy(true)
    try { props.onNotice(await job()) } catch (e) { props.onNotice((e as Error).message, 'error') } finally { setBusy(false) }
  }

  return (
    <section>
      <h3>Sao lưu lên máy chủ</h3>
      {!settings.user ? <p className="hint">Đăng nhập ở tab Tài khoản để sao lưu lên máy chủ.</p>
        : !canUse ? <p className="hint">Chỉ chủ doanh nghiệp hoặc admin sao lưu và khôi phục từ máy chủ được.</p>
        : <>
          <p>Gửi kho mẫu và dự án lên máy chủ của doanh nghiệp bạn. Ảnh nền phác thảo không được gửi. Máy chủ giữ 5 bản mới nhất, chỉ doanh nghiệp của bạn đọc được.</p>
          <div className="row">
            <button className="btn-cta" disabled={busy} onClick={() => void run(async () => {
              const r = await window.sdraw.backupPush()
              await load(); await props.update({})
              return `Đã sao lưu ${r.samples} mẫu và ${r.projects} dự án lên máy chủ`
            })}>Sao lưu lên máy chủ</button>
          </div>
          <Switch label="Tự sao lưu mỗi ngày khi mở app" on={settings.autoBackup} onChange={(v) => void props.update({ autoBackup: v })} />
          <p className="hint">{settings.lastBackupAt ? `Lần gần nhất: ${new Date(settings.lastBackupAt).toLocaleString('vi-VN')}` : 'Chưa sao lưu lên máy chủ lần nào.'}</p>
          {rows && rows.length > 0 ? (
            <table className="lib-table">
              <thead><tr><th>Thời gian</th><th>Mẫu</th><th>Dự án</th><th>Dung lượng</th><th /></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>{new Date(r.createdAt).toLocaleString('vi-VN')}</td><td>{r.samples}</td><td>{r.projects}</td><td>{(r.size / 1024).toFixed(0)} KB</td>
                    <td><button className="btn" disabled={busy} onClick={() => void run(async () => {
                      const x = await window.sdraw.backupPull(r.id)
                      props.onCatalog(await window.sdraw.loadCatalog())
                      return `Đã khôi phục thêm ${x.samples} mẫu và ${x.projects} dự án`
                    })}>Khôi phục</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className="hint">Chưa có bản sao lưu trên máy chủ.</p>}
        </>}
    </section>
  )
}
