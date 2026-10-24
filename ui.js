/* 公司经营模拟 · 界面层 v1.0.0 2026-10-24 肥鱼 */
const $ = id => document.getElementById(id);
const money = v => {
  const w = v / 1e4;
  if (Math.abs(w) >= 10000) return (w / 10000).toFixed(2) + ' 亿';
  return w.toFixed(1) + ' 万';
};
const pct = v => (v * 100).toFixed(1) + '%';

let choiceCtx = null;   // 待选事件

function render() {
  const p = P();
  $('cash').textContent = money(G.cash);
  const _td = totalDebt();
  $('debt').textContent = money(_td);
  $('month').textContent = G.month;
  $('stores').textContent = G.stores;
  $('seg').textContent = p.icon + ' ' + p.name;
  $('rep').textContent = G.reputation.toFixed(0);
  $('morale').textContent = G.morale.toFixed(0);
  $('staff').textContent = G.staff;
  if ($('staff2')) $('staff2').textContent = G.staff;
  if ($('credit')) {
    const c = G.credit;
    $('credit').textContent = c.toFixed(0);
    $('credit').className = 'v ' + (c >= 70 ? 'good' : c >= 40 ? 'warn' : 'bad');
  }
  if ($('avail')) {
    const av = Math.max(0, creditLimit() - totalDebt());
    $('avail').textContent = money(av);
    $('avail').className = 'v' + (av < 50000 ? ' bad' : '');
  }
  if ($('monthlyPay')) {
    let mpay = 0;
    G.loans.forEach(ln => {
      const r = ln.rate / 12, n = ln.term;
      mpay += ln.principal * r * Math.pow(1 + r, n) / (Math.pow(1 + r, n) - 1);
    });
    $('monthlyPay').textContent = mpay > 0 ? money(mpay) : '无';
    $('monthlyPay').className = 'v' + (mpay > 0 ? ' warn' : '');
  }

  const stage = STAGES.find(s => G.stores >= s.minStores && G.stores <= s.maxStores) || STAGES[0];
  $('stage').textContent = stage.name;

  // 城市 / 竞争 / 风险 显示
  if ($('cityLabel') && G.cityMod) {
    $('cityLabel').textContent = G.cityMod.city.name + '·' + G.cityMod.district.name;
  }
  if ($('riskVal')) {
    const r = G.riskBuildup || 0;
    $('riskVal').textContent = r.toFixed(0);
    $('riskVal').className = 'v ' + (r >= 30 ? 'bad' : r >= 15 ? 'warn' : r > 0 ? '' : 'good');
  }
  if ($('rivalVal')) {
    const n = (G.rivals || []).length;
    $('rivalVal').textContent = n + ' 家';
    $('rivalVal').className = 'v ' + (G.compIntensity >= 1.5 ? 'bad' : G.compIntensity >= 1 ? 'warn' : 'good');
  }
  if ($('orgVal')) {
    const o = G.hasCompany ? '公司化' : G.hasHQ ? '总部' : '无';
    $('orgVal').textContent = o;
    $('orgVal').className = 'v ' + (G.hasCompany ? 'good' : G.hasHQ ? '' : 'warn');
  }

  // 现金为负变红
  $('cash').className = G.cash < 0 ? 'v bad' : 'v';
  $('debt').className = _td > 0 ? 'v warn' : 'v';

  // 月度历史
  const tbody = $('history');
  tbody.innerHTML = G.history.slice(-12).reverse().map(l => `
    <tr>
      <td>${l.month}</td>
      <td>${money(l.revenue)}</td>
      <td class="${l.netProfit >= 0 ? 'good' : 'bad'}">${money(l.netProfit)}</td>
      <td class="${l.cashAfter >= 0 ? '' : 'bad'}">${money(l.cashAfter)}</td>
    </tr>`).join('');

  // 状态
  if (G.status === 'bankrupt') {
    $('status').innerHTML = '<div class="over">💀 公司破产</div>';
    $('btnNext').disabled = true;
    $('btnOpen').disabled = true;
  } else if (G.status === 'caught') {
    $('status').innerHTML = '<div class="over" style="color:#ff4040">🚨 被查处关停 · 游戏结束</div>';
    $('btnNext').disabled = true;
    $('btnOpen').disabled = true;
  }
}

