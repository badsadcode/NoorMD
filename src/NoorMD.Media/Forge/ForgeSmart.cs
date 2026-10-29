namespace NoorMD.Media.Forge;

/// <summary>Smart materials: layer stacks that suit any model (they read its shape, not its UVs).</summary>
public static class ForgeSmart
{
    public sealed record Smart(string Id, string Name, string Description, Func<List<ForgeLayer>> Make);

    private static ForgeLayer Mat(string name, string material, double scale, string tint = "#808080") => new() { Name = name, Material = material, Scale = scale, Color = tint };
    private static ForgeLayer Plain(string name, string color, double rough, double metal, ForgeMask mask) => new() { Name = name, Color = color, Roughness = rough, Metallic = metal, UseNormal = false, Mask = mask };

    public static readonly IReadOnlyList<Smart> All =
    [
        new("mossy-stone", "Mossy stone", "Rock with dirt in its cracks, worn light edges and moss on top.", () =>
        [
            Mat("Stone", "stone-rock", 1.5),
            Plain("Dirt in the cracks", "#3a2a1a", 1, 0, new ForgeMask { Kind = "cavity", Amount = 0.45, Noise = 0.4, NoiseScale = 0.3 }),
            Plain("Worn edges", "#c8c0b0", 0.55, 0, new ForgeMask { Kind = "edges", Amount = 0.3, Noise = 0.5, NoiseScale = 0.1 }),
            new ForgeLayer { Name = "Moss", Material = "stone-mossy", Scale = 1, Color = "#585e3e", Mask = new ForgeMask { Kind = "top", Amount = 0.3, Noise = 0.6, NoiseScale = 0.4 } },
        ]),
        new("snowy-rock", "Snowy rock", "Grey rock, snow settled on everything facing up.", () =>
        [
            Mat("Rock", "stone-rock", 2),
            Plain("Dark cracks", "#2a2a2c", 1, 0, new ForgeMask { Kind = "cavity", Amount = 0.4, Noise = 0.3 }),
            new ForgeLayer { Name = "Snow", Material = "snow", Scale = 1.5, Mask = new ForgeMask { Kind = "top", Amount = 0.45, Softness = 0.2, Noise = 0.5, NoiseScale = 0.5 } },
        ]),
        new("painted-metal", "Painted metal, worn", "Painted steel, the paint worn off its edges to bare metal, grime low down.", () =>
        [
            Mat("Bare metal", "metal-brushed", 0.5),
            new ForgeLayer { Name = "Paint", Color = "#2e5c8a", Roughness = 0.45, Metallic = 0, UseNormal = false, Mask = new ForgeMask { Kind = "edges", Amount = 0.25, Invert = true, Noise = 0.6, NoiseScale = 0.05 } },
            Plain("Grime", "#2b2418", 0.95, 0, new ForgeMask { Kind = "height", Amount = 0.25, Noise = 0.5, NoiseScale = 0.2 }),
            Plain("Dirt in corners", "#1e1a14", 1, 0, new ForgeMask { Kind = "cavity", Amount = 0.35, Noise = 0.3 }),
        ]),
        new("rusty-iron", "Rusty iron", "Dark iron rusting from its corners and underside.", () =>
        [
            Mat("Iron", "metal-brushed", 0.5, "#707070"),
            new ForgeLayer { Name = "Rust", Material = "metal-rusty", Scale = 0.6, Mask = new ForgeMask { Kind = "cavity", Amount = 0.55, Noise = 0.7, NoiseScale = 0.12 } },
            new ForgeLayer { Name = "Rust underneath", Material = "metal-rusty", Scale = 0.6, Mask = new ForgeMask { Kind = "bottom", Amount = 0.4, Noise = 0.6, NoiseScale = 0.15 } },
            Plain("Polished edges", "#b0b0b0", 0.3, 1, new ForgeMask { Kind = "edges", Amount = 0.2, Noise = 0.4, NoiseScale = 0.05 }),
        ]),
        new("dusty-wood", "Dusty wood", "Planks with dust settled on top and dark worn corners.", () =>
        [
            Mat("Wood", "wood-planks", 1.2),
            Plain("Dark corners", "#2a1c10", 1, 0, new ForgeMask { Kind = "cavity", Amount = 0.4, Noise = 0.3 }),
            Plain("Rubbed edges", "#a07850", 0.5, 0, new ForgeMask { Kind = "edges", Amount = 0.25, Noise = 0.5, NoiseScale = 0.05 }),
            Plain("Dust", "#b8ad98", 1, 0, new ForgeMask { Kind = "top", Amount = 0.35, Noise = 0.5, NoiseScale = 0.2 }),
        ]),
        new("sandstone", "Weathered sandstone", "Warm sandstone, darker low down, pale worn edges.", () =>
        [
            Mat("Sandstone", "stone-sandstone", 2),
            Plain("Damp base", "#5a4030", 1, 0, new ForgeMask { Kind = "height", Amount = 0.2, Softness = 0.5, Noise = 0.4, NoiseScale = 0.4 }),
            Plain("Pale edges", "#e8d6b0", 0.7, 0, new ForgeMask { Kind = "edges", Amount = 0.3, Noise = 0.5, NoiseScale = 0.1 }),
        ]),
        new("clay", "Plain clay", "One grey layer: to look at the shape and the bakes.", () => [new ForgeLayer { Name = "Clay", Color = "#9a9a9a", Roughness = 0.8 }]),
    ];

