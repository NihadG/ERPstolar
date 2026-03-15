# =============================================
# SketchUp → ERP CSV Export Script
# =============================================
# Pokreni iz SketchUp Ruby Console:
#   load 'C:/putanja/do/sketchup_export.rb'
#
# Prije pokretanja: selektiraj komponente u modelu
# Output: CSV fajl sa kolonama:
#   Naziv;Visina;Sirina;Debljina;Kolicina;Materijal
# =============================================

module ERPExport
  def self.run
    model = Sketchup.active_model
    selection = model.selection

    if selection.empty?
      UI.messagebox("Nema selektovanih komponenti!\nSelektirajte komponente pa pokrenite ponovo.")
      return
    end

    # Collect component data
    components = {}

    selection.each do |entity|
      next unless entity.is_a?(Sketchup::ComponentInstance)

      defn = entity.definition
      name = defn.name

      # Get bounding box dimensions in mm
      bb = defn.bounds
      dims = [
        bb.width.to_mm.round(1),
        bb.height.to_mm.round(1),
        bb.depth.to_mm.round(1)
      ].sort.reverse

      # Dimensions: height (largest), width (middle), thickness (smallest)
      height = dims[0]
      width = dims[1]
      thickness = dims[2]

      # Get material name
      mat_name = ""
      if entity.material
        mat_name = entity.material.display_name
      elsif defn.material
        mat_name = defn.material.display_name
      end

      # Group key: name + dimensions + material
      key = "#{name}|#{height}|#{width}|#{thickness}|#{mat_name}"

      if components.key?(key)
        components[key][:qty] += 1
      else
        components[key] = {
          name: name,
          height: height,
          width: width,
          thickness: thickness,
          qty: 1,
          material: mat_name
        }
      end
    end

    if components.empty?
      UI.messagebox("Nema komponenti u selekciji!")
      return
    end

    # Ask for save location
    path = UI.savepanel("Spremi CSV za ERP", "", "sketchup_export.csv")
    return unless path

    # Ensure .csv extension
    path += ".csv" unless path.downcase.end_with?(".csv")

    # Write CSV with BOM for UTF-8
    File.open(path, "w:UTF-8") do |f|
      f.write("\xEF\xBB\xBF") # UTF-8 BOM
      f.puts "Naziv;Visina;Sirina;Debljina;Kolicina;Materijal"

      components.each_value do |c|
        f.puts "#{c[:name]};#{c[:height]};#{c[:width]};#{c[:thickness]};#{c[:qty]};#{c[:material]}"
      end
    end

    UI.messagebox("Eksportovano #{components.size} komponenti u:\n#{path}")
  end
end

# Auto-run
ERPExport.run
