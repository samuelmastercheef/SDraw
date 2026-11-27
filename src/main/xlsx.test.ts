import ExcelJS from 'exceljs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SEED_SAMPLES } from '../core/catalog'
import { emptyDoc, itemFromSample } from '../core/commands'
import { writeBomXlsx } from './xlsx'

describe('xuất bảng kê Excel', () => {
  it('ghi đúng giá, để trống món chưa báo giá và có công thức tổng', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sdraw-'))
    try {
      const sofa = SEED_SAMPLES.find((s) => s.id === 'seed-sofa-l')!
      const chair = SEED_SAMPLES.find((s) => s.id === 'seed-armchair')!
      const doc = {
        ...emptyDoc('Phòng khách'),
        items: [itemFromSample(sofa, 1500, 3000, 0, 'a'), itemFromSample(chair, 4000, 2000, 0, 'b')]
      }
      const file = join(dir, 'bk.xlsx')
      await writeBomXlsx(doc, SEED_SAMPLES, file)

      const wb = new ExcelJS.Workbook()
      await wb.xlsx.readFile(file)
      const ws = wb.getWorksheet('Bảng kê')!
      expect(ws.getCell('B2').value).toBe('Sofa góc L')
      expect(ws.getCell('F2').value).toBe(14_000_000)
      expect(ws.getCell('G2').value).toBe('Bảng giá')
      expect(ws.getCell('F3').value).toBeNull()
      expect(ws.getCell('G3').value).toBe('Chưa báo giá')
      const total = ws.getCell('H4').value as { formula: string }
      expect(total.formula).toBe('SUM(H2:H3)')
      expect(String(ws.getCell('B5').value)).toContain('1 món chưa báo giá')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
