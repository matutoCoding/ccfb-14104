// WebGL2 渲染器: 编译链接着色器、上传网格与逐顶点几何数据纹理、驱动 PBR/调试绘制
import { Mesh } from '../core/Mesh';
import { ProcessLayer, REAGENTS, WeatheringParams } from '../core/materials';
import { VERT_SRC, FRAG_SRC, DEBUG_FRAG, DEBUG_VERT } from './shaders';
import { Mat4, mat4Identity, mat4LookAt, mat4Mul, mat4Perspective, Vec3 } from '../math/vecmath';

const KIND_TO_INT: Record<string, number> = {
  base: 0, darken: 1, patinaGreen: 2, patinaBlue: 3, polish: 4,
};

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error('着色器编译失败: ' + log);
  }
  return sh;
}

function link(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const p = gl.createProgram()!;
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error('着色器链接失败: ' + gl.getProgramInfoLog(p));
  }
  return p;
}

interface GpuMesh {
  vao: WebGLVertexArrayObject;
  vbo: WebGLBuffer;
  ebo: WebGLBuffer;
  indexCount: number;
  geoTex: WebGLTexture;
  geoTexW: number;
  geoTexH: number;
  vertexCount: number;
}

export interface CameraState {
  yaw: number;
  pitch: number;
  distance: number;
  target: Vec3;
}

export class Renderer {
  gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private debugProgram: WebGLProgram;
  private gpu: GpuMesh | null = null;
  private modelMatrix: Mat4 = mat4Identity();
  debugMode: -1 | 0 | 1 = -1;
  fps = 0;
  private frameTimes: number[] = [];
  private resizeObserver: ResizeObserver;

