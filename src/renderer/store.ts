import { useReducer } from 'react'
import { emptyDoc } from '@core/commands'
import { commit, createHistory, redo, undo, type History } from '@core/history'
import { newSofaSketch } from '@core/sofa'
import type { SketchDoc } from '@core/shapes'
import type { PickStats } from '@core/suggest'
import type { Sample, SdrawDoc } from '@core/types'

export type View = 'view3d' | 'model3d' | 'importplan' | 'export' | 'projects' | 'layout' | 'library' | 'sketch' | 'chat' | 'store' | 'admin' | 'settings'

export interface State {
  history: History<SdrawDoc>
  /** Bản đã lưu gần nhất, để biết có thay đổi chưa lưu */
  saved: SdrawDoc
  path: string | null
  /** Bản vẽ đang mở thuộc phòng nào của dự án nào (null = không thuộc dự án) */
  link: { projectId: string; roomId: string } | null
  selectedId: string | null
  catalog: Sample[]
  view: View
  sketch: History<SketchDoc>
  sketchPath: string | null
  /** Tăng mỗi lần nạp phác thảo, để trình vẽ nạp lại ảnh nền */
  sketchLoadId: number
  /** Thống kê lượt chọn trên máy này, dùng khi gợi ý ngoại tuyến */
  stats: PickStats
  notice: { text: string; tone: 'ok' | 'error' } | null
}

export type Action =
  | { type: 'edit'; doc: SdrawDoc }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'select'; id: string | null }
  | { type: 'loadDoc'; doc: SdrawDoc; path: string | null }
  | { type: 'openRoom'; doc: SdrawDoc; projectId: string; roomId: string }
  | { type: 'markSaved'; path: string }
  | { type: 'newDoc' }
  | { type: 'catalog'; catalog: Sample[] }
  | { type: 'view'; view: View }
  | { type: 'sketchEdit'; doc: SketchDoc }
  | { type: 'sketchUndo' }
  | { type: 'sketchRedo' }
  | { type: 'sketchLoad'; doc: SketchDoc; path: string | null }
  | { type: 'stats'; stats: PickStats }
  | { type: 'notice'; notice: State['notice'] }

function initial(): State {
  const doc = emptyDoc()
  return {
    history: createHistory(doc),
    saved: doc,
    path: null,
    link: null,
    selectedId: null,
    catalog: [],
    view: 'layout',
    sketch: createHistory(newSofaSketch('straight')),
    sketchPath: null,
    sketchLoadId: 0,
    stats: {},
    notice: null
  }
}

function reducer(s: State, a: Action): State {
  switch (a.type) {
    case 'edit':
      return { ...s, history: commit(s.history, a.doc) }
    case 'undo':
      return { ...s, history: undo(s.history) }
    case 'redo':
      return { ...s, history: redo(s.history) }
    case 'select':
      return { ...s, selectedId: a.id }
    case 'loadDoc':
      return { ...s, history: createHistory(a.doc), saved: a.doc, path: a.path, link: null, selectedId: null }
    case 'openRoom':
      return { ...s, history: createHistory(a.doc), saved: a.doc, path: null, link: { projectId: a.projectId, roomId: a.roomId }, selectedId: null }
    case 'newDoc': {
      const doc = emptyDoc()
      return { ...s, history: createHistory(doc), saved: doc, path: null, link: null, selectedId: null }
    }
    case 'markSaved':
      return { ...s, saved: s.history.present, path: a.path }
    case 'catalog':
      return { ...s, catalog: a.catalog }
    case 'view':
      return { ...s, view: a.view }
    case 'sketchEdit':
      return { ...s, sketch: commit(s.sketch, a.doc) }
    case 'sketchUndo':
      return { ...s, sketch: undo(s.sketch) }
    case 'sketchRedo':
      return { ...s, sketch: redo(s.sketch) }
    case 'sketchLoad':
      return { ...s, sketch: createHistory(a.doc), sketchPath: a.path, sketchLoadId: s.sketchLoadId + 1 }
    case 'stats':
      return { ...s, stats: a.stats }
    case 'notice':
      return { ...s, notice: a.notice }
  }
}

export function useStore() {
  return useReducer(reducer, undefined, initial)
}
