<p align="center"><img src="build/icon.png" width="128" alt="Biểu tượng S Draw"></p>

# S Draw

Phần mềm thiết kế nội thất mã nguồn mở cho Windows và macOS: bố trí phòng 2D, phác thảo vector, mẫu nội thất theo thông số (sofa, bàn, ghế, giường, kệ, tủ), xem 3D, bảng kê và xuất bản vẽ.

> Trạng thái: alpha. Lõi dựng hình 3D đã có vẽ mặt, đẩy kéo, nhóm, phép khối, vật liệu, bản vẽ, cấu kiện dùng lại và cổng AI.

## Tính năng

- Dựng 3D: vẽ đường, cung, chữ nhật, hình tròn, offset trên nền hoặc trên mặt (cắt mặt, chia mặt), đẩy kéo thành khối nhô, hốc hoặc lỗ xuyên, trừ/hợp/giao khối, chạy mặt cắt dọc đường (phào chỉ, len chân tường), cấu kiện dùng lại (sửa một bản, các bản đổi theo), vật liệu nội thất và ảnh vân, di chuyển, chép, chép thành dãy, xoay góc bất kỳ, co giãn, lật, nhóm, tô màu, đo; bám đỉnh, trung điểm, cạnh; nhập kích thước chính xác bằng bàn phím; ghi kích thước, xuất bản vẽ mặt bằng và mặt đứng ra PDF/DXF; hoàn tác/làm lại. Tệp `.sdraw3d`, nhập/xuất OBJ, STL, GLB. Dựng nhanh từ bố cục phòng.
- Dựng 3D từ phác thảo: một nút đưa bản phác thảo sang Dựng 3D, mẫu theo thông số ra đủ bộ phận đúng kích thước, nét vẽ tự do được đùn thành khối.
- Tạo hình 3D bằng AI: 21 skill theo loại sản phẩm nội thất (sofa, bàn, ghế, giường, tủ, tủ bếp, cửa, cầu thang...) soạn sẵn prompt chuẩn, xem và sửa trước khi tạo; ảnh hoặc mô tả thành mô hình GLB qua Hunyuan3D-2 chạy trên máy, Tripo hoặc Meshy (khoá API của bạn); Draw Things vẽ ảnh ý tưởng và ảnh vân. App tự dò công cụ chưa cài, cài bằng một nút (brew, winget) và hướng dẫn kết nối từng bước.
- Cổng AI: máy chủ MCP cục bộ để Claude và các AI khác dựng hình, gán vật liệu, ghi kích thước và xuất file; kho skill (quy trình mẫu có tham số) để AI và người dùng chạy lại.
- Bố cục phòng 2D: kéo thả, bám lưới 50 mm, xoay, sửa kích thước, kiểm tra đè nhau, ra ngoài phòng, chắn cửa.
- Phác thảo vector toàn màn hình và mẫu nội thất theo thông số; đổi thông số thì khung tự dựng lại.
- Tự xếp mẫu vào phòng theo quy tắc, sửa bố cục bằng câu lệnh tiếng Việt.
- Nhập mặt bằng từ ảnh hoặc PDF, đặt tỉ lệ bằng hai điểm, dò tường và cửa.
- Xem 3D, nhập mô hình .obj và .glb.
- Bảng kê và xuất DXF, Excel, JSON (kế hoạch dựng cho SketchUp, Home Assistant NeonPlan).
- Dự án nhiều phòng, nhiều tầng.