function doSettle() {
  if (G.status !== 'running') return;   // 破产/被查处都不能继续
  const log = settleMonth();

  // 展示本月明细
  let html = `<div class="logtitle">第 ${log.month} 个月</div>`;
  html += '<table class="detail">';
  log.items.forEach(([name, amt, kind]) => {
    if (kind === 'memo') return;
    const cls = kind === 'in' ? 'good' : 'bad';
    html += `<tr><td>${name}</td><td class="${cls}">${kind === 'in' ? '+' : '−'}${money(Math.abs(amt))}</td></tr>`;
  });
  html += `<tr class="total"><td>当月净利</td><td class="${log.netProfit >= 0 ? 'good' : 'bad'}">${money(log.netProfit)}</td></tr>`;
  html += '</table>';

  // 随机事件（真实频率：约 35% 的月份会遇到事，不是月月出事）
  const EVENT_CHANCE = 0.35;
  const ev = (Math.random() < EVENT_CHANCE) ? pickEvent(G, new Set(G.usedEvents)) : null;
  if (ev) {
    G.usedEvents.push(ev.id);
    html += `<div class="event"><div class="evtitle">⚠ ${ev.title}</div><div class="evtext">${ev.text}</div></div>`;
    if (ev.choice) {
      choiceCtx = ev;
      html += '<div class="choices">';
      ev.options.forEach((o, i) => {
        html += `<button class="choice" onclick="pickChoice(${i})">${o.label}</button>`;
      });
      html += '</div>';
      $('btnNext').disabled = true;
    } else {
      const eff = ev.effect(G);
      applyEffect(eff);
      html += `<div class="evresult">→ ${eff.text}</div>`;
    }
  }

  // 历史大环境
  if (G.historyEvent && G.historyEvent.length) {
    G.historyEvent.forEach(h => {
      html += `<div class="bigEvent">
        <div class="betitle">🌏 ${h.name}（${h.severity}）</div>
        <div class="betext">${h.text}</div>
        ${h.real ? `<div class="bereal">真实数据：${h.real}</div>` : ''}
      </div>`;
    });
  }

  // 破产提示 / 事件
  log.events.forEach(e => {
    html += `<div class="evresult ${e.type}">${e.text}</div>`;
  });

  // 被查之后：先让玩家做选择，不选不能继续
  if (G.pendingAftermath) {
    html += renderAftermath();
  }
  if (G.pendingOfficialDemand) {
    html += renderOfficialDemand();
  }

  $('log').innerHTML = html;
  render();
  if (G.pendingAftermath || G.pendingOfficialDemand) $('btnNext').disabled = true;
}

function applyEffect(eff) {
  if (eff.cash) G.cash += eff.cash;
  if (eff.reputation) G.reputation = Math.max(0, Math.min(100, G.reputation + eff.reputation));
  if (eff.morale) G.morale = Math.max(0, Math.min(100, G.morale + eff.morale));
  if (eff.revenueDelta) addMod('revenueDelta', eff.revenueDelta, eff.months || 1);
  if (eff.foodCostDelta) addMod('foodCostDelta', eff.foodCostDelta, eff.months || 1);
  if (eff.rentDelta) addMod('rentDelta', eff.rentDelta, eff.months || 999);
  if (eff.staffRateDelta) addMod('staffRateDelta', eff.staffRateDelta, eff.months || 999);
  if (eff.staffDelta) addMod('staffDelta', eff.staffDelta, eff.months || 999);
  if (eff.receivables) {
    eff.receivables.forEach(r => G.receivables.push(r));
  }
  if (G.cash < 0) G.status = 'bankrupt';
}

function pickChoice(i) {
  if (!choiceCtx) return;
  const eff = choiceCtx.options[i].effect(G);
  applyEffect(eff);
  const box = document.querySelector('.choices');
  if (box) box.outerHTML = `<div class="evresult">→ ${eff.text}</div>`;
  choiceCtx = null;
  $('btnNext').disabled = false;
  render();
}

function doOpen() {
  const r = openStore();
  $('log').innerHTML = `<div class="evresult ${r.ok ? 'good' : 'bad'}">${r.msg}</div>`;
  render();
}

