using NoorMD.Core.Sprite;
using Xunit;

namespace NoorMD.Core.Tests.Sprite;

/// <summary>NoorSprite tilemaps: tilesets and tilemap cels in files, drawn, flattened for Aseprite, and for Godot.</summary>
public class SpriteTilemapTests
{
    /// <summary>A 4 × 4 tileset of three tiles (red, green, blue), and a 24 × 12 sprite with a tilemap layer over an image layer.</summary>
    internal static SpriteDoc Sample()
    {
        var px = new byte[4 * 4 * 4 * 3];
        for (var n = 0; n < 3; n++) for (var i = 0; i < 16; i++) { px[(n * 16 + i) * 4 + n] = 200; px[(n * 16 + i) * 4 + 3] = 255; }
        var doc = new SpriteDoc
        {
            Width = 24, Height = 12,
            Tilesets = [new SpriteTileset { Name = "Ground", TileWidth = 4, TileHeight = 4, Count = 3 }.WithPixels(px)],
            Layers = [new SpriteLayer { Id = "back", Name = "Back" }, new SpriteLayer { Id = "map", Name = "Map", Kind = "tilemap", Tileset = 0 }],
            Frames = [new SpriteFrame(), new SpriteFrame()],
        };
        // 6 × 3 tiles: a row of red-green-blue, then nothing, then all blue.
        doc.Cels.Add(new SpriteCel { Layer = "map", Frame = 0, Width = 6, Height = 3, Tiles = [1, 2, 3, 1, 2, 3, 0, 0, 0, 0, 0, 0, 3 | SpriteTilemap.FlipX, 3, 3, 3, 3, 3] }); // the first of the bottom row flipped
        doc.Cels.Add(new SpriteCel { Layer = "map", Frame = 1, Width = 6, Height = 3, Tiles = [2, 2, 2, 2, 2, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1] });
        doc.Cels.Add(new SpriteCel { Layer = "back", Frame = 0, Width = 1, Height = 1 }.WithPixels([9, 9, 9, 255]));
        return doc.Checked();
    }

    [Fact]
    public void Tilemaps_are_kept_in_the_file_and_drawn_from_their_tiles()
    {
        var doc = Sample();
        var back = SpriteFile.FromBytes(SpriteFile.ToBytes(doc));
        Assert.Equal(("tilemap", 0), (back.Layers[1].Kind, back.Layers[1].Tileset));
        Assert.Equal(doc.Tilesets[0].Pixels(), back.Tilesets[0].Pixels());
        Assert.Equal(doc.Cel("map", 0)!.Tiles, back.Cel("map", 0)!.Tiles);
        var px = SpriteTilemap.Render(back.Cel("map", 0)!, back.Tilesets[0], 24, 12);
        Assert.Equal(200, px[(1 * 24 + 1) * 4 + 0]);        // tile 1 (red) at the top left
        Assert.Equal(200, px[(1 * 24 + 5) * 4 + 1]);        // tile 2 (green) next to it
        Assert.Equal(0, px[(5 * 24 + 5) * 4 + 3]);          // the empty middle row
        Assert.Equal(200, px[(9 * 24 + 22) * 4 + 2]);       // blue along the bottom
        // Numbers past the tileset are taken as no tile; a map of the wrong size is refused.
        var bad = Sample(); bad.Cels[0].Tiles![0] = 99;
        Assert.Equal(0, bad.Checked().Cels[0].Tiles![0]);
        var worse = Sample(); worse.Cels[0].Tiles = [1, 2];
        Assert.Throws<InvalidDataException>(() => worse.Checked());
        Assert.Throws<InvalidDataException>(() => new SpriteTileset { TileWidth = 4, TileHeight = 4, Count = 2 }.WithPixels(new byte[10]).Checked());
    }

