import { contextBridge, ipcRenderer } from 'electron'
import type { SdrawApi } from './api'

const api: SdrawApi = {
  backupExport: () => ipcRenderer.invoke('backup:export'),
  backupRestore: () => ipcRenderer.invoke('backup:restore'),
  storePutCover: (id, dataUrl) => ipcRenderer.invoke('store:putCover', id, dataUrl),
  storeCover: (id) => ipcRenderer.invoke('store:cover', id),
  backupPush: () => ipcRenderer.invoke('backup:push'),
  backupList: () => ipcRenderer.invoke('backup:list'),
  backupPull: (id) => ipcRenderer.invoke('backup:pull', id),
  storeUploadFile: (id) => ipcRenderer.invoke('store:upload', id),
  storeDownloadFile: (id, name) => ipcRenderer.invoke('store:download', id, name),
  storeUploadData: (id, fileName, data) => ipcRenderer.invoke('store:uploadData', id, fileName, data),
  storeFetch: (id) => ipcRenderer.invoke('store:fetch', id),
  gen3dStatus: () => ipcRenderer.invoke('gen3d:status'),
  gen3dSetKey: (p, k) => ipcRenderer.invoke('gen3d:setKey', p, k),
  gen3dRun: (req) => ipcRenderer.invoke('gen3d:run', req),
  gen3dCancel: () => ipcRenderer.invoke('gen3d:cancel'),
  onGen3dProgress: (cb) => { const h = (_e: unknown, p: { provider: string; progress: number; text: string }) => cb(p); ipcRenderer.on('gen3d:progress', h); return () => { ipcRenderer.removeListener('gen3d:progress', h) } },
  toolsStatus: () => ipcRenderer.invoke('tools:status'),
  toolsInstall: (ids) => ipcRenderer.invoke('tools:install', ids),
  toolsLogs: () => ipcRenderer.invoke('tools:logs'),
  toolsStartHunyuan: () => ipcRenderer.invoke('tools:startHunyuan'),
  toolsStopHunyuan: () => ipcRenderer.invoke('tools:stopHunyuan'),
  toolsOpenUrl: (u) => ipcRenderer.invoke('tools:openUrl', u),
  onToolsError: (cb) => { const h = (_e: unknown, m: string) => cb(m); ipcRenderer.on('tools:error', h); return () => { ipcRenderer.removeListener('tools:error', h) } },
  openWarehouse: (q) => ipcRenderer.invoke('warehouse:open', q),
  listProjects: () => ipcRenderer.invoke('projects:list'),
  saveProject: (p) => ipcRenderer.invoke('projects:save', p),
  deleteProject: (id) => ipcRenderer.invoke('projects:delete', id),
  loadCatalog: () => ipcRenderer.invoke('catalog:load'),
  saveCatalog: (samples) => ipcRenderer.invoke('catalog:save', samples),
  scanPath: (path) => ipcRenderer.invoke('catalog:scanPath', path),
  scanFolder: () => ipcRenderer.invoke('catalog:scan'),
  scanCancel: () => ipcRenderer.invoke('scan:cancel'),
  onScanProgress: (cb) => {
    const h = (_e: unknown, p: Parameters<typeof cb>[0]) => cb(p)
    ipcRenderer.on('scan:progress', h)
    return () => { ipcRenderer.removeListener('scan:progress', h) }
  },
  aiStatus: () => ipcRenderer.invoke('ai:status'),
  aiSetEnabled: (on) => ipcRenderer.invoke('ai:setEnabled', on),
  aiNewToken: () => ipcRenderer.invoke('ai:newToken'),
  onAiCall: (cb) => {
    const h = (_e: unknown, p: Parameters<typeof cb>[0]) => cb(p)
    ipcRenderer.on('ai:call', h)
    return () => { ipcRenderer.removeListener('ai:call', h) }
  },
  aiResult: (r) => ipcRenderer.send('ai:result', r),
  listSkills: () => ipcRenderer.invoke('skills:list'),
  saveSkill: (s) => ipcRenderer.invoke('skills:save', s),
  deleteSkill: (id) => ipcRenderer.invoke('skills:delete', id),
  onSkillsChanged: (cb) => {
    const h = () => cb()
    ipcRenderer.on('skills:changed', h)
    return () => { ipcRenderer.removeListener('skills:changed', h) }
  },
  onFolderChanged: (cb) => {
    const h = (_e: unknown, p: Parameters<typeof cb>[0]) => cb(p)
    ipcRenderer.on('scan:changed', h)
    return () => { ipcRenderer.removeListener('scan:changed', h) }
  },
  openDoc: () => ipcRenderer.invoke('doc:open'),
  saveDoc: (doc, path) => ipcRenderer.invoke('doc:save', doc, path),
  exportDxf: (doc) => ipcRenderer.invoke('export:dxf', doc),
  exportXlsx: (doc, samples) => ipcRenderer.invoke('export:xlsx', doc, samples),
  exportSketchupJson: (doc, samples) => ipcRenderer.invoke('export:json', doc, samples),
  exportNeonPlan: (doc, samples) => ipcRenderer.invoke('export:neonplan', doc, samples),
  exportNeonPlanHouse: (rooms, samples, name) => ipcRenderer.invoke('export:neonplanHouse', rooms, samples, name),
  importFiles: () => ipcRenderer.invoke('catalog:import'),
  saveSketch: (doc, path) => ipcRenderer.invoke('sketch:save', doc, path),
  openSketch: () => ipcRenderer.invoke('sketch:open'),
  exportSvg: (svg, name) => ipcRenderer.invoke('export:svg', svg, name),
  saveModel3d: (model, name, path) => ipcRenderer.invoke('model3d:save', model, name, path),
  openModel3d: () => ipcRenderer.invoke('model3d:open'),
  exportModel3d: (kind, data, name) => ipcRenderer.invoke('model3d:export', kind, data, name),
  importModel3d: () => ipcRenderer.invoke('model3d:import'),
  openReferenceImage: () => ipcRenderer.invoke('sketch:openImage'),
  readMesh: (path) => ipcRenderer.invoke('mesh:read', path),
  openMesh: () => ipcRenderer.invoke('mesh:open'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (s) => ipcRenderer.invoke('settings:set', s),
  generateImage: (frame, prompt) => ipcRenderer.invoke('image:generate', frame, prompt),
  net: (method, path, body) => ipcRenderer.invoke('net:call', method, path, body)
}

contextBridge.exposeInMainWorld('sdraw', api)
