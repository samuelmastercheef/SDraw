// Ký ad-hoc riêng cho bản Mac: đặt định danh org.socin.sdrawai thay cho chữ ký mặc định "Electron".
// Chưa phải chữ ký Developer ID và chưa notarize; chỉ làm cho mã băm của app khác bản Electron gốc.
const { execFileSync } = require('node:child_process')
const path = require('node:path')

exports.default = async function (context) {
  if (context.electronPlatformName !== 'darwin') return
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  // Ký lại toàn bộ thành phần bên trong (Frameworks, Helper) trước, rồi ký vỏ app với định danh riêng.
  // electron-builder đổi tên tệp chạy và Info.plist nên chữ ký gốc của Electron không còn khớp.
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' })
  execFileSync('codesign', ['--force', '--sign', '-', '--identifier', context.packager.appInfo.id, app], { stdio: 'inherit' })
  execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' })
}