App có hai chế độ: **ngoại tuyến** (mọi phần trên máy, không cần tài khoản, app nhớ lựa chọn) hoặc **liên kết tài khoản [Socin](https://socin.org)** bất cứ lúc nào để lưu mô hình dùng chung trong doanh nghiệp, đăng và mở mô hình 3D trên Store, gợi ý từ hệ thống và các dịch vụ AI trực tuyến.

## Cấu hình máy

### Dùng S Draw (bố trí phòng, phác thảo, dựng 3D, bản vẽ, Tripo/Meshy trên đám mây)

| | Tối thiểu | Khuyến nghị |
|---|---|---|
| macOS | macOS 11 trở lên, Mac chip Apple (M1), 8 GB RAM | M2 trở lên, 16 GB RAM |
| Windows | Windows 10/11 64-bit, 8 GB RAM, card đồ hoạ hỗ trợ WebGL 2 | 16 GB RAM, card rời |
| Ổ đĩa | 1 GB trống, SSD | SSD, thêm chỗ cho thư viện mẫu |
| Màn hình | 1366 × 768 | 1920 × 1080 trở lên |

Bộ cài Mac có sẵn là bản Apple silicon (arm64). Mac chip Intel tự build từ mã nguồn (thêm `x64` vào `build.mac.target`); macOS đang ngừng hỗ trợ app Intel.

### Tạo hình bằng AI chạy trên máy (tuỳ chọn)

| Công cụ | Dùng để | Tối thiểu | Khuyến nghị |
|---|---|---|---|
| Hunyuan3D-2 | Ảnh hoặc mô tả thành mô hình 3D | Windows: NVIDIA 12 GB VRAM (ví dụ RTX 3060 12GB), 16 GB RAM, chỉ dựng hình | NVIDIA 16–24 GB VRAM, 32 GB RAM để dựng cả vân; Mac M3/M4 Pro 36 GB trở lên (chạy được nhưng chậm) |
| Draw Things (chỉ Mac) | Ảnh ý tưởng, ảnh vân | M1, 16 GB RAM cho SDXL | M2/M3 Pro, 32 GB RAM cho FLUX |
| ComfyUI (Windows, tuỳ chọn) | Ảnh ý tưởng, ảnh vân | NVIDIA 8 GB VRAM | 12 GB VRAM trở lên |

Hunyuan3D-2 cần khoảng 10 GB ổ đĩa (mã nguồn, thư viện Python, mô hình tải ở lần chạy đầu). Tripo và Meshy chạy trên đám mây, không cần cấu hình mạnh, chỉ cần khoá API và mạng.

## Phần mềm kèm theo

S Draw tự dò những công cụ dưới đây (Dựng 3D, Tạo hình bằng AI, mục Công cụ trên máy), báo thiếu gì và có nút **Cài tự động**:

| Phần mềm | Cần khi | Cách cài |
|---|---|---|
| Homebrew (Mac) / winget (Windows) | Để S Draw tự cài các công cụ khác | Mac: [brew.sh](https://brew.sh). Windows 10/11 có sẵn winget (App Installer) |
| git | Tải mã nguồn Hunyuan3D-2 | Tự cài qua brew/winget |
| uv | Môi trường Python riêng cho Hunyuan3D-2 | Tự cài qua brew/winget |
| Hunyuan3D-2 | Tạo hình 3D trên máy | Nút Cài tự động, rồi Chạy máy chủ Hunyuan |
| Draw Things (Mac) | Vẽ ảnh trên máy | Tự cài qua brew, hoặc App Store; bật API Server (HTTP, cổng 7860) |
| ComfyUI (Windows, tuỳ chọn) | Vẽ ảnh trên máy | Hướng dẫn trong app |
| Blender (tuỳ chọn) | Sửa lưới, giảm mặt cho mô hình AI | Tự cài qua brew/winget |

Không cần cài gì thêm để dùng các phần còn lại. Tripo và Meshy cần tài khoản và khoá API riêng (hướng dẫn lấy khoá có trong app); khoá được mã hoá và chỉ lưu trên máy.

## Chạy và build

Cần Node 22 (khuyến nghị), git; trên Mac cần Xcode Command Line Tools để ký và đóng gói.

```bash
npm install
npm run dev        # chạy app ở chế độ phát triển
npm test           # test lõi
npm run typecheck
npm run dist       # đóng gói bộ cài
npm run dist:mac   # bản Mac (arm64), xem docs/MAC-SIGNING.md để ký và notarize
```

## Cấu trúc

```
src/core       Logic thuần, có test: lõi dựng hình 3D (model3d), hình học, lệnh, bảng kê, DXF, mẫu thông số, gợi ý, điểm cắm mở rộng
src/main       Tiến trình Electron: cửa sổ, hộp thoại file, quét thư mục, ghi Excel
src/preload    Cầu nối an toàn giữa main và giao diện
src/renderer   Giao diện React
sketchup-plugin  Plugin cầu nối cho SketchUp (tuỳ chọn)
```

Mọi kích thước tính bằng milimét.

## Đóng góp

Xem [CONTRIBUTING.md](CONTRIBUTING.md). Người đóng góp ký [CLA](CLA.md) một lần.

## Giấy phép

[GNU AGPL-3.0](LICENSE). "S Draw" và logo là nhãn hiệu của Socin; bản fork phân phối lại cần dùng tên khác.

*SketchUp và 3D Warehouse là nhãn hiệu của Trimble Inc. S Draw là phần mềm độc lập, không liên kết hay được Trimble bảo trợ.*