/* 打开贷款面板 */
function showLoan() {
  const panel = $('loanPanel');
  panel.style.display = panel.style.display === 'block' ? 'none' : 'block';
  if (panel.style.display !== 'block') return;
  const limit = creditLimit();
  const debt = totalDebt();
  const avail = Math.max(0, limit - debt);
  const rate = loanRate();

  let html = `<div class="loanhead">信用评分 <b class="${G.credit >= 70 ? 'good' : G.credit >= 40 ? 'warn2' : 'bad'}">${G.credit.toFixed(0)}</b> / 100
    · 可贷余额 <b>${money(avail)}</b> · 基准利率 <b>${(G.lastRBI).toFixed(2)}%</b></div>`;

  // 已有贷款
  if (G.loans.length) {
    html += '<div class="loansub">当前贷款</div>';
    G.loans.forEach((ln, i) => {
      const r = ln.rate / 12, n = ln.term;
      const pay = ln.principal * r * Math.pow(1 + r, n) / (Math.pow(1 + r, n) - 1);
      html += `<div class="loanrow">
        <span>${ln.product} · 余 ${money(ln.remain)} · 年化 ${(ln.rate * 100).toFixed(2)}%</span>
        <span class="pay">月供 ${money(pay)}</span>
        <button class="tiny" onclick="doRepay(${i})">提前还</button>
      </div>`;
    });
  }

  // 可申请的贷款
  html += '<div class="loansub">可申请</div>';
  LOAN_PRODUCTS.forEach(prod => {
    const okCredit = G.credit >= prod.minCredit;
    const okMonth = prod.id !== 'business' || G.month >= 6;
    const okAmount = avail >= 50000;
    const disabled = !okCredit || !okMonth || !okAmount;
    let reason = '';
    if (!okCredit) reason = '信用不足（需 ' + prod.minCredit + ' 分）';
    else if (!okMonth) reason = '需经营满 6 个月';
    else if (!okAmount) reason = '可贷余额不足';

    html += `<div class="loanprod ${disabled ? 'disabled' : ''}">
      <div class="lpname">${prod.name} <span class="lpterm">${prod.term} 期</span></div>
      <div class="lpdesc">${prod.desc}</div>
      ${disabled ? `<div class="lpno">${reason}</div>` : `
        <div class="lprate">年利率 ${(rate * 100).toFixed(2)}%</div>
        <div class="lpbtns">
          ${[5, 10, 20].filter(w => w * 1e4 <= avail).map(w =>
            `<button class="tiny" onclick="doLoan('${prod.id}',${w * 1e4})">借 ${w} 万</button>`).join('')}
        </div>`}
    </div>`;
  });

  html += `<div class="loanwarn">⚠️ 利率随信用浮动：信用越低越贵。逾期一次罚息 5% 并扣 15 分信用。</div>`;
  panel.innerHTML = html;
}

function doLoan(prodId, amount) {
  const r = applyLoan(prodId, amount);
  $('log').innerHTML = `<div class="evresult ${r.ok ? 'good' : 'bad'}">${r.msg}</div>`;
  showLoan(); showLoan();   // 刷新面板
  render();
}

function doRepay(idx) {
  const ln = G.loans[idx];
  if (!ln) return;
  const r = repayLoan(idx, ln.remain);
  $('log').innerHTML = `<div class="evresult ${r.ok ? 'good' : 'bad'}">${r.msg}</div>`;
  showLoan(); showLoan();
  render();
}

function showSwitch() {
  $('switchPanel').style.display = 'block';
  const list = $('switchList');
  list.innerHTML = Object.entries(SEGMENTS).map(([k, v]) => {
    if (k === G.seg) return '';
    const prev = switchSegment(k);
    const cls = prev.ok ? '' : 'disabled';
    return `<div class="switem ${cls}">
      <div class="swname">${v.icon} ${v.name}</div>
      <div class="swdesc">${v.desc}</div>
      ${prev.ok ? `<div class="swcost">转换成本 ${money(prev.cost)} · 成功率 ${pct(prev.successRate)}</div>
      <button class="tbtn" onclick="confirmSwitch('${k}')">转做这个</button>` : `<div class="swcost bad">${prev.msg}</div>`}
    </div>`;
  }).join('');
}

function confirmSwitch(k) {
  const prev = switchSegment(k);
  if (!prev.ok) return;
  const r = executeSwitch(k, prev);
  $('switchPanel').style.display = 'none';
  $('log').innerHTML = `<div class="evresult ${r.success ? 'good' : 'bad'}">${r.msg}</div>`;
  render();
}

function startGame() {
  const seg = document.querySelector('input[name=seg]:checked').value;
  const cityId = $('selCity').value;
  const distId = $('selDist').value;
  const p = SEGMENTS[seg];

  // 城市系数
  const cm = cityModifiers(cityId, distId);
  G.cityMod = cm;
  G.cityId = cityId;
  G.districtId = distId;
  G.startYear = startYear;

  // 起始资金：开店成本 + 1~2 个月固定成本，按城市等级加成（一线融资更容易，但压力也大）
  const monthlyFixed = (p.rentFixed * cm.rentMult) + p.utilFixed +
                       (p.staffCount * p.staffFixedWage * cm.wageMult);
  const bonus = CITY_STARTUP_BONUS[cm.city.tier] || 1.0;
  G.cash = Math.round((p.setupCost + monthlyFixed * (1 + Math.random())) * bonus / 10000) * 10000;

  // 加盟：先扣加盟费
  let franchiseMsg = '';
  if (startMode === 'join' && startBrand) {
    const r = joinFranchise(startBrand);
    franchiseMsg = r.ok ? r.msg : ('加盟失败：' + r.msg);
  }

  // 基础状态
  G.seg = seg;
  G.stores = 1;
  G.month = 0;
  G.history = [];
  G.status = 'running';
  G.mods = [];
  G.receivables = [];
  G.payables = [];
  G.reputation = 50;
  G.morale = 70;
  G.monthsNegProfit = 0;
  G.loans = [];
  G.credit = 100;
  G.overdue = 0;
  G.lastRBI = 6.0;
  G.mortgages = [];
  G.terms = 'normal';
  G.listed = false;
  G.ipoMonth = 0;
  G.ownership = 1.0;
  G.monthlyDividend = false;
  G.hasHQ = false;
  G.hasCompany = false;
  G.riskBuildup = 0;
  G.riskEvent = null;
  G.vcDeal = null;
  G.pendingStores = [];
  G.rampingStores = [{ months: 0, rampMonths: 10 }];   // 第一家店也要爬坡
  G.rivalsPriceWarMonths = 0;
  G.warnings = [];
  G.historyEvent = null;
  G.staff = p.staffCount;
  if (startMode !== 'join') G.franchise = null;

  // 竞争对手
  initRivals(cityId, distId, seg);

  $('setup').style.display = 'none';
  $('game').style.display = 'block';
  render();

  const hist = historyRevenueMult(0, startYear);
  $('log').innerHTML = `<div class="evresult good">
    ${cm.city.name} · ${cm.district.name} · ${startYear} 年 · ${p.name}
    ${G.franchise ? '（加盟「' + G.franchise.brandName + '」）' : '（自建品牌）'}<br>
    现金 ${money(G.cash)}｜员工 ${G.staff} 人｜附近有 ${G.rivals.length} 家同行<br>
    ${franchiseMsg ? franchiseMsg + '<br>' : ''}
    <span style="color:#8aa06a">${p.realData}</span><br>
    <span style="color:#c0a050">⚠️ 新店要 10 个月才能爬满客流，前几个月是熬的</span>
  </div>`;
}


