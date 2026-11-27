# frozen_string_literal: true

# Sdraw AI cho SketchUp: đăng ký tiện ích mở rộng.
require 'sketchup.rb'
require 'extensions.rb'

module Sdrawai
  EXTENSION = SketchupExtension.new('Sdraw AI', File.join('sdrawai', 'main'))
  EXTENSION.description = 'Quét thư mục .skp thành thư viện cho Sdraw AI và dựng bố cục từ app vào SketchUp.'
  EXTENSION.version = '0.4.0'
  EXTENSION.creator = 'Socin'
  Sketchup.register_extension(EXTENSION, true)
end
