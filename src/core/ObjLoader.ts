// OBJ 导入器 (纯手写, 支持 v / vt / vn / f, 含负索引与三角/四边面)
import { Mesh, recomputeNormals } from './Mesh';

export function parseOBJ(text: string, name: string): Mesh {
  const positions: number[] = [];
  const uvs: number[] = [];
  const normals: number[] = [];
  const outPos: number[] = [];
  const outNrm: number[] = [];
  const indices: number[] = [];
  // 顶点复用缓存: "v/vt/vn" -> 输出顶点 id
  const cache = new Map<string, number>();

  const resolve = (idx: number, size: number): number => (idx > 0 ? idx - 1 : size + idx);

  const lines = text.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const sp = line.split(/\s+/);
    const tag = sp[0];
    if (tag === 'v') {
      positions.push(+sp[1], +sp[2], sp[3] === undefined ? 0 : +sp[3]);
    } else if (tag === 'vt') {
      uvs.push(+sp[1], sp[2] === undefined ? 0 : +sp[2]);
    } else if (tag === 'vn') {
      normals.push(+sp[1], +sp[2], +sp[3]);
    } else if (tag === 'f') {
      const faceIds: number[] = [];
      for (let k = 1; k < sp.length; k++) {
        const part = sp[k];
        let key = part;
        const seg = part.split('/');
        const vi = resolve(parseInt(seg[0], 10), positions.length / 3);
        const ti = seg[1] ? resolve(parseInt(seg[1], 10), uvs.length / 2) : -1;
        const ni = seg[2] ? resolve(parseInt(seg[2], 10), normals.length / 3) : -1;
        key = `${vi}/${ti}/${ni}`;
        let id = cache.get(key);
        if (id === undefined) {
          id = outPos.length / 3;
          cache.set(key, id);
          outPos.push(positions[vi * 3], positions[vi * 3 + 1], positions[vi * 3 + 2]);
          if (ni >= 0) outNrm.push(normals[ni * 3], normals[ni * 3 + 1], normals[ni * 3 + 2]);
          else outNrm.push(0, 0, 0);
        }
        faceIds.push(id);
      }
      // 扇形三角化 (支持 n 边形)
      for (let k = 1; k < faceIds.length - 1; k++) {
        indices.push(faceIds[0], faceIds[k], faceIds[k + 1]);
      }
    }
  }

  const mesh: Mesh = {
    name,
    positions: Float32Array.from(outPos),
    normals: Float32Array.from(outNrm),
    indices: Uint32Array.from(indices),
    curvature: new Float32Array(outPos.length / 3),
    ao: new Float32Array(outPos.length / 3),
  };
  // OBJ 自带法线在焊接/减面后会失效, 统一重算保证后续处理一致
  recomputeNormals(mesh);
  return mesh;
}
