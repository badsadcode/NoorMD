using System.Numerics;
using System.Text;
using NoorMD.Media.Forge;
using NoorMD.Media.Mesh;
using Xunit;

namespace NoorMD.Media.Tests;

/// <summary>NoorMesh's scenes: the .noormesh file, GLB and OBJ out (Y up) and in (Z up again).</summary>
public class MeshDocTests
{
    /// <summary>A 2 m cube (+Z up, faces counter-clockwise from outside), as the page makes it.</summary>
    private static MeshData Cube()
    {
        var v = new float[] { -1, -1, -1, 1, -1, -1, 1, 1, -1, -1, 1, -1, -1, -1, 1, 1, -1, 1, 1, 1, 1, -1, 1, 1 };
        int[][] faces = [[0, 1, 5, 4], [2, 3, 7, 6], [1, 2, 6, 5], [3, 0, 4, 7], [4, 5, 6, 7], [0, 3, 2, 1]];
        return new MeshData { V = v, F = faces.Select(f => new MeshFace { V = f, Uv = [0, 0, 1, 0, 1, 1, 0, 1] }).ToList() };
    }
    private static MeshDoc Scene(float[]? t = null, float[]? r = null, float[]? s = null) =>
        new() { Objects = [new MeshObject { Id = "o1", Name = "Crate", Kind = "cube", T = t ?? [0, 0, 0], R = r ?? [0, 0, 0], S = s ?? [1, 1, 1], Mesh = Cube() }] };
    private static void Near(float want, float got, float eps = 1e-4f) => Assert.InRange(got, want - eps, want + eps);

    [Fact]
    public void The_noormesh_file_keeps_everything()
    {
        var doc = Scene([1, 2, 3], [10, 20, 30], [1, 2, 1]);
        doc.Objects[0].Mesh.F[0].S = true;
        var back = MeshDoc.FromFile(doc.ToFile());
        var o = back.Objects[0];
        Assert.Equal("Crate", o.Name); Assert.Equal([1f, 2f, 3f], o.T); Assert.Equal([10f, 20f, 30f], o.R); Assert.Equal([1f, 2f, 1f], o.S);
        Assert.Equal(Cube().V, o.Mesh.V);
        Assert.Equal(6, o.Mesh.F.Count); Assert.True(o.Mesh.F[0].S); Assert.Equal(8, o.Mesh.F[1].Uv!.Length);
    }

    [Fact]
    public void Materials_go_into_the_file_and_the_glb_and_come_back()
    {
        var doc = Scene();
        doc.Materials = [new MeshMaterial { Id = "m1", Name = "Wood", Color = [0.6f, 0.4f, 0.2f, 1], Roughness = 0.8f }, new MeshMaterial { Id = "m2", Name = "Metal", Color = [0.7f, 0.7f, 0.75f, 1], Roughness = 0.3f, Metallic = 1 }];
        doc.Objects[0].Materials = ["m1", "m2"];
        doc.Objects[0].Mesh.F[4].M = 1; doc.Objects[0].Mesh.F[5].M = 1; // top and bottom metal
        var file = MeshDoc.FromFile(doc.ToFile());
        Assert.Equal(2, file.Materials!.Count); Assert.Equal(["m1", "m2"], file.Objects[0].Materials);
        Assert.Equal("Metal", file.Materials[1].Name); Assert.Equal(1f, file.Materials[1].Metallic);
        // GLB: two glTF materials, one primitive each; read back as two slots.
        var back = MeshDoc.FromGlb(doc.ToGlb());
        Assert.Equal(2, back.Materials!.Count);
        Assert.Equal(new[] { "Wood", "Metal" }, back.Materials.Select(m => m.Name));
        Near(0.6f, back.Materials[0].Color[0]); Near(0.3f, back.Materials[1].Roughness); Near(1f, back.Materials[1].Metallic);
        var o = back.Objects[0];
        Assert.Equal(2, o.Materials!.Count);
        var metal = o.Materials.IndexOf(back.Materials.First(m => m.Name == "Metal").Id);
        Assert.Equal(4, o.Mesh.F.Count(f => f.M == metal)); // 2 quads → 4 triangles
        Assert.Equal(8, o.Mesh.F.Count(f => f.M != metal));
        // A slot pointing at a material that isn't there is dropped; numbers out of range are held in.
        var c = MeshDoc.FromJson("{\"format\":\"noormesh\",\"materials\":[{\"id\":\"m1\",\"color\":[2,-1,0.5],\"roughness\":5}],\"objects\":[{\"materials\":[\"m1\",\"nope\"],\"mesh\":{\"v\":[0,0,0,1,0,0,0,1,0],\"f\":[{\"v\":[0,1,2]}]}}]}");
        Assert.Equal(["m1"], c.Objects[0].Materials); Assert.Equal([1f, 0f, 0.5f, 1f], c.Materials![0].Color); Assert.Equal(1f, c.Materials[0].Roughness);
    }

