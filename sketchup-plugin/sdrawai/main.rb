# frozen_string_literal: true

require 'json'
require 'sketchup.rb'
require_relative 'plan'

module Sdrawai
  def self.to_mm(len)
    len.to_mm
  end

  # ---- Quét thư mục .skp thành thư viện ----
  def self.scan_folder
    folder = UI.select_directory(title: 'Chọn thư mục chứa mẫu .skp')
    return unless folder

    paths = Dir.glob(File.join(folder, '**', '*.skp')).sort
    return UI.messagebox('Không thấy file .skp nào trong thư mục này.') if paths.empty?
    return unless UI.messagebox("Tìm thấy #{paths.length} file. Đo kích thước từng mẫu? (có thể mất vài phút)", MB_YESNO) == IDYES

    model = Sketchup.active_model
    items = []
    skipped = []
    model.start_operation('Sdraw AI: đo mẫu', true)
    begin
      paths.each_with_index do |path, i|
        Sketchup.status_text = "Sdraw AI: đo #{i + 1}/#{paths.length}"
        items << measure(model, path)
      rescue StandardError => e
        skipped << "#{path} (#{e.message})"
      end
    ensure
      model.abort_operation # không để lại định nghĩa tạm trong mô hình của bạn
    end
    items.compact!

    out = UI.savepanel('Lưu thư viện cho Sdraw AI', folder, 'thu-vien.sdlib.json')
    return unless out

    File.write(out, JSON.pretty_generate(Plan.library(items)))
    msg = "Đã ghi #{items.length} mẫu vào:\n#{out}\n\nTrong app Sdraw AI: Thư viện > Tải mẫu lên > chọn file này."
    msg += "\n\nBỏ qua #{skipped.length} file không đọc được." unless skipped.empty?
    UI.messagebox(msg)
  end

  def self.measure(model, path)
    defn = model.definitions.load(path)
    b = defn.bounds
    name = File.basename(path, '.skp')
    Plan.library_item(path: path, name: name, w: to_mm(b.width), d: to_mm(b.height), h: to_mm(b.depth))
  end

  # ---- Dựng bố cục từ app ----
  def self.build_layout
    file = UI.openpanel('Chọn file JSON xuất từ Sdraw AI', '', 'JSON|*.json||')
    return unless file

    plan = JSON.parse(File.read(file))
    errors = Plan.validate(plan)
    return UI.messagebox("Không dựng được:\n- #{errors.join("\n- ")}") unless errors.empty?

    model = Sketchup.active_model
    model.start_operation('Sdraw AI: dựng bố cục', true)
    placed = 0
    missing = []
    begin
      draw_room(model, plan['room'])
      plan['items'].each do |it|
        if place_item(model, it, plan['room'])
          placed += 1
        else
          missing << it['name']
        end
      end
      model.commit_operation
    rescue StandardError => e
      model.abort_operation
      return UI.messagebox("Lỗi khi dựng, đã hoàn tác: #{e.message}")
    end
    msg = "Đã đặt #{placed}/#{plan['items'].length} món."
    msg += "\nCác món sau chưa có file .skp nên được dựng từ thông số hoặc khối hộp:\n- #{missing.join("\n- ")}" unless missing.empty?
    UI.messagebox(msg)
  end

  def self.draw_room(model, room)
    w = room['widthMm'].to_f.mm
    d = room['depthMm'].to_f.mm
    g = model.active_entities.add_group
    g.name = 'Sdraw AI: sàn phòng'
    g.entities.add_face([0, 0, 0], [w, 0, 0], [w, d, 0], [0, d, 0])
  end

  # Dựng món từ danh sách khối 3D thô (mẫu phác thảo chưa có file .skp). Mỗi khối là một nhóm con để dễ chỉnh.
  def self.build_parts(model, parts, depth)
    inst = model.active_entities.add_group
    parts.each do |pt|
      next unless Plan.valid_part?(pt)

      g = inst.entities.add_group
      g.name = pt['name'].to_s
      z = pt['z'].to_f.mm
      h = pt['h'].to_f.mm
      corners = Plan.part_footprint(pt, depth)
      face =
        if pt['kind'] == 'ellipse'
          cx = (corners[0][0] + corners[1][0]) / 2.0
          cy = (corners[0][1] + corners[2][1]) / 2.0
          rx = pt['w'].to_f / 2.0
          ry = pt['d'].to_f / 2.0
          pts = Array.new(48) { |i| a = 2 * Math::PI * i / 48; [(cx + rx * Math.cos(a)).mm, (cy + ry * Math.sin(a)).mm, z] }
          g.entities.add_face(pts)
        else
          g.entities.add_face(corners.map { |x, y| [x.mm, y.mm, z] })
        end
      face.reverse! if face.normal.z < 0
      face.pushpull(h)
    end
    inst
  end

  # Dựng món từ lưới tam giác đọc từ .obj/.glb. Việc lật y và bỏ tam giác suy biến do Plan lo.
  def self.build_mesh(model, mesh, depth)
    inst = model.active_entities.add_group
    pm = Geom::PolygonMesh.new
    Plan.mesh_triangles(mesh, depth).each do |tri|
      pm.add_polygon(tri.map { |x, y, z| Geom::Point3d.new(x.mm, y.mm, z.mm) })
    end
    inst.entities.add_faces_from_mesh(pm, 0)
    inst
  end

  # Trả về true nếu đặt bằng file .skp, false nếu phải dùng khối hộp thay thế.
  def self.place_item(model, it, room)
    x, y, angle = Plan.placement(it, room)
    w = it['widthMm'].to_f.mm
    d = it['depthMm'].to_f.mm
    path = it['skpPath']
    inst = nil
    used_skp = false
    if path && File.file?(path)
      defn = model.definitions.load(path)
      inst = model.active_entities.add_instance(defn, Geom::Transformation.new)
      used_skp = true
    elsif Plan.valid_mesh?(it['mesh'])
      inst = build_mesh(model, it['mesh'], it['depthMm'].to_f)
    elsif it['parts'].is_a?(Array) && it['parts'].any? { |pt| Plan.valid_part?(pt) }
      inst = build_parts(model, it['parts'], it['depthMm'].to_f)
    else
      h = (it['heightMm'] || 800).to_f.mm
      inst = model.active_entities.add_group
      face = inst.entities.add_face([0, 0, 0], [w, 0, 0], [w, d, 0], [0, d, 0])
      face.pushpull(-h)
    end
    inst.name = it['name'].to_s
    # Đưa tâm khối về gốc, quay quanh trục đứng, rồi dời tới vị trí.
    b = inst.bounds
    to_origin = Geom::Transformation.translation([-b.center.x, -b.center.y, -b.min.z])
    rot = Geom::Transformation.rotation([0, 0, 0], [0, 0, 1], angle.degrees)
    move = Geom::Transformation.translation([x.mm, y.mm, 0])
    inst.transform!(move * rot * to_origin)
    used_skp
  end

  unless file_loaded?(__FILE__)
    menu = UI.menu('Plugins').add_submenu('Sdraw AI')
    menu.add_item('Quét thư mục .skp thành thư viện') { scan_folder }
    menu.add_item('Dựng bố cục từ file JSON của app') { build_layout }
    file_loaded(__FILE__)
  end
end
