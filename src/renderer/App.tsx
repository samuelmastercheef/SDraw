import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { applyOps, patchItem } from '@core/commands'
import { findFreeSpot, findIssues } from '@core/geometry'
import { autoLayout } from '@core/autolayout'
import type { Sample } from '@core/types'
import { BomPanel } from './Bom'
import { EditAssist } from './EditAssist'
import { Canvas } from './Canvas'
import { Inspector } from './Inspector'
import { LibraryPanel } from './LibraryPanel'
import { LibraryView } from './LibraryView'
import { ChatView } from './Chat'
import { LoginScreen } from './Login'
import { AdminView, ImportPanel, SettingsView, StoreView, syncIndex, useSettings } from './Panels'
import { SketchEditor } from './Sketch'
import { newSketchFor } from '@core/furniture'
import { sketchSize, withoutUnderlay } from '@core/shapes'
import { indexKey } from '@core/indexing'
import { recordPick } from '@core/suggest'
import { sketchToSample } from '@core/sofa'
import { sketchToSvg } from '@core/shapes'
import { useAutoIndex, useFolderWatch } from './Sources'
import { ProjectsView } from './Projects'
import { ExportView } from './Export'
import { View3D } from './View3D'
import { Model3DView } from './Model3D'
import { ImportPlanView } from './ImportPlan'
import { useStore, type View } from './store'
import { startAiBridge } from './aiBridge'
import { sendToModel3d } from './model3dInbox'
import type { PlanInfo } from '@core/plan'

const NUDGE_MM = 50