/* ═══ 抵押面板 ═══ */
function showMortgage() {
  const panel = $('mortgagePanel');
  panel.style.display = panel.style.display === 'block' ? 'none' : 'block';
  if (panel.style.display !== 'block') return;

  let html = `<div class="loanhead">可抵押资产 · 折价率越低越难变现</div>`;
  COLLATERAL_TYPES.forEach(t => {
    const offer = mortgageOffer(t.id);
    if (!offer || !offer.ok) {
      html += `<div class="loanprod disabled">
        <div class="lpname">${t.name}</div>
        <div class="lpdesc">${t.desc}</div>
        <div class="lpno">${offer ? offer.msg : '无'}</div></div>`;
      return;
    }
    const already = G.mortgages.some(m => m.type === t.id);
    html += `<div class="loanprod ${already ? 'disabled' : ''}">
      <div class="lpname">${t.name} <span class="lpterm">折价 ${(t.ratio * 100)}%</span></div>
      <div class="lpdesc">${t.desc}</div>
      <div class="lprate">评估 ${money(offer.baseValue)} → 可贷 ${money(offer.loanable)} · 年化 ${(offer.rate * 100).toFixed(2)}%</div>
      ${already ? '<div class="lpno">已抵押</div>' : `
        <div class="lpbtns">
          ${[0.5, 1].map(f => `<button class="tiny" onclick="doMortgage('${t.id}',${Math.round(offer.loanable * f)})">借 ${money(offer.loanable * f)}</button>`).join('')}
        </div>`}
    </div>`;
  });
  html += `<div class="loanwarn">⚠️ 抵押贷利率比信用贷低，但一旦长期违约，银行会按评估价 50% 法拍处置抵押物。</div>`;
  panel.innerHTML = html;
}

function doMortgage(typeId, amount) {
  const r = applyMortgage(typeId, amount);
  $('log').innerHTML = `<div class="evresult ${r.ok ? 'good' : 'bad'}">${r.msg}</div>`;
  showMortgage(); showMortgage();
  render();
}

/* ═══ 账期谈判面板 ═══ */
function showTerms() {
  const panel = $('termsPanel');
  panel.style.display = panel.style.display === 'block' ? 'none' : 'block';
  if (panel.style.display !== 'block') return;

  const cur = currentDeal();
  const sizeScore = Math.min(1, G.stores / 10);
  const creditScore = G.credit / 100;
  const power = sizeScore * 0.5 + creditScore * 0.5;

  let html = `<div class="loanhead">当前账期 <b>${cur.name}</b> · 议价力 <b class="${power >= 0.6 ? 'good' : power >= 0.35 ? 'warn2' : 'bad'}">${(power * 100).toFixed(0)}</b> / 100
    <br><span style="font-size:9px;color:#5a7a90">议价力 = 门店规模 50% + 信用 50%</span></div>`;

  TERMS_DEALS.forEach(d => {
    const isCur = d.id === G.terms;
    const need = d.id === 'extra' ? 0.6 : d.id === 'long' ? 0.35 : 0;
    const canGet = power >= need;
    html += `<div class="loanprod ${(!canGet || isCur) ? 'disabled' : ''}">
      <div class="lpname">${d.name} ${isCur ? '<span class="lpterm">当前</span>' : ''}</div>
      <div class="lpdesc">${d.desc}</div>
      <div class="lprate">报价 ${d.priceUp >= 0 ? '+' : ''}${(d.priceUp * 100).toFixed(0)}%${d.risk > 0 ? ` · 断供风险 ${(d.risk * 100).toFixed(0)}%` : ''}</div>
      ${isCur ? '' : canGet ? `<div class="lpbtns"><button class="tiny" onclick="doTerms('${d.id}')">谈这个</button></div>` :
        `<div class="lpno">议价力不足（需 ${(need * 100).toFixed(0)} 分）</div>`}
    </div>`;
  });
  html += `<div class="loanwarn">⚠️ 账期越长，占用供应商的钱越多，但报价更贵；经营一旦恶化，供应商会直接断供。</div>`;
  panel.innerHTML = html;
}

