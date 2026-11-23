// WebGL2 GLSL ES 3.00 着色器源码
// 几何属性(曲率/AO)通过每顶点数据纹理传入, 保证"积色跟几何对得上"

export const VERT_SRC = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPosition;
layout(location=1) in vec3 aNormal;
layout(location=2) in float aDataIndex; // 顶点在数据纹理中的索引

uniform mat4 uModel;
uniform mat4 uView;
uniform mat4 uProj;

out vec3 vWorldPos;
out vec3 vNormal;
out float vDataIndex;
out vec3 vLocalPos;

void main() {
  vec4 wp = uModel * vec4(aPosition, 1.0);
  vWorldPos = wp.xyz;
  vLocalPos = aPosition;
  vNormal = mat3(uModel) * aNormal;
  vDataIndex = aDataIndex;
  gl_Position = uProj * uView * wp;
}
`;

export const FRAG_SRC = `#version 300 es
precision highp float;

in vec3 vWorldPos;
in vec3 vNormal;
in float vDataIndex;
in vec3 vLocalPos;

uniform sampler2D uGeoData;   // R=曲率 H, G=AO, B=法线朝上分量, A=高度(归一化)
uniform vec2 uGeoTexSize;

// 工序层 (最多 8 层), kind: 0=base 1=darken 2=patinaGreen 3=patinaBlue 4=polish
#define MAX_LAYERS 8
uniform int uLayerCount;
uniform int uLayerKind[MAX_LAYERS];
uniform vec3 uLayerColor[MAX_LAYERS];
uniform float uLayerConc[MAX_LAYERS];
uniform float uLayerPasses[MAX_LAYERS];
uniform float uLayerCavity[MAX_LAYERS];
uniform int uLayerEnabled[MAX_LAYERS];
uniform float uLayerMetal[MAX_LAYERS];
uniform float uLayerRough[MAX_LAYERS];

// 风化
uniform float uYears;        // 0..50
uniform vec3 uFacingDir;     // 主导朝向 (水平面内)
uniform vec3 uRainDir;       // 淋雨方向 (指向下)
uniform float uPatinaRate;
uniform float uStreakStrength;
uniform int uEnvironment;    // 0=晴 1=阴 2=夜景
uniform vec3 uCamPos;

out vec4 fragColor;

// ---------- 工具 ----------
vec4 fetchGeo() {
  float idx = vDataIndex + 0.5;
  float x = mod(idx, uGeoTexSize.x);
  float y = floor(idx / uGeoTexSize.x);
  return texelFetch(uGeoData, ivec2(x, y), 0);
}

float hash11(float n) { return fract(sin(n) * 43758.5453123); }
float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
// 3D 值噪声
float vnoise(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float n000 = hash13(i + vec3(0.0,0.0,0.0));
  float n100 = hash13(i + vec3(1.0,0.0,0.0));
  float n010 = hash13(i + vec3(0.0,1.0,0.0));
  float n110 = hash13(i + vec3(1.0,1.0,0.0));
  float n001 = hash13(i + vec3(0.0,0.0,1.0));
  float n101 = hash13(i + vec3(1.0,0.0,1.0));
  float n011 = hash13(i + vec3(0.0,1.0,1.0));
  float n111 = hash13(i + vec3(1.0,1.0,1.0));
  return mix(
    mix(mix(n000,n100,f.x), mix(n010,n110,f.x), f.y),
    mix(mix(n001,n101,f.x), mix(n011,n111,f.x), f.y), f.z);
}
float fbm(vec3 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { s += a * vnoise(p); p *= 2.03; a *= 0.5; }
  return s;
}

// 雨痕: 世界坐标 xz 上的窄带噪声, 沿 y 拉伸 => 竖向条纹
float rainStreak(vec3 wp, float seed) {
  vec3 q = vec3(wp.x * 9.0 + seed, wp.y * 1.6, wp.z * 9.0);
  float n = fbm(q);
  float bands = smoothstep(0.45, 0.85, n);
  // 垂直连续性: 再叠一层 y 方向高频很弱的噪声
  float longN = fbm(vec3(wp.x * 7.0 + seed * 2.0, wp.y * 0.35, wp.z * 7.0));
  return bands * smoothstep(0.3, 0.9, longN);
}

// Schlick 菲涅尔
vec3 fresnelSchlick(float cosTheta, vec3 F0) {
  return F0 + (1.0 - F0) * pow(clamp(1.0 - cosTheta, 0.0, 1.0), 5.0);
}
// GGX NDF
float distributionGGX(vec3 N, vec3 H, float rough) {
  float a = rough * rough;
  float a2 = a * a;
  float ndh = max(dot(N, H), 0.0);
  float d = (ndh * ndh) * (a2 - 1.0) + 1.0;
  return a2 / max(0.0001, 3.14159265 * d * d);
}
float geometrySchlickGGX(float ndv, float rough) {
  float r = rough + 1.0;
  float k = (r * r) / 8.0;
  return ndv / (ndv * (1.0 - k) + k);
}

