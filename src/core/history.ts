/** Lịch sử Hoàn tác / Làm lại dùng chung cho thao tác tay và lệnh AI. */
export interface History<T> {
  past: T[]
  present: T
  future: T[]
}

const LIMIT = 200

export function createHistory<T>(present: T): History<T> {
  return { past: [], present, future: [] }
}

export function commit<T>(h: History<T>, next: T): History<T> {
  if (next === h.present) return h
  return { past: [...h.past, h.present].slice(-LIMIT), present: next, future: [] }
}

export function undo<T>(h: History<T>): History<T> {
  const prev = h.past[h.past.length - 1]
  if (prev === undefined) return h
  return { past: h.past.slice(0, -1), present: prev, future: [h.present, ...h.future] }
}

export function redo<T>(h: History<T>): History<T> {
  const next = h.future[0]
  if (next === undefined) return h
  return { past: [...h.past, h.present], present: next, future: h.future.slice(1) }
}
