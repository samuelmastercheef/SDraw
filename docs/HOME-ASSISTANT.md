# Đồng bộ thiết kế Sdraw sang Home Assistant (NeonPlan 3D)

Sdraw không nói chuyện trực tiếp với Home Assistant. Nó xuất file nhập của **NeonPlan 3D**
(tích hợp HACS, https://github.com/Mastershort/neonplan3d, MIT), rồi NeonPlan hiển thị phòng 3D
trên dashboard bằng card `custom:neonplan3d-card`.

## Cách dùng
1. Sdraw: mục **Xuất bản vẽ** > tích "Home Assistant (NeonPlan 3D)" > Xuất, ra file `*-neonplan.json`.
2. Home Assistant: cài NeonPlan 3D qua HACS (Custom repositories > Integration), khởi động lại, thêm tích hợp.
3. NeonPlan 3D (thanh bên) > **Import** > chọn file `.json` (định dạng `neonplan-import`).
4. Gắn từng phòng với Area của Home Assistant để đèn, rèm, cảm biến tự hiện.
5. Thêm card vào dashboard: `type: custom:neonplan3d-card`.

## Ánh xạ
- Phòng Sdraw (mm, mép trong) > một tầng một phòng (m), cộng 0,3 m mỗi phía (tường ngoài theo tài liệu NeonPlan).
- Cửa > `doors` đặt đúng trên đường tường. Cửa sổ (mục "Cửa sổ và rèm" trong panel Phòng) > `windows` với `width`, `height`, `sill`. Cờ "Có rèm" lưu trong bản vẽ Sdraw và vẽ nét đứt trên canvas, chưa xuất sang NeonPlan vì chưa rõ NeonPlan nhận rèm theo cách nào.
- Món nội thất > `furniture` (`at` là tâm, `width`, `depth`, `rotation` độ theo chiều kim đồng hồ, 0 = mặt trước hướng xuống).
- Danh mục > loại NeonPlan: Tủ lạnh, Bếp, Chậu rửa, Tủ bếp, Bồn cầu, Bồn tắm, Vòi sen (loại có trong tài liệu NeonPlan), Sofa, Ghế thư giãn, Ghế, Bàn*, Bàn làm việc, Giường. Kệ tivi, kệ sách, tủ chưa có loại
  được tài liệu xác nhận nên xuất là `cabinet` và app báo cảnh báo; chỉnh bảng `TYPE_BY_CATEGORY` trong
  `src/core/neonplan.ts` sau khi thử nhập thật.

- Ô "Area Home Assistant" trong panel Phòng: tên Area được dùng làm tên phòng trong file xuất (kèm trường `area`), để khi gắn phòng với Area trong NeonPlan chỉ cần chọn đúng tên.

## Dự án nhiều phòng, nhiều tầng
- Màn hình **Dự án**: mỗi dự án có danh sách phòng. "Thêm phòng" tạo phòng mới theo mẫu đã chọn ở tầng chỉ định (0 = trệt, 1 = tầng 1, -1 = hầm). Mỗi phòng vẫn là một bản vẽ như cũ; bấm "Mở" để sửa, rồi "Lưu bản vẽ đang mở vào phòng".
- Bản vẽ mở từ danh sách dự án được nhớ là thuộc phòng nào; mở file hoặc tạo mới thì không còn liên kết.
- "Xuất cả nhà sang Home Assistant" xuất mọi phòng, mỗi tầng một mục (cao độ 2,5 m mỗi tầng). Phòng chưa đặt vị trí được xếp nối đuôi theo chiều ngang trong cùng tầng, tường chung trùng một đường. Có thể nhập X, Y (mm) để đặt tay.
- Cửa trùng giữa hai phòng liền kề (cách nhau không quá 6 cm) chỉ giữ một.
- Khi có nhiều phòng, tường dùng độ lệch 0,12 m (tường trong theo tài liệu NeonPlan) cho mọi phòng, nên tường ngoài mỏng hơn bản một phòng (0,3 m).
- Chưa có cầu thang, lỗ thông tầng, mái; thêm trong NeonPlan sau khi nhập.

## Xem 3D trong Sdraw
- Tab **Xem 3D** (thanh trái) dựng phòng đang mở, hoặc cả dự án nếu bản vẽ mở từ danh sách dự án: sàn, tường, cửa (cam), cửa sổ (xanh nhạt), rèm (tím) và đồ nội thất dạng khối hộp theo kích thước thật, kiểu neon tối.
- Kéo chuột để xoay, cuộn để phóng to, chuột phải để dời; chọn "Cả nhà" hoặc từng tầng; có "Tự xoay".
- Mẫu trong kho có file `.obj` hoặc `.glb` hiện đúng hình dạng (đọc dần khi mở tab; mẫu quá nặng hoặc lỗi file vẫn hiện khối hộp). Mẫu khác hiện khối hộp theo kích thước thật. Lưới 3D coi trục z là chiều cao, giống khi xuất sang SketchUp.
- Ô "Bật đèn": mỗi phòng có một đèn trần phát sáng kèm vệt sáng trên sàn; món thuộc danh mục Đèn (hoặc có chữ "đèn" trong tên) cũng phát sáng. Tối đa 10 nguồn sáng thật, phần còn lại chỉ có vầng sáng.
- Đây chỉ là xem trước bố cục, không gồm thiết bị Home Assistant hay trạng thái bật tắt thật.

## Giới hạn đã biết
- Tài liệu NeonPlan chưa công bố schema đầy đủ (`plan-format.md`) hay API; chỉ có `docs/ai-import.md`. Cần thử nhập thật
  để xác nhận trường `name` và loại `cabinet`.
- Chỉ một chiều Sdraw > NeonPlan. Chưa đọc lại danh sách thiết bị từ Home Assistant.
