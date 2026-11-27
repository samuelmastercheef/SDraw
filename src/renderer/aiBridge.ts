/**
 * Cầu nối lệnh AI (từ cổng MCP ở tiến trình chính) tới màn Dựng 3D.
 * Lệnh tới khi màn Dựng 3D chưa mở thì được giữ lại và màn được mở ra; khi màn đăng ký
 * bộ xử lý thì các lệnh chờ chạy lần lượt.
 */
import type { AiCall } from '../preload/api'

type Handler = (call: AiCall) => Promise<{ ok: boolean; text: string; data?: Record<string, unknown>; file?: import('@core/aiTools').AiFile }>

let handler: Handler | null = null
const queue: AiCall[] = []
let busy = Promise.resolve()
let onNeedView: (() => void) | null = null

function dispatch(call: AiCall): void {
  // Chạy tuần tự để mỗi lệnh thấy mô hình sau lệnh trước
  busy = busy.then(async () => {
    try {
      const r = await handler!(call)
      window.sdraw.aiResult({ id: call.id, ...r })
    } catch (e) {
      window.sdraw.aiResult({ id: call.id, ok: false, text: (e as Error).message })
    }
  })
}

export function startAiBridge(needView: () => void): () => void {
  onNeedView = needView
  return window.sdraw.onAiCall((call) => {
    if (handler) dispatch(call)
    else { queue.push(call); onNeedView?.() }
  })
}

export function setAiHandler(h: Handler | null): void {
  handler = h
  if (h) while (queue.length) dispatch(queue.shift()!)
}
