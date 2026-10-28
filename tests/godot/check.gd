# The Godot import check: run in the project NOORMD_GODOT_OUT wrote (see GodotExportTests), after an import:
#   godot --headless --path <project> --import
#   godot --headless --path <project> --script res://check.gd
# Checks what the NoorMD trees plugin did to each imported tree, and that other scenes were left alone.
extends SceneTree

var failures := 0


func check(ok: bool, what: String, detail: Variant = "") -> void:
	print(("PASS " if ok else "FAIL ") + what + ("" if str(detail) == "" else "  (" + str(detail) + ")"))
	if not ok:
		failures += 1


func meshes(node: Node) -> Array[MeshInstance3D]:
	var found: Array[MeshInstance3D] = []
	if node is MeshInstance3D:
		found.append(node)
	for child in node.get_children():
		found.append_array(meshes(child))
	return found


func named(node: Node, name: String) -> Node:
	return node.find_child(name, true, false)


func wind_materials(node: Node) -> Array:
	var all := []
	for m in meshes(node):
		for s in m.mesh.get_surface_count():
			all.append(m.get_surface_override_material(s))
	return all


func _init() -> void:
	var expected: Dictionary = JSON.parse_string(FileAccess.get_file_as_string("res://expected.json"))
	var at: Array = expected["oak"]

	# A tree in one file: three levels, each seen only between its distances.
	var oak: Node = load("res://trees/oak.glb").instantiate()
	var levels := [named(oak, "Oak_LOD0"), named(oak, "Oak_LOD1"), named(oak, "Oak_LOD2")]
	check(levels.all(func(n): return n != null), "the levels come in as nodes Oak_LOD0…2")
	if levels.all(func(n): return n != null):
		var spans := []
		for level in levels:
			var m: MeshInstance3D = meshes(level)[0]
			spans.append([snappedf(m.visibility_range_begin, 0.01), snappedf(m.visibility_range_end, 0.01)])
		var want := [[0.0, snappedf(at[0], 0.01)], [snappedf(at[0], 0.01), snappedf(at[1], 0.01)], [snappedf(at[1], 0.01), 0.0]]
		check(str(spans) == str(want), "each level has its visibility range (the billboard no far limit)", str(spans) + " want " + str(want))
		check(meshes(levels[1]).all(func(m): return m.visibility_range_end_margin > 0.0), "the switch has a margin so it doesn't flicker")

	# Its materials became the wind shader, with the textures they had.
	var mats := wind_materials(oak)
	check(mats.size() > 0 and mats.all(func(m): return m is ShaderMaterial and m.shader.resource_path.ends_with("noor_tree_wind.gdshader")), "every surface uses the wind shader", mats.size())
	var by_name := {}
	for m in mats:
		if m != null:
			by_name[m.resource_name] = m
	check(by_name.has("Bark") and by_name.has("Leaves") and by_name.has("Billboard"), "materials keep their names", by_name.keys())
	if by_name.has("Bark"):
		var bark: ShaderMaterial = by_name["Bark"]
		check(bark.get_shader_parameter("albedo_texture") is Texture2D, "bark keeps its colour texture")
		check(bark.get_shader_parameter("use_normal_texture") == true and bark.get_shader_parameter("normal_texture") is Texture2D, "bark keeps its normal map")
		check(bark.get_shader_parameter("use_orm_texture") == true, "bark keeps its occlusion/roughness map")
		check(bark.get_shader_parameter("use_alpha_cutoff") == false, "bark is opaque")
		check(bark.get_shader_parameter("wind_in_color") == false and bark.get_shader_parameter("vertex_shading") == true, "wind from UV2, colours are the shading")
		check(float(bark.get_shader_parameter("tree_height")) > 3.0, "the tree's height is set", bark.get_shader_parameter("tree_height"))
	for leafy in ["Leaves", "Billboard"]:
		if by_name.has(leafy):
			var m: ShaderMaterial = by_name[leafy]
			check(m.get_shader_parameter("use_alpha_cutoff") == true and m.get_shader_parameter("albedo_texture") is Texture2D, leafy + " are cut out by their texture's alpha")
	check(by_name.size() == mats.filter(func(m): return m != null).map(func(m): return m.resource_name).reduce(func(a, n): return a if a.has(n) else a + [n], []).size(), "levels share one material each, not a copy per mesh")

	# The wind data arrived: UV2 (TEXCOORD_1) and the colours.
	var trunk: MeshInstance3D = named(levels[0], "Trunk") if levels[0] != null else null
	if trunk != null:
		var format: int = (trunk.mesh as ArrayMesh).surface_get_format(0)
		check(format & Mesh.ARRAY_FORMAT_TEX_UV2 != 0, "the trunk has UV2 (branch bend, leaf flutter)")
		check(format & Mesh.ARRAY_FORMAT_COLOR != 0, "the trunk has vertex colours (shading)")
		print("INFO TEXCOORD_2 as custom data: ", format & Mesh.ARRAY_FORMAT_CUSTOM0 != 0)
	oak.free()

	# Wind in the colours: the shader reads it from COLOR and doesn't shade with it.
	var birch: Node = load("res://trees/birch_colour.glb").instantiate()
	var bm := wind_materials(birch).filter(func(m): return m != null)
	check(bm.size() > 0 and bm.all(func(m): return m.get_shader_parameter("wind_in_color") == true and m.get_shader_parameter("vertex_shading") == false), "wind in vertex colours is read from COLOR")
	birch.free()

	# One level on its own: the wind material, but no range (it would vanish up close).
	var far: Node = load("res://trees/fly_agaric_LOD2.glb").instantiate()
	var fm := meshes(far)
	check(fm.size() > 0 and fm.all(func(m): return m.visibility_range_begin == 0.0 and m.visibility_range_end == 0.0), "a single level gets no distance limits")
	check(wind_materials(far).all(func(m): return m is ShaderMaterial), "…but does get the wind material")
	far.free()

	# Not ours: untouched.
	var plain: Node = load("res://trees/plain.glb").instantiate()
	check(wind_materials(plain).all(func(m): return m == null) and meshes(plain).all(func(m): return m.visibility_range_end == 0.0), "a scene not made by NoorMD is left alone")
	plain.free()

	# The shader itself: its code loads and declares what the plugin sets.
	var shader: Shader = load("res://addons/noor_trees/noor_tree_wind.gdshader")
	check(shader != null and shader.code.contains("shader_type spatial"), "the wind shader loads")

	print("%d failure(s)" % failures)
	quit(1 if failures > 0 else 0)
