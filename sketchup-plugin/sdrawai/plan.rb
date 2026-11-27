# frozen_string_literal: true

# Phần tính toán thuần Ruby (không cần SketchUp) để dễ kiểm thử.
# Toạ độ app: mm, gốc ở góc trên trái phòng, y hướng xuống, góc quay thuận chiều kim đồng hồ.
# Toạ độ SketchUp nhìn từ trên: x sang phải, y hướng lên, góc dương ngược chiều kim đồng hồ.
module Sdrawai
  module Plan
    FORMAT = 'sdraw-sketchup-plan'
    LIBRARY_FORMAT = 'sdraw-library'

    module_function

    # Trả về [x_mm, y_mm, goc_do] của tâm món trong SketchUp.
    def placement(item, room)
      x = item.fetch('cx').to_f
      y = room.fetch('depthMm').to_f - item.fetch('cy').to_f
      angle = -item.fetch('rotationDeg', 0).to_f
      [x.round(1), y.round(1), angle.round(1)]
    end

    # Một khối 3D thô (toạ độ app: y xuống) -> 4 góc đáy theo toạ độ SketchUp (y lên) cùng độ cao z và chiều cao.
    # depth là chiều sâu của món; lật y để mặt trước (y lớn trong app) nằm phía y nhỏ trong SketchUp.
    def part_footprint(part, depth)
      x = part.fetch('x').to_f
      w = part.fetch('w').to_f
      d = part.fetch('d').to_f
      y = depth.to_f - part.fetch('y').to_f - d
      [[x, y], [x + w, y], [x + w, y + d], [x, y + d]]
    end

    # Hợp lệ khi đủ số và kích thước dương; bỏ qua khối hỏng thay vì làm hỏng cả bản dựng.
    def valid_part?(part)
      part.is_a?(Hash) && %w[x y z w d h].all? { |k| part[k].is_a?(Numeric) } &&
        part['w'].positive? && part['d'].positive? && part['h'].positive?
    end

    # Lưới tam giác hợp lệ: đỉnh x,y,z liên tiếp, chỉ số tam giác nằm trong phạm vi.
    def valid_mesh?(mesh)
      return false unless mesh.is_a?(Hash) && mesh['vertices'].is_a?(Array) && mesh['triangles'].is_a?(Array)

      v = mesh['vertices']
      t = mesh['triangles']
      n = v.length / 3
      v.length.positive? && (v.length % 3).zero? && v.all? { |x| x.is_a?(Numeric) } &&
        t.length.positive? && (t.length % 3).zero? && t.all? { |i| i.is_a?(Integer) && i >= 0 && i < n }
    end

    # Các tam giác dưới dạng 3 điểm [x, y, z] mm theo toạ độ SketchUp (lật y như part_footprint); bỏ tam giác suy biến.
    def mesh_triangles(mesh, depth)
      v = mesh['vertices']
      pt = ->(i) { [v[i * 3].to_f, depth.to_f - v[i * 3 + 1].to_f, v[i * 3 + 2].to_f] }
      mesh['triangles'].each_slice(3).map { |a, b, c| [pt.call(a), pt.call(b), pt.call(c)] }.reject do |p, q, r|
        ux, uy, uz = q[0] - p[0], q[1] - p[1], q[2] - p[2]
        vx, vy, vz = r[0] - p[0], r[1] - p[1], r[2] - p[2]
        cx, cy, cz = uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx
        (cx * cx + cy * cy + cz * cz) < 1e-9
      end
    end

    # Kiểm tra bản kế hoạch trước khi chạm vào mô hình. Trả về danh sách lỗi (rỗng nếu hợp lệ).
    def validate(plan)
      errors = []
      return ['Tệp không phải bản kế hoạch Sdraw AI'] unless plan.is_a?(Hash) && plan['format'] == FORMAT
      return ["Phiên bản #{plan['version']} chưa được hỗ trợ"] unless plan['version'] == 1

      room = plan['room']
      errors << 'Thiếu kích thước phòng' unless room.is_a?(Hash) && room['widthMm'].to_f.positive? && room['depthMm'].to_f.positive?
      items = plan['items']
      errors << 'Thiếu danh sách món' unless items.is_a?(Array)
      Array(items).each_with_index do |it, i|
        %w[cx cy widthMm depthMm].each do |k|
          errors << "Món #{i + 1}: thiếu #{k}" unless it.is_a?(Hash) && it[k].is_a?(Numeric)
        end
      end
      errors
    end

    # Phân loại sơ bộ theo tên file: "Sofa góc L.skp" -> "Sofa".
    CATEGORY_WORDS = {
      'Sofa' => %w[sofa sopha], 'Bàn trà' => ['ban tra', 'bàn trà', 'coffee table'],
      'Bàn ăn' => ['ban an', 'bàn ăn', 'dining table'], 'Bàn' => %w[ban bàn table],
      'Ghế' => %w[ghe ghế chair], 'Giường' => %w[giuong giường bed],
      'Kệ tivi' => ['ke tivi', 'kệ tivi', 'tv unit'], 'Kệ sách' => ['ke sach', 'kệ sách', 'bookshelf'],
      'Tủ' => %w[tu tủ cabinet wardrobe]
    }.freeze

    def guess_category(name)
      n = name.to_s.downcase
      CATEGORY_WORDS.each do |cat, words|
        return cat if words.any? { |w| n.match?(/(^|[^[:alnum:]])#{Regexp.escape(w)}([^[:alnum:]]|$)/) }
      end
      'Chưa phân loại'
    end

    # Một dòng thư viện từ kích thước đo trong SketchUp (mm).
    def library_item(path:, name:, w:, d:, h:)
      {
        'name' => name, 'path' => path, 'category' => guess_category(name),
        'w' => w.round, 'd' => d.round, 'h' => h.round
      }
    end

    def library(items)
      { 'format' => LIBRARY_FORMAT, 'version' => 1, 'units' => 'mm', 'items' => items }
    end
  end
end
