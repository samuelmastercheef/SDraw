# Build, ký và notarize bản macOS

## Vì sao bản tải từ GitHub Actions bị báo "Malware Blocked"

Đến 3.11.0, bước ký ad-hoc (`scripts/mac-adhoc-sign.cjs`) khai báo sai chỗ trong `package.json`
(nằm ngoài mục `build`) nên electron-builder không chạy. electron-builder đổi tên tệp chạy và
Info.plist của Electron, chữ ký gốc không còn khớp, macOS mới coi là app bị sửa và chặn hẳn.
Đã sửa: bản CI giờ được ký ad-hoc và có bước kiểm tra chữ ký app trong DMG.

Bản ký ad-hoc vẫn chưa phải Developer ID, nên lần đầu mở vẫn cần chuột phải > Open (hoặc
System Settings > Privacy & Security > Open Anyway). Muốn mở bình thường thì ký Developer ID
và notarize như dưới đây.

## Tự build và ký trên Mac (S Hub hoặc Terminal)

Cần: Xcode Command Line Tools, Node 22, chứng chỉ **Developer ID Application** đã có trong Keychain.

```bash
git clone -b claude/project-thread-p3viyl https://github.com/samuelmastercheef/SDrawAi.git
cd SDrawAi
npm ci

# Notarize (chọn một trong hai cách; bỏ qua nếu chỉ muốn ký)
export APPLE_ID="email@apple-id"
export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"   # tạo ở appleid.apple.com
export APPLE_TEAM_ID="ABCDE12345"
# hoặc: APPLE_API_KEY=/đường/dẫn/AuthKey_XXX.p8  APPLE_API_KEY_ID=...  APPLE_API_ISSUER=...

# Chọn chứng chỉ (bỏ qua để electron-builder tự tìm Developer ID trong Keychain)
export CSC_NAME="Tên công ty (ABCDE12345)"
# hoặc dùng tệp .p12: CSC_LINK=/đường/dẫn/cert.p12  CSC_KEY_PASSWORD=...

npm run dist:mac
```

Kết quả: `dist/Sdraw AI-<phiên bản>-arm64.dmg`. Cấu hình ép build arm64 (Apple silicon) kể cả khi Node chạy bản x64/Rosetta; muốn thêm bản Intel thì thêm `x64` vào `build.mac.target[0].arch`.

Lưu ý chứng chỉ: "Apple Development" chỉ dùng chạy trên máy của mình. Phát hành cho người khác cần "Developer ID Application" (Apple Developer Program) và notarize, nếu không máy khác sẽ chặn. Cấu hình sẵn trong `package.json` mục `build.mac`:
hardened runtime và quyền ở `build/entitlements.mac.plist` (Electron cần allow-jit,
allow-unsigned-executable-memory, disable-library-validation). Có biến APPLE_* thì
electron-builder tự gửi notarize và staple; không có thì chỉ ký.

## Ký trên GitHub Actions

Thêm vào Settings > Secrets: `CSC_LINK` (.p12 mã hoá base64), `CSC_KEY_PASSWORD`, `APPLE_ID`,
`APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`; truyền vào bước `npm run dist` của job mac và bỏ
dòng `CSC_IDENTITY_AUTO_DISCOVERY: 'false'`.

## Kiểm tra kết quả

```bash
codesign -dv --verbose=4 "dist/mac-arm64/Sdraw AI.app"
codesign --verify --deep --strict "dist/mac-arm64/Sdraw AI.app"
spctl -a -vv "dist/mac-arm64/Sdraw AI.app"   # mong đợi: accepted, source=Notarized Developer ID
xcrun stapler validate "dist/mac-arm64/Sdraw AI.app"
```

Windows cũng cảnh báo SmartScreen với tệp chưa ký; muốn hết cần chứng chỉ code signing (OV/EV).
