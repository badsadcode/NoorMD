namespace NoorMD.Media.Assets3D;

/// <summary>
/// The Godot 4 import plugin for Asset Bench trees (addons/noor_trees): once it is on (Project Settings → Plugins), every
/// imported GLB that NoorMD made gets its levels of detail switched by distance (visibility ranges from the file's own
/// extras) and its materials swapped for the wind shader, keeping their textures. Other scenes are left alone. Each
/// option can be turned off per file in the Import dock.
/// </summary>
public static class GodotAddon
{
    public const string Folder = "noor_trees";
    public const int Version = 3;
    /// <summary>The first line of every file, so a later export can tell our files (and how old they are) from yours.</summary>
    public static string Header => $"NoorMD Asset Bench, Godot tree import v{Version}";

    /// <summary>The plugin's files, with LF line endings whatever the checkout used (Godot writes its files that way).</summary>
    public static IReadOnlyList<(string Name, string Text)> Files => new[]
    {
        ("plugin.cfg", PluginCfg),
        ("plugin.gd", PluginGd),
        ("noor_tree_import.gd", ImportGd),
        ("noor_tree_wind.gdshader", WindShaders.Godot.Replace("// NoorMD Asset Bench: tree wind for Godot 4.", "// " + Header + ": tree wind.")),
        ("README.txt", Readme),
    }.Select(f => (f.Item1, f.Item2.ReplaceLineEndings("\n"))).ToList();

    /// <summary>
    /// Writes the plugin into <paramref name="addonsFolder"/>/noor_trees. A file of ours from an older version is
    /// updated; one that isn't ours (no header) or is as new is kept. Returns the files written.
    /// </summary>
    public static List<string> WriteTo(string addonsFolder)
    {
        var dir = Path.Combine(addonsFolder, Folder);
        Directory.CreateDirectory(dir);
        var written = new List<string>();
        foreach (var (name, text) in Files)
        {
            var path = Path.Combine(dir, name);
            if (File.Exists(path) && !Older(File.ReadLines(path).FirstOrDefault() ?? "")) continue;
            File.WriteAllText(path, text, new System.Text.UTF8Encoding(false));
            written.Add(path);
        }
        return written;
    }

    private static bool Older(string firstLine)
    {
        var at = firstLine.IndexOf("Godot tree import v", StringComparison.Ordinal);
        return at >= 0 && int.TryParse(firstLine[(at + 19)..].Trim().Split(' ', ':')[0], out var v) && v < Version;
    }

    /// <summary>The Godot project a folder is in (the nearest folder above it holding project.godot), or null.</summary>
    public static string? ProjectOf(string folder)
    {
        for (var d = new DirectoryInfo(Path.GetFullPath(folder)); d != null; d = d.Parent)
            if (File.Exists(Path.Combine(d.FullName, "project.godot"))) return d.FullName;
        return null;
    }

    private static string PluginCfg => $"""
        ; {Header}
        [plugin]

        name="NoorMD trees"
        description="Sets up trees from the NoorMD Asset Bench on import: levels of detail switched by distance, and wind."
        author="NoorMD"
        version="{Version}"
        script="plugin.gd"

        """;

    private static string PluginGd => $$"""
        # {{Header}}
        @tool
        extends EditorPlugin

        var _import: EditorScenePostImportPlugin


        func _enter_tree() -> void:
        	_import = preload("noor_tree_import.gd").new()
        	add_scene_post_import_plugin(_import)


        func _exit_tree() -> void:
        	remove_scene_post_import_plugin(_import)
        	_import = null

        """;