void main() {
  vec4 geo = fetchGeo();
  float curvH = geo.r;       // 曲率: 凹为正, 凸为负
  float ao = geo.g;          // 0..1
  float upness = geo.b;      // 法线 y 分量
  float heightN = geo.a;     // 归一化高度 0..1

  vec3 N = normalize(vNormal);
  vec3 V = normalize(uCamPos - vWorldPos);
  float ndv = max(dot(N, V), 0.05);

  // 凹度/凸度 0..1 (曲率经平滑映射, 限幅防异常值)
  float cavity = smoothstep(-0.5, 3.5, curvH); // 越凹越接近 1
  float convex = 1.0 - cavity;

  // ---------- 工序叠层 ----------
  vec3 baseCol = vec3(0.72, 0.35, 0.18);
  float metal = 1.0;
  float rough = 0.3;
  float coverage = 0.0; // 已被着色层覆盖的比例

  for (int i = 0; i < MAX_LAYERS; i++) {
    if (i >= uLayerCount) break;
    if (uLayerEnabled[i] == 0) continue;
    int kind = uLayerKind[i];
    float conc = uLayerConc[i];
    float pass = clamp((uLayerPasses[i] - 1.0) * 0.22 + 1.0, 1.0, 1.9);
    float strength = clamp(conc * pass, 0.0, 1.8);

    // 凹处偏好: cavityBias 把覆盖重心移向凹处, AO 进一步强化积色
    float geoMask = mix(1.0, clamp(cavity * 0.7 + (1.0 - ao) * 0.6, 0.0, 1.4), uLayerCavity[i]);
    float layerCov = clamp(strength * geoMask * (1.0 - coverage), 0.0, 1.0);

    if (kind == 0) { // base: 直接替换基底
      baseCol = uLayerColor[i];
      metal = uLayerMetal[i];
      rough = uLayerRough[i];
      continue;
    }

    vec3 lc = uLayerColor[i];
    if (kind == 4) { // 擦亮: 凸处恢复金属, 凹处不动
      float polishMask = convex * strength * (0.55 + 0.45 * ao);
      baseCol = mix(baseCol, lc, polishMask * 0.8);
      metal = mix(metal, uLayerMetal[i], polishMask);
      rough = mix(rough, uLayerRough[i], polishMask);
    } else {
      // darken / patina: 乘色叠层, 覆盖率驱动
      baseCol = mix(baseCol, lc, layerCov);
      metal = mix(metal, uLayerMetal[i], layerCov);
      rough = mix(rough, uLayerRough[i], layerCov);
      coverage = clamp(coverage + layerCov * 0.85, 0.0, 1.0);
    }
  }

  // ---------- 风化 ----------
  float yearT = clamp(uYears / 50.0, 0.0, 1.0);
  // 朝向因子: 朝向主导面的法线点积
  float facingDot = dot(normalize(vec3(uFacingDir.x, 0.0, uFacingDir.z)), normalize(vec3(N.x, 0.0, N.z)));
  float facingMask = smoothstep(-0.4, 0.9, facingDot);
  // 淋雨: 朝上 + 朝向雨来向的面受雨强
  float rainDot = dot(N, normalize(-uRainDir));
  float wetMask = smoothstep(-0.2, 0.85, rainDot) * (0.4 + 0.6 * max(upness, 0.0));
  // 凹处保水保污
  float retain = cavity * 0.6 + (1.0 - ao) * 0.5;

  // 铜绿随年份生长 (饱和曲线), 凹处+朝雨面+主导朝向优先
  float patinaGrowth = yearT * yearT * (0.35 + 0.65 * uPatinaRate);
  float patinaMask = clamp(patinaGrowth * (0.35 + retain * 0.75) * (0.55 + 0.45 * facingMask), 0.0, 0.92);

  // 绿锈与蓝锈斑驳: 噪声分区
  float mottle = fbm(vWorldPos * 3.7 + vec3(11.3));
  vec3 greenPatina = vec3(0.16, 0.34, 0.21);
  vec3 bluePatina = vec3(0.11, 0.26, 0.4);
  vec3 patinaCol = mix(greenPatina, bluePatina, smoothstep(0.55, 0.8, mottle) * 0.7);
  // 长期风化整体褪暗金属
  baseCol = mix(baseCol, patinaCol, patinaMask);
  metal = mix(metal, 0.08, patinaMask);
  rough = mix(rough, 0.88, patinaMask);

  // 雨痕竖条: 受雨面上, 沿世界 Y 方向的条纹加深+轻微发绿
  float streak = rainStreak(vWorldPos, 3.1) * wetMask * yearT * uStreakStrength;
  streak = clamp(streak, 0.0, 0.85);
  vec3 streakCol = vec3(0.09, 0.16, 0.12);
  baseCol = mix(baseCol, streakCol, streak * 0.55);
  rough = mix(rough, 0.92, streak * 0.5);

  // 顶部受雨面积累更明显 (水流终点在凹处, 起点在凸顶被冲刷擦亮)
  float washOff = convex * wetMask * yearT * 0.25;
  rough = mix(rough, max(rough - 0.15, 0.15), washOff);

  // AO 作用到漫反射
  vec3 albedo = baseCol;
  vec3 F0 = mix(vec3(0.04), albedo, metal);

  // ---------- 光照 (环境预设) ----------
  vec3 lightDir; vec3 lightColor; vec3 ambient; vec3 skyTint;
  if (uEnvironment == 0) { // 晴天
    lightDir = normalize(vec3(0.55, 0.85, 0.35));
    lightColor = vec3(1.0, 0.95, 0.85) * 2.6;
    ambient = vec3(0.32, 0.36, 0.42);
    skyTint = vec3(0.45, 0.55, 0.7);
  } else if (uEnvironment == 1) { // 阴天
    lightDir = normalize(vec3(-0.2, 1.0, 0.15));
    lightColor = vec3(0.85, 0.88, 0.95) * 1.3;
    ambient = vec3(0.5, 0.52, 0.56);
    skyTint = vec3(0.6, 0.62, 0.66);
  } else { // 夜景投光
    lightDir = normalize(vec3(0.35, 0.35, -0.6));
    lightColor = vec3(1.0, 0.82, 0.6) * 3.1;
    ambient = vec3(0.06, 0.07, 0.11);
    skyTint = vec3(0.08, 0.1, 0.18);
  }

  // 简易 IBL: 天空/地面渐变的环境项
  float upMix = max(N.y, 0.0) * 0.5 + 0.5;
  vec3 envRadiance = mix(vec3(0.12, 0.1, 0.08), skyTint, upMix);
  vec3 ambientCol = envRadiance * albedo * (1.0 - metal) * ao + envRadiance * F0 * metal * 0.6 * ao;

  // 主光直接照明 (Cook-Torrance)
  vec3 L = lightDir;
  vec3 Hv = normalize(V + L);
  float ndl = max(dot(N, L), 0.0);
  float NDF = distributionGGX(N, Hv, rough);
  float G = geometrySchlickGGX(ndv, rough) * geometrySchlickGGX(ndl, rough);
  vec3 F = fresnelSchlick(max(dot(Hv, V), 0.0), F0);
  vec3 spec = (NDF * G * F) / max(0.0001, 4.0 * ndv * ndl);
  vec3 kd = (vec3(1.0) - F) * (1.0 - metal);
  vec3 direct = (kd * albedo / 3.14159265 + spec) * lightColor * ndl;

  vec3 color = ambientCol + direct;

  // 夜景加一盏冷色补光 (模拟双侧投光灯)
  if (uEnvironment == 2) {
    vec3 L2 = normalize(vec3(-0.7, 0.3, 0.5));
    float ndl2 = max(dot(N, L2), 0.0);
    vec3 H2 = normalize(V + L2);
    float NDF2 = distributionGGX(N, H2, rough);
    vec3 F2 = fresnelSchlick(max(dot(H2, V), 0.0), F0);
    vec3 spec2 = F2 * NDF2 * 0.35;
    color += (kd * albedo / 3.14159265 + spec2) * vec3(0.5, 0.6, 0.9) * 1.4 * ndl2;
  }

  // 色调映射 + gamma
  color = color / (color + vec3(1.0));
  color = pow(color, vec3(1.0 / 2.2));
  fragColor = vec4(color, 1.0);
}
`;

// 调试视图: 曲率 / AO 伪彩
export const DEBUG_VERT = VERT_SRC;
export const DEBUG_FRAG = `#version 300 es
precision highp float;
in float vDataIndex;
uniform sampler2D uGeoData;
uniform vec2 uGeoTexSize;
uniform int uMode; // 0=曲率 1=AO
out vec4 fragColor;

vec3 ramp(float t) {
  t = clamp(t, 0.0, 1.0);
  vec3 c0 = vec3(0.08, 0.15, 0.5);
  vec3 c1 = vec3(0.95, 0.95, 0.9);
  vec3 c2 = vec3(0.7, 0.12, 0.08);
  if (t < 0.5) return mix(c0, c1, t * 2.0);
  return mix(c1, c2, (t - 0.5) * 2.0);
}

void main() {
  float idx = vDataIndex + 0.5;
  vec2 uv = vec2(mod(idx, uGeoTexSize.x), floor(idx / uGeoTexSize.x));
  vec4 g = texelFetch(uGeoData, ivec2(uv), 0);
  if (uMode == 0) {
    float t = clamp(g.r * 0.35 + 0.5, 0.0, 1.0);
    fragColor = vec4(ramp(t), 1.0);
  } else {
    fragColor = vec4(vec3(g.g), 1.0);
  }
}
`;
