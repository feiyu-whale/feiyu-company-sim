/* 公司经营模拟 · 结算体验（判决书 / 打工还债）  v3.0.0 2026-10-25 肥鱼
 *
 * 现实逻辑：
 *  ① 被抓不是 "Game Over"，是一纸判决书 —— 罪名按你实际干过的事生成
 *  ② 破产不是重新开始 —— 是一屁股债，然后去打工，每月工资还债
 *  ③ 算给玩家看：要还多少年。这才是"负翁"的真实体感
 */

/* ═══ 罪名库（按实际触发的违法项生成）═══ */
const CRIME_LIBRARY = {
  fake:      { name: '生产、销售伪劣产品罪', law: '刑法第一百四十条', min: 2, max: 7, fine: 0.5 },
  blackLabor:{ name: '强迫劳动罪',           law: '刑法第二百四十四条', min: 1, max: 3, fine: 0.2 },
  taxEvade:  { name: '逃税罪',               law: '刑法第二百零一条', min: 1, max: 6, fine: 1.0 },
  underTable:{ name: '行贿罪',               law: '刑法第三百八十九条', min: 1, max: 10, fine: 1.5 },
  fireDeath: { name: '重大责任事故罪',       law: '刑法第一百三十四条', min: 2, max: 7, fine: 0.3 },
  loanShark: { name: '非法吸收公众存款罪',   law: '刑法第一百七十六条', min: 1, max: 10, fine: 2.0 }
};

/* 生成判决书 */
function makeVerdict() {
  const crimes = (G.crimes && G.crimes.length) ? G.crimes : ['taxEvade'];
  const list = [];
  let totalMin = 0, totalMax = 0, totalFine = 0;

  crimes.forEach(c => {
    // 罪名可能带中文说明（如 fireDeath 全串），做兼容
    const key = Object.keys(CRIME_LIBRARY).find(k =>
      c === k || c.includes(CRIME_LIBRARY[k].name));
    const lib = key ? CRIME_LIBRARY[key] : { name: c, law: '', min: 1, max: 3, fine: 0.3 };
    list.push(lib);
    totalMin += lib.min;
    totalMax += lib.max;
    totalFine += lib.fine;
  });

  // 数罪并罚：取总和但打八折（真实司法实践：限制加重原则）
  const years = Math.max(1, Math.round((totalMin + totalMax) / 2 * 0.8));
  // 罚金基数：每个罪名的基础罚金（单位：万），不再二次乘 10
  const fine = totalFine * 100;   // 例：三个罪名合计 1.7 → 170 万；再按规模上浮但封顶

  // 违法时间越长、店越多，罚得越重（但封顶 3 倍，现实也不会无限罚）
  const scale = Math.max(1, Math.min(3, G.stores * 0.15 + G.month / 100));
  const finalFine = Math.round(fine * scale);

  return {
    crimes: list,
    years,
    fineWan: finalFine,
    scale
  };
}

/* 判决书 HTML */
function verdictHTML() {
  const v = makeVerdict();
  const name = '被告人（就是你）';
  const crimeText = v.crimes.map(c => c.name).join('、');
  const lawText = v.crimes.filter(c => c.law).map(c => c.law).join('；');
  const rows = v.crimes.map(c =>
    `<tr><td>${c.name}</td><td style="text-align:right;color:#999;font-size:11px">${c.law}</td></tr>`
  ).join('');

  return `
<div style="background:#0d0d0f;border:1px solid #3a3a40;padding:24px 20px;font-family:'Songti SC',serif;color:#d8d8d8;line-height:1.9;max-width:560px;margin:0 auto">
  <div style="text-align:center;font-size:20px;letter-spacing:8px;color:#c9c9c9;border-bottom:1px solid #3a3a40;padding-bottom:12px;margin-bottom:18px">
    刑 事 判 决 书
  </div>
  <div style="font-size:12px;color:#8a8a8a;margin-bottom:14px">
    被告人：${name}<br>
    案由：${crimeText}
  </div>
  <table style="width:100%;font-size:13px;border-collapse:collapse;margin-bottom:16px">
    ${rows}
  </table>
  <div style="font-size:13px;color:#b0b0b0;margin-bottom:14px">
    本院认为，被告人经营期间实施上述行为，${lawText ? '违反' + lawText + '之规定，' : ''}
    犯罪事实清楚，证据确实充分，应当以${crimeText}追究其刑事责任。
  </div>
  <div style="border-top:1px solid #3a3a40;padding-top:16px;font-size:14px">
    <div style="margin-bottom:10px">判处有期徒刑 <b style="color:#e05050;font-size:18px">${v.years}</b> 年，</div>
    <div>并处罚金 <b style="color:#e05050;font-size:18px">${v.fineWan}</b> 万元。</div>
  </div>
  <div style="margin-top:20px;font-size:12px;color:#7a7a7a;text-align:right">
    如不服本判决，可在接到判决书第二日起十日内提出上诉。
  </div>
  <div style="margin-top:28px;text-align:center;font-size:13px;color:#8a8a8a;letter-spacing:2px;border-top:1px dashed #3a3a40;padding-top:18px">
    你的商业帝国梦，在铁窗中落幕。
  </div>
</div>`;
}

