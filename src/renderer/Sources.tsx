import { useEffect, useRef, useState } from 'react'
import { syncIndex } from './Panels'
import { samplesFromScan } from '@core/catalog'
import type { Sample } from '@core/types'
import type { ImageProvider, Settings, SourceFolder } from '../preload/api'

type Notify = (text: string, tone?: 'ok' | 'error') => void
type Update = (p: Partial<Settings>) => Promise<Settings>

export function Switch(props: { on: boolean; label: string; onChange: (v: boolean) => void }) {
  return (
    <div className="switch-row">
      <span>{props.label}</span>
      <button role="switch" aria-checked={props.on} aria-label={props.label} className={props.on ? 'switch on' : 'switch'} onClick={() => props.onChange(!props.on)}><span /></button>
    </div>
  )
}

export function SourcesPanel(props: { settings: Settings; catalog: Sample[]; update: Update; onCatalog: (c: Sample[]) => void; onNotice: Notify }) {
  const { settings } = props
  const [busy, setBusy] = useState<string | null>(null)
  const [progress, setProgress] = useState<{ found: number; dirs: number } | null>(null)
  useEffect(() => window.sdraw.onScanProgress((p) => setProgress({ found: p.found, dirs: p.dirs })), [])
  const catalogRef = useRef(props.catalog)
  catalogRef.current = props.catalog

  const index = async (f: SourceFolder, quiet = false): Promise<SourceFolder> => {
    setBusy(f.path)
    try {
      const res = await window.sdraw.scanPath(f.path)
      if (!res) return f
      const added = samplesFromScan(res.paths, catalogRef.current)
      if (added.length) { catalogRef.current = [...catalogRef.current, ...added]; props.onCatalog(catalogRef.current) }
      if (!quiet) props.onNotice(`${f.name}: ${res.paths.length} file .skp, thêm ${added.length} mẫu mới` + (res.truncated ? ' (đã dừng ở giới hạn)' : ''))
      return { ...f, lastScan: Date.now(), count: res.paths.length }
    } catch (e) {
      if (!quiet) props.onNotice(`Không quét được ${f.name}: ${(e as Error).message}`, 'error')
      return f
    } finally { setBusy(null); setProgress(null) }
  }

  const add = async () => {
    const res = await window.sdraw.scanFolder()
    if (!res) return
    if (settings.folders.some((f) => f.path === res.folder)) { props.onNotice('Thư mục này đã có trong danh sách'); return }
    const name = res.folder.split(/[\\/]/).filter(Boolean).pop() ?? res.folder
    const added = samplesFromScan(res.paths, catalogRef.current)
    if (added.length) props.onCatalog([...catalogRef.current, ...added])
    await props.update({ folders: [...settings.folders, { path: res.folder, name, lastScan: Date.now(), count: res.paths.length }] })
    props.onNotice(`Đã thêm ${name}: ${res.paths.length} file .skp, ${added.length} mẫu mới`)
  }
  const reindex = async (f: SourceFolder) => {
    const nf = await index(f)
    await props.update({ folders: settings.folders.map((x) => (x.path === f.path ? nf : x)) })
  }
  const remove = async (f: SourceFolder) => {
    await props.update({ folders: settings.folders.filter((x) => x.path !== f.path) })
    props.onNotice(`Đã gỡ ${f.name} khỏi danh sách. Mẫu và file .skp được giữ nguyên.`)
  }

  return (
    <>
      <section>
        <h3>Thư mục đầu vào</h3>
        <p className="hint">Thêm các thư mục chứa mẫu .skp. App lập chỉ mục lại khi mở. File gốc ở nguyên trong thư mục của bạn; gỡ thư mục chỉ bỏ khỏi danh sách theo dõi.</p>
        <div className="row"><button className="btn-cta" onClick={() => void add()}>+ Thêm thư mục</button></div>
        {settings.folders.length === 0 ? <p className="hint">Chưa có thư mục nào được theo dõi.</p> : null}
        <ul className="cards">
          {settings.folders.map((f) => (
            <li key={f.path} className="card">
              <strong>{f.name}</strong>
              <span className="muted">{f.path}</span>
              <span className="muted">{f.count} file .skp · {f.lastScan ? `quét lúc ${new Date(f.lastScan).toLocaleString('vi-VN')}` : 'chưa quét'}</span>
              <span className="row">
                <button className="btn" disabled={busy !== null} onClick={() => void reindex(f)}>{busy === f.path ? (progress ? `Đang quét… ${progress.found} file` : 'Đang quét…') : 'Lập chỉ mục ngay'}</button>
                {busy === f.path ? <button className="btn" onClick={() => void window.sdraw.scanCancel()}>Dừng</button> : null}
                <button className="btn-ghost danger" onClick={() => void remove(f)}>Gỡ</button>
              </span>
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h3>Tự động hoá</h3>
        <Switch label="Tự phát hiện file mới khi mở app" on={settings.autoDetect} onChange={(v) => void props.update({ autoDetect: v })} />
        <Switch label="Tự lập chỉ mục khi có file mới" on={settings.autoIndex} onChange={(v) => void props.update({ autoIndex: v })} />
        <Switch label="Tự đồng bộ chỉ mục lên VPS" on={settings.autoSync} onChange={(v) => void props.update({ autoSync: v })} />
        <Switch label="Theo dõi thư mục khi app đang mở" on={settings.autoWatch} onChange={(v) => void props.update({ autoWatch: v })} />
        <p className="hint">Khi theo dõi, file .skp mới hoặc đổi trong thư mục được lập chỉ mục sau vài giây. Hệ thống không theo dõi được thì app vẫn quét khi mở hoặc khi bấm lập chỉ mục. Đồng bộ chỉ chạy khi có mạng và đã đăng nhập.</p>
      </section>
    </>
  )
}

const PROVIDERS: { id: ImageProvider; title: string; note: string }[] = [
  { id: 'socin', title: 'Dịch vụ tạo ảnh qua máy chủ Socin', note: 'Hợp với văn phòng dùng Windows, máy nhân viên không cần card đồ hoạ mạnh. Khoá API nằm trên máy chủ. Cần mạng.' },
  { id: 'lan', title: 'Máy chủ trong văn phòng (Windows, card NVIDIA)', note: 'Chạy Stable Diffusion WebUI (bật --api, cổng mặc định 7860) trên một máy mạnh, các máy khác gọi qua mạng nội bộ. Dữ liệu không ra ngoài.' },
  { id: 'drawthings', title: 'Draw Things trên Mac', note: 'Chỉ dùng khi văn phòng có Mac Apple Silicon. Bật máy chủ HTTP trong Draw Things (cổng mặc định 7860).' }
]

export function ImagePanel(props: { settings: Settings; update: Update; onNotice: Notify }) {
  const img = props.settings.image
  const set = (p: Partial<Settings['image']>) => void props.update({ image: { ...img, ...p } })
  return (
    <section>
      <h3>Ảnh minh hoạ tạo ở đâu?</h3>
      <p className="hint">Nơi tạo ảnh chỉ nhận ảnh khung đường nét và câu mô tả. File .skp, giá, tên khách hàng và bảng kê không bao giờ được gửi đi.</p>
      <div className="tpl-grid" role="radiogroup" aria-label="Nơi tạo ảnh">
        {PROVIDERS.map((p) => (
          <button key={p.id} role="radio" aria-checked={img.provider === p.id} className={img.provider === p.id ? 'tpl on' : 'tpl'} onClick={() => set({ provider: p.id })}>
            <strong>{p.title}</strong>
            <span className="muted">{p.note}</span>
          </button>
        ))}
      </div>
      {img.provider === 'socin' ? (
        <div className="field"><label htmlFor="lim">Giới hạn ảnh mỗi tháng</label><div className="input-wrap"><input id="lim" type="number" min={0} value={img.monthlyLimit} onChange={(e) => set({ monthlyLimit: Number(e.target.value) })} /></div></div>
      ) : null}
      {img.provider === 'lan' ? (
        <div className="row">
          <div className="field"><label htmlFor="lh">Địa chỉ máy chủ</label><div className="input-wrap"><input id="lh" placeholder="http://192.168.1.20" value={img.lanHost} onChange={(e) => set({ lanHost: e.target.value })} /></div></div>
          <div className="field"><label htmlFor="lp">Cổng</label><div className="input-wrap"><input id="lp" type="number" value={img.lanPort} onChange={(e) => set({ lanPort: Number(e.target.value) })} /></div></div>
        </div>
      ) : null}
      <Switch label="Cho nhân viên tạo ảnh" on={img.staffAllowed} onChange={(v) => set({ staffAllowed: v })} />
      <Switch label={'Đóng dấu "Ảnh minh hoạ AI" lên ảnh xuất cho khách'} on={img.watermark} onChange={(v) => set({ watermark: v })} />
      <p className="hint">Draw Things và máy trong văn phòng gọi trực tiếp từ máy này, không đi qua máy chủ Socin. Dịch vụ qua máy chủ Socin cần máy chủ có máy GPU (IMAGE_WORKER_URL). Ảnh AI chỉ để minh hoạ; không dùng ảnh mẫu của doanh nghiệp khác trên Store làm ảnh tham chiếu khi chưa được phép.</p>
    </section>
  )
}

/** Khi mở app (một lần, sau khi nạp cài đặt và kho mẫu): lập chỉ mục lại thư mục đã thêm và đồng bộ nếu bật. */
export function useAutoIndex(ready: boolean, loaded: boolean, settings: Settings, catalog: Sample[], update: Update, onCatalog: (c: Sample[]) => void): void {
  const done = useRef(false)
  useEffect(() => {
    if (!ready || !loaded || done.current) return
    done.current = true
    if (!settings.autoDetect || !settings.autoIndex || settings.folders.length === 0) return
    void (async () => {
      let cat = catalog
      const next: SourceFolder[] = []
      for (const f of settings.folders) {
        try {
          const res = await window.sdraw.scanPath(f.path)
          if (!res) { next.push(f); continue }
          const added = samplesFromScan(res.paths, cat)
          if (added.length) { cat = [...cat, ...added]; onCatalog(cat) }
          next.push({ ...f, lastScan: Date.now(), count: res.paths.length })
        } catch { next.push(f) }
      }
      await update({ folders: next })
      if (settings.autoSync && settings.token && settings.user) {
        try { await syncIndex(cat, settings.user.businessId) } catch { /* mất mạng: bỏ qua, lần sau đồng bộ */ }
      }
    })()
  }, [ready, loaded]) // eslint-disable-line react-hooks/exhaustive-deps
}

/** Có thay đổi trong thư mục nguồn khi app đang mở: lập chỉ mục lại thư mục đó và thêm mẫu mới. */
export function useFolderWatch(settings: Settings, catalog: Sample[], update: Update, onCatalog: (c: Sample[]) => void, notify: Notify): void {
  const ref = useRef({ settings, catalog })
  ref.current = { settings, catalog }
  useEffect(() => window.sdraw.onFolderChanged(({ folder }) => {
    const cur = ref.current
    if (!cur.settings.autoDetect || !cur.settings.autoIndex || !cur.settings.autoWatch) return
    const f = cur.settings.folders.find((x) => x.path === folder)
    if (!f) return
    void (async () => {
      try {
        const res = await window.sdraw.scanPath(f.path)
        if (!res) return
        const added = samplesFromScan(res.paths, ref.current.catalog)
        if (added.length) {
          onCatalog([...ref.current.catalog, ...added])
          notify(`${f.name}: tự thêm ${added.length} mẫu mới`)
        }
        await update({ folders: ref.current.settings.folders.map((x) => (x.path === f.path ? { ...x, lastScan: Date.now(), count: res.paths.length } : x)) })
      } catch { /* bỏ qua, lần quét sau sẽ thấy */ }
    })()
  }), []) // eslint-disable-line react-hooks/exhaustive-deps
}
