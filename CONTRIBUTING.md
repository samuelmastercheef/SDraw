# Đóng góp cho S Draw

Cảm ơn bạn muốn đóng góp. S Draw là phần mềm 3D mã nguồn mở cho thiết kế nội thất, giấy phép [AGPL-3.0](LICENSE).

## Trước khi bắt đầu

- Đọc và đồng ý với [CLA](CLA.md) (một lần, bằng một bình luận trong pull request đầu tiên).
- Việc lớn (tính năng mới, đổi định dạng file): mở issue trao đổi trước.
- Không đưa vào mã, ảnh, mẫu 3D hay biểu tượng của phần mềm khác nếu giấy phép không cho phép. Mẫu tải từ kho mẫu của bên thứ ba không được đưa vào repo.

## Chạy và kiểm tra

```bash
npm install
npm run dev
npm test
npm run typecheck
```

Mọi thay đổi ở `src/core` cần có test. Kích thước tính bằng milimét.

## Mở rộng bằng plugin

Bộ xuất file và công cụ mới nên đăng ký qua `src/core/extensions.ts` thay vì sửa trực tiếp giao diện. Bản S Draw chính thức dùng cùng cơ chế này để nạp các gói Pro.

## Quy ước

- Commit và pull request viết tiếng Việt hoặc tiếng Anh, mô tả rõ thay đổi và cách kiểm.
- Giữ pull request nhỏ, một mục đích.

## Nhãn hiệu

"S Draw", "Sdraw AI" và logo là nhãn hiệu của Socin. Bạn được tự do fork theo AGPL-3.0, nhưng bản phân phối đã sửa đổi phải dùng tên và logo khác.
