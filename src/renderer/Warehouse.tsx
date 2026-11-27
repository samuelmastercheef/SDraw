/** Nút mở 3D Warehouse trong trình duyệt. App không tải mẫu thay người dùng: họ đăng nhập và tải bằng tài khoản SketchUp của mình. */
export function WarehouseButton(props: { query?: string; primary?: boolean; onNotice: (t: string, tone?: 'ok' | 'error') => void }) {
  const open = async () => {
    try {
      await window.sdraw.openWarehouse(props.query ?? '')
      props.onNotice('Đã mở 3D Warehouse. Tải file .skp vào thư mục đã thêm ở Cài đặt, Nguồn dữ liệu để app nhận ra mẫu.')
    } catch (e) { props.onNotice(`Không mở được trình duyệt: ${(e as Error).message}`, 'error') }
  }
  return <button className={props.primary ? 'btn-cta' : 'btn'} onClick={() => void open()}>Tìm trên 3D Warehouse</button>
}

export const WAREHOUSE_NOTE = 'Mẫu lấy từ 3D Warehouse chỉ dùng trong dự án của bạn. Điều khoản của 3D Warehouse không cho chuyển hay bán mẫu đó như món đồ đứng riêng, nên đừng đăng bán riêng lên Store.'
