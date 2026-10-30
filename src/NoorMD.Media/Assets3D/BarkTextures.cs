using System.Globalization;

namespace NoorMD.Media.Assets3D;

/// <summary>
/// Bark made for the tree's own colour, as NoorMaterial recipes (so they tile, and come with normal and ORM maps):
/// "bark" deep furrows for realistic trees, "painted" broad hand-painted grooves for the stylized look, "birch" pale
/// with dark marks. Any NoorMaterial preset id works too; an empty one means a plain colour.
/// </summary>
public static class BarkTextures
{
    public static readonly string[] Ids = ["bark", "painted", "birch", "cactus"];

    public static TextureRecipe? For(string id, string barkHex) => id switch
    {
        "bark" => new TextureRecipe
        {
            Name = "Bark", Family = "Wood",
            Surface = new TextureSurface
            {
                Ramp = Ramp((0, Scale(barkHex, 0.25)), (0.4, Scale(barkHex, 0.6)), (0.8, barkHex), (1, Scale(barkHex, 1.3))),
                ColorVariation = 0.25, Dirt = 0.6, RoughnessLow = 0.95, RoughnessHigh = 0.85, NormalStrength = 9, AoStrength = 0.8, AoRadius = 0.03,
            },
            Layers =
            [
                new TextureLayer { Name = "Furrows", Type = "ridged", ScaleX = 8, ScaleY = 2, Octaves = 6, Warp = 0.35, WarpScale = 2 },
                new TextureLayer { Name = "Flakes", Type = "cells", ScaleX = 10, ScaleY = 4, Mode = "edges", Blend = "overlay", Opacity = 0.5 },
            ],
        }.Clamped(),
        "painted" => new TextureRecipe
        {
            Name = "Painted bark", Family = "Wood",
            Surface = new TextureSurface
            {
                Ramp = Ramp((0, Scale(barkHex, 0.45)), (0.45, Scale(barkHex, 0.85)), (0.8, Scale(barkHex, 1.15)), (1, Scale(barkHex, 1.5))),
                ColorVariation = 0.08, Dirt = 0.25, RoughnessLow = 0.9, RoughnessHigh = 0.8, NormalStrength = 4, AoStrength = 0.5, AoRadius = 0.04,
            },
            Layers =
            [
                // Broad plates with dark grooves between them (the ridges turned over).
                new TextureLayer { Name = "Plates", Type = "ridged", ScaleX = 6, ScaleY = 1, Octaves = 2, Warp = 0.3, WarpScale = 2, Invert = true, Gamma = 0.6 },
                new TextureLayer { Name = "Strokes", Type = "noise", ScaleX = 3, ScaleY = 12, Octaves = 2, Blend = "overlay", Opacity = 0.3 },
            ],
        }.Clamped(),
        "birch" => new TextureRecipe
        {
            Name = "Birch bark", Family = "Wood",
            Surface = new TextureSurface
            {
                Ramp = Ramp((0, "#2b2622"), (0.3, "#6a6258"), (0.6, Scale(barkHex, 0.92)), (1, Scale(barkHex, 1.04))),
                ColorVariation = 0.1, Dirt = 0.3, RoughnessLow = 0.85, RoughnessHigh = 0.7, NormalStrength = 3, AoStrength = 0.4, AoRadius = 0.02,
            },
            Layers =
            [
                new TextureLayer { Name = "Skin", Type = "noise", ScaleX = 4, ScaleY = 4, Octaves = 3, Low = 0.1, High = 0.9 },
                // Dark lenticels: short marks across the trunk.
                new TextureLayer { Name = "Marks", Type = "noise", ScaleX = 2, ScaleY = 24, Octaves = 2, Low = 0.6, High = 0.68, Blend = "subtract", Opacity = 0.9 },
            ],
        }.Clamped(),
        "cactus" => new TextureRecipe
        {
            Name = "Cactus skin", Family = "Nature",
            Surface = new TextureSurface
            {
                Ramp = Ramp((0, Scale(barkHex, 0.55)), (0.5, barkHex), (0.85, Scale(barkHex, 1.25)), (1, "#efe6c8")),
                ColorVariation = 0.08, Dirt = 0.15, RoughnessLow = 0.7, RoughnessHigh = 0.6, NormalStrength = 3, AoStrength = 0.4, AoRadius = 0.02,
            },
            Layers =
            [
                // Streaks along the ribs, and pale spine tufts in rows.
                new TextureLayer { Name = "Streaks", Type = "noise", ScaleX = 16, ScaleY = 1, Octaves = 2, Low = 0.15, High = 0.85 },
                new TextureLayer { Name = "Spines", Type = "noise", ScaleX = 24, ScaleY = 24, Octaves = 1, Low = 0.72, High = 0.78, Blend = "screen", Opacity = 0.9 },
            ],
        }.Clamped(),
        _ => null,
    };

    internal static List<RampStop> Ramp(params (double Pos, string Color)[] stops) => stops.Select(s => new RampStop { Pos = s.Pos, Color = s.Color }).ToList();

    /// <summary>A colour made lighter or darker (factor above or below 1).</summary>
    internal static string Scale(string hex, double f)
    {
        var c = LeafAtlas.Hex(hex);
        int B(float v) => (int)Math.Clamp(Math.Round(v * f * 255), 0, 255);
        return string.Create(CultureInfo.InvariantCulture, $"#{B(c.X):x2}{B(c.Y):x2}{B(c.Z):x2}");
    }
}
