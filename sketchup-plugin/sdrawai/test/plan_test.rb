# frozen_string_literal: true

require 'minitest/autorun'
require 'json'
require_relative '../plan'

class PlanTest < Minitest::Test
  ROOM = { 'widthMm' => 5000, 'depthMm' => 4000 }.freeze

  def test_placement_flips_y_and_angle
    x, y, a = Sdrawai::Plan.placement({ 'cx' => 1000, 'cy' => 500, 'rotationDeg' => 90 }, ROOM)
    assert_equal [1000.0, 3500.0, -90.0], [x, y, a]
  end

  def test_placement_default_rotation
    assert_equal [0.0, 4000.0, 0.0], Sdrawai::Plan.placement({ 'cx' => 0, 'cy' => 0 }, ROOM)
  end

  def valid_plan
    { 'format' => 'sdraw-sketchup-plan', 'version' => 1, 'room' => ROOM,
      'items' => [{ 'cx' => 1, 'cy' => 2, 'widthMm' => 3, 'depthMm' => 4 }] }
  end

  def test_validate_accepts_good_plan
    assert_empty Sdrawai::Plan.validate(valid_plan)
  end

  def test_validate_rejects_bad_plans
    refute_empty Sdrawai::Plan.validate('x')
    refute_empty Sdrawai::Plan.validate(valid_plan.merge('format' => 'khac'))
    refute_empty Sdrawai::Plan.validate(valid_plan.merge('version' => 2))
    refute_empty Sdrawai::Plan.validate(valid_plan.merge('room' => { 'widthMm' => 0, 'depthMm' => 1 }))
    bad = valid_plan.merge('items' => [{ 'cx' => 1 }])
    assert_equal 3, Sdrawai::Plan.validate(bad).length
  end

  def test_part_footprint_flips_y_so_front_faces_negative_y
    # Lưng ở y = 0 trong app; mặt trước y = 800. Depth 900.
    back = { 'x' => 0, 'y' => 0, 'w' => 2000, 'd' => 180 }
    front = { 'x' => 0, 'y' => 720, 'w' => 2000, 'd' => 180 }
    assert_equal [[0.0, 720.0], [2000.0, 720.0], [2000.0, 900.0], [0.0, 900.0]], Sdrawai::Plan.part_footprint(back, 900)
    assert_equal [[0.0, 0.0], [2000.0, 0.0], [2000.0, 180.0], [0.0, 180.0]], Sdrawai::Plan.part_footprint(front, 900)
  end

  def test_valid_part
    ok = { 'x' => 0, 'y' => 0, 'z' => 0, 'w' => 10, 'd' => 10, 'h' => 10 }
    assert Sdrawai::Plan.valid_part?(ok)
    refute Sdrawai::Plan.valid_part?(ok.merge('w' => 0))
    refute Sdrawai::Plan.valid_part?(ok.merge('h' => '5'))
    refute Sdrawai::Plan.valid_part?('x')
    refute Sdrawai::Plan.valid_part?(ok.reject { |k, _| k == 'z' })
  end

  def test_valid_mesh_and_triangles
    mesh = { 'vertices' => [0, 0, 0, 100, 0, 0, 0, 50, 0, 0, 0, 80], 'triangles' => [0, 1, 2, 0, 1, 3] }
    assert Sdrawai::Plan.valid_mesh?(mesh)
    refute Sdrawai::Plan.valid_mesh?(mesh.merge('triangles' => [0, 1, 9]))
    refute Sdrawai::Plan.valid_mesh?(mesh.merge('vertices' => [0, 0]))
    refute Sdrawai::Plan.valid_mesh?(mesh.merge('triangles' => []))
    refute Sdrawai::Plan.valid_mesh?(nil)
    tris = Sdrawai::Plan.mesh_triangles(mesh, 50)
    assert_equal 2, tris.length
    # y lật: đỉnh (0,50,0) với depth 50 -> y = 0; đỉnh (0,0,0) -> y = 50
    assert_equal [0.0, 50.0, 0.0], tris[0][0]
    assert_equal [0.0, 0.0, 0.0], tris[0][2]
  end

  def test_degenerate_triangle_dropped
    mesh = { 'vertices' => [0, 0, 0, 1, 0, 0, 2, 0, 0], 'triangles' => [0, 1, 2] }
    assert_empty Sdrawai::Plan.mesh_triangles(mesh, 10)
  end

  def test_guess_category
    assert_equal 'Sofa', Sdrawai::Plan.guess_category('Sofa góc L 2m7')
    assert_equal 'Bàn trà', Sdrawai::Plan.guess_category('ban tra oval')
    assert_equal 'Ghế', Sdrawai::Plan.guess_category('Ghế thư giãn')
    assert_equal 'Chưa phân loại', Sdrawai::Plan.guess_category('abc123')
    assert_equal 'Chưa phân loại', Sdrawai::Plan.guess_category('tablet') # không khớp nửa từ
  end

  def test_library_round_trip
    item = Sdrawai::Plan.library_item(path: '/a/b.skp', name: 'Sofa L', w: 2700.4, d: 899.6, h: 800)
    lib = JSON.parse(JSON.generate(Sdrawai::Plan.library([item])))
    assert_equal 'sdraw-library', lib['format']
    assert_equal [2700, 900, 800], lib['items'][0].values_at('w', 'd', 'h')
    assert_equal 'Sofa', lib['items'][0]['category']
  end
end