function doTerms(id) {
  const r = negotiateTerms(id);
  $('log').innerHTML = `<div class="evresult ${r.ok ? 'good' : 'bad'}">${r.msg}</div>`;
  showTerms(); showTerms();
  render();
}

/* ═══ 上市面板 ═══ */
function showIPO() {
  const panel = $('ipoPanel');
  panel.style.display = panel.style.display === 'block' ? 'none' : 'block';
  if (panel.style.display !== 'block') return;

  if (G.listed) {
    const el2 = ipoEligibility();
    panel.innerHTML = `<div class="loanhead">已上市 · 创始人持股 <b class="good">${((G.ownership || 1) * 100).toFixed(1)}%</b>
      <br>当前估值约 ${money(el2.valuation)} · 上市后每期分红净利的 30%</div>`;
    return;
  }

  const el = ipoEligibility();
  let html = `<div class="loanhead">上市条件检查 · 预计估值 <b>${money(el.valuation)}</b></div>`;
  el.checks.forEach(c => {
    html += `<div class="loanrow">
      <span>${c.ok ? '✅' : '❌'} ${c.name}</span>
      <span class="pay" style="color:${c.ok ? '#50c080' : '#c06060'}">${c.now} / 需 ${c.need}</span>
    </div>`;
  });

  if (el.pass) {
    html += `<div class="loanprod">
      <div class="lpname">选择发行比例</div>
      <div class="lpdesc">发行股份换取现金。发行越多募资越多，但创始人股权稀释越多，且发行费占 8%</div>
      <div class="lpbtns">
        ${[0.15, 0.25, 0.35].map(r => `<button class="tiny" onclick="doIPOClick(${r})">发行 ${(r * 100)}% · 募 ${money(el.valuation * r)}</button>`).join('')}
      </div>
    </div>`;
  } else {
    html += `<div class="loanwarn">还没到上市的时候。继续把店做多、利润做厚、信用守住。</div>`;
  }
  panel.innerHTML = html;
}

function doIPOClick(ratio) {
  const r = doIPO(ratio);
  $('log').innerHTML = `<div class="evresult ${r.ok ? 'good' : 'bad'}">${r.msg}</div>`;
  showIPO(); showIPO();
  render();
}

/* ═══ 经营报表 ═══ */
function showReport() {
  const panel = $('reportPanel');
  panel.style.display = panel.style.display === 'block' ? 'none' : 'block';
  if (panel.style.display !== 'block') return;

  const p = P();
  const h12 = G.history.slice(-12);
  const rev = h12.reduce((s, h) => s + (h.revenue || 0), 0);
  const profit = h12.reduce((s, h) => s + (h.netProfit || 0), 0);
  const assets = G.stores * p.setupCost * 0.7;
  const debt = totalDebt();
  const netWorth = G.cash + assets - debt;
  const months = h12.length || 1;

  let html = `<div class="loanhead">最近 ${months} 个月经营情况</div>`;
  html += `<table class="detail" style="width:100%">
    <tr><td>累计营收</td><td class="${rev >= 0 ? 'good' : 'bad'}">${money(rev)}</td></tr>
    <tr><td>累计净利</td><td class="${profit >= 0 ? 'good' : 'bad'}">${money(profit)}</td></tr>
    <tr><td>月均净利</td><td class="${profit >= 0 ? 'good' : 'bad'}">${money(profit / months)}</td></tr>
    <tr><td>净利率</td><td>${rev ? ((profit / rev) * 100).toFixed(1) + '%' : '-'}</td></tr>
  </table>`;
  html += `<div class="loansub">资产负债</div>
  <table class="detail" style="width:100%">
    <tr><td>现金</td><td>${money(G.cash)}</td></tr>
    <tr><td>门店资产（折旧后）</td><td>${money(assets)}</td></tr>
    <tr><td>负债合计</td><td class="bad">${money(debt)}</td></tr>
    <tr class="total"><td>净资产</td><td class="${netWorth >= 0 ? 'good' : 'bad'}">${money(netWorth)}</td></tr>
    <tr><td>资产负债率</td><td>${assets > 0 ? ((debt / (assets + G.cash)) * 100).toFixed(1) + '%' : '-'}</td></tr>
  </table>`;
  html += `<div class="loansub">经营指标</div>
  <table class="detail" style="width:100%">
    <tr><td>门店数 / 阶段</td><td>${G.stores} 家 · ${(STAGES.find(s => G.stores >= s.minStores && G.stores <= s.maxStores) || STAGES[0]).name}</td></tr>
    <tr><td>员工数</td><td>${G.staff} 人</td></tr>
    <tr><td>口碑 / 士气</td><td>${G.reputation.toFixed(0)} / ${G.morale.toFixed(0)}</td></tr>
    <tr><td>信用评分</td><td>${G.credit.toFixed(0)} 分</td></tr>
    <tr><td>供应商账期</td><td>${currentDeal().name}</td></tr>
    <tr><td>上市状态</td><td>${G.listed ? '已上市（创始持股 ' + ((G.ownership || 1) * 100).toFixed(1) + '%）' : '未上市'}</td></tr>
  </table>`;
  panel.innerHTML = html;
}