  constructor(public canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { antialias: true, preserveDrawingBuffer: true });
    if (!gl) throw new Error('当前浏览器不支持 WebGL2');
    this.gl = gl;
    this.program = link(gl, VERT_SRC, FRAG_SRC);
    this.debugProgram = link(gl, DEBUG_VERT, DEBUG_FRAG);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    // 容器尺寸变化(含挂载时从 0 撑开)立即更新绘图缓冲
    this.resizeObserver = new ResizeObserver(() => this.syncSize());
    this.resizeObserver.observe(canvas);
  }

  private syncSize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = Math.max(1, Math.floor(this.canvas.clientWidth * dpr));
    const H = Math.max(1, Math.floor(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== W || this.canvas.height !== H) {
      this.canvas.width = W;
      this.canvas.height = H;
    }
  }

  uploadMesh(mesh: Mesh): void {
    const gl = this.gl;
    if (this.gpu) this.disposeGpu();
    const n = mesh.positions.length / 3;

    // 交错缓冲: pos(3) + normal(3) + dataIndex(1)
    const packed = new Float32Array(n * 7);
    for (let i = 0; i < n; i++) {
      packed[i * 7] = mesh.positions[i * 3];
      packed[i * 7 + 1] = mesh.positions[i * 3 + 1];
      packed[i * 7 + 2] = mesh.positions[i * 3 + 2];
      packed[i * 7 + 3] = mesh.normals[i * 3];
      packed[i * 7 + 4] = mesh.normals[i * 3 + 1];
      packed[i * 7 + 5] = mesh.normals[i * 3 + 2];
      packed[i * 7 + 6] = i;
    }
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const vbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, packed, gl.STATIC_DRAW);
    const stride = 7 * 4;
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, stride, 3 * 4);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 1, gl.FLOAT, false, stride, 6 * 4);
    const ebo = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ebo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);
    gl.bindVertexArray(null);

    // 逐顶点几何数据纹理: R=曲率 G=AO B=法线y A=高度
    const texW = Math.min(2048, Math.max(1, Math.ceil(Math.sqrt(n))));
    const texH = Math.ceil(n / texW);
    const data = new Float32Array(texW * texH * 4);
    let minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < n; i++) {
      minY = Math.min(minY, mesh.positions[i * 3 + 1]);
      maxY = Math.max(maxY, mesh.positions[i * 3 + 1]);
    }
    const yRange = Math.max(1e-6, maxY - minY);
    for (let i = 0; i < n; i++) {
      data[i * 4] = mesh.curvature[i];
      data[i * 4 + 1] = mesh.ao[i];
      data[i * 4 + 2] = mesh.normals[i * 3 + 1];
      data[i * 4 + 3] = (mesh.positions[i * 3 + 1] - minY) / yRange;
    }
    const geoTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, geoTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, texW, texH, 0, gl.RGBA, gl.FLOAT, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    // 浮点纹理需检查线性过滤支持; NEAREST 无需求, 但要确认 RGBA32F 可渲染采样
    const ext = gl.getExtension('EXT_color_buffer_float');
    if (!ext) console.warn('EXT_color_buffer_float 不可用, 浮点数据纹理可能无法采样');

    this.gpu = { vao, vbo, ebo, indexCount: mesh.indices.length, geoTex, geoTexW: texW, geoTexH: texH, vertexCount: n };
  }

  setModel(m: Mat4) { this.modelMatrix = m; }

  private commonUniforms(p: WebGLProgram, cam: CameraState, aspect: number) {
    const gl = this.gl;
    const proj = mat4Perspective((45 * Math.PI) / 180, aspect, 0.05, 100);
    const eye: Vec3 = [
      cam.target[0] + cam.distance * Math.cos(cam.pitch) * Math.sin(cam.yaw),
      cam.target[1] + cam.distance * Math.sin(cam.pitch),
      cam.target[2] + cam.distance * Math.cos(cam.pitch) * Math.cos(cam.yaw),
    ];
    const view = mat4LookAt(eye, cam.target, [0, 1, 0]);
    const vp = mat4Mul(proj, view);
    gl.uniformMatrix4fv(gl.getUniformLocation(p, 'uProj'), false, proj);
    gl.uniformMatrix4fv(gl.getUniformLocation(p, 'uView'), false, view);
    gl.uniformMatrix4fv(gl.getUniformLocation(p, 'uModel'), false, this.modelMatrix);
    gl.uniform3fv(gl.getUniformLocation(p, 'uCamPos'), eye);
    return { vp, eye };
  }

  render(cam: CameraState, layers: ProcessLayer[], w: WeatheringParams): void {
    const gl = this.gl;
    if (!this.gpu) return;
    const t0 = performance.now();
    this.syncSize();
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0.07, 0.08, 0.1, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    const useDebug = this.debugMode !== -1;
    const p = useDebug ? this.debugProgram : this.program;
    gl.useProgram(p);
    const { eye } = this.commonUniforms(p, cam, this.canvas.width / this.canvas.height);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.gpu.geoTex);
    gl.uniform1i(gl.getUniformLocation(p, 'uGeoData'), 0);
    gl.uniform2f(gl.getUniformLocation(p, 'uGeoTexSize'), this.gpu.geoTexW, this.gpu.geoTexH);

    if (useDebug) {
      gl.uniform1i(gl.getUniformLocation(p, 'uMode'), this.debugMode);
    } else {
      this.uploadLayerUniforms(p, layers);
      this.uploadWeathering(p, w, eye);
    }

    gl.bindVertexArray(this.gpu.vao);
    gl.drawElements(gl.TRIANGLES, this.gpu.indexCount, gl.UNSIGNED_INT, 0);
    gl.bindVertexArray(null);

    const dt = performance.now() - t0;
    this.frameTimes.push(dt);
    if (this.frameTimes.length > 60) this.frameTimes.shift();
    const avg = this.frameTimes.reduce((s, x) => s + x, 0) / this.frameTimes.length;
    this.fps = Math.round(1000 / Math.max(avg, 0.01));
  }

  private uploadLayerUniforms(p: WebGLProgram, layers: ProcessLayer[]): void {
    const gl = this.gl;
    const active = layers.filter((l) => l.enabled).slice(0, 8);
    gl.uniform1i(gl.getUniformLocation(p, 'uLayerCount'), active.length);
    active.forEach((layer, i) => {
      const def = REAGENTS[layer.reagent];
      gl.uniform1i(gl.getUniformLocation(p, `uLayerKind[${i}]`), KIND_TO_INT[def.kind]);
      // sRGB -> 线性
      const lin = def.color.map((c) => Math.pow(c, 2.2));
      gl.uniform3fv(gl.getUniformLocation(p, `uLayerColor[${i}]`), lin);
      gl.uniform1f(gl.getUniformLocation(p, `uLayerConc[${i}]`), layer.concentration);
      gl.uniform1f(gl.getUniformLocation(p, `uLayerPasses[${i}]`), layer.passes);
      gl.uniform1f(gl.getUniformLocation(p, `uLayerCavity[${i}]`), layer.cavityBias);
      gl.uniform1i(gl.getUniformLocation(p, `uLayerEnabled[${i}]`), layer.enabled ? 1 : 0);
      gl.uniform1f(gl.getUniformLocation(p, `uLayerMetal[${i}]`), def.metalness);
      gl.uniform1f(gl.getUniformLocation(p, `uLayerRough[${i}]`), def.roughness);
    });
  }

  private uploadWeathering(p: WebGLProgram, w: WeatheringParams, eye: Vec3): void {
    const gl = this.gl;
    gl.uniform1f(gl.getUniformLocation(p, 'uYears'), w.years);
    const fr = (w.facing * Math.PI) / 180;
    gl.uniform3fv(gl.getUniformLocation(p, 'uFacingDir'), [Math.cos(fr), 0, Math.sin(fr)]);
    const ra = (w.rainAngle * Math.PI) / 180;
    const rt = (w.rainTilt * Math.PI) / 180;
    // 雨方向: 水平角 rainAngle + 向下倾角
    gl.uniform3fv(gl.getUniformLocation(p, 'uRainDir'), [
      Math.cos(rt) * Math.cos(ra), -Math.sin(rt), Math.cos(rt) * Math.sin(ra),
    ]);
    gl.uniform1f(gl.getUniformLocation(p, 'uPatinaRate'), w.patinaRate);
    gl.uniform1f(gl.getUniformLocation(p, 'uStreakStrength'), w.streakStrength);
    gl.uniform1i(gl.getUniformLocation(p, 'uEnvironment'), w.environment === 'sunny' ? 0 : w.environment === 'overcast' ? 1 : 2);
  }

  /** 高清 PNG 导出: 临时提高画布分辨率, 渲染一帧后回读, 再还原尺寸 */
  readPixelsPNG(scale: number, renderOnce: () => void): string {
    const oldW = this.canvas.width, oldH = this.canvas.height;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.floor(this.canvas.clientWidth * dpr * scale);
    this.canvas.height = Math.floor(this.canvas.clientHeight * dpr * scale);
    renderOnce();
    const url = this.canvas.toDataURL('image/png');
    this.canvas.width = oldW;
    this.canvas.height = oldH;
    return url;
  }

  get vertexCount(): number { return this.gpu?.vertexCount ?? 0; }
  get triangleCount(): number { return this.gpu ? this.gpu.indexCount / 3 : 0; }

  private disposeGpu(): void {
    const gl = this.gl;
    if (!this.gpu) return;
    gl.deleteVertexArray(this.gpu.vao);
    gl.deleteBuffer(this.gpu.vbo);
    gl.deleteBuffer(this.gpu.ebo);
    gl.deleteTexture(this.gpu.geoTex);
    this.gpu = null;
  }

  dispose(): void {
    this.disposeGpu();
    this.resizeObserver.disconnect();
    glDeleteProgram(this.gl, this.program);
    glDeleteProgram(this.gl, this.debugProgram);
  }
}

function glDeleteProgram(gl: WebGL2RenderingContext, p: WebGLProgram) {
  gl.deleteProgram(p);
}