    private static string Png8() { var px = new byte[8 * 8 * 4]; for (var i = 0; i < 64; i++) { px[i * 4] = (byte)(i * 4); px[i * 4 + 3] = 255; } return Convert.ToBase64String(NoorMD.Media.PngWriter.Rgba(8, 8, px)); }

    [Fact]
    public void Packed_pictures_go_inside_the_file_linked_ones_by_path_and_glb_carries_them()
    {
        var doc = Scene();
        var png = Png8();
        doc.Textures = [new MeshTexture { Id = "t1", Name = "bricks.png", Packed = true, Data = png, Mime = "image/png" }, new MeshTexture { Id = "t2", Name = "far.png", Path = @"C:\Textures\far.png", Packed = false, Data = png }];
        doc.Materials = [new MeshMaterial { Id = "m1", Name = "Bricks", Texture = "t1" }, new MeshMaterial { Id = "m2", Name = "Far", Texture = "t2" }];
        doc.Objects[0].Materials = ["m1", "m2"]; doc.Objects[0].Mesh.F[4].M = 1;
        var bytes = doc.ToFile();
        Assert.Equal(png, doc.Textures[0].Data); // the scene in memory keeps its pictures
        var back = MeshDoc.FromFile(bytes);
        Assert.Equal(png, back.Textures!.First(t => t.Id == "t1").Data);           // packed: inside the zip
        var far = back.Textures!.First(t => t.Id == "t2");
        Assert.Null(far.Data); Assert.Equal(@"C:\Textures\far.png", far.Path); // linked: only its path
        Assert.Equal("t1", back.Materials![0].Texture);
        using (var zip = new System.IO.Compression.ZipArchive(new MemoryStream(bytes)))
            Assert.Contains(zip.Entries, e => e.FullName == "textures/t1.png");
        // GLB: the pictures go in (as glTF images) and come back as packed textures on the materials.
        var glb = MeshDoc.FromGlb(doc.ToGlb());
        Assert.Equal(2, glb.Textures!.Count);
        Assert.All(glb.Textures, t => { Assert.True(t.Packed); Assert.Equal(png, t.Data); });
        Assert.All(glb.Materials!, m => Assert.NotNull(m.Texture));
        // A material pointing at a picture that isn't there loses the link.
        var c = MeshDoc.FromJson("{\"format\":\"noormesh\",\"materials\":[{\"id\":\"m1\",\"texture\":\"nope\"}],\"objects\":[]}");
        Assert.Null(c.Materials![0].Texture);
    }

    [Fact]
    public void Broken_scenes_are_refused_and_newer_ones_explained()
    {
        var bad = Scene(); bad.Objects[0].Mesh.F[0].V = [0, 1, 99];
        Assert.Throws<InvalidDataException>(() => MeshDoc.FromFile(bad.ToFile()));
        Assert.Throws<InvalidDataException>(() => MeshDoc.FromFile(Encoding.UTF8.GetBytes("not a zip")));
        var newer = Scene(); newer.Version = 99;
        var ex = Assert.Throws<InvalidDataException>(() => MeshDoc.FromJson(newer.ToJson()));
        Assert.Contains("newer", ex.Message);
        Assert.Throws<InvalidDataException>(() => MeshDoc.FromJson("{\"format\":\"noormesh\",\"objects\":[{\"mesh\":{\"v\":[1,2,\"x\"],\"f\":[]}}]}"));
        Assert.Throws<InvalidDataException>(() => MeshDoc.FromJson("{\"format\":\"noormesh\",\"objects\":[{\"mesh\":{\"v\":[1,2],\"f\":[]}}]}"));
        Assert.Throws<InvalidDataException>(() => MeshDoc.FromJson("{\"format\":\"something else\"}"));
    }

