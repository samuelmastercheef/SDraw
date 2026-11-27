import ExcelJS from 'exceljs'
import { buildBom, SOURCE_LABEL } from '../core/bom'
import type { Sample, SdrawDoc } from '../core/types'

/** Bảng kê Excel: món chưa báo giá để trống ô giá và không vào tổng. */
export async function writeBomXlsx(doc: SdrawDoc, samples: Sample[], file: string): Promise<void> {
  const bom = buildBom(doc, samples)
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Bảng kê')
  ws.columns = [
    { header: 'STT', key: 'i', width: 6 },
    { header: 'Tên món', key: 'name', width: 34 },
    { header: 'Kích thước', key: 'size', width: 20 },
    { header: 'Vật liệu', key: 'mat', width: 20 },
    { header: 'SL', key: 'q', width: 6 },
    { header: 'Đơn giá (đ)', key: 'p', width: 16 },
    { header: 'Nguồn giá', key: 's', width: 14 },
    { header: 'Thành tiền (đ)', key: 't', width: 18 }
  ]
  ws.getRow(1).font = { bold: true }

  bom.rows.forEach((r, i) => {
    const row = ws.addRow({
      i: r.index,
      name: r.name,
      size: r.sizeText,
      mat: r.material,
      q: r.quantity,
      p: r.unitPrice ?? null,
      s: SOURCE_LABEL[r.source]
    })
    if (r.unitPrice != null) row.getCell('t').value = { formula: `E${i + 2}*F${i + 2}`, result: r.unitPrice }
  })

  const last = bom.rows.length + 1
  const totalRow = ws.addRow({ name: 'Tạm tính' })
  totalRow.font = { bold: true }
  totalRow.getCell('t').value = { formula: `SUM(H2:H${Math.max(last, 2)})`, result: bom.total }
  if (bom.unpriced > 0) ws.addRow({ name: `Chưa gồm ${bom.unpriced} món chưa báo giá` })

  ws.getColumn('p').numFmt = '#,##0'
  ws.getColumn('t').numFmt = '#,##0'
  await wb.xlsx.writeFile(file)
}
