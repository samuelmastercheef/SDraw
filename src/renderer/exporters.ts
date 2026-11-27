import { exporters } from '@core/extensions'

/** Đăng ký các bộ xuất file có sẵn trong bản mã nguồn mở. Gọi một lần khi app khởi động. */
let done = false
export function registerBuiltinExporters(): void {
  if (done) return
  done = true
  exporters.register({
    id: 'dxf', order: 10, defaultOn: true, label: 'Bản vẽ DXF', note: 'Mở bằng AutoCAD hoặc các phần mềm CAD khác',
    run: async ({ doc }) => { const file = await window.sdraw.exportDxf(doc); return file ? { file } : null }
  })
  exporters.register({
    id: 'xlsx', order: 20, defaultOn: true, label: 'Bảng kê Excel', note: 'Danh sách món, kích thước, số lượng và giá (nếu có)',
    run: async ({ doc, catalog }) => { const file = await window.sdraw.exportXlsx(doc, catalog); return file ? { file } : null }
  })
  exporters.register({
    id: 'json', order: 30, defaultOn: true, label: 'Kế hoạch dựng cho SketchUp', note: 'File .json để plugin Sdraw dựng phòng và đặt mẫu trong SketchUp (cần cài plugin)',
    run: async ({ doc, catalog }) => { const file = await window.sdraw.exportSketchupJson(doc, catalog); return file ? { file } : null }
  })
  exporters.register({
    id: 'neonplan', order: 40, label: 'Home Assistant (NeonPlan 3D)', note: 'File .json nhập vào NeonPlan 3D để hiện phòng và đồ nội thất trên dashboard nhà thông minh',
    run: async ({ doc, catalog }) => {
      const r = await window.sdraw.exportNeonPlan(doc, catalog)
      return r ? { file: r.file, warnings: r.warnings } : null
    }
  })
}
