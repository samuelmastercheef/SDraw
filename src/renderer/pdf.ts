import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

export const isPdfDataUrl = (src: string): boolean => src.startsWith('data:application/pdf;base64,')

/** Vẽ trang đầu của PDF thành ảnh PNG (cạnh dài tối đa 2400 px) để làm ảnh nền. Chạy hoàn toàn trên máy. */
export async function pdfFirstPageToPng(dataUrl: string): Promise<{ src: string; width: number; height: number }> {
  const bin = atob(dataUrl.slice(dataUrl.indexOf(',') + 1))
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  const doc = await pdfjs.getDocument({ data: bytes, isEvalSupported: false }).promise
  try {
    const page = await doc.getPage(1)
    const base = page.getViewport({ scale: 1 })
    const scale = Math.min(4, 2400 / Math.max(base.width, base.height))
    const vp = page.getViewport({ scale })
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(vp.width)
    canvas.height = Math.round(vp.height)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Không vẽ được trang PDF')
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    await page.render({ canvasContext: ctx, viewport: vp }).promise
    return { src: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height }
  } finally {
    await doc.destroy()
  }
}
