namespace NoorMD.Media.Assets3D;

/// <summary>
/// Rock surfaces made for the rock's own colour, as Texture Bench recipes (tiling, with normal and ORM maps):
/// "rock" weathered and pitted, "granite" speckled, "sandstone" in layers (the bands follow the height, as the rock's
/// UVs do), "mossy" with moss in the hollows, "snowy" with snow lying in patches, "painted" broad hand-painted planes
/// for the stylized look. Any Texture Bench preset id works too; an empty one means a plain colour.
/// </summary>
public static class RockTextures
{
    public static readonly string[] Ids = ["rock", "granite", "sandstone", "mossy", "snowy", "painted"];


    private static TextureRecipe Weathered(string name, string hex, params TextureLayer[] extra) => new TextureRecipe
    {
        Name = name, Family = "Stone",
        Surface = new TextureSurface
        {
            Ramp = BarkTextures.Ramp((0, BarkTextures.Scale(hex, 0.35)), (0.45, BarkTextures.Scale(hex, 0.8)), (0.8, hex), (1, BarkTextures.Scale(hex, 1.25))),
            ColorVariation = 0.2, Dirt = 0.45, RoughnessLow = 0.95, RoughnessHigh = 0.8, NormalStrength = 7, AoStrength = 0.7, AoRadius = 0.03,
        },
        Layers =
        [
            new TextureLayer { Name = "Weathering", Type = "musgrave", Mode = "hybrid", ScaleX = 3, ScaleY = 3, Octaves = 7, Warp = 0.25, WarpScale = 2 },
            new TextureLayer { Name = "Pits", Type = "turbulence", ScaleX = 14, ScaleY = 14, Octaves = 4, Blend = "overlay", Opacity = 0.45 },
            // A few fine cracks, faint (rock faces break along the mesh's own edges).
            new TextureLayer { Name = "Cracks", Type = "cells", Mode = "cracks", ScaleX = 3, ScaleY = 3, Jitter = 1, Warp = 0.4, WarpScale = 4, Blend = "multiply", Opacity = 0.25, SeedShift = 5 },
            .. extra,
        ],
    }.Clamped();

    /// <summary>Moss for the tops of rocks, in its colour: soft clumps with lighter tips.</summary>
    public static TextureRecipe Moss(string hex) => new TextureRecipe
    {
        Name = "Moss", Family = "Nature",
        Surface = new TextureSurface
        {
            Ramp = BarkTextures.Ramp((0, BarkTextures.Scale(hex, 0.45)), (0.6, BarkTextures.Scale(hex, 0.85)), (1, BarkTextures.Scale(hex, 1.12))),
            ColorVariation = 0.1, Dirt = 0.2, RoughnessLow = 1, RoughnessHigh = 0.9, NormalStrength = 4, AoStrength = 0.6, AoRadius = 0.02,
        },
        Layers =
        [
            new TextureLayer { Name = "Clumps", Type = "cells", Mode = "smooth", ScaleX = 10, ScaleY = 10, Jitter = 1 },
            new TextureLayer { Name = "Fuzz", Type = "turbulence", ScaleX = 40, ScaleY = 40, Octaves = 3, Blend = "overlay", Opacity = 0.5 },
        ],
    }.Clamped();

