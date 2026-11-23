// glTF 2.0 / GLB 加载器 (手写, 覆盖网格所需子集: POSITION/NORMAL/indices, TRIANGLES)
// .glb 单文件, .gltf+bin 通过 GltfResources 提供外部缓冲
import { Mesh, recomputeNormals } from './Mesh';

interface GltfAccessor {
  bufferView?: number; componentType: number; count: number; type: string;
  min?: number[]; max?: number[]; byteOffset?: number;
}
interface GltfBufferView { buffer: number; byteOffset?: number; byteLength: number; target?: number; byteStride?: number; }
interface GltfBuffer { byteLength: number; uri?: string; }
interface GltfPrimitive { attributes: { POSITION: number; NORMAL?: number; TEXCOORD_0?: number }; indices?: number; mode?: number; }
interface GltfMesh { primitives: GltfPrimitive[]; name?: string; }
interface GltfDoc {
  buffers: GltfBuffer[]; bufferViews: GltfBufferView[]; accessors: GltfAccessor[];
  meshes: GltfMesh[];
}

export interface GltfResources {
  /** 外部 .bin / 图片等, uri -> ArrayBuffer (data: URI 自动解析) */
  files?: Map<string, ArrayBuffer>;
}

const GL_FLOAT = 5126, GL_UNSIGNED_SHORT = 5123, GL_UNSIGNED_INT = 5125, GL_UNSIGNED_BYTE = 5121;

export async function parseGLB(buffer: ArrayBuffer, name: string): Promise<Mesh> {
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== 0x46546c67) throw new Error('不是合法的 GLB 文件 (magic 不匹配)');
  let off = 12;
  let json: GltfDoc | null = null;
  const binChunks: ArrayBuffer[] = [];
  while (off < buffer.byteLength) {
    const len = view.getUint32(off, true);
    const type = view.getUint32(off + 4, true);
    const chunk = buffer.slice(off + 8, off + 8 + len);
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(chunk));
    else if (type === 0x004e4942) binChunks.push(chunk);
    off += 8 + len;
  }
  if (!json) throw new Error('GLB 缺少 JSON 块');
  return buildMesh(json, binChunks, name);
}

export async function parseGLTF(text: string, resources: GltfResources, name: string): Promise<Mesh> {
  const json = JSON.parse(text) as GltfDoc;
  const buffers: ArrayBuffer[] = [];
  for (const b of json.buffers ?? []) {
    if (b.uri?.startsWith('data:')) {
      const base64 = b.uri.split(',')[1];
      const bin = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      buffers.push(bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength));
    } else if (b.uri) {
      const ab = resources.files?.get(b.uri) ?? resources.files?.get(b.uri.split('/').pop()!);
      if (!ab) throw new Error(`glTF 缺少外部缓冲: ${b.uri}`);
      buffers.push(ab);
    }
  }
  return buildMesh(json, buffers, name);
}

function readAccessor(json: GltfDoc, buffers: ArrayBuffer[], accIdx: number): { data: Float32Array | Uint32Array; comps: number } {
  const acc = json.accessors[accIdx];
  const bv = json.bufferViews[acc.bufferView!];
  const buffer = buffers[bv.buffer];
  const viewOffset = (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  const comps = acc.type === 'SCALAR' ? 1 : acc.type === 'VEC2' ? 2 : acc.type === 'VEC3' ? 3 : 4;
  if (acc.componentType === GL_FLOAT) {
    const stride = bv.byteStride ? bv.byteStride / 4 : comps;
    const out = new Float32Array(acc.count * comps);
    const src = new Float32Array(buffer, viewOffset, bv.byteStride ? undefined : acc.count * comps);
    if (stride === comps) {
      out.set(src);
    } else {
      for (let i = 0; i < acc.count; i++) for (let k = 0; k < comps; k++) out[i * comps + k] = src[i * stride + k];
    }
    return { data: out, comps };
  }
  // 整数索引
  const out = new Uint32Array(acc.count);
  if (acc.componentType === GL_UNSIGNED_INT) {
    out.set(new Uint32Array(buffer, viewOffset, acc.count));
  } else if (acc.componentType === GL_UNSIGNED_SHORT) {
    const src = new Uint16Array(buffer, viewOffset, acc.count);
    for (let i = 0; i < acc.count; i++) out[i] = src[i];
  } else if (acc.componentType === GL_UNSIGNED_BYTE) {
    const src = new Uint8Array(buffer, viewOffset, acc.count);
    for (let i = 0; i < acc.count; i++) out[i] = src[i];
  } else {
    throw new Error(`不支持的 componentType: ${acc.componentType}`);
  }
  return { data: out, comps: 1 };
}

function buildMesh(json: GltfDoc, buffers: ArrayBuffer[], name: string): Mesh {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  let vertexBase = 0;

  for (const m of json.meshes ?? []) {
    for (const prim of m.primitives) {
      if (prim.mode !== undefined && prim.mode !== 4) continue; // 仅 TRIANGLES
      const pos = readAccessor(json, buffers, prim.attributes.POSITION).data as Float32Array;
      let nrm: Float32Array | null = null;
      if (prim.attributes.NORMAL !== undefined) {
        nrm = readAccessor(json, buffers, prim.attributes.NORMAL).data as Float32Array;
      }
      positions.push(...pos);
      if (nrm) normals.push(...nrm);
      else for (let i = 0; i < pos.length / 3; i++) normals.push(0, 1, 0);

      if (prim.indices !== undefined) {
        const idx = readAccessor(json, buffers, prim.indices).data as Uint32Array;
        for (const v of idx) indices.push(v + vertexBase);
      } else {
        const cnt = pos.length / 3;
        for (let i = 0; i < cnt; i++) indices.push(i + vertexBase);
      }
      vertexBase += pos.length / 3;
    }
  }

  const mesh: Mesh = {
    name,
    positions: Float32Array.from(positions),
    normals: Float32Array.from(normals),
    indices: Uint32Array.from(indices),
    curvature: new Float32Array(positions.length / 3),
    ao: new Float32Array(positions.length / 3),
  };
  recomputeNormals(mesh);
  return mesh;
}
