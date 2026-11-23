// 端到端管线验证: OBJ 解析 -> 焊接 -> 减面 -> 烘焙, Node 环境
import { parseOBJ } from '../src/core/ObjLoader';
import { weldVertices, triangleCount, vertexCount } from '../src/core/Mesh';
import { decimate } from '../src/core/Decimate';
import { bakeMesh } from '../src/core/MeshBake';
import { normalizeMeshToUnit } from '../src/math/vecmath';

// 构造一个带四边面的 OBJ (立方体 + 细分面), 测 v/vt/vn、负索引、四边面
const obj = `# test cube-ish
v 0 0 0
v 1 0 0
v 1 1 0
v 0 1 0
v 0 0 1
v 1 0 1
v 1 1 1
v 0 1 1
vn 0 0 1
vn 0 0 -1
f 1//1 2//1 3//1 4//1
f 5//2 8//2 7//2 6//2
f 1//1 5//2 6//2 2//1
f 2//1 6//2 7//2 3//1
f 3//1 7//2 8//2 4//1
f 4//1 8//2 5//2 1//1
`;

let mesh = parseOBJ(obj, 'test.obj');
console.log('OBJ 解析:', vertexCount(mesh), '顶点', triangleCount(mesh), '三角形 (四边面应扇形三角化)');
if (triangleCount(mesh) !== 12) throw new Error('四边面三角化数量错误');

mesh = weldVertices(mesh, 1e-6);
console.log('焊接后:', vertexCount(mesh), '顶点 (立方体应为 8)');
if (vertexCount(mesh) !== 8) throw new Error('焊接顶点数错误, 期望 8');

normalizeMeshToUnit(mesh.positions);

// 细分加密后测减面: 用网格复制放大模拟高面数
const big = subdivide(mesh, 3);
console.log('细分后:', triangleCount(big), '三角形');
const target = Math.floor(triangleCount(big) * 0.3);
const dec = decimate(big, target);
console.log(`QEM 减面: ${triangleCount(big)} -> ${triangleCount(dec)} (目标 ${target})`);
if (triangleCount(dec) > target * 1.05) throw new Error('减面未达目标');

// 减面后法线/曲率可正常烘焙
await bakeMesh(dec, 6, 0.6);
const finite = dec.curvature.every((x) => Number.isFinite(x)) && dec.ao.every((x) => Number.isFinite(x));
console.log('减面后烘焙: 曲率/AO 全部有限值 =', finite, '| AO 范围', dec.ao[0].toFixed(2), '~', Math.max(...dec.ao).toFixed(2));
if (!finite) throw new Error('烘焙出现非有限值');

// glTF 二进制解析冒烟测试 (最小 GLB)
const glb = makeMinimalGLB();
const { parseGLB } = await import('../src/core/GltfLoader');
const gmesh = await parseGLB(glb, 'test.glb');
console.log('GLB 解析:', vertexCount(gmesh), '顶点', triangleCount(gmesh), '三角形');
if (triangleCount(gmesh) !== 1) throw new Error('GLB 三角形数错误');

// 工程打包往返
const { buildPackage, parsePackage } = await import('../src/core/Package');
const { meshToStored } = await import('../src/core/Storage');
const { makeScheme } = await import('../src/core/materials');
const proj = {
  id: 'prj_test', name: '往返测试', source: 'procedural' as const, decimateTarget: 0, rayCount: 12,
  createdAt: 1, updatedAt: 1, schemes: [makeScheme()], activeSchemeId: '',
};
proj.activeSchemeId = proj.schemes[0].id;
const stored = meshToStored('prj_test', dec);
const pkg = buildPackage({ project: proj, mesh: stored });
const back = parsePackage(pkg);
console.log('工程包往返:', back.project.name, back.mesh.positions.byteLength === stored.positions.byteLength ? '几何一致 ✅' : '几何不一致 ❌');
if (back.project.name !== '往返测试') throw new Error('工程包往返失败');

console.log('\n全部管线验证通过');

// 三角形细分 (每三角形分 4 个), n 轮
function subdivide(m: ReturnType<typeof parseOBJ>, rounds: number) {
  let positions = Array.from(m.positions);
  let indices = Array.from(m.indices);
  for (let r = 0; r < rounds; r++) {
    const newIdx: number[] = [];
    const midCache = new Map<string, number>();
    const mid = (a: number, b: number) => {
      const key = a < b ? `${a}_${b}` : `${b}_${a}`;
      const hit = midCache.get(key);
      if (hit !== undefined) return hit;
      const id = positions.length / 3;
      positions.push(
        (positions[a * 3] + positions[b * 3]) / 2,
        (positions[a * 3 + 1] + positions[b * 3 + 1]) / 2,
        (positions[a * 3 + 2] + positions[b * 3 + 2]) / 2,
      );
      midCache.set(key, id);
      return id;
    };
    for (let i = 0; i < indices.length; i += 3) {
      const [a, b, c] = [indices[i], indices[i + 1], indices[i + 2]];
      const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
      newIdx.push(a, ab, ca, b, bc, ab, c, ca, bc, ab, bc, ca);
    }
    indices = newIdx;
  }
  const n = positions.length / 3;
  return {
    name: 'sub', positions: Float32Array.from(positions), normals: new Float32Array(positions.length),
    indices: Uint32Array.from(indices), curvature: new Float32Array(n), ao: new Float32Array(n),
  };
}

function makeMinimalGLB(): ArrayBuffer {
  // 一个三角形: 3 顶点
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const bin = positions.buffer.slice(0);
  const gltf = {
    asset: { version: '2.0' },
    buffers: [{ byteLength: bin.byteLength }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: bin.byteLength, target: 34962 }],
    accessors: [{
      bufferView: 0, componentType: 5126, count: 3, type: 'VEC3',
      min: [0, 0, 0], max: [1, 1, 0],
    }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, mode: 4 }] }],
  };
  const jsonBytes = new TextEncoder().encode(JSON.stringify(gltf));
  const jsonPad = (4 - (jsonBytes.length % 4)) % 4;
  const binPad = (4 - (bin.byteLength % 4)) % 4;
  const total = 12 + 8 + jsonBytes.length + jsonPad + 8 + bin.byteLength + binPad;
  const buf = new ArrayBuffer(total);
  const dv = new DataView(buf);
  const u8 = new Uint8Array(buf);
  dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
  dv.setUint32(12, jsonBytes.length + jsonPad, true); dv.setUint32(16, 0x4e4f534a, true);
  u8.set(jsonBytes, 20); u8.fill(0x20, 20 + jsonBytes.length, 20 + jsonBytes.length + jsonPad);
  const boff = 20 + jsonBytes.length + jsonPad;
  dv.setUint32(boff, bin.byteLength + binPad, true); dv.setUint32(boff + 4, 0x004e4942, true);
  u8.set(new Uint8Array(bin), boff + 8);
  return buf;
}