/* ═══ 开局界面：城市 / 年份 / 创业或加盟 ═══ */
let startMode = 'start';
let startBrand = null;
let startYear = 2019;

function initSetup() {
  // 城市下拉
  const sel = $('selCity');
  if (!sel) return;
  const byTier = {};
  CITIES.forEach(c => { (byTier[c.tier] = byTier[c.tier] || []).push(c); });
  let html = '';
  ['tier1','newtier1','tier2','tier3'].forEach(t => {
    if (!byTier[t]) return;
    html += `<optgroup label="${CITY_TIERS[t].name}">`;
    byTier[t].forEach(c => { html += `<option value="${c.id}">${c.name}</option>`; });
    html += '</optgroup>';
  });
  sel.innerHTML = html;
  sel.value = 'cd';

  // 年份按钮
  $('yearBox').innerHTML = START_YEARS.map(y =>
    `<button class="ybtn${y.year === startYear ? ' active' : ''}" onclick="pickYear(${y.year})">
      ${y.label}<span class="yd">${y.difficulty}</span>
    </button>`).join('');

  onCityChange();
  renderBrands();
}

function pickYear(y) {
  startYear = y;
  document.querySelectorAll('.ybtn').forEach(b => b.classList.remove('active'));
  event.target.closest('.ybtn').classList.add('active');
}

function onCityChange() {
  const cityId = $('selCity').value;
  const distId = $('selDist').value;
  const m = cityModifiers(cityId, distId);
  if (!m) return;
  $('cityInfo').innerHTML =
    `<b>${m.city.name} · ${m.tier.name} · ${m.district.name}</b><br>
     人口 ${m.city.pop} 万｜人均可支配收入 ${(m.city.income / 10000).toFixed(1)} 万/年<br>
     推算餐饮市场约 <b>${m.diningMarket} 亿</b>（人口 × 收入 × 25% 餐饮占比）<br>
     核心商圈参考租金 <b>${m.refRent} 元/㎡/天</b><br>
     经营系数：租金 ×${m.rentMult.toFixed(2)}｜客流 ×${m.revenueMult.toFixed(2)}｜竞争 ×${m.compMult.toFixed(2)}｜工资 ×${m.wageMult.toFixed(2)}<br>
     <span style="color:#5a7a90">${m.city.note}</span><br>
     <span style="color:#4a6a80;font-size:8px">人口/收入为公开统计年鉴数据；餐饮规模与租金按公开行业规律推算，非逐城实测</span>`;
}

function setMode(mode) {
  startMode = mode;
  $('modeStart').classList.toggle('active', mode === 'start');
  $('modeJoin').classList.toggle('active', mode === 'join');
  $('brandBox').style.display = mode === 'join' ? 'block' : 'none';
  renderBrands();
}

function renderBrands() {
  if (startMode !== 'join') return;
  const seg = document.querySelector('input[name=seg]:checked').value;
  const list = brandsFor(seg);
  $('brandBox').innerHTML =
    `<div class="setup-title" style="margin:12px 0 8px">选牌子（信息全公开，自己判断）</div>` +
    list.map(b => `
      <div class="brandcard${startBrand === b.id ? ' active' : ''}" onclick="pickBrand('${b.id}')">
        <div class="bname">${b.name}</div>
        <div class="bdesc">${b.desc}</div>
        <div class="bsign">
          加盟费 ${(b.fee / 1e4).toFixed(0)} 万 + 保证金 ${(b.deposit / 1e4).toFixed(0)} 万｜
          权利金 营收 ${(b.royalty * 100).toFixed(0)}%<br>
          商务部备案：<span class="${b.sign.备案 ? '' : 'no'}">${b.sign.备案 ? '有' : '查不到'}</span>｜
          直营店：<span class="${b.sign.直营店 >= 5 ? '' : 'no'}">${b.sign.直营店} 家</span>｜
          加盟商评价：<span class="${b.sign.加盟商评价 >= 3.5 ? '' : 'no'}">${b.sign.加盟商评价} 分</span><br>
          供货价：<span class="${b.supplyMarkup <= 1.08 ? '' : 'no'}">${b.sign.供货价}</span>
        </div>
      </div>`).join('');
}

