/** Vân vật liệu cho màn Dựng 3D: tạo texture three.js, ảnh nhỏ cho bảng chọn, ảnh PNG để nhúng GLB. */
import * as THREE from 'three'
import type { Material3 } from '@core/model3d'
import { patternPixels } from '@core/materials'
import type { GlbImages } from '@core/model3dIo'

const keyOf = (m: Material3) => (m.texture ? `img:${m.id}:${m.texture.length}:${m.texture.slice(-32)}` : `pat:${m.pattern ?? 'plain'}:${m.color}`)

function patternCanvas(m: Material3, px: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = c.height = px
  const ctx = c.getContext('2d')!
  ctx.putImageData(new ImageData(patternPixels(m.pattern ?? 'plain', m.color, px), px, px), 0, 0)
  return c
}

const texCache = new Map<string, THREE.Texture>()

/** Texture lặp của vật liệu (ảnh vân nạp bất đồng bộ, three.js tự cập nhật khi xong). */
export function textureFor(m: Material3): THREE.Texture {
  const k = keyOf(m)
  let t = texCache.get(k)
  if (!t) {
    t = m.texture ? new THREE.TextureLoader().load(m.texture) : new THREE.CanvasTexture(patternCanvas(m, 256))
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    t.colorSpace = THREE.SRGBColorSpace
    t.anisotropy = 4
    texCache.set(k, t)
  }
  return t
}

const thumbCache = new Map<string, string>()

/** Ảnh nhỏ (data URL) để hiện trong bảng chọn vật liệu. */
export function thumbFor(m: Material3): string {
  if (m.texture) return m.texture
  const k = keyOf(m)
  let u = thumbCache.get(k)
  if (!u) { u = patternCanvas(m, 64).toDataURL('image/png'); thumbCache.set(k, u) }
  return u
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Không đọc được ảnh vân')); i.src = src })
}

/** Thu nhỏ ảnh vân về cạnh dài tối đa max px để mô hình không quá nặng. */
export async function shrinkImage(src: string, max = 1024): Promise<string> {
  const img = await loadImage(src)
  const k = Math.min(1, max / Math.max(img.width, img.height))
  if (k >= 1 && src.length < 1_500_000) return src
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(img.width * k)); c.height = Math.max(1, Math.round(img.height * k))
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
  return c.toDataURL('image/jpeg', 0.88)
}

function dataUrlBytes(u: string): Uint8Array {
  const b = atob(u.slice(u.indexOf(',') + 1))
  const out = new Uint8Array(b.length)
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i)
  return out
}

/** Ảnh vân của các vật liệu đang dùng, để nhúng vào GLB (PNG hoặc JPEG). */
export async function glbImages(materials: Record<string, Material3> | undefined): Promise<GlbImages> {
  const out: GlbImages = {}
  for (const m of Object.values(materials ?? {})) {
    if (m.texture?.startsWith('data:image/png')) out[m.id] = { mime: 'image/png', data: dataUrlBytes(m.texture) }
    else if (m.texture?.startsWith('data:image/jpeg')) out[m.id] = { mime: 'image/jpeg', data: dataUrlBytes(m.texture) }
    else {
      let c: HTMLCanvasElement
      if (m.texture) { const img = await loadImage(m.texture); c = document.createElement('canvas'); c.width = img.width; c.height = img.height; c.getContext('2d')!.drawImage(img, 0, 0) } else c = patternCanvas(m, 256)
      out[m.id] = { mime: 'image/png', data: dataUrlBytes(c.toDataURL('image/png')) }
    }
  }
  return out
}
