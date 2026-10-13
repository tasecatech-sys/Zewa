/* ==========================================================
   Gráficos SVG ligeros (sin dependencias) con tooltip al pasar el mouse.
   Colores por rol (CSS vars) → funcionan en modo claro y oscuro.
   ========================================================== */
const Charts = (() => {
  const NS = 'http://www.w3.org/2000/svg';
  const niceMax = (v) => {
    if (v <= 0) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    const n = v / p;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
  };
  function tip(root) {
    let t = root.querySelector('.chart-tip');
    if (!t) { t = document.createElement('div'); t.className = 'chart-tip'; root.appendChild(t); }
    return {
      show(html, x, y) {
        t.innerHTML = html; t.classList.add('on');
        const rw = root.clientWidth, tw = t.offsetWidth;
        t.style.left = Math.min(Math.max(0, x - tw / 2), rw - tw) + 'px';
        t.style.top = Math.max(0, y - t.offsetHeight - 10) + 'px';
      },
      hide() { t.classList.remove('on'); },
    };
  }
  const scaleOf = (root, W) => (root.querySelector('svg').getBoundingClientRect().width || W) / W;

  /* Barras verticales: una serie */
  function bars(el, { labels, values, color = 'var(--series-1)', fmt = fmtMoney, H = 220 }) {
    const W = 560, P = { l: 52, r: 8, t: 12, b: 26 };
    const max = niceMax(Math.max(...values, 0));
    const iw = W - P.l - P.r, ih = H - P.t - P.b, bw = iw / values.length;
    const barW = Math.min(36, bw * 0.56);
    let g = '';
    for (let i = 0; i <= 4; i++) {
      const y = P.t + ih - (ih * i) / 4;
      g += `<line class="gridline" x1="${P.l}" x2="${W - P.r}" y1="${y}" y2="${y}"/><text x="${P.l - 8}" y="${y + 4}" text-anchor="end">${fmtShort((max * i) / 4)}</text>`;
    }
    let b = '', hits = '';
    values.forEach((v, i) => {
      const h = (v / max) * ih, x = P.l + bw * i + (bw - barW) / 2, y = P.t + ih - h;
      const r = Math.min(4, h / 2);
      b += h > 0 ? `<path d="M${x},${P.t + ih} V${y + r} Q${x},${y} ${x + r},${y} H${x + barW - r} Q${x + barW},${y} ${x + barW},${y + r} V${P.t + ih} Z" style="fill:${color}"/>` : '';
      hits += `<rect class="hit" data-i="${i}" x="${P.l + bw * i}" y="${P.t}" width="${bw}" height="${ih}"/>`;
      g += `<text x="${P.l + bw * i + bw / 2}" y="${H - 8}" text-anchor="middle">${labels[i]}</text>`;
    });
    el.classList.add('chart');
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img"><g class="axis">${g}</g>${b}<line x1="${P.l}" x2="${W - P.r}" y1="${P.t + ih}" y2="${P.t + ih}" style="stroke:var(--border-strong)"/>${hits}</svg>`;
    const T = tip(el);
    el.querySelectorAll('.hit').forEach((h) => {
      h.addEventListener('mousemove', () => {
        const i = +h.dataset.i, s = scaleOf(el, W);
        T.show(`<span class="muted">${labels[i]}</span><b>${fmt(values[i])}</b>`, (P.l + bw * i + bw / 2) * s, (P.t + ih - (values[i] / max) * ih) * s);
      });
      h.addEventListener('mouseleave', T.hide);
    });
  }

  /* Área + línea con crosshair */
  function area(el, { labels, values, color = 'var(--series-3)', fmt = fmtMoney, H = 220 }) {
    const W = 560, P = { l: 52, r: 12, t: 12, b: 26 };
    const max = niceMax(Math.max(...values, 0));
    const iw = W - P.l - P.r, ih = H - P.t - P.b;
    const X = (i) => P.l + (values.length === 1 ? iw / 2 : (iw * i) / (values.length - 1));
    const Y = (v) => P.t + ih - (v / max) * ih;
    let g = '';
    for (let i = 0; i <= 4; i++) {
      const y = P.t + ih - (ih * i) / 4;
      g += `<line class="gridline" x1="${P.l}" x2="${W - P.r}" y1="${y}" y2="${y}"/><text x="${P.l - 8}" y="${y + 4}" text-anchor="end">${fmtShort((max * i) / 4)}</text>`;
    }
    labels.forEach((l, i) => { g += `<text x="${X(i)}" y="${H - 8}" text-anchor="middle">${l}</text>`; });
    const pts = values.map((v, i) => `${X(i)},${Y(v)}`).join(' L');
    const gid = 'ga' + Math.random().toString(36).slice(2, 7);
    el.classList.add('chart');
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img">
      <defs><linearGradient id="${gid}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" style="stop-color:${color};stop-opacity:.28"/><stop offset="1" style="stop-color:${color};stop-opacity:0"/></linearGradient></defs>
      <g class="axis">${g}</g>
      <path d="M${X(0)},${P.t + ih} L${pts} L${X(values.length - 1)},${P.t + ih} Z" fill="url(#${gid})"/>
      <path d="M${pts}" fill="none" style="stroke:${color}" stroke-width="2" stroke-linejoin="round"/>
      <line class="xh" y1="${P.t}" y2="${P.t + ih}" style="stroke:var(--text-3)" stroke-dasharray="3 3" visibility="hidden"/>
      <circle class="xd" r="5" style="fill:${color};stroke:var(--surface)" stroke-width="2" visibility="hidden"/>
      <rect class="hit" x="${P.l}" y="${P.t}" width="${iw}" height="${ih}"/></svg>`;
    const T = tip(el), svg = el.querySelector('svg'), xh = svg.querySelector('.xh'), xd = svg.querySelector('.xd');
    const hit = svg.querySelector('.hit');
    hit.addEventListener('mousemove', (e) => {
      const r = svg.getBoundingClientRect(), s = r.width / W;
      const mx = (e.clientX - r.left) / s;
      const i = Math.max(0, Math.min(values.length - 1, Math.round(((mx - P.l) / iw) * (values.length - 1))));
      xh.setAttribute('x1', X(i)); xh.setAttribute('x2', X(i)); xh.setAttribute('visibility', 'visible');
      xd.setAttribute('cx', X(i)); xd.setAttribute('cy', Y(values[i])); xd.setAttribute('visibility', 'visible');
      T.show(`<span class="muted">${labels[i]}</span><b>${fmt(values[i])}</b>`, X(i) * s, Y(values[i]) * s);
    });
    hit.addEventListener('mouseleave', () => { T.hide(); xh.setAttribute('visibility', 'hidden'); xd.setAttribute('visibility', 'hidden'); });
  }

  /* Barra apilada horizontal (composición de cartera) con leyenda + etiquetas */
  function stack(el, { parts, fmt = fmtMoney }) {
    const total = parts.reduce((s, p) => s + p.value, 0) || 1;
    const W = 560, H = 40;
    let x = 0, segs = '';
    parts.forEach((p, i) => {
      const w = (p.value / total) * W;
      if (w > 0) segs += `<rect class="seg" data-i="${i}" x="${x + (x ? 1 : 0)}" y="0" width="${Math.max(0, w - (x ? 2 : 1))}" height="${H}" rx="4" style="fill:${p.color}"/>`;
      x += w;
    });
    el.classList.add('chart');
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" style="border-radius:6px">${segs}</svg>
      <table class="mini-tbl" style="margin-top:12px"><tbody>${parts.map((p) => `<tr><td><i style="display:inline-block;width:10px;height:10px;border-radius:3px;background:${p.color};margin-right:8px"></i>${p.label}</td><td class="num">${fmt(p.value)}</td><td class="num" style="color:var(--text-3)">${Math.round((p.value / total) * 100)}%</td></tr>`).join('')}</tbody></table>`;
    const T = tip(el);
    el.querySelectorAll('.seg').forEach((s) => {
      s.addEventListener('mousemove', (e) => {
        const p = parts[+s.dataset.i], r = el.getBoundingClientRect();
        T.show(`<span class="muted">${p.label}</span><b>${fmt(p.value)}</b>`, e.clientX - r.left, 0);
      });
      s.addEventListener('mouseleave', T.hide);
    });
  }

  /* Embudo de conversión (rampa ordinal azul) */
  function funnel(el, { steps }) {
    const max = Math.max(...steps.map((s) => s.value), 1);
    const ramp = ['var(--seq-1)', 'var(--seq-2)', 'var(--seq-3)', 'var(--seq-4)'];
    el.classList.add('chart');
    el.innerHTML = steps.map((s, i) => {
      const pct = i === 0 ? 100 : steps[0].value ? Math.round((s.value / steps[0].value) * 100) : 0;
      return `<div class="fn-row" data-i="${i}" style="display:grid;grid-template-columns:110px 1fr 70px;align-items:center;gap:10px;margin:8px 0">
        <span style="font-size:12.5px;color:var(--text-2)">${s.label}</span>
        <div style="height:26px;background:var(--muted-bg);border-radius:6px;overflow:hidden"><div style="height:100%;width:${(s.value / max) * 100}%;background:${ramp[i % 4]};border-radius:4px;transition:width .6s"></div></div>
        <span style="text-align:right;font-variant-numeric:tabular-nums"><b>${s.value}</b> <small style="color:var(--text-3)">${pct}%</small></span></div>`;
    }).join('');
    const T = tip(el);
    el.querySelectorAll('.fn-row').forEach((r) => {
      r.addEventListener('mousemove', (e) => {
        const s = steps[+r.dataset.i], b = el.getBoundingClientRect();
        T.show(`<span class="muted">${s.label}</span><b>${s.value} documentos · ${fmtMoney(s.amount || 0)}</b>`, e.clientX - b.left, r.offsetTop);
      });
      r.addEventListener('mouseleave', T.hide);
    });
  }

  return { bars, area, stack, funnel };
})();