    [Fact]
    public void Isometric_tilesets_and_mirrored_tags_are_kept_and_go_to_godot_as_diamonds()
    {
        var doc = Sample();
        doc.Tilesets[0].Isometric = true;
        doc.Tags = [new SpriteTag { Name = "walk_right", From = 0, To = 0 }, new SpriteTag { Name = "walk_left", From = 1, To = 1, Mirror = "walk_right" }];
        var back = SpriteFile.FromBytes(SpriteFile.ToBytes(doc));
        Assert.True(back.Tilesets[0].Isometric);
        Assert.Equal("walk_right", back.Tags[1].Mirror);
        Assert.Null(back.Tags[0].Mirror);
        // 4 × 4 tiles: diamonds 4 × 2, the pictures standing one pixel up from them.
        var tres = GodotTiles.TileSet("t.png", back.Tilesets[0]);
        Assert.Contains("tile_shape = 1", tres);
        Assert.Contains("tile_layout = 5", tres);
        Assert.Contains("tile_size = Vector2i(4, 2)", tres);
        Assert.Contains("0:0/0/texture_origin = Vector2i(0, 1)", tres);
        Assert.DoesNotContain("tile_shape", GodotTiles.TileSet("t.png", Sample().Tilesets[0]));
    }

    [Fact]
    public void A_collision_polygon_goes_in_the_scene_and_changes_with_the_frames()
    {
        List<IReadOnlyList<(double X, double Y)>> polys = [[(0, 0), (8, 0), (8, 8)], [(0, 0), (8, 0), (8, 8), (0, 8)]];
        var scene = GodotSprite.HitboxScene("Hero", "hero.tres", [100, 100], [], [], 8, 8, null, polys);
        Assert.Contains("[node name=\"CollisionPolygon2D\" type=\"CollisionPolygon2D\" parent=\"Collision\"]\npolygon = PackedVector2Array(-4, -4, 4, -4, 4, 4)", scene);
        Assert.Contains("NodePath(\"Collision/CollisionPolygon2D:polygon\")", scene);
        Assert.Contains("PackedVector2Array(-4, -4, 4, -4, 4, 4, -4, 4)", scene);
        // Polygons that don't match the frames are left out.
        Assert.DoesNotContain("CollisionPolygon2D", GodotSprite.HitboxScene("Hero", "hero.tres", [100, 100], [], [], 8, 8, null, polys.Take(1).ToList()));
    }

    [Fact]
    public void Aseprite_gets_the_tilemap_drawn_as_an_image_layer()
    {
        var (back, _) = AsepriteFile.Read(AsepriteFile.Write(Sample()));
        Assert.All(back.Layers, l => Assert.Equal("image", l.Kind));
        var cel = back.Cel(back.Layers[1].Id, 1)!;
        var full = new byte[24 * 12 * 4];
        for (var y = 0; y < cel.Height; y++) Array.Copy(cel.Pixels(), y * cel.Width * 4, full, ((cel.Y + y) * 24 + cel.X) * 4, cel.Width * 4);
        Assert.Equal(200, full[(1 * 24 + 1) * 4 + 1]);      // frame 1: green across the top
        Assert.Equal(200, full[(10 * 24 + 22) * 4 + 0]);    // and a red tile at the bottom right
    }

