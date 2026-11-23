// 网格数据结构 —— 所有几何处理的统一载体
export interface Mesh {
  name: string;
  positions: Float32Array; // vec3 * vertexCount
  normals: Float32Array;   // vec3 * vertexCount (可能与位置同顶点数)
  indices: Uint32Array;    // 三角形索引
  curvature: Float32Array; // 每顶点有符号平均曲率 (1/长度量纲, 归一化模型)
  ao: Float32Array;        // 每顶点环境遮蔽 0..1 (1 = 无遮蔽)
  /** 烘焙来源标记, 供 UI 展示 */
  bakeInfo?: { vertexCount: number; triangleCount: number; bakedAt: number };
}

export function vertexCount(mesh: Mesh): number {
  return mesh.positions.length / 3;
}

export function triangleCount(mesh: Mesh): number {
  return mesh.indices.length / 3;
}

/** 面积加权顶点法线重算 */
export function recomputeNormals(mesh: Mesh): void {
  const n = vertexCount(mesh);
  const normals = new Float32Array(n * 3);
  const { positions, indices } = mesh;
  for (let i = 0; i < indices.length; i += 3) {
    const ia = indices[i] * 3, ib = indices[i + 1] * 3, ic = indices[i + 2] * 3;
    const ux = positions[ib] - positions[ia], uy = positions[ib + 1] - positions[ia + 1], uz = positions[ib + 2] - positions[ia + 2];
    const vx = positions[ic] - positions[ia], vy = positions[ic + 1] - positions[ia + 1], vz = positions[ic + 2] - positions[ia + 2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    normals[ia] += nx; normals[ia + 1] += ny; normals[ia + 2] += nz;
    normals[ib] += nx; normals[ib + 1] += ny; normals[ib + 2] += nz;
    normals[ic] += nx; normals[ic + 1] += ny; normals[ic + 2] += nz;
  }
  for (let i = 0; i < normals.length; i += 3) {
    const l = Math.hypot(normals[i], normals[i + 1], normals[i + 2]) || 1;
    normals[i] /= l; normals[i + 1] /= l; normals[i + 2] /= l;
  }
  mesh.normals = normals;
}

/** 位置量化焊接, 用于 OBJ 等可能存在重复顶点的输入; 返回新 Mesh (索引重映射) */
export function weldVertices(mesh: Mesh, tolerance = 1e-6): Mesh {
  const n = vertexCount(mesh);
  const q = Math.round(1 / tolerance);
  const map = new Map<string, number>();
  const remap = new Uint32Array(n);
  const keep: number[] = [];
  for (let i = 0; i < n; i++) {
    const key = `${Math.round(mesh.positions[i * 3] * q)},${Math.round(mesh.positions[i * 3 + 1] * q)},${Math.round(mesh.positions[i * 3 + 2] * q)}`;
    let id = map.get(key);
    if (id === undefined) {
      id = keep.length;
      map.set(key, id);
      keep.push(i);
    }
    remap[i] = id;
  }
  if (keep.length === n) return mesh;
  const m = keep.length;
  const positions = new Float32Array(m * 3);
  keep.forEach((src, dst) => positions.set(mesh.positions.subarray(src * 3, src * 3 + 3), dst * 3));
  const indices = new Uint32Array(mesh.indices.length);
  for (let i = 0; i < indices.length; i++) indices[i] = remap[mesh.indices[i]];
  const out: Mesh = {
    name: mesh.name,
    positions,
    normals: new Float32Array(m * 3),
    indices,
    curvature: new Float32Array(m),
    ao: new Float32Array(m),
  };
  recomputeNormals(out);
  return out;
}

export function cloneMesh(mesh: Mesh): Mesh {
  return {
    name: mesh.name,
    positions: new Float32Array(mesh.positions),
    normals: new Float32Array(mesh.normals),
    indices: new Uint32Array(mesh.indices),
    curvature: new Float32Array(mesh.curvature),
    ao: new Float32Array(mesh.ao),
    bakeInfo: mesh.bakeInfo ? { ...mesh.bakeInfo } : undefined,
  };
}