const NAV: { view: View; label: string; d: string; admin?: boolean }[] = [
  { view: 'projects', label: 'Dự án', d: 'M3 6h7l2 2h9v11H3z' },
  { view: 'importplan', label: 'Nhập mặt bằng', d: 'M4 4h16v16H4zM4 12h8v8M12 4v8' },
  { view: 'chat', label: 'Chat thiết kế', d: 'M4 5h16v11H9l-5 4z' },
  { view: 'layout', label: 'Bố cục phòng', d: 'M3 5h18v14H3zM3 9h18M9 9v10' },
  { view: 'library', label: 'Thư viện mẫu', d: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z' },
  { view: 'model3d', label: 'Dựng 3D', d: 'M4 17V7l8-4 8 4v10l-8 4zM4 7l8 4 8-4M12 11v10M15 2v4M13 4h4' },
  { view: 'view3d', label: 'Xem 3D', d: 'M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 12l8-4.5M12 12v9M12 12L4 7.5' },
  { view: 'sketch', label: 'Phác thảo', d: 'M4 20l4-1L19 8l-3-3L5 16zM14 7l3 3' },
  { view: 'export', label: 'Xuất', d: 'M12 3v12M7 8l5-5 5 5M4 17v4h16v-4' },
  { view: 'store', label: 'Store', d: 'M6 7h12l1 13H5zM9 7a3 3 0 0 1 6 0' },
  { view: 'admin', label: 'Gắn nhãn', d: 'M4 4h8l8 8-8 8-8-8z', admin: true },
  { view: 'settings', label: 'Cài đặt', d: 'M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zM12 2v3M12 19v3M2 12h3M19 12h3' }
]

export function App() {
  const [state, dispatch] = useStore()
  // Lệnh từ AI (cổng MCP) chạy trong màn Dựng 3D: tự mở màn đó khi cần
  useEffect(() => startAiBridge(() => dispatch({ type: 'view', view: 'model3d' })), [dispatch])
  const { history, selectedId, catalog, view, notice } = state
  const doc = history.present
  const loaded = useRef(false)
  const { settings, update: updateSettings, online, ready: settingsReady } = useSettings()
  const [catReady, setCatReady] = useState(false)
  const [importing, setImporting] = useState(false)
  const [showPlan, setShowPlan] = useState(true)
  // Hai chế độ: ngoại tuyến (nhớ lựa chọn) hoặc liên kết tài khoản Socin. linking: đang mở màn đăng nhập từ chế độ ngoại tuyến.
  const [linking, setLinking] = useState(false)
  const [plan, setPlan] = useState<PlanInfo | null>(null)
  useEffect(() => {
    if (!online) { setPlan(null); return }
    setLinking(false)
    void window.sdraw.net('GET', '/v1/me').then((r) => {
      if (r.status === 200) setPlan((r.data as { plan?: PlanInfo }).plan ?? null)
      // Phiên hết hạn: về màn đăng nhập, giữ dữ liệu trên máy
      else if (r.status === 401) void updateSettings({ token: '', user: null })
    })
  }, [online]) // eslint-disable-line react-hooks/exhaustive-deps
  const [storeQuery, setStoreQuery] = useState('')
  const isAdmin = settings.user?.role === 'admin'

  const notify = useCallback(
    (text: string, tone: 'ok' | 'error' = 'ok') => dispatch({ type: 'notice', notice: { text, tone } }),
    [dispatch]
  )

  // Nạp kho mẫu một lần; sau đó mỗi thay đổi được ghi lại.
  useEffect(() => {
    void window.sdraw.loadCatalog().then((c) => {
      dispatch({ type: 'catalog', catalog: c })
      loaded.current = true
      setCatReady(true)
    })
  }, [dispatch])

  useAutoIndex(settingsReady, catReady, settings, catalog, updateSettings, (c) => dispatch({ type: 'catalog', catalog: c }))
  useFolderWatch(settings, catalog, updateSettings, (c) => dispatch({ type: 'catalog', catalog: c }), notify)

  useEffect(() => {
    if (!loaded.current) return
    const t = setTimeout(() => {
      window.sdraw.saveCatalog(catalog).catch((e: Error) => notify(`Không lưu được kho mẫu: ${e.message}`, 'error'))
    }, 400)
    return () => clearTimeout(t)
  }, [catalog, notify])

  // Học chung mặc định bật: sau khi đăng nhập và khi kho đổi, gửi chỉ mục ẩn danh (chỉ thông số và nhãn).
  useEffect(() => {
    if (!online || !settings.user || !loaded.current || catalog.length === 0) return
    const t = setTimeout(() => {
      syncIndex(catalog, settings.user!.businessId).catch(() => { /* mất mạng: lần sau */ })
    }, 5000)
    return () => clearTimeout(t)
  }, [catalog, online, settings.user])

  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => dispatch({ type: 'notice', notice: null }), 5000)
    return () => clearTimeout(t)
  }, [notice, dispatch])

  const issues = useMemo(() => findIssues(doc), [doc])
  const selected = doc.items.find((i) => i.id === selectedId) ?? null
  const dirty = doc !== state.saved

  const addSample = (sample: Sample) => {
    const spot = findFreeSpot(doc, { w: sample.w, d: sample.d })
    const res = applyOps(doc, [{ op: 'add', sample, cx: spot.cx, cy: spot.cy }])
    dispatch({ type: 'edit', doc: res.doc })
    const added = res.doc.items[res.doc.items.length - 1]
    if (added) dispatch({ type: 'select', id: added.id })
  }

  const save = async (asNew: boolean) => {
    try {
      const path = await window.sdraw.saveDoc(doc, asNew ? null : state.path)
      if (path) {
        dispatch({ type: 'markSaved', path })
        notify(`Đã lưu ${path}`)
      }
    } catch (e) {
      notify(`Không lưu được: ${(e as Error).message}`, 'error')
    }
  }

  const open = async () => {
    try {
      const res = await window.sdraw.openDoc()
      if (res) dispatch({ type: 'loadDoc', doc: res.doc, path: res.path })
    } catch (e) {
      notify((e as Error).message, 'error')
    }
  }

  const exportWith = async (fn: () => Promise<string | null>) => {
    try {
      const file = await fn()
      if (file) notify(`Đã xuất ${file}`)
    } catch (e) {
      notify(`Không xuất được: ${(e as Error).message}`, 'error')
    }
  }

  // Phím tắt: Ctrl/Cmd+Z, Y, S; Delete; phím mũi tên dịch 50 mm.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return
      const mod = e.ctrlKey || e.metaKey
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        dispatch({ type: e.shiftKey ? 'redo' : 'undo' })
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        dispatch({ type: 'redo' })
      } else if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void save(e.shiftKey)
      } else if (selected && (e.key === 'Delete' || e.key === 'Backspace')) {
        e.preventDefault()
        dispatch({ type: 'edit', doc: { ...doc, items: doc.items.filter((i) => i.id !== selected.id) } })
        dispatch({ type: 'select', id: null })
      } else if (selected && e.key.startsWith('Arrow')) {
        e.preventDefault()
        const dx = e.key === 'ArrowLeft' ? -NUDGE_MM : e.key === 'ArrowRight' ? NUDGE_MM : 0
        const dy = e.key === 'ArrowUp' ? -NUDGE_MM : e.key === 'ArrowDown' ? NUDGE_MM : 0
        dispatch({ type: 'edit', doc: patchItem(doc, selected.id, { cx: selected.cx + dx, cy: selected.cy + dy }) })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <div className="app">
      {settingsReady && !settings.user && (!settings.offlineChosen || linking)
        ? <LoginScreen settings={settings} update={updateSettings} linking={linking} onOffline={() => { setLinking(false); void updateSettings({ offlineChosen: true }) }} />
        : null}
      <nav className="rail" aria-label="Điều hướng">
        <div className="logo" aria-label="Sdraw AI">
          <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true">
            <path d="M4 4h16a3 3 0 0 1 3 3v9a3 3 0 0 1-3 3h-8l-5 4v-4H4a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3z" fill="#2FB4C4" />
            <text x="12" y="16" textAnchor="middle" fontSize="11" fontWeight="800" fill="#0D1B2A">S</text>
            <circle cx="22" cy="4" r="3.4" fill="#FFB020" />
          </svg>
          <span>Sdraw AI</span>
        </div>
        {NAV.filter((n) => !n.admin || isAdmin).map((n) => (
          <button key={n.view} className={view === n.view ? 'rail-btn on' : 'rail-btn'} aria-current={view === n.view ? 'page' : undefined} onClick={() => dispatch({ type: 'view', view: n.view })}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={n.d} /></svg>
            {n.label}
          </button>
        ))}
      </nav>

      <div className="main">
        <header className="topbar">
          <div className="title">
            <span className="crumb">{state.path ?? 'Chưa lưu'}{dirty ? ' · có thay đổi chưa lưu' : ''}</span>
            <span className="name">{doc.name}</span>
          </div>
          <div className="actions">
            {online
              ? <button className="mode-chip on" title={plan ? `Gói ${plan.name}: ${plan.usage.cloudModels}/${plan.limits.cloudModels} mô hình trên Socin` : 'Đã liên kết Socin'} onClick={() => dispatch({ type: 'view', view: 'settings' })}>Socin · {settings.user?.name}{plan ? ` · ${plan.name}` : ''}</button>
              : <button className="mode-chip" title="Đang dùng ngoại tuyến, dữ liệu ở trên máy. Bấm để liên kết tài khoản Socin." onClick={() => setLinking(true)}>Ngoại tuyến · Liên kết Socin</button>}
            <button className="btn" onClick={() => dispatch({ type: 'newDoc' })}>Mới</button>
            <button className="btn" onClick={() => void open()}>Mở</button>
            <button className="btn" onClick={() => void save(false)}>Lưu</button>
            <button className="btn icon" aria-label="Hoàn tác" disabled={history.past.length === 0} onClick={() => dispatch({ type: 'undo' })}>↶</button>
            <button className="btn icon" aria-label="Làm lại" disabled={history.future.length === 0} onClick={() => dispatch({ type: 'redo' })}>↷</button>
            <span className="sep" />
            <button className="btn" onClick={() => void exportWith(() => window.sdraw.exportDxf(doc))}>Xuất DXF</button>
            <button className="btn" onClick={() => void exportWith(() => window.sdraw.exportXlsx(doc, catalog))}>Bảng kê Excel</button>
            <button className="btn-cta" onClick={() => void exportWith(() => window.sdraw.exportSketchupJson(doc, catalog))}>
              Xuất sang SketchUp
            </button>
          </div>
        </header>

        {notice ? (
          <div className={notice.tone === 'error' ? 'notice error' : 'notice'} role="status">{notice.text}</div>
        ) : null}

        {view === 'projects' ? (
          <ProjectsView current={doc} link={state.link} catalog={catalog} onNotice={notify} onOpen={(d) => { dispatch({ type: 'loadDoc', doc: d, path: null }); dispatch({ type: 'view', view: 'layout' }) }} onOpenRoom={(d, projectId, roomId) => { dispatch({ type: 'openRoom', doc: d, projectId, roomId }); dispatch({ type: 'view', view: 'layout' }) }} />
        ) : view === 'importplan' ? (
          <ImportPlanView onNotice={notify} onCreate={(d) => { dispatch({ type: 'loadDoc', doc: d, path: null }); dispatch({ type: 'view', view: 'layout' }) }} />
        ) : view === 'model3d' ? (
          <Model3DView doc={doc} link={state.link} catalog={catalog} onNotice={notify} online={online} />
        ) : view === 'view3d' ? (
          <View3D doc={doc} link={state.link} catalog={catalog} />
        ) : view === 'export' ? (
          <ExportView doc={doc} catalog={catalog} onNotice={notify} />
        ) : view === 'library' ? (
          <LibraryView catalog={catalog} onChange={(c) => dispatch({ type: 'catalog', catalog: c })} onNotice={notify} onImport={() => setImporting(true)} />
        ) : view === 'sketch' ? (
          <SketchEditor
            doc={state.sketch.present}
            canUndo={state.sketch.past.length > 0}
            canRedo={state.sketch.future.length > 0}
            onEdit={(d) => dispatch({ type: 'sketchEdit', doc: d })}
            onUndo={() => dispatch({ type: 'sketchUndo' })}
            onRedo={() => dispatch({ type: 'sketchRedo' })}
            onNew={(c, k) => dispatch({ type: 'sketchLoad', doc: newSketchFor(c, k), path: null })}
            loadId={state.sketchLoadId}
            onSave={(underlay) => {
              const withImg = underlay ? { ...state.sketch.present, underlay } : withoutUnderlay(state.sketch.present)
              window.sdraw.saveSketch(withImg, state.sketchPath).then((p) => {
                if (p) { dispatch({ type: 'sketchLoad', doc: withImg, path: p }); notify(underlay ? `Đã lưu ${p} (kèm ảnh nền)` : `Đã lưu ${p}`) }
              }).catch((e: Error) => notify(`Không lưu được: ${e.message}`, 'error'))
            }}
            onOpen={() => {
              window.sdraw.openSketch().then((r) => { if (r) dispatch({ type: 'sketchLoad', doc: r.doc, path: r.path }) }).catch((e: Error) => notify(e.message, 'error'))
            }}
            onExportSvg={() => {
              window.sdraw.exportSvg(sketchToSvg(state.sketch.present), state.sketch.present.name).then((p) => { if (p) notify(`Đã xuất ${p}`) }).catch((e: Error) => notify(e.message, 'error'))
            }}
            onTo3d={() => {
              const sk = withoutUnderlay(state.sketch.present)
              sendToModel3d({ kind: 'sketch', name: sk.name, doc: sk })
              dispatch({ type: 'view', view: 'model3d' })
            }}
            onToLibrary={() => {
              const sk = state.sketch.present
              const existing = catalog.find((c) => c.sketch && c.name === sk.name && c.origin === 'sketch')
              const id = existing?.id ?? `sk-${Date.now().toString(36)}`
              const sample = { ...sketchToSample(sk, id), ...(existing?.listPrice !== undefined ? { listPrice: existing.listPrice } : {}) }
              dispatch({ type: 'catalog', catalog: existing ? catalog.map((c) => (c.id === id ? sample : c)) : [...catalog, sample] })
              notify(`Đã lưu "${sk.name}" vào kho (${sketchSize(sk).w}×${sketchSize(sk).d} mm). Hệ thống dùng mẫu này để gợi ý.`)
            }}
            onIllustrate={async (png, prompt) => {
              const res = await window.sdraw.generateImage(png, prompt)
              if (res.status === 200) return (res.data as { image: string }).image
              notify((res.data as { error?: string }).error ?? 'Không tạo được ảnh', 'error')
              return null
            }}
          />
        ) : view === 'chat' ? (
          <ChatView
            doc={doc}
            onOpenLayout={() => dispatch({ type: 'view', view: 'layout' })}
            catalog={catalog}
            stats={state.stats}
            online={online}
            onUse={addSample}
            onLayout={(samples) => {
              const r = autoLayout(doc, samples)
              dispatch({ type: 'edit', doc: r.doc })
              dispatch({ type: 'view', view: 'layout' })
              notify(r.unplaced.length ? `Đã xếp ${r.placed.length} món. Không còn chỗ cho: ${r.unplaced.join(', ')}` : `Đã xếp ${r.placed.length} món vào phòng. Kéo để chỉnh, khoá món nào bạn ưng.`, r.unplaced.length ? 'error' : 'ok')
            }}
            onPick={(s) => {
              dispatch({ type: 'stats', stats: recordPick(state.stats, s.id) })
              if (online && settings.user) void window.sdraw.net('POST', '/v1/events/pick', { key: indexKey(s.id, settings.user.businessId) })
            }}
            onOpenStore={(q) => { setStoreQuery(q); dispatch({ type: 'view', view: 'store' }) }}
            onNotice={notify}
          />
        ) : view === 'store' ? (
          <StoreView catalog={catalog} online={online} role={settings.user?.role ?? 'staff'} initialQuery={storeQuery} onChange={(c) => dispatch({ type: 'catalog', catalog: c })} onNotice={notify}
            onOpen3d={(f) => { sendToModel3d(f); dispatch({ type: 'view', view: 'model3d' }) }} />
        ) : view === 'admin' ? (
          <AdminView onNotice={notify} />
        ) : view === 'settings' ? (
          <SettingsView settings={settings} catalog={catalog} update={updateSettings} onNotice={notify} onCatalog={(c) => dispatch({ type: 'catalog', catalog: c })} />
        ) : (
          <div className="workspace">
            <aside className="panel left">
              <LibraryPanel catalog={catalog} onAdd={addSample} onManage={() => dispatch({ type: 'view', view: 'library' })} />
            </aside>
            <section className="center">
              <Canvas
                doc={doc}
                selectedId={selectedId}
                issues={issues}
                onSelect={(id) => dispatch({ type: 'select', id })}
                onMove={(id, cx, cy) => dispatch({ type: 'edit', doc: patchItem(doc, id, { cx, cy }) })}
                showPlan={showPlan}
              />
              {doc.plan ? <label className="check plan-toggle"><input type="checkbox" checked={showPlan} onChange={(e) => setShowPlan(e.target.checked)} /> Hiện mặt bằng nền</label> : null}
              <div className="issues" aria-live="polite">
                {issues.length === 0 ? (
                  <span className="ok">Bố trí hợp lệ: không đè nhau, trong phòng, lối vào cửa thông thoáng.</span>
                ) : (
                  issues.map((i, k) => (
                    <button key={k} className="issue" onClick={() => dispatch({ type: 'select', id: i.itemIds[0] ?? null })}>
                      {i.message}
                    </button>
                  ))
                )}
              </div>
            </section>
            <aside className="panel right">
              <Inspector
                doc={doc}
                item={selected}
                onEdit={(d) => dispatch({ type: 'edit', doc: d })}
                onSelect={(id) => dispatch({ type: 'select', id })}
              />
              <EditAssist doc={doc} catalog={catalog} selectedId={selectedId} onApply={(d) => dispatch({ type: 'edit', doc: d })} onNotice={notify} />
              <BomPanel doc={doc} catalog={catalog} selectedId={selectedId} onSelect={(id) => dispatch({ type: 'select', id })} />
            </aside>
          </div>
        )}
      </div>
      {importing ? (
        <ImportPanel catalog={catalog} onChange={(c) => dispatch({ type: 'catalog', catalog: c })} onNotice={notify} onClose={() => setImporting(false)} />
      ) : null}
    </div>
  )
}