    [Fact]
    public void Godot_gets_a_tileset_and_a_tilemap_placing_the_tiles()
    {
        var doc = Sample();
        var ts = doc.Tilesets[0];
        Assert.Equal(2, GodotTiles.Columns(ts));
        var atlas = GodotTiles.Atlas(ts);
        Assert.Equal((8, 8), (atlas.Width, atlas.Height));
        Assert.Equal(200, atlas.Rgba[(4 * 8 + 0) * 4 + 2]);  // tile 3 (blue) on the second row
        var tres = GodotTiles.TileSet("ground.png", ts);
        Assert.Contains("texture_region_size = Vector2i(4, 4)", tres);
        Assert.Contains("0:0/0 = 0\n1:0/0 = 0\n0:1/0 = 0\n", tres);
        var scene = GodotTiles.Scene("Level", "ground.tres", doc.Cel("map", 0)!, ts);
        Assert.Contains("type=\"TileMap\"", scene);
        // Cell (1, 0) is tile 2: atlas (1, 0) → 1 | (1 << 16); cell (0, 2) is tile 3 flipped across: atlas (0, 1),
        // Godot's flip flag (4096) as its alternative.
        Assert.Contains("1, 65536, 0", scene);
        Assert.Contains($"{2 << 16}, 0, {1 | (4096 << 16)}", scene);
        Assert.Equal(12 * 3, scene.Split("PackedInt32Array(")[1].TrimEnd(')', '\n').Split(", ").Length);
    }
    [Fact]
    public void The_pages_tilemap_json_is_read_as_sent()
    {
        // As NoorSprite's page sends it: a tileset strip as base64, a tilemap cel of tile numbers with no pixels.
        var tile = new byte[2 * 2 * 4];
        for (var i = 0; i < 4; i++) { tile[i * 4] = 255; tile[i * 4 + 3] = 255; }
        var json = "{\"version\":1,\"width\":4,\"height\":2,\"palette\":[],\"layers\":[{\"id\":\"L1\",\"name\":\"Tilemap 1\",\"visible\":true,\"locked\":false,\"opacity\":255,\"blend\":\"normal\",\"kind\":\"tilemap\",\"tileset\":0}],"
            + "\"frames\":[{\"duration\":100}],\"tags\":[],\"slices\":[],\"tilesets\":[{\"name\":\"Tiles 1\",\"tileWidth\":2,\"tileHeight\":2,\"count\":1,\"data\":\"" + Convert.ToBase64String(tile) + "\"}],"
            + "\"gridWidth\":2,\"gridHeight\":2,\"cels\":[{\"layer\":\"L1\",\"frame\":0,\"x\":0,\"y\":0,\"width\":2,\"height\":1,\"opacity\":255,\"tiles\":[0,1]}]}";
        var doc = SpriteDoc.FromJson(json);
        Assert.Equal("tilemap", doc.Layers[0].Kind);
        Assert.Equal([0, 1], doc.Cels[0].Tiles!);
        var px = SpriteTilemap.Render(doc.Cels[0], doc.Tilesets[0], 4, 2);
        Assert.Equal(0, px[3]);
        Assert.Equal(255, px[2 * 4]);
        var again = SpriteFile.FromBytes(SpriteFile.ToBytes(doc));
        Assert.Equal([0, 1], again.Cels[0].Tiles!);
        Assert.Equal(tile, again.Tilesets[0].Tile(1));
    }
    [Fact]
    public void Turned_tiles_are_drawn_turned_and_go_to_godot_with_its_flags()
    {
        // A 2 × 2 tile: red top left, the rest clear.
        var tile = new byte[16]; tile[0] = 255; tile[3] = 255;
        var ts = new SpriteTileset { TileWidth = 2, TileHeight = 2, Count = 1 }.WithPixels(tile);
        Assert.Equal(255, SpriteTilemap.Turned(ts, 1 | SpriteTilemap.FlipX)[4]);                            // top right
        Assert.Equal(255, SpriteTilemap.Turned(ts, 1 | SpriteTilemap.FlipY)[8]);                            // bottom left
        Assert.Equal(255, SpriteTilemap.Turned(ts, 1 | SpriteTilemap.FlipD | SpriteTilemap.FlipX)[4]);      // a quarter turn clockwise: top right
        var cel = new SpriteCel { Width = 1, Height = 1, Tiles = [1 | SpriteTilemap.FlipX | SpriteTilemap.FlipD] };
        Assert.Contains("PackedInt32Array(0, 0, " + (20480 << 16) + ")", GodotTiles.Scene("Map", "t.tres", cel, ts));
        var doc = new SpriteDoc
        {
            Width = 2, Height = 2, Tilesets = [ts], Frames = [new SpriteFrame()],
            Layers = [new SpriteLayer { Id = "m", Name = "M", Kind = "tilemap" }],
            Cels = [new SpriteCel { Layer = "m", Frame = 0, Width = 1, Height = 1, Tiles = [1 | SpriteTilemap.FlipD] }],
        }.Checked();
        Assert.Equal(1 | SpriteTilemap.FlipD, SpriteFile.FromBytes(SpriteFile.ToBytes(doc)).Cels[0].Tiles![0]);
    }
}