/* ═══ 打工还债模式 ═══ */
/* 启动：破产后不直接重开，进入还债 */
function startDebtMode() {
  const p = P();
  // 债务 = 贷款余款 + 欠薪欠税 + 清算后不足部分
  const loans = totalDebt();
  const arrears = (G.arrears || 0);
  const negCash = Math.max(0, -G.cash);
  const total = loans + arrears + negCash;

  if (total <= 0) return null;

  G.debtMode = {
    total,
    remaining: total,
    months: 0,
    // 打工收入：一个普通打工人的工资（现实：餐饮店长 1~1.5 万/月）
    monthlySalary: 12000,
    monthlyLiving: 5000,     // 生活开支
    rate: 0.05,              // 债务年利率（民间借贷/银行催收利息）
    paid: 0,
    history: []
  };
  G.status = 'debt';
  return G.debtMode;
}

/* 每月还债推进 */
function debtMonthAdvance() {
  const d = G.debtMode;
  if (!d) return null;
  d.months++;
  // 利息先滚
  const interest = d.remaining * d.rate / 12;
  d.remaining += interest;
  // 工资还债
  const able = d.monthlySalary - d.monthlyLiving;
  const pay = Math.min(able, d.remaining);
  d.remaining -= pay;
  d.paid += pay;

  const rec = { month: d.months, interest, pay, remaining: d.remaining };
  d.history.push(rec);

  if (d.remaining <= 0.01) {
    d.remaining = 0;
    return { type: 'free', text: '🕊 你终于还清了。用了 ' + d.months + ' 个月' };
  }
  return { type: 'ongoing', rec };
}

/* 还要还多少年（给玩家看的刺眼数字） */
function debtYearsLeft() {
  const d = G.debtMode;
  if (!d) return null;
  const able = d.monthlySalary - d.monthlyLiving;
  if (able <= 0) return { infinite: true };
  // 简化：不算复利，算个大概
  const years = d.remaining / able / 12;
  return {
    years: Math.round(years * 10) / 10,
    monthly: able,
    remaining: d.remaining,
    // 现实描述
    text: years > 50 ? '这辈子还不完'
        : years > 20 ? '还到退休都还不完'
        : years > 10 ? '要还十几年'
        : years > 3  ? '还要苦好几年'
        : '咬咬牙还能还完'
  };
}

/* 还债界面 HTML */
function debtHTML() {
  const y = debtYearsLeft();
  if (!y) return '';
  return `
<div style="background:#141418;border:1px solid #3a3a40;padding:20px;color:#d0d0d0;line-height:1.9;max-width:560px;margin:0 auto">
  <div style="text-align:center;font-size:17px;letter-spacing:4px;color:#c0c0c0;border-bottom:1px solid #3a3a40;padding-bottom:10px;margin-bottom:16px">
    打 工 还 债
  </div>
  <table style="width:100%;font-size:13px;border-collapse:collapse">
    <tr><td>欠款总额</td><td style="text-align:right;color:#e05050">${(y.remaining / 1e4).toFixed(1)} 万元</td></tr>
    <tr><td>月薪</td><td style="text-align:right">${(G.debtMode.monthlySalary / 1e4).toFixed(1)} 万元</td></tr>
    <tr><td>房租吃饭</td><td style="text-align:right;color:#999">${(G.debtMode.monthlyLiving / 1e4).toFixed(1)} 万元</td></tr>
    <tr><td>每月能还</td><td style="text-align:right">${(y.monthly / 1e4).toFixed(2)} 万元</td></tr>
    <tr><td>利息</td><td style="text-align:right;color:#999">年化 ${(G.debtMode.rate * 100).toFixed(0)}%（借新还旧、催收成本）</td></tr>
  </table>
  <div style="margin-top:16px;padding-top:14px;border-top:1px dashed #3a3a40;text-align:center">
    <div style="font-size:13px;color:#999">按这个速度</div>
    <div style="font-size:26px;color:#e05050;margin:6px 0">${y.years} 年</div>
    <div style="font-size:13px;color:#8a8a8a">${y.text}</div>
  </div>
  <div style="margin-top:14px;font-size:12px;color:#6a6a6a;text-align:center">
    已还 ${G.debtMode.months} 个月 · 累计还了 ${(G.debtMode.paid / 1e4).toFixed(1)} 万
  </div>
</div>`;
}

if (typeof module !== 'undefined') module.exports = {
  CRIME_LIBRARY, makeVerdict, verdictHTML,
  startDebtMode, debtMonthAdvance, debtYearsLeft, debtHTML
};
