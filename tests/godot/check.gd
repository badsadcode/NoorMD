# The Godot import check: run in the project NOORMD_GODOT_OUT wrote (see GodotExportTests), after an import:
#   godot --headless --path <project> --import
#   godot --headless --path <project> --script res://check.gd
# Checks what the NoorMD trees plugin did to each imported tree and rock, and that other scenes were left alone.
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
		check(float(bark.get_shader_parameter("backlight")) == 0.0, "no light through the bark")
		check(bark.get_shader_parameter("wind_in_color") == false and bark.get_shader_parameter("vertex_shading") == true, "wind from UV2, colours are the shading")
		check(float(bark.get_shader_parameter("tree_height")) > 3.0, "the tree's height is set", bark.get_shader_parameter("tree_height"))
	for leafy in ["Leaves", "Billboard"]:
		if by_name.has(leafy):
			var m: ShaderMaterial = by_name[leafy]
			check(m.get_shader_parameter("use_alpha_cutoff") == true and m.get_shader_parameter("albedo_texture") is Texture2D, leafy + " are cut out by their texture's alpha")
			check(float(m.get_shader_parameter("backlight")) > 0.0, leafy + " let light through from behind")
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

	# Small textures (a Thornwake tree): drawn as crisp pixels, the PBR maps kept.
	var small: Node = load("res://trees/pine_small_LOD0.glb").instantiate()
	var sm := wind_materials(small).filter(func(m): return m != null)
	check(sm.size() > 0 and sm.all(func(m): return m.get_shader_parameter("sharp_pixels") == true and m.get_shader_parameter("albedo_sharp") is Texture2D), "small textures are sampled sharp (nearest)")
	check(sm.any(func(m): return m.get_shader_parameter("use_normal_texture") == true and m.get_shader_parameter("normal_sharp") is Texture2D), "…and keep their normal maps")
	small.free()

	# A rock: its levels switched by distance, its own materials kept (no wind), and Godot's convex collision from
	# the "-convcolonly" nodes.
	var rock_at: Array = expected["outcrop"]
	var rock: Node = load("res://trees/outcrop.glb").instantiate()
	var rock_levels := [named(rock, "Outcrop_LOD0"), named(rock, "Outcrop_LOD1"), named(rock, "Outcrop_LOD2")]
	check(rock_levels.all(func(n): return n != null), "a rock's levels come in as nodes Outcrop_LOD0…2")
	if rock_levels.all(func(n): return n != null):
		var rock_spans := []
		for level in rock_levels:
			var m: MeshInstance3D = meshes(level)[0]
			rock_spans.append([snappedf(m.visibility_range_begin, 0.01), snappedf(m.visibility_range_end, 0.01)])
		var rock_want := [[0.0, snappedf(rock_at[0], 0.01)], [snappedf(rock_at[0], 0.01), snappedf(rock_at[1], 0.01)], [snappedf(rock_at[1], 0.01), 0.0]]
		check(str(rock_spans) == str(rock_want), "each rock level has its visibility range", str(rock_spans) + " want " + str(rock_want))
	check(wind_materials(rock).all(func(m): return m == null), "a rock keeps its own materials (no wind shader)")
	var shapes := rock.find_children("*", "CollisionShape3D", true, false)
	check(shapes.size() == 3 and shapes.all(func(c): return c.shape is ConvexPolygonShape3D and c.get_parent() is StaticBody3D), "the rock's three -convcolonly pieces became convex collision shapes", shapes.size())
	check(shapes.all(func(c): return (c.shape as ConvexPolygonShape3D).points.size() <= 34), "…each with at most 34 points")
	check(meshes(rock).all(func(m): return not str(m.name).begins_with("Collision")), "…and are not drawn")
	rock.free()

	# Not ours: untouched.
	var plain: Node = load("res://trees/plain.glb").instantiate()
	check(wind_materials(plain).all(func(m): return m == null) and meshes(plain).all(func(m): return m.visibility_range_end == 0.0), "a scene not made by NoorMD is left alone")
	plain.free()

	# NoorForge: the Godot material beside its maps (found by relative paths), and the textured GLB.
	var forge_mat = load("res://forge/Boulder.tres")
	check(forge_mat is ORMMaterial3D, "a NoorForge export's .tres loads as an ORM material", forge_mat)
	if forge_mat is ORMMaterial3D:
		check(forge_mat.albedo_texture is Texture2D and forge_mat.albedo_texture.resource_path.ends_with("Boulder_BaseColor.png"), "…with its colour map", forge_mat.albedo_texture)
		check(forge_mat.normal_enabled and forge_mat.normal_texture is Texture2D, "…its normal map")
		check(forge_mat.orm_texture is Texture2D and forge_mat.orm_texture.resource_path.ends_with("Boulder_ORM.png"), "…its occlusion/roughness/metal map")
		check(forge_mat.heightmap_texture is Texture2D and not forge_mat.heightmap_enabled, "…and its height map, set but off")
	var forge_scene: Node = load("res://forge/Boulder.glb").instantiate()
	var forge_meshes := meshes(forge_scene)
	check(forge_meshes.size() > 0, "the textured GLB imports")
	if forge_meshes.size() > 0:
		var forge_surface: Material = forge_meshes[0].mesh.surface_get_material(0)
		check(forge_surface is BaseMaterial3D and forge_surface.albedo_texture is Texture2D and forge_surface.normal_enabled, "…with its textures on its material", forge_surface)
	forge_scene.free()

	# NoorSprite: SpriteFrames with an animation per tag (ping-pong there and back), each frame's duration, trimmed
	# frames put back in place; an AnimatedSprite2D scene with sharp pixels.
	var sf = load("res://sprite/hero.tres")
	check(sf is SpriteFrames, "a NoorSprite export's .tres loads as SpriteFrames", sf)
	if sf is SpriteFrames:
		check(sf.has_animation("walk") and sf.has_animation("idle"), "…an animation per tag", sf.get_animation_names())
		check(sf.get_frame_count("walk") == 6 and sf.get_frame_count("idle") == 1, "…walk plays there and back (6 frames), idle 1", [sf.get_frame_count("walk"), sf.get_frame_count("idle")])
		check(is_equal_approx(sf.get_frame_duration("walk", 1), 1.5) and is_equal_approx(sf.get_animation_speed("walk"), 10.0), "…each frame's own duration", sf.get_frame_duration("walk", 1))
		var tex: Texture2D = sf.get_frame_texture("walk", 1)
		check(tex is AtlasTexture and tex.get_width() == 16 and tex.get_height() == 16, "…frames are parts of the sheet, trimmed ones the full size again", [tex, tex.get_width() if tex else 0])
	var hero: Node = load("res://sprite/hero.tscn").instantiate()
	check(hero is AnimatedSprite2D and hero.sprite_frames is SpriteFrames and hero.texture_filter == CanvasItem.TEXTURE_FILTER_NEAREST and hero.autoplay == "walk", "…and the scene is an AnimatedSprite2D with sharp pixels, playing walk", hero)
	hero.free()

	# NoorSprite tilemaps: the TileSet (an atlas of the tiles) and a TileMap placing them.
	var tset = load("res://sprite/ground.tres")
	check(tset is TileSet and tset.get_source_count() == 1 and (tset.get_source(0) as TileSetAtlasSource).get_tiles_count() == 3 and tset.tile_size == Vector2i(4, 4), "a NoorSprite tileset loads as a TileSet of 3 tiles", tset)
	var level: Node = load("res://sprite/level.tscn").instantiate()
	check(level is TileMap and level.texture_filter == CanvasItem.TEXTURE_FILTER_NEAREST, "…and its tilemap as a TileMap with sharp pixels", level)
	if level is TileMap:
		check(level.get_cell_source_id(0, Vector2i(1, 0)) == 0 and level.get_cell_atlas_coords(0, Vector2i(1, 0)) == Vector2i(1, 0), "…tile 2 where it was drawn", level.get_cell_atlas_coords(0, Vector2i(1, 0)))
		check(level.get_cell_atlas_coords(0, Vector2i(5, 2)) == Vector2i(0, 1) and level.get_cell_source_id(0, Vector2i(2, 1)) == -1, "…tile 3 along the bottom, nothing in the empty row", [level.get_cell_atlas_coords(0, Vector2i(5, 2)), level.get_cell_source_id(0, Vector2i(2, 1))])
		check(level.get_used_cells(0).size() == 12, "…12 tiles in all", level.get_used_cells(0).size())
		check(level.get_cell_alternative_tile(0, Vector2i(0, 2)) == 4096 and level.get_cell_atlas_coords(0, Vector2i(0, 2)) == Vector2i(0, 1), "…a flipped tile flipped (Godot's flip flag)", level.get_cell_alternative_tile(0, Vector2i(0, 2)))
	level.free()
	# Terrains (autotiling by sides).
	check(tset.get_terrain_sets_count() == 1 and tset.get_terrain_set_mode(0) == TileSet.TERRAIN_MODE_MATCH_SIDES and tset.get_terrain_name(0, 0) == "Grass", "the tileset has its terrain (match sides)", tset.get_terrain_sets_count())
	var src: TileSetAtlasSource = tset.get_source(0)
	var t2: TileData = src.get_tile_data(Vector2i(1, 0), 0)
	var t3: TileData = src.get_tile_data(Vector2i(0, 1), 0)
	check(t2.terrain_set == 0 and t2.terrain == 0 and t2.get_terrain_peering_bit(TileSet.CELL_NEIGHBOR_TOP_SIDE) == 0 and t2.get_terrain_peering_bit(TileSet.CELL_NEIGHBOR_RIGHT_SIDE) == -1, "…tile 2 joins above", [t2.terrain_set, t2.get_terrain_peering_bit(TileSet.CELL_NEIGHBOR_TOP_SIDE)])
	check(t3.get_terrain_peering_bit(TileSet.CELL_NEIGHBOR_RIGHT_SIDE) == 0 and t3.get_terrain_peering_bit(TileSet.CELL_NEIGHBOR_TOP_SIDE) == -1, "…tile 3 joins on the right", t3.get_terrain_peering_bit(TileSet.CELL_NEIGHBOR_RIGHT_SIDE))
	# Every map layer in one scene.
	var world: Node = load("res://sprite/world.tscn").instantiate()
	check(world is Node2D and world.get_child_count() == 2 and world.get_child(0) is TileMap and world.get_child(0).name == "Ground", "every map layer in one scene, a TileMap each", world.get_child_count())
	check(world.get_child(1).visible == false and is_equal_approx(world.get_child(1).modulate.a, 0.502) and world.get_child(1).get_used_cells(0).size() == 2, "…hidden and see-through as the layers were", [world.get_child(1).visible, world.get_child(1).modulate.a])
	world.free()
	# Hitboxes moving with the frames.
	var hit: Node = load("res://sprite/hero_hit.tscn").instantiate()
	var ap: AnimationPlayer = hit.get_node("AnimationPlayer")
	check(hit is AnimatedSprite2D and ap != null and ap.has_animation("walk") and ap.autoplay == "walk", "hitboxes: an AnimationPlayer playing the tags", ap)
	var shape: CollisionShape2D = hit.get_node("hit/CollisionShape2D")
	check(hit.get_node("hit") is Area2D and shape.shape is RectangleShape2D and shape.shape.size == Vector2(4, 4) and shape.position == Vector2(-6, -6), "…an Area2D a slice, where the slice is", [shape.position, shape.shape.size])
	var walk: Animation = ap.get_animation("walk")
	var pos_track := walk.find_track(NodePath("hit/CollisionShape2D:position"), Animation.TYPE_VALUE)
	var size_track := walk.find_track(NodePath("hit/CollisionShape2D:shape:size"), Animation.TYPE_VALUE)
	check(walk.get_track_count() == 4 and pos_track >= 0 and walk.track_get_key_value(pos_track, 1) == Vector2(3, 1) and walk.track_get_key_value(size_track, 1) == Vector2(6, 2), "…the moving one moved on frame 2", [walk.get_track_count(), walk.track_get_key_value(pos_track, 1) if pos_track >= 0 else null])
	var frame_track := walk.find_track(NodePath(".:frame"), Animation.TYPE_VALUE)
	check(frame_track >= 0 and walk.track_get_key_count(frame_track) == 6 and is_equal_approx(walk.track_get_key_time(frame_track, 1), 0.1), "…the frames turning with their durations", walk.track_get_key_count(frame_track) if frame_track >= 0 else -1)
	hit.free()

	# The shader itself: its code loads and declares what the plugin sets.
	var shader: Shader = load("res://addons/noor_trees/noor_tree_wind.gdshader")
	check(shader != null and shader.code.contains("shader_type spatial"), "the wind shader loads")

	print("%d failure(s)" % failures)
	quit(1 if failures > 0 else 0)
