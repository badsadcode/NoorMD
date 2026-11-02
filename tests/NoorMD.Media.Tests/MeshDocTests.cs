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
