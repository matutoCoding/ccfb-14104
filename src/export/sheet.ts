// 工序单导出: 给车间的施工单 (HTML 可打印), 含每层药剂/浓度/遍数/凹处偏好与风化参数
import { Project, Scheme, REAGENTS } from '../core/materials';
import { downloadBlob } from '../core/Package';

export function exportProcessSheet(project: Project, scheme: Scheme): void {
  const rows = scheme.layers
    .filter((l) => l.enabled)
    .map((l, i) => {
      const d = REAGENTS[l.reagent];
      return `<tr>
        <td>${i + 1}</td><td>${d.name}</td><td>${Math.round(l.concentration * 100)}%</td>
        <td>${l.passes}</td><td>${Math.round(l.cavityBias * 100)}%</td>
        <td style="text-align:left">${d.description}</td>
      </tr>`;
    }).join('');

  const w = scheme.weathering;
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<title>${project.name} - 着色工序单</title>
<style>
  body { font-family: 'SimSun', serif; padding: 32px; color: #111; }
  h1 { text-align: center; margin-bottom: 4px; }
  .meta { display: flex; justify-content: space-between; margin: 12px 0; font-size: 13px; }
  table { width: 100%; border-collapse: collapse; margin: 16px 0; }
  th, td { border: 1px solid #333; padding: 7px 9px; text-align: center; font-size: 13px; }
  th { background: #eee; }
  .note { border: 1px solid #999; padding: 12px; margin-top: 18px; font-size: 13px; line-height: 1.9; }
  .sign { margin-top: 40px; display: flex; justify-content: space-between; }
  @media print { .noprint { display: none; } }
</style></head><body>
<h1>铜雕着色工序单</h1>
<div class="meta">
  <span>作品: <b>${project.name}</b>${project.client ? ' · 客户: ' + project.client : ''}</span>
  <span>方案: ${scheme.name}</span>
  <span>单号: ${project.id.slice(-8).toUpperCase()}</span>
</div>
<table>
  <thead><tr><th>顺序</th><th>药剂/工序</th><th>浓度</th><th>遍数</th><th>凹处偏好</th><th>施工说明</th></tr></thead>
  <tbody>${rows}</tbody>
</table>
<div class="note">
  <b>风化交付预期 (${w.years} 年户外):</b><br>
  主导朝向 ${w.facing}° 面铜绿着生优先; 雨水来向 ${w.rainAngle}° / 倾角 ${w.rainTilt}°,
  雨痕沿竖直方向流挂; 铜绿速率 ×${w.patinaRate}, 雨痕强度 ${Math.round(w.streakStrength * 100)}%。<br>
  几何积色依据: 顶点离散平均曲率 (Meyer 余切公式, 球/圆环解析核对误差 &lt;2%) 与半球光线投射环境遮蔽,
  凹处积存铜绿与硫化层, 凸处经蜡封擦亮保留金属光。
</div>
<div class="sign"><span>车间师傅签字: ____________</span><span>质检: ____________</span><span>日期: ____________</span></div>
<button class="noprint" onclick="window.print()" style="margin-top:24px;padding:8px 24px">打印 / 另存 PDF</button>
</body></html>`;

  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  downloadBlob(blob, `${project.name}_工序单_${scheme.name}.html`);
}
