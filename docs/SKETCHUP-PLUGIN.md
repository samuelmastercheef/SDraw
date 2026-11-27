# Plugin SketchUp cho Sdraw AI

Plugin làm hai việc mà app không tự làm được vì `.skp` là định dạng đóng:

1. **Quét thư mục `.skp` thành thư viện**: SketchUp mở từng mẫu để đo kích thước thật, ghi ra file `thu-vien.sdlib.json`. App nhập file này, mẫu vào kho với kích thước đúng, không phải nhập tay.
2. **Dựng bố cục từ app**: đọc file JSON do app xuất ("Xuất sang SketchUp"), vẽ sàn phòng và đặt từng món vào đúng vị trí, góc quay. Món có đường dẫn `.skp` thì chèn component thật; món chưa có file thì thay bằng khối hộp đúng kích thước.

## Cài đặt

```bash
cd sketchup-plugin
./build-rbz.sh            # tạo sdrawai.rbz
```
Trong SketchUp: **Window > Extension Manager > Install Extension**, chọn `sdrawai.rbz`. Menu mới: **Extensions (Plugins) > Sdraw AI**.

## Dùng

- Thư viện: menu **Quét thư mục .skp thành thư viện**, chọn thư mục, lưu file `.sdlib.json`. Trong app: **Thư viện > Tải mẫu lên**, chọn file đó.
- Bố cục: trong app bấm **Xuất sang SketchUp**, rồi trong SketchUp chọn **Dựng bố cục từ file JSON của app**. Cả bước dựng nằm trong một thao tác, nên Ctrl+Z (Edit > Undo) hoàn tác được toàn bộ.

## Quy ước toạ độ

App tính theo mm, gốc ở góc trên trái phòng, y hướng xuống, góc quay thuận chiều kim đồng hồ. SketchUp nhìn từ trên có y hướng lên, nên plugin đổi `y = chiềuSâuPhòng - cy` và `góc = -rotationDeg`. Bố cục nhìn từ trên trong SketchUp giống hệt trên canvas của app.

## Trạng thái kiểm thử (nói thẳng)

- Đã chạy: kiểm tra cú pháp Ruby và 6 test cho phần tính toán thuần (`sdrawai/plan.rb`: đổi toạ độ, kiểm tra tệp, đoán loại, định dạng thư viện), chạy bằng `ruby sdrawai/test/plan_test.rb`.
- **Chưa chạy trong SketchUp thật** (không có SketchUp trong môi trường dựng). Phần gọi API SketchUp (`definitions.load`, `add_instance`, `transform!`) cần bạn thử với vài mẫu thật. Nếu có lỗi, gửi nội dung hộp thoại hoặc cửa sổ Ruby Console (Window > Ruby Console).
- Mẫu có file `.skp` rất nặng sẽ làm quét chậm: plugin hỏi xác nhận trước khi đo và hoàn tác mọi định nghĩa tạm sau khi đo xong.
