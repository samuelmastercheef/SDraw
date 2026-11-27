#!/bin/sh
# Đóng gói plugin thành sdrawai.rbz (file zip) để cài trong SketchUp:
# Window > Extension Manager > Install Extension.
set -e
cd "$(dirname "$0")"
rm -f sdrawai.rbz
zip -r sdrawai.rbz sdrawai.rb sdrawai -x 'sdrawai/test/*'
echo "Đã tạo $(pwd)/sdrawai.rbz"
