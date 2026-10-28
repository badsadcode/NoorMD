namespace NoorMD.Media;

/// <summary>Built-in materials: a starting point to shape (all tile seamlessly).</summary>
public static class TexturePresets
{
    public sealed record Preset(string Id, string Family, string Name, string Description, Func<TextureRecipe> Make);

    private static TextureLayer L(string name, string type, int sx, int sy, Action<TextureLayer>? more = null)
    {
        var l = new TextureLayer { Name = name, Type = type, ScaleX = sx, ScaleY = sy };
        more?.Invoke(l);
        return l;
    }

    private static List<RampStop> Ramp(params (double Pos, string Color)[] stops) => stops.Select(s => new RampStop { Pos = s.Pos, Color = s.Color }).ToList();

    private static TextureRecipe M(string family, string name, TextureSurface surface, params TextureLayer[] layers) =>
        new() { Family = family, Name = name, Layers = [.. layers], Surface = surface };

    public static readonly IReadOnlyList<Preset> All =
    [
        new("stone-cobbles", "Stone", "Cobblestones", "Rounded stones set in dirt.", () => M("Stone", "Cobblestones",
            new() { Ramp = Ramp((0, "#2b2620"), (0.25, "#4a4238"), (0.6, "#7d766c"), (1, "#a59d90")), ColorVariation = 0.3, Dirt = 0.6, RoughnessLow = 0.95, RoughnessHigh = 0.7, NormalStrength = 6, AoStrength = 0.7, AoRadius = 0.03 },
            L("Stones", "cells", 6, 6, l => { l.Mode = "stones"; l.Jitter = 0.85; l.Variation = 0.35; }),
            L("Surface", "noise", 16, 16, l => { l.Octaves = 5; l.Blend = "multiply"; l.Low = 0.1; l.High = 0.9; l.Opacity = 0.35; }))),
        new("stone-mossy", "Stone", "Mossy stones", "Cobbles with moss growing in the gaps between them.", () => M("Stone", "Mossy stones",
            new() { Ramp = Ramp((0, "#2b2620"), (0.25, "#4a4238"), (0.6, "#7d766c"), (1, "#a59d90")), ColorVariation = 0.3, Dirt = 0.5, RoughnessLow = 0.95, RoughnessHigh = 0.7, NormalStrength = 6, AoStrength = 0.7, AoRadius = 0.03 },
            L("Stones", "cells", 6, 6, l => { l.Mode = "stones"; l.Jitter = 0.85; l.Variation = 0.35; }),
            L("Surface", "noise", 16, 16, l => { l.Octaves = 5; l.Blend = "multiply"; l.Low = 0.1; l.High = 0.9; l.Opacity = 0.35; }),
            L("Moss", "current", 1, 1, l => { l.Invert = true; l.Low = 0.45; l.High = 0.75; l.Warp = 0.6; l.WarpScale = 12; l.Opacity = 0; l.Tint = "#4d6b26"; l.TintAmount = 0.9; l.RoughnessShift = 0.05; }),
            L("Moss tufts", "turbulence", 48, 48, l => { l.Octaves = 3; l.Opacity = 0; l.Low = 0.4; l.Tint = "#6f8f2e"; l.TintAmount = 0.25; }))),
        new("stone-snowy", "Stone", "Snowy rock", "Rough rock with snow lying on its tops.", () => M("Stone", "Snowy rock",
            new() { Ramp = Ramp((0, "#2e2d2b"), (0.5, "#6b6862"), (1, "#a8a49c")), ColorVariation = 0.25, Dirt = 0.5, RoughnessLow = 0.95, RoughnessHigh = 0.8, NormalStrength = 8, AoStrength = 0.7 },
            L("Ridges", "ridged", 3, 3, l => { l.Octaves = 7; l.Warp = 0.3; }),
            L("Grit", "turbulence", 12, 12, l => { l.Octaves = 4; l.Blend = "overlay"; l.Opacity = 0.5; }),
            L("Snow", "current", 1, 1, l => { l.Low = 0.63; l.High = 0.72; l.Warp = 0.4; l.WarpScale = 8; l.Blend = "max"; l.Opacity = 0.35; l.Tint = "#eef3f8"; l.TintAmount = 1; l.RoughnessShift = -0.35; }))),
        new("stone-rock", "Stone", "Rough rock", "Cracked, weathered rock face.", () => M("Stone", "Rough rock",
            new() { Ramp = Ramp((0, "#2e2d2b"), (0.5, "#6b6862"), (1, "#a8a49c")), ColorVariation = 0.25, Dirt = 0.5, RoughnessLow = 0.95, RoughnessHigh = 0.8, NormalStrength = 8, AoStrength = 0.7 },
            L("Ridges", "ridged", 3, 3, l => { l.Octaves = 7; l.Warp = 0.3; }),
            L("Grit", "turbulence", 12, 12, l => { l.Octaves = 4; l.Blend = "overlay"; l.Opacity = 0.5; }),
            L("Cracks", "cells", 5, 5, l => { l.Mode = "cracks"; l.Blend = "multiply"; l.Opacity = 0.6; l.SeedShift = 3; }))),
        new("gravel", "Ground", "Gravel", "Loose small stones.", () => M("Ground", "Gravel",
            new() { Ramp = Ramp((0, "#2a2724"), (0.4, "#5d5850"), (0.8, "#8f897e"), (1, "#b2ab9f")), ColorVariation = 0.4, Dirt = 0.7, RoughnessLow = 0.95, RoughnessHigh = 0.75, NormalStrength = 7, AoStrength = 0.8, AoRadius = 0.012 },
            L("Pebbles", "cells", 24, 24, l => { l.Mode = "cells"; l.Gamma = 0.6; }),
            L("Small", "cells", 48, 48, l => { l.Mode = "cells"; l.Blend = "max"; l.Opacity = 0.5; l.SeedShift = 7; l.Gamma = 1.5; }))),
        new("ground-mud", "Ground", "Dried mud", "Cracked, sun-baked mud.", () => M("Ground", "Dried mud",
            new() { Ramp = Ramp((0, "#2c2016"), (0.3, "#5c4632"), (1, "#8e7558")), ColorVariation = 0.2, Dirt = 0.6, RoughnessLow = 0.95, RoughnessHigh = 0.85, NormalStrength = 6, AoStrength = 0.6 },
            L("Ground", "noise", 4, 4, l => { l.Octaves = 6; l.Warp = 0.3; l.Low = 0.2; l.High = 0.8; }),
            L("Cracks", "cells", 7, 7, l => { l.Mode = "cracks"; l.Blend = "multiply"; l.Jitter = 0.9; }))),
        new("ground-soil", "Ground", "Forest soil", "Dark earth with bits of leaf and twig.", () => M("Ground", "Forest soil",
            new() { Ramp = Ramp((0, "#1d140d"), (0.4, "#3b2a1c"), (0.8, "#5a4630"), (1, "#6d6038")), ColorVariation = 0.5, Dirt = 0.4, RoughnessLow = 0.95, RoughnessHigh = 0.85, NormalStrength = 4 },
            L("Earth", "noise", 6, 6, l => { l.Octaves = 6; l.Warp = 0.4; }),
            L("Crumbs", "turbulence", 24, 24, l => { l.Octaves = 3; l.Blend = "overlay"; l.Opacity = 0.6; }),
            L("Twigs", "scratches", 1, 1, l => { l.Count = 30; l.Length = 0.08; l.Width = 0.004; l.Blend = "max"; l.Opacity = 0.7; }))),
        new("ground-wet", "Ground", "Wet ground with puddles", "Muddy earth, the dips filled with shiny water.", () => M("Ground", "Wet ground with puddles",
            new() { Ramp = Ramp((0, "#241a12"), (0.4, "#4a3826"), (1, "#6e5a40")), ColorVariation = 0.4, Dirt = 0.4, RoughnessLow = 0.9, RoughnessHigh = 0.8, NormalStrength = 4 },
            L("Earth", "noise", 4, 4, l => { l.Octaves = 4; l.Warp = 0.4; }),
            // The puddles see only the broad shape of the ground (the crumbs come after them).
            L("Puddles", "current", 1, 1, l => { l.Invert = true; l.Low = 0.56; l.High = 0.6; l.Opacity = 0; l.Tint = "#1c1712"; l.TintAmount = 0.6; l.RoughnessShift = -0.85; }),
            L("Crumbs", "turbulence", 24, 24, l => { l.Octaves = 3; l.Blend = "overlay"; l.Opacity = 0.5; }))),
        new("sand-ripples", "Ground", "Sand ripples", "Wind-blown sand in soft ripples.", () => M("Ground", "Sand ripples",
            new() { Ramp = Ramp((0, "#b39467"), (0.6, "#cfb487"), (1, "#e2cda3")), ColorVariation = 0.2, Dirt = 0.15, RoughnessLow = 0.9, RoughnessHigh = 0.85, NormalStrength = 3 },
            L("Dunes", "noise", 2, 2, l => { l.Octaves = 3; l.Low = 0.2; l.High = 0.8; }),
            L("Ripples", "wood", 12, 2, l => { l.Octaves = 3; l.Persistence = 0.4; l.Blend = "overlay"; l.Opacity = 0.7; }),
            L("Grain", "noise", 64, 64, l => { l.Octaves = 2; l.Blend = "overlay"; l.Opacity = 0.25; }))),
        new("snow", "Ground", "Snow", "Soft, lumpy fresh snow.", () => M("Ground", "Snow",
            new() { Ramp = Ramp((0, "#b9c6d4"), (0.5, "#e6eef6"), (1, "#ffffff")), ColorVariation = 0.15, Dirt = 0.1, RoughnessLow = 0.6, RoughnessHigh = 0.45, NormalStrength = 2.5, AoStrength = 0.4 },
            L("Drifts", "noise", 3, 3, l => { l.Octaves = 5; l.Persistence = 0.45; }),
            L("Clumps", "cells", 20, 20, l => { l.Blend = "overlay"; l.Opacity = 0.3; }))),
        new("wood-planks", "Wood", "Wooden planks", "Staggered floor boards with grain.", () => M("Wood", "Wooden planks",
            new() { Ramp = Ramp((0, "#2a1a0e"), (0.35, "#6b4423"), (0.75, "#9a6a3c"), (1, "#b98a55")), ColorVariation = 0.25, Dirt = 0.5, RoughnessLow = 0.8, RoughnessHigh = 0.55, NormalStrength = 3, AoStrength = 0.6, AoRadius = 0.01 },
            L("Grain", "wood", 9, 3, l => { l.Octaves = 5; l.Warp = 0.15; l.WarpScale = 2; }),
            L("Boards", "bricks", 6, 2, l => { l.Mortar = 0.06; l.Bevel = 0.04; l.Offset = 0.5; l.Variation = 0.25; l.Blend = "multiply"; }))),
        new("wood-bark", "Wood", "Tree bark", "Deeply furrowed bark.", () => M("Wood", "Tree bark",
            new() { Ramp = Ramp((0, "#1a120c"), (0.4, "#3d2c20"), (0.8, "#6a5643"), (1, "#8a7a68")), ColorVariation = 0.3, Dirt = 0.7, RoughnessLow = 0.95, RoughnessHigh = 0.85, NormalStrength = 9, AoStrength = 0.8, AoRadius = 0.03 },
            L("Furrows", "ridged", 8, 2, l => { l.Octaves = 6; l.Warp = 0.35; l.WarpScale = 2; }),
            L("Flakes", "cells", 10, 4, l => { l.Mode = "edges"; l.Blend = "overlay"; l.Opacity = 0.5; }))),
        new("metal-brushed", "Metal", "Brushed metal", "Fine parallel brushing, a few scratches.", () => M("Metal", "Brushed metal",
            new() { Ramp = Ramp((0, "#8a8d91"), (1, "#c9ccd0")), ColorVariation = 0.1, Dirt = 0.05, Metallic = 1, RoughnessLow = 0.45, RoughnessHigh = 0.3, RoughnessVariation = 0.15, NormalStrength = 1, AoStrength = 0.2 },
            L("Brushing", "noise", 2, 128, l => { l.Octaves = 3; l.Persistence = 0.6; }),
            L("Scratches", "scratches", 1, 1, l => { l.Count = 60; l.Length = 0.15; l.Width = 0.0015; l.Blend = "subtract"; l.Opacity = 0.4; }))),
        new("metal-rusty", "Metal", "Rusty metal", "Bare steel eaten by rust: the rust is not metal, the steel is.", () => M("Metal", "Rusty metal",
            new() { Ramp = Ramp((0, "#5c6266"), (1, "#9aa3a8")), ColorVariation = 0.15, Dirt = 0.4, Metallic = 1, RoughnessLow = 0.5, RoughnessHigh = 0.35, NormalStrength = 4, AoStrength = 0.5 },
            L("Pitting", "turbulence", 32, 32, l => { l.Octaves = 3; l.Opacity = 0.5; l.Low = 0.2; }),
            L("Rust", "noise", 3, 3, l => { l.Octaves = 7; l.Warp = 0.5; l.Low = 0.45; l.High = 0.6; l.Blend = "add"; l.Opacity = 0.15; l.Tint = "#7a3815"; l.TintAmount = 0.95; l.RoughnessShift = 0.5; l.MetallicShift = -1; }),
            L("Rust colour", "turbulence", 12, 12, l => { l.Octaves = 4; l.Opacity = 0; l.Tint = "#a85a2a"; l.TintAmount = 0.35; l.Low = 0.3; }))),
        new("metal-painted", "Metal", "Worn painted panels", "Painted metal panels, the paint worn off at the edges to bare steel.", () => M("Metal", "Worn painted panels",
            new() { Ramp = Ramp((0, "#7d8589"), (1, "#a9b1b5")), ColorVariation = 0.05, Dirt = 0.5, Metallic = 1, RoughnessLow = 0.45, RoughnessHigh = 0.35, NormalStrength = 6, AoStrength = 0.6, AoRadius = 0.01 },
            L("Panels", "bricks", 2, 2, l => { l.Offset = 0; l.Mortar = 0.04; l.Bevel = 0.06; l.Variation = 0; }),
            L("Dents", "noise", 6, 6, l => { l.Octaves = 4; l.Blend = "overlay"; l.Opacity = 0.15; }),
            L("Paint", "noise", 8, 8, l => { l.Octaves = 3; l.Opacity = 0; l.Low = 0; l.High = 0.02; l.Tint = "#2f5f8a"; l.TintAmount = 1; l.RoughnessShift = 0.25; l.MetallicShift = -1; }),
            L("Worn edges", "curvature", 2, 1, l => { l.Opacity = 0; l.Low = 0.55; l.High = 0.64; l.Warp = 0.5; l.WarpScale = 16; l.Tint = "#9aa3a8"; l.TintAmount = 1; l.RoughnessShift = -0.25; l.MetallicShift = 1; }),
            L("Scratches", "scratches", 1, 1, l => { l.Count = 40; l.Length = 0.12; l.Width = 0.0015; l.Opacity = 0; l.Tint = "#9aa3a8"; l.TintAmount = 1; l.MetallicShift = 1; l.RoughnessShift = -0.2; }))),
        new("bricks-red", "Walls", "Red bricks", "A wall of red bricks in grey mortar.", () => M("Walls", "Red bricks",
            new() { Ramp = Ramp((0, "#6e6a64"), (0.15, "#8a8580"), (0.2, "#5a2418"), (0.6, "#8e3a26"), (1, "#b0563a")), ColorVariation = 0.35, Dirt = 0.5, RoughnessLow = 0.95, RoughnessHigh = 0.8, NormalStrength = 6, AoStrength = 0.7, AoRadius = 0.015 },
            L("Bricks", "bricks", 4, 8, l => { l.Mortar = 0.12; l.Bevel = 0.08; l.Variation = 0.3; }),
            L("Texture", "noise", 24, 24, l => { l.Octaves = 4; l.Blend = "overlay"; l.Opacity = 0.35; }))),
        new("tiles-floor", "Walls", "Floor tiles", "Glazed square tiles with grout.", () => M("Walls", "Floor tiles",
            new() { Ramp = Ramp((0, "#4b4741"), (0.1, "#6a655d"), (0.2, "#d9d2c3"), (1, "#efe9dc")), ColorVariation = 0.1, Dirt = 0.4, RoughnessLow = 0.9, RoughnessHigh = 0.2, RoughnessVariation = 0.05, NormalStrength = 5, AoStrength = 0.6, AoRadius = 0.008 },
            L("Tiles", "bricks", 4, 4, l => { l.Offset = 0; l.Mortar = 0.06; l.Bevel = 0.03; l.Variation = 0.04; }),
            L("Waviness", "noise", 8, 8, l => { l.Octaves = 3; l.Blend = "overlay"; l.Opacity = 0.12; }))),
        new("fabric-weave", "Fabric", "Woven fabric", "Tight canvas weave.", () => M("Fabric", "Woven fabric",
            new() { Ramp = Ramp((0, "#1c2a44"), (0.6, "#30466e"), (1, "#4a6494")), ColorVariation = 0.15, Dirt = 0.3, RoughnessLow = 0.95, RoughnessHigh = 0.85, NormalStrength = 3, AoStrength = 0.5, AoRadius = 0.004 },
            L("Weave", "weave", 32, 32),
            L("Fuzz", "noise", 64, 64, l => { l.Octaves = 2; l.Blend = "overlay"; l.Opacity = 0.25; }))),
    ];

    public static TextureRecipe Make(string id)
    {
        var p = All.FirstOrDefault(x => x.Id == id) ?? throw new ArgumentException("Unknown preset.");
        var r = p.Make();
        r.Name = p.Name;
        return r.Clamped();
    }
}