    public static TextureRecipe? For(string id, string hex) => id switch
    {
        "rock" => Weathered("Weathered rock", hex),
        "mossy" => Weathered("Mossy rock", hex,
            new TextureLayer { Name = "Moss", Type = "current", ScaleX = 1, ScaleY = 1, Invert = true, Low = 0.5, High = 0.72, Warp = 0.5, WarpScale = 10, Opacity = 0, Tint = "#4f6d28", TintAmount = 0.85, RoughnessShift = 0.1 },
            new TextureLayer { Name = "Moss tufts", Type = "turbulence", ScaleX = 40, ScaleY = 40, Octaves = 3, Opacity = 0, Low = 0.45, Tint = "#6f8f2e", TintAmount = 0.2 }),
        "snowy" => Weathered("Snowy rock", hex,
            new TextureLayer { Name = "Snow", Type = "current", ScaleX = 1, ScaleY = 1, Low = 0.6, High = 0.68, Warp = 0.4, WarpScale = 8, Blend = "max", Opacity = 0.35, Tint = "#eef3f8", TintAmount = 1, RoughnessShift = -0.2 }),
        "granite" => new TextureRecipe
        {
            Name = "Granite", Family = "Stone",
            Surface = new TextureSurface
            {
                Ramp = BarkTextures.Ramp((0, "#1d1c1c"), (0.3, BarkTextures.Scale(hex, 0.7)), (0.7, hex), (0.9, BarkTextures.Scale(hex, 1.3)), (1, "#e8e2da")),
                ColorVariation = 0.12, Dirt = 0.3, RoughnessLow = 0.85, RoughnessHigh = 0.65, NormalStrength = 4, AoStrength = 0.5, AoRadius = 0.02,
            },
            Layers =
            [
                new TextureLayer { Name = "Body", Type = "noise", ScaleX = 3, ScaleY = 3, Octaves = 5, Low = 0.15, High = 0.85 },
                // Crystals: dark and pale grains.
                new TextureLayer { Name = "Grains", Type = "cells", Mode = "cells", ScaleX = 48, ScaleY = 48, Blend = "overlay", Opacity = 0.6, SeedShift = 2 },
                new TextureLayer { Name = "Specks", Type = "cells", Mode = "cells", ScaleX = 96, ScaleY = 96, Gamma = 3, Blend = "multiply", Opacity = 0.35, SeedShift = 9 },
            ],
        }.Clamped(),
        "sandstone" => new TextureRecipe
        {
            Name = "Sandstone", Family = "Stone",
            Surface = new TextureSurface
            {
                Ramp = BarkTextures.Ramp((0, BarkTextures.Scale(hex, 0.45)), (0.5, BarkTextures.Scale(hex, 0.9)), (0.85, BarkTextures.Scale(hex, 1.1)), (1, BarkTextures.Scale(hex, 1.3))),
                ColorVariation = 0.15, Dirt = 0.4, RoughnessLow = 0.95, RoughnessHigh = 0.85, NormalStrength = 6, AoStrength = 0.6, AoRadius = 0.03,
            },
            Layers =
            [
                // Layers across the height (the rock's side UVs run v down the height).
                new TextureLayer { Name = "Beds", Type = "noise", ScaleX = 1, ScaleY = 12, Octaves = 4, Warp = 0.15, WarpScale = 3 },
                new TextureLayer { Name = "Grit", Type = "turbulence", ScaleX = 20, ScaleY = 20, Octaves = 3, Blend = "overlay", Opacity = 0.4 },
            ],
        }.Clamped(),
        "painted" => new TextureRecipe
        {
            Name = "Painted rock", Family = "Stone",
            Surface = new TextureSurface
            {
                Ramp = BarkTextures.Ramp((0, BarkTextures.Scale(hex, 0.6)), (0.5, hex), (1, BarkTextures.Scale(hex, 1.3))),
                RampMode = "ease", ColorVariation = 0.06, Dirt = 0.15, RoughnessLow = 0.9, RoughnessHigh = 0.8, NormalStrength = 2, AoStrength = 0.3, AoRadius = 0.04,
            },
            Layers =
            [
                // Broad soft tones (the vertex colours do the light), brush strokes across, a little grain.
                new TextureLayer { Name = "Tones", Type = "noise", ScaleX = 2, ScaleY = 2, Octaves = 3, Low = 0.3, High = 0.7 },
                new TextureLayer { Name = "Strokes", Type = "noise", ScaleX = 10, ScaleY = 3, Octaves = 2, Blend = "overlay", Opacity = 0.3 },
                new TextureLayer { Name = "Grain", Type = "noise", ScaleX = 32, ScaleY = 32, Octaves = 1, Blend = "overlay", Opacity = 0.12 },
            ],
        }.Clamped(),
        _ => null,
    };
}