    public static List<ForgeLayer> Make(string id) => (All.FirstOrDefault(s => s.Id == id) ?? All[^1]).Make().Select(l => l.Clamped()).ToList();
}

/// <summary>Smart materials of your own: a layer stack saved by name (one .json each in a folder of the app's).</summary>
public static class ForgeUserSmart
{
    public const string Prefix = "mine:";
    public const int MaxCount = 200;

    public sealed class Saved
    {
        public string Name { get; set; } = "";
        public string Description { get; set; } = "";
        public List<ForgeLayer> Layers { get; set; } = [];
    }

    private static readonly System.Text.Json.JsonSerializerOptions Options = new() { PropertyNamingPolicy = System.Text.Json.JsonNamingPolicy.CamelCase, WriteIndented = true };

    /// <summary>The saved ones, by name: (id, saved). Files that can't be read are passed over.</summary>
    public static List<(string Id, Saved Smart)> Load(string folder)
    {
        var all = new List<(string, Saved)>();
        if (!Directory.Exists(folder)) return all;
        foreach (var file in Directory.EnumerateFiles(folder, "*.json").Take(MaxCount))
        {
            try
            {
                if (new FileInfo(file).Length > 400_000) continue;
                var s = System.Text.Json.JsonSerializer.Deserialize<Saved>(File.ReadAllText(file), Options);
                if (s == null || string.IsNullOrWhiteSpace(s.Name)) continue;
                s.Layers = (s.Layers ?? []).Where(l => l != null).Take(ForgeRecipe.MaxLayers).Select(l => l.Clamped()).ToList();
                all.Add((Prefix + Path.GetFileNameWithoutExtension(file), s));
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or System.Text.Json.JsonException) { }
        }
        return all.OrderBy(s => s.Item2.Name, StringComparer.CurrentCultureIgnoreCase).ToList();
    }

    /// <summary>Saves (or replaces, by the same name) a stack; returns its id.</summary>
    public static string Save(string folder, string name, string description, IEnumerable<ForgeLayer> layers)
    {
        name = (name ?? "").Trim();
        if (name.Length == 0) throw new ArgumentException("Give the smart material a name.");
        if (name.Length > 60) name = name[..60];
        var stem = FileStem(name);
        Directory.CreateDirectory(folder);
        var path = Path.Combine(folder, stem + ".json");
        if (!File.Exists(path) && Directory.EnumerateFiles(folder, "*.json").Count() >= MaxCount) throw new ArgumentException($"There are already {MaxCount} smart materials of your own: remove one first.");
        var saved = new Saved { Name = name, Description = (description ?? "").Trim() is var d && d.Length > 200 ? d[..200] : d, Layers = layers.Take(ForgeRecipe.MaxLayers).Select(l => l.Clamped()).ToList() };
        File.WriteAllText(path, System.Text.Json.JsonSerializer.Serialize(saved, Options));
        return Prefix + stem;
    }

    public static bool Delete(string folder, string id)
    {
        if (!id.StartsWith(Prefix, StringComparison.Ordinal)) return false;
        var stem = id[Prefix.Length..];
        if (stem.Length == 0 || stem != FileStem(stem)) return false; // only a name this class made: nothing outside the folder
        var path = Path.Combine(folder, stem + ".json");
        if (!File.Exists(path)) return false;
        File.Delete(path);
        return true;
    }

    /// <summary>A file name from the material's name: letters, digits, spaces, '-' and '_' only.</summary>
    internal static string FileStem(string name)
    {
        var chars = name.Trim().Select(c => char.IsLetterOrDigit(c) || c is ' ' or '-' or '_' ? c : '_').ToArray();
        var stem = new string(chars).Trim(' ', '.');
        return stem.Length == 0 ? "smart" : stem.ToLowerInvariant();
    }
}
