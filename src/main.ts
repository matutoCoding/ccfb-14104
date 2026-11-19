import './style.css';
import { App } from './ui/app';

const appEl = document.getElementById('app')!;
appEl.innerHTML = `
  <header>
    <h1>架空线路排杆与弧垂校核系统</h1>
    <nav id="nav"></nav>
  </header>
  <main id="page"></main>
`;

const app = new App();
app.init().catch(err => {
  appEl.insertAdjacentHTML('beforeend',
    `<pre style="color:#f66;padding:1em">初始化失败：${err?.stack ?? err}</pre>`);
});
