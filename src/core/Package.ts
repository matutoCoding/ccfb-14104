// 工程打包导出/导入: .patina 包 = 自定义容器 (JSON 头 + 二进制几何段)
// 浏览器无原生 gzip 时走原始打包; 支持 CompressionStream 时启用 gzip
import { Project } from './materials';
import { StoredMesh } from './Storage';

const MAGIC = 'PATINA1';

export interface PackagePayload {
  project: Project;
  mesh: StoredMesh;
}

function writeCString(view: DataView, offset: number, text: string): number {
  const bytes = new TextEncoder().encode(text);
  view.setUint32(offset, bytes.length, true);
  new Uint8Array(view.buffer as ArrayBuffer, offset + 4).set(bytes);
  return offset + 4 + bytes.length;
}

function readCString(view: DataView, offset: number): { text: string; next: number } {
  const len = view.getUint32(offset, true);
  const text = new TextDecoder().decode(new Uint8Array(view.buffer as ArrayBuffer, offset + 4, len));
  return { text, next: offset + 4 + len };
}

function writeBuf(view: DataView, offset: number, buf: ArrayBuffer): number {
  view.setUint32(offset, buf.byteLength, true);
  new Uint8Array(view.buffer).set(new Uint8Array(buf), offset + 4);
  return offset + 4 + buf.byteLength;
}

function readBuf(view: DataView, offset: number): { buf: ArrayBuffer; next: number } {
  const len = view.getUint32(offset, true);
  const buf = (view.buffer as ArrayBuffer).slice(offset + 4, offset + 4 + len);
  return { buf, next: offset + 4 + len };
}

export function buildPackage(payload: PackagePayload): ArrayBuffer {
  const headJson = JSON.stringify(payload.project);
  const headBytes = new TextEncoder().encode(headJson);
  const m = payload.mesh;
  const total =
    MAGIC.length + 4 + headBytes.length +
    5 * 4 + m.positions.byteLength + m.normals.byteLength + m.indices.byteLength +
    m.curvature.byteLength + m.ao.byteLength;
  const buf = new ArrayBuffer(total);
  const view = new DataView(buf);
  let off = 0;
  new Uint8Array(buf, 0, MAGIC.length).set(new TextEncoder().encode(MAGIC));
  off += MAGIC.length;
  off = writeCString(view, off, headJson);
  off = writeBuf(view, off, m.positions);
  off = writeBuf(view, off, m.normals);
  off = writeBuf(view, off, m.indices);
  off = writeBuf(view, off, m.curvature);
  off = writeBuf(view, off, m.ao);
  return buf;
}

export function parsePackage(buffer: ArrayBuffer): PackagePayload {
  const view = new DataView(buffer);
  const magic = new TextDecoder().decode(new Uint8Array(buffer, 0, MAGIC.length));
  if (magic !== MAGIC) throw new Error('不是合法的 .patina 工程包');
  let off = MAGIC.length;
  const head = readCString(view, off);
  off = head.next;
  const project = JSON.parse(head.text) as Project;
  const parts: ArrayBuffer[] = [];
  for (let i = 0; i < 5; i++) {
    const r = readBuf(view, off);
    parts.push(r.buf);
    off = r.next;
  }
  const mesh: StoredMesh = {
    projectId: project.id,
    positions: parts[0],
    normals: parts[1],
    indices: parts[2],
    curvature: parts[3],
    ao: parts[4],
  };
  return { project, mesh };
}

/** 优先 gzip 压缩; 不支持 CompressionStream 时返回原始包 */
export async function maybeCompress(buf: ArrayBuffer): Promise<{ data: Blob; compressed: boolean }> {
  if (typeof CompressionStream !== 'undefined') {
    const stream = new Blob([buf]).stream().pipeThrough(new CompressionStream('gzip'));
    return { data: new Blob([await new Response(stream).arrayBuffer()], { type: 'application/gzip' }), compressed: true };
  }
  return { data: new Blob([buf]), compressed: false };
}

export async function maybeDecompress(file: File): Promise<ArrayBuffer> {
  const raw = await file.arrayBuffer();
  // gzip 魔数 1f 8b
  if (new Uint8Array(raw, 0, 2).join(',') === '31,139' && typeof DecompressionStream !== 'undefined') {
    const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Response(stream).arrayBuffer();
  }
  return raw;
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