    [Fact]
    public void Glb_is_y_up_and_comes_back_z_up_with_its_placement()
    {
        var doc = Scene([0, 0, 2], [0, 0, 90], [2, 2, 2]);
        var glb = doc.ToGlb();
        // An independent reader (NoorForge's): world positions, +Y up. The cube's top (z = 1, scaled 2, moved up 2) is y = 4.
        var forge = ForgeModel.ReadGlb(glb, "Back");
        var ys = forge.Sets.SelectMany(s => s.Positions).Select(p => p.Y).ToList();
        Near(4, ys.Max()); Near(0, ys.Min());
        Assert.Equal(12, forge.TriangleCount);
        // Ours: Z up again, the placement kept, the vertices welded back to 8, triangles as faces.
        var back = MeshDoc.FromGlb(glb);
        var o = back.Objects[0];
        Assert.Equal("Crate", o.Name);
        Near(0, o.T[0]); Near(0, o.T[1]); Near(2, o.T[2]);
        Near(0, o.R[0], 1e-3f); Near(0, o.R[1], 1e-3f); Near(90, o.R[2], 1e-3f);
        Assert.All(o.S, s => Near(2, s));
        Assert.Equal(8, o.Mesh.VertexCount);
        Assert.Equal(12, o.Mesh.F.Count);
        Assert.All(o.Mesh.F, f => Assert.False(f.S)); // a flat cube stays flat
        // Faces still point out: the volume is positive.
        double vol = 0;
        foreach (var f in o.Mesh.F) { var a = o.Mesh.Vertex(f.V[0]); var b = o.Mesh.Vertex(f.V[1]); var c = o.Mesh.Vertex(f.V[2]); vol += Vector3.Dot(a, Vector3.Cross(b, c)) / 6; }
        Near(8, (float)vol, 1e-3f);
    }

    [Fact]
    public void Smooth_faces_share_normals_and_hidden_objects_are_left_out()
    {
        var doc = Scene();
        doc.Objects[0].Mesh.F.ForEach(f => f.S = true);
        doc.Objects.Add(new MeshObject { Id = "o2", Name = "Hidden", Hidden = true, Mesh = Cube() });
        var back = MeshDoc.FromGlb(doc.ToGlb());
        Assert.Single(back.Objects);
        Assert.All(back.Objects[0].Mesh.F, f => Assert.True(f.S)); // normals bent at the corners: smooth
    }

    [Fact]
    public void Obj_keeps_n_gons_in_the_world_y_up()
    {
        var doc = Scene([0, 0, 1]);
        var m = doc.Objects[0].Mesh;
        // A pentagon on top instead of the quad: a vertex added in the middle of an edge.
        m.V = [.. m.V, 0, -1, 1];
        m.F[4] = new MeshFace { V = [4, 8, 5, 6, 7] };
        m.F[0] = new MeshFace { V = [0, 1, 5, 8, 4] };
        var obj = doc.ToObj();
        Assert.Contains("o Crate", obj);
        Assert.Contains("\nv 0 2 1\n", obj); // (0, −1, 1) moved up 1 → (0, −1, 2) Z up → (0, 2, 1) Y up
        var back = MeshDoc.FromObj(obj);
        var o = back.Objects[0];
        Assert.Equal(9, o.Mesh.VertexCount);
        Assert.Equal(new[] { 5, 4, 4, 4, 5, 4 }, o.Mesh.F.Select(f => f.V.Length).ToArray());
        Near(2, o.Mesh.V.Where((_, i) => i % 3 == 2).Max()); // back in the world, Z up
    }

    [Fact]
    public void Triangulating_a_concave_face_covers_it()
    {
        var m = new MeshData { V = [0, 0, 0, 2, 0, 0, 2, 1, 0, 1, 1, 0, 1, 2, 0, 0, 2, 0], F = [new MeshFace { V = [0, 1, 2, 3, 4, 5] }] };
        var tris = MeshDoc.Triangulate(m, m.F[0]);
        Assert.Equal(4, tris.Count);
        var area = tris.Sum(t => Vector3.Cross(m.Vertex(m.F[0].V[t.B]) - m.Vertex(m.F[0].V[t.A]), m.Vertex(m.F[0].V[t.C]) - m.Vertex(m.F[0].V[t.A])).Z / 2);
        Near(3, area);
    }
}