function pickBrand(id) {
  startBrand = id;
  renderBrands();
}

/* ═══ 组织建设面板 ═══ */
function showOrg() {
  const panel = $('orgPanel');
  panel.style.display = panel.style.display === 'block' ? 'none' : 'block';
  if (panel.style.display !== 'block') return;

  const risk = G.riskBuildup || 0;
  let html = `<div class="loanhead">当前风险累积 <b class="${risk >= 30 ? 'bad' : risk >= 15 ? 'warn2' : 'good'}">${risk.toFixed(0)}</b>
    ${risk >= 30 ? '（高危！随时可能集中爆发）' : risk >= 15 ? '（有隐患）' : '（安全）'}</div>`;

  ORG_LEVELS.forEach(lv => {
    const built = G[lv.flag];
    const chk = checkOrg(lv.id);
    html += `<div class="loanprod ${built ? 'disabled' : ''}">
      <div class="lpname">${lv.icon} ${lv.name} <span class="lpterm">建议 ${lv.suggestStores} 家店时</span></div>
      <div class="lpdesc">${lv.desc}</div>
      <div class="lprate">投入 ${(lv.cost / 1e4).toFixed(0)} 万 · 每月固定 ${(lv.monthly / 1e4).toFixed(0)} 万</div>
      ${built ? '<div class="lpno" style="color:#50c080">✓ 已建成</div>' : `
        <div style="font-size:9px;color:#7a94ac;line-height:1.8;margin:5px 0">
          <span style="color:#50c080">建了：</span>${lv.benefits.join('、')}<br>
          <span style="color:#c06060">不建：</span>${lv.skipCost.join('、')}
        </div>
        ${chk.ok ? `<div class="lpbtns"><button class="tiny" onclick="doBuildOrg('${lv.id}')">投入 ${(lv.cost / 1e4).toFixed(0)} 万建${lv.name}</button></div>`
                 : `<div class="lpno">${chk.msg}</div>`}
      `}
    </div>`;
  });

  html += `<div class="loanwarn">⚠️ 不建不是不花钱，是把钱换成了风险。风险累积到 30 以上，随时会集中爆发——突击检查、食安事故、大客户解约。</div>`;
  panel.innerHTML = html;
}

function doBuildOrg(id) {
  const r = buildOrg(id);
  $('log').innerHTML = `<div class="evresult ${r.ok ? 'good' : 'bad'}">${r.msg}</div>`;
  showOrg(); showOrg();
  render();
}

/* ═══ 对赌面板（并入上市面板） ═══ */
function showVC() {
  const panel = $('ipoPanel');
  panel.style.display = 'block';
  if (G.vcDeal && !G.vcDeal.done) {
    const d = G.vcDeal;
    panel.innerHTML = `<div class="loanhead">已签「${d.name}」· 第 ${d.deadline} 月到期
      <br>目标：${d.targetStores ? '开到 ' + d.targetStores + ' 家店　' : ''}年净利 ≥ ${(d.targetProfit / 1e4).toFixed(0)} 万
      <br>失败代价：按 ${(d.multiple * 100).toFixed(0)}% 回购（${((d.amount * d.multiple) / 1e4).toFixed(0)} 万）</div>
      <div class="loanwarn">⚠️ 赔不起就丢控制权——俏江南张兰走过的路</div>`;
    return;
  }
  panel.innerHTML = `<div class="loanhead">对赌融资：拿投资人的钱，签业绩承诺</div>` +
    VC_OFFERS.map(o => `<div class="loanprod">
      <div class="lpname">${o.name}</div>
      <div class="lpdesc">${o.desc}</div>
      <div class="lprate">拿到 ${(o.amount / 1e4).toFixed(0)} 万 · 出让 ${(o.equity * 100).toFixed(0)}% 股权 · 期限 ${o.years} 年</div>
      <div class="lpbtns"><button class="tiny" onclick="doVC('${o.id}')">签这个</button></div>
    </div>`).join('') +
    `<div class="loanwarn">⚠️ 对赌是真实存在的玩法。签了字，做不到就是真赔。</div>`;
}

function doVC(id) {
  const r = takeVCD(id);
  $('log').innerHTML = `<div class="evresult ${r.ok ? 'good' : 'bad'}">${r.msg}</div>`;
  showVC(); showVC();
  render();
}

