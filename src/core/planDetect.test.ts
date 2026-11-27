import { describe, expect, it } from 'vitest'
import { detectPlan, type Gray } from './planDetect'

function plan(gapTop?: [number, number]): Gray {
  const W = 400, H = 300
  const data = new Uint8ClampedArray(W * H).fill(255)
  const dot = (x: number, y: number): void => { data[y * W + x] = 0 }
  // tường dày 4px: ngoài (50,40) tới (350,260)
  for (let t = 0; t < 4; t++) {
    for (let x = 50; x <= 353; x++) { if (!(gapTop && x >= gapTop[0] && x < gapTop[1])) dot(x, 40 + t); dot(x, 257 + t) }
    for (let y = 40; y <= 260; y++) { dot(50 + t, y); dot(350 + t, y) }
  }
  // vài nét đồ đạc ngắn trong phòng không được nhầm là tường
  for (let x = 120; x < 160; x++) dot(x, 150)
  return { width: W, height: H, data }
}

describe('nhận mặt bằng từ ảnh', () => {
  it('tìm mép trong của bốn tường', () => {
    const r = detectPlan(plan(), 20)!
    expect(r.x0).toBe(54); expect(r.x1).toBe(349); expect(r.y0).toBe(44); expect(r.y1).toBe(256)
    expect(r.doors).toEqual([])
  })
  it('khoảng hở 50px trên tường trên = cửa 1000mm, offset theo mm từ góc trái', () => {
    const r = detectPlan(plan([150, 200]), 20)!
    expect(r.doors).toEqual([{ wall: 'top', offsetMm: 1920, widthMm: 1000 }])
  })
  it('hở quá rộng hoặc quá hẹp không phải cửa', () => {
    expect(detectPlan(plan([150, 160]), 20)!.doors).toEqual([]) // 200mm
    expect(detectPlan(plan([100, 300]), 20)?.doors ?? []).toEqual([]) // 4000mm: tường mất nên không nhận
  })
  it('ảnh trắng hoặc tỉ lệ sai thì null', () => {
    expect(detectPlan({ width: 100, height: 100, data: new Uint8ClampedArray(10000).fill(255) }, 20)).toBeNull()
    expect(detectPlan(plan(), 0)).toBeNull()
  })
})
