import type { Bom, BomRow, Item, Sample, SdrawDoc } from './types'

/** Giá một món: bảng giá doanh nghiệp, nhập tay, hoặc để trống (null = chưa báo giá). */
export function unitPrice(
  item: Item,
  samples: Map<string, Sample>
): { price: number | null; source: BomRow['source'] } {
  if (item.priceMode === 'manual' && item.manualPrice != null && item.manualPrice >= 0) {
    return { price: item.manualPrice, source: 'manual' }
  }
  if (item.priceMode === 'list') {
    const listed = samples.get(item.sampleId)?.listPrice
    if (listed != null) return { price: listed, source: 'list' }
  }
  return { price: null, source: 'blank' }
}

export function sizeText(item: Item): string {
  return `${Math.round(item.w)} × ${Math.round(item.d)} mm`
}

export function buildBom(doc: SdrawDoc, samples: Sample[]): Bom {
  const map = new Map(samples.map((s) => [s.id, s]))
  let total = 0
  let unpriced = 0
  const rows: BomRow[] = doc.items.map((it, i) => {
    const { price, source } = unitPrice(it, map)
    if (price == null) unpriced += 1
    else total += price
    return {
      itemId: it.id,
      index: i + 1,
      name: it.name,
      sizeText: sizeText(it),
      material: it.material,
      quantity: 1,
      unitPrice: price,
      source
    }
  })
  return { rows, total, unpriced }
}

export const SOURCE_LABEL: Record<BomRow['source'], string> = {
  list: 'Bảng giá',
  manual: 'Nhập tay',
  blank: 'Chưa báo giá'
}

export function formatVnd(amount: number): string {
  return new Intl.NumberFormat('vi-VN').format(Math.round(amount)) + ' đ'
}