/* ═══ 违法操作面板 ═══ */
function showIllegal() {
  const panel = $('illegalPanel');
  panel.style.display = panel.style.display === 'block' ? 'none' : 'block';
  if (panel.style.display !== 'block') return;

  let html = `<div class="loanhead" style="color:#c06060">⚠️ 这些操作短期能省钱，但风险月月累积</div>`;
  ILLEGAL_ACTS.forEach(a => {
    const on = G.illegalActs && G.illegalActs[a.id];
    const months = (G.illegalRisk && G.illegalRisk[a.id]) || 0;
    const curRisk = (a.baseRisk + a.riskGrowth * Math.pow(months, a.riskCurve || 2)) * 100;
    html += `<div class="loanprod ${on ? 'activeIllegal' : ''}">
      <div class="lpname">${a.icon} ${a.name} ${on ? '<span class="lpterm" style="color:#c06060">使用中</span>' : ''}</div>
      <div class="lpdesc">${a.desc}</div>
      <div class="lprate">
        ${a.savingRate ? '省 ' + (a.savingRate * 100).toFixed(0) + '% ' + (a.id === 'oil' ? '食材' : a.id === 'labor' ? '人工' : '营收') : ''}
        ${a.revenueBoost ? '客流 +' + (a.revenueBoost * 100).toFixed(0) + '%' : ''}
        ${on ? ' ｜ 当前月被查概率 <b style="color:' + (curRisk > 8 ? '#e05050' : '#d0a040') + '">' + curRisk.toFixed(1) + '%</b>' : ''}
      </div>
      <div class="lpbtns">
        <button class="tiny ${on ? 'danger' : ''}" onclick="doToggleIllegal('${a.id}')">${on ? '停用' : '启用'}</button>
      </div>
    </div>`;
  });
  html += `<div class="loanwarn" style="color:#c06060">
    🚨 被查处后果：<br>
    · 劣质油 → 刑事案，吊照关停，<b>游戏直接结束</b><br>
    · 偷税 → 补缴+罚款，金额巨大可追刑责<br>
    · 黑工 → 停产停业、吊销执照，<b>游戏直接结束</b><br>
    · 刷单 → 罚款、平台降权<br><br>
    用得越久，查得越准。这不是能不能做的问题，是赌不赌得起。
  </div>`;
  panel.innerHTML = html;
}

function doToggleIllegal(id) {
  const r = toggleIllegal(id);
  $('log').innerHTML = `<div class="evresult ${r.ok ? 'warn' : 'bad'}">${r.msg}</div>`;
  showIllegal(); showIllegal();
  render();
}

/* ═══ 被查之后：四条路怎么走 ═══ */
function renderAftermath() {
  const pa = G.pendingAftermath;
  if (!pa) return '';

  let html = `<div class="bigEvent" style="border-color:#8a2020;background:#1e0a0a">
    <div class="betitle" style="color:#ff6060">🚨 「${pa.actName}」被查了 —— 接下来怎么办？</div>
    <div class="betext">罚款基数约 ${money(pa.baseFine)}。怎么应对，决定公司还能不能开下去。</div>
    <div class="choices">`;
  pa.choices.forEach(c => {
    html += `<button class="choice" onclick="pickAftermath('${c.id}')">
      <b>${c.name}</b><br><span style="color:#7a94ac;font-size:9px">${c.desc}</span>
    </button>`;
  });
  html += `</div></div>`;
  return html;
}

function pickAftermath(choiceId) {
  const pa = G.pendingAftermath;
  if (!pa) return;
  const r = resolveAftermath(pa.actId, choiceId);
  G.pendingAftermath = null;

  $('log').innerHTML = `<div class="evresult ${r.gameOver ? 'bad' : 'warn'}">${r.text}</div>`;
  $('btnNext').disabled = (G.status !== 'running');
  render();
}

/* ═══ 官员来要钱：给还是不给 ═══ */
function renderOfficialDemand() {
  if (!G.pendingOfficialDemand || !G.official || !G.official.active) return '';
  const amt = G.pendingOfficialDemand;
  const o = G.official;
  return `<div class="bigEvent" style="border-color:#8a6a20;background:#1e1a0a">
    <div class="betitle" style="color:#e0b050">💸 那位官员又来"借"钱了</div>
    <div class="betext">
      这次要 <b>${money(amt)}</b>。关系亲密度 ${o.relation.toFixed(0)}/100，累计已给 ${money(o.totalPaid)}。<br>
      给：关系更铁，但他下次要得更多（真实：胃口会变大）<br>
      不给：关系裂一道缝，对方可能恼羞成怒
    </div>
    <div class="choices">
      <button class="choice" onclick="answerOfficial(true)">给钱（${money(amt)}）</button>
      <button class="choice" onclick="answerOfficial(false)">不给</button>
    </div>
  </div>`;
}

function answerOfficial(yes) {
  const r = payOfficial(yes);
  G.pendingOfficialDemand = null;
  $('log').innerHTML = `<div class="evresult ${r.gameOver ? 'bad' : 'warn'}">${r.text}</div>`;
  $('btnNext').disabled = (G.status !== 'running');
  render();
}