    private static string ImportGd => $$"""
        # {{Header}}
        # Trees exported by the NoorMD Asset Bench carry glTF extras, which Godot keeps as each node's "extras" metadata:
        # the tree's root has noor_tree, noor_height and noor_wind ("uv", "color" or "none"); each level's root has
        # noor_lod, noor_visible_from and noor_visible_to (metres; 0 = no limit). Scenes without them are left alone.
        @tool
        extends EditorScenePostImportPlugin

        const SHADER := "noor_tree_wind.gdshader"


        func _get_import_options(_path: String) -> void:
        	add_import_option_advanced(TYPE_BOOL, "noormd_trees/enabled", true)
        	add_import_option_advanced(TYPE_BOOL, "noormd_trees/lod_ranges", true)
        	add_import_option_advanced(TYPE_FLOAT, "noormd_trees/lod_distance_scale", 1.0, PROPERTY_HINT_RANGE, "0.1,10,0.05")
        	add_import_option_advanced(TYPE_BOOL, "noormd_trees/wind_material", true)


        func _post_process(scene: Node) -> void:
        	if not _option("noormd_trees/enabled", true):
        		return
        	var trees: Array[Node] = []
        	_find(scene, "noor_tree", trees)
        	if trees.is_empty():
        		return
        	var shader: Shader = load(get_script().resource_path.get_base_dir().path_join(SHADER))
        	var made := {}
        	for tree in trees:
        		var about: Dictionary = tree.get_meta("extras")
        		var levels: Array[Node] = []
        		_find(tree, "noor_lod", levels)
        		if levels.size() > 1 and _option("noormd_trees/lod_ranges", true):
        			var scale := float(_option("noormd_trees/lod_distance_scale", 1.0))
        			for level in levels:
        				_set_range(level, level.get_meta("extras"), scale)
        		if shader != null and _option("noormd_trees/wind_material", true):
        			for node in _meshes(tree):
        				for s in node.mesh.get_surface_count():
        					var source := node.get_active_material(s)
        					if source is BaseMaterial3D:
        						if not made.has(source):
        							made[source] = _wind_material(source, shader, about)
        						node.set_surface_override_material(s, made[source])


        func _option(name: String, fallback: Variant) -> Variant:
        	var value: Variant = get_option_value(name)
        	return fallback if value == null else value


        func _find(node: Node, key: String, into: Array[Node]) -> void:
        	if node.has_meta("extras"):
        		var extras: Variant = node.get_meta("extras")
        		if extras is Dictionary and extras.has(key):
        			into.append(node)
        	for child in node.get_children():
        		_find(child, key, into)


        func _meshes(node: Node) -> Array[MeshInstance3D]:
        	var found: Array[MeshInstance3D] = []
        	if node is MeshInstance3D and node.mesh != null:
        		found.append(node)
        	for child in node.get_children():
        		found.append_array(_meshes(child))
        	return found


        # Each level is seen only between its distances (a little overlap so the switch doesn't flicker back and forth).
        func _set_range(level: Node, extras: Dictionary, scale: float) -> void:
        	var from := float(extras.get("noor_visible_from", 0.0)) * scale
        	var to := float(extras.get("noor_visible_to", 0.0)) * scale
        	for node in _meshes(level):
        		node.visibility_range_begin = from
        		node.visibility_range_begin_margin = from * 0.05
        		node.visibility_range_end = to
        		node.visibility_range_end_margin = to * 0.05
        		node.visibility_range_fade_mode = GeometryInstance3D.VISIBILITY_RANGE_FADE_DISABLED


        # The wind shader with the imported material's textures and settings.
        func _wind_material(source: BaseMaterial3D, shader: Shader, about: Dictionary) -> ShaderMaterial:
        	var m := ShaderMaterial.new()
        	m.shader = shader
        	m.resource_name = source.resource_name
        	m.set_shader_parameter("albedo_texture", source.albedo_texture)
        	m.set_shader_parameter("use_albedo_texture", source.albedo_texture != null)
        	m.set_shader_parameter("albedo_tint", source.albedo_color)
        	m.set_shader_parameter("use_alpha_cutoff", source.transparency == BaseMaterial3D.TRANSPARENCY_ALPHA_SCISSOR)
        	# Leaves (cut out) let light through from behind.
        	m.set_shader_parameter("backlight", 0.35 if source.transparency == BaseMaterial3D.TRANSPARENCY_ALPHA_SCISSOR else 0.0)
        	m.set_shader_parameter("alpha_cutoff", source.alpha_scissor_threshold)
        	m.set_shader_parameter("roughness", source.roughness)
        	m.set_shader_parameter("metallic", source.metallic)
        	if source.normal_enabled and source.normal_texture != null:
        		m.set_shader_parameter("normal_texture", source.normal_texture)
        		m.set_shader_parameter("use_normal_texture", true)
        		m.set_shader_parameter("normal_strength", source.normal_scale)
        	if source.roughness_texture != null:
        		m.set_shader_parameter("orm_texture", source.roughness_texture)
        		m.set_shader_parameter("use_orm_texture", true)
        	if source.emission_enabled:
        		m.set_shader_parameter("emission", source.emission * source.emission_energy_multiplier)
        	# Small textures drawn as crisp pixels (the glTF said NEAREST, or the tree says so).
        	var sharp := bool(about.get("noor_sharp", false)) or source.texture_filter in [BaseMaterial3D.TEXTURE_FILTER_NEAREST, BaseMaterial3D.TEXTURE_FILTER_NEAREST_WITH_MIPMAPS, BaseMaterial3D.TEXTURE_FILTER_NEAREST_WITH_MIPMAPS_ANISOTROPIC]
        	m.set_shader_parameter("sharp_pixels", sharp)
        	if sharp:
        		m.set_shader_parameter("albedo_sharp", source.albedo_texture)
        		if source.normal_enabled and source.normal_texture != null:
        			m.set_shader_parameter("normal_sharp", source.normal_texture)
        		if source.roughness_texture != null:
        			m.set_shader_parameter("orm_sharp", source.roughness_texture)
        	var wind := str(about.get("noor_wind", "uv"))
        	m.set_shader_parameter("wind_enabled", wind != "none")
        	m.set_shader_parameter("wind_in_color", wind == "color")
        	m.set_shader_parameter("vertex_shading", wind != "color")
        	m.set_shader_parameter("tree_height", float(about.get("noor_height", 8.0)))
        	return m

        """;

    private static string Readme => $"""
        {Header}

        Trees from the NoorMD Asset Bench, set up on import.

        1. Keep this folder at res://addons/noor_trees (NoorMD puts it there when you export into a Godot project).
        2. Project → Project Settings → Plugins: turn on "NoorMD trees" (once).
        3. Export trees from NoorMD as one file (all levels in it), or reimport the ones you have (Import dock → Reimport).

        Every tree then:
        - switches its levels of detail by distance (each level's MeshInstance3D gets a visibility range; the last one, the
          billboard, has no far limit). Change the distances for a file in the Import dock: NoorMD Trees → Lod Distance Scale.
        - moves in the wind: its materials become the wind shader (noor_tree_wind.gdshader) with the same textures. Set the
          wind on those materials (wind_direction, wind_strength, wind_speed), or turn Wind Material off in the Import dock.

        Scenes not made by NoorMD are not changed.

        """;
}
