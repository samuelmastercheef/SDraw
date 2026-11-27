/**
 * Hộp thư cho màn Dựng 3D: nơi khác (Store, Phác thảo) gửi một mô hình tới, màn Dựng 3D nhận khi mở ra.
 */
import type { SketchDoc } from '@core/shapes'

export type Model3dDelivery =
  | { kind: 'sdraw3d' | 'glb'; name: string; data: Uint8Array }
  /** Bản phác thảo: màn Dựng 3D dựng khối từ nét vẽ và thêm vào mô hình đang mở */
  | { kind: 'sketch'; name: string; doc: SketchDoc }

let pending: Model3dDelivery | null = null
let listener: ((d: Model3dDelivery) => void) | null = null

/** Gửi mô hình. Nếu màn Dựng 3D đang mở thì nhận ngay, không thì giữ tới khi nó mở. */
export function sendToModel3d(d: Model3dDelivery): void {
  if (listener) listener(d)
  else pending = d
}

/** Màn Dựng 3D đăng ký nhận; trả về hàm huỷ. Có thư đang chờ thì giao luôn. */
export function receiveModel3d(fn: (d: Model3dDelivery) => void): () => void {
  listener = fn
  if (pending) { const d = pending; pending = null; fn(d) }
  return () => { if (listener === fn) listener = null }
}
