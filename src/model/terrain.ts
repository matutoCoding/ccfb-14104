import type { Corridor, Tree } from '../types';

/** 确定性伪随机（mulberry32） */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 一维值噪声 */
function noise1(x: number, rand: (i: number) => number): number {
  const i = Math.floor(x), f = x - i;
  const u = f * f * (3 - 2 * f);
  return rand(i) * (1 - u) + rand(i + 1) * u;
}

export interface Terrain {
  corridor: Corridor;
  /** 地面高程（x 沿走廊里程，y 横向偏移，右侧为正） */
  groundAt(x: number, y: number): number;
}

/**
 * 程序生成"翻山过河"走廊：
 *  - 两座山包 + 一条河谷 + 缓坡起伏
 *  - 山腰两片树林、一处公路跨越、一处低压线跨越
 */
export function generateTerrain(seed: number, length: number): Terrain {
  const rand = rng(seed);
  // 固定结构（占走廊比例），细节由种子扰动
  const hill1X = length * (0.30 + rand() * 0.05);
  const hill1H = 55 + rand() * 25;
  const hill2X = length * (0.72 + rand() * 0.05);
  const hill2H = 75 + rand() * 30;
  const riverX = length * (0.52 + rand() * 0.04);
  const riverW = 60 + rand() * 40;
  const roadX = length * (0.42 + rand() * 0.06);
  const lvX = length * (0.84 + rand() * 0.04);
  const base0 = 20 + rand() * 15;

  // 噪声表
  const table = new Array(256).fill(0).map(() => rand());
  const tab = (i: number) => table[((i % 256) + 256) % 256];

  const gauss = (x: number, c: number, w: number) => Math.exp(-(((x - c) / w) ** 2));

  function groundAt(x: number, y: number): number {
    let z = base0;
    z += hill1H * gauss(x, hill1X, length * 0.09);
    z += hill2H * gauss(x, hill2X, length * 0.11);
    // 河谷下切
    z -= (base0 * 0.8 + 12) * gauss(x, riverX, riverW * 0.8);
    // 纵向起伏
    z += 8 * noise1(x / 90, tab) + 3 * noise1(x / 23, tab);
    // 横向：走廊中心略平整，两侧山坡抬升 + 横向噪声
    const ay = Math.abs(y);
    z += ay * ay * 0.0012 * (1 + gauss(x, hill1X, length * 0.1) + gauss(x, hill2X, length * 0.12));
    z += 4 * noise1(x / 70 + y / 53, tab) * Math.min(1, ay / 40);
    return z;
  }

  // 树林：两片，分别在山腰
  const trees: Tree[] = [];
  const forests = [
    { cx: hill1X - length * 0.06, cy: 25, rx: length * 0.055, ry: 55, n: 90 },
    { cx: hill2X + length * 0.05, cy: -30, rx: length * 0.06, ry: 60, n: 110 },
    { cx: length * 0.15, cy: -20, rx: length * 0.03, ry: 35, n: 40 },
  ];
  for (const f of forests) {
    for (let i = 0; i < f.n; i++) {
      const ang = rand() * Math.PI * 2;
      const rr = Math.sqrt(rand());
      const x = f.cx + Math.cos(ang) * rr * f.rx;
      const y = f.cy + Math.sin(ang) * rr * f.ry;
      trees.push({ x, y, h: 9 + rand() * 8, r: 2 + rand() * 2 });
    }
  }

  const corridor: Corridor = {
    id: `corridor-${seed}-${length}`,
    projectId: '',
    seed, length, trees,
    road: { station: roadX, width: 12 },
    lvLine: { station: lvX, poleHeight: 10 },
    river: { station: riverX, width: riverW },
  } satisfies Corridor;

  return { corridor, groundAt };
}
