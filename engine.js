/* 公司经营模拟 · 核心引擎
 * 设计原则：规则来自真实商业逻辑，随机只决定"什么时候来"，不决定"合不合理"
 * 2026-10-24 肥鱼  v1.0.0
 */

const G = {
  cash: 300000,          // 起始现金 30 万
  debt: 0,               // 负债
  month: 0,              // 已过月数（0 = 第1月）
  stores: 1,             // 门店数
  seg: 'zhengcan',       // 当前品类
  reputation: 50,        // 口碑 0-100
  morale: 70,            // 士气 0-100
  staff: 5,              // 员工数
  receivables: [],       // 应收账：{amount, dueMonth}
  payables: [],          // 应付账：{amount, dueMonth}
  inventory: 0,          // 存货（元）
  history: [],           // 每月记录
  status: 'running',     // running / bankrupt / quit
  events: [],            // 本月事件日志
  totalInvested: 0,
  monthsNegProfit: 0,    // 连续亏损月数
  revenueLast: 0,        // 上月营收（事件用）
  mods: [],              // 生效中的事件修饰器 {type, value, until}
  usedEvents: [],        // 本月已出事件
  pendingChoice: null,   // 等待玩家选择的事件
  loans: [],             // 每笔贷款：{principal, remain, rate, term, startMonth}
  credit: 100,           // 信用评分 0-100（逾期扣、按时还款加分）
  overdue: 0,            // 累计逾期次数
  lastRBI: 6.0,          // 当前基准利率（年化 %）——2026 中国 LPR 水平
  mortgages: [],         // 已抵押资产 [{type,name,amount,rate,term}]
  ownedProperty: 0,      // 自有房产价值
  terms: 'normal',       // 供应商账期方案
  listed: false,         // 是否已上市
  ipoMonth: 0,
  ownership: 1.0,        // 创始人持股比例
  monthlyDividend: false,// 上市后强制分红
  // ═══ 组织三级（可跳过，跳过则风险累积）═══
  hasHQ: false,          // 是否建了总部
  hasCompany: false,     // 是否做了公司化
  riskBuildup: 0,        // 被跳过组织的风险累积值
  riskEvent: null,       // 本月爆发的风险事件
  // ═══ 对赌 ═══
  vcDeal: null,          // {amount, targetStores, targetProfit, deadline, multiple, equity}
  bankruptcyCount: 0,
  // ═══ 城市与商圈 ═══
  cityId: 'cd',
  districtId: 'core',
  startYear: 2019,
  cityMod: null,
  // ═══ 加盟 ═══
  franchise: null,
  // ═══ 竞争对手 ═══
  rivals: null,
  compIntensity: 1.0,
  rivalsPriceWarMonths: 0,
  // ═══ 历史事件预警 ═══
  warnings: [],
  historyEvent: null,
  // ═══ 违法操作 ═══
  illegalActs: {},
  illegalRisk: {},
  caughtBy: null,
  pendingAftermath: null,
  crimes: [],
  official: null
};

function P() { return SEGMENTS[G.seg]; }

/* 修饰器：事件造成的影响，按月生效 */
function addMod(type, value, months) {
  G.mods.push({ type, value, until: G.month + months });
}
function modSum(type) {
  return G.mods.filter(m => m.type === type && m.until > G.month)
               .reduce((s, m) => s + m.value, 0);
}
function expireMods() {
  G.mods = G.mods.filter(m => m.until > G.month);
}

/* 月度结算：核心循环
 * 顺序不可调整 —— 这是真实企业的死法
 */
function settleMonth() {
  const p = P();
  const log = { month: G.month + 1, items: [], events: [] };
  G.month++;
  G.events = [];

  // ── 新店筹备与爬坡（真实：新店不是一开门就满座）──
  G.pendingStores = G.pendingStores || [];
  G.rampingStores = G.rampingStores || [];
  G.pendingStores = G.pendingStores.filter(ps => {
    if (ps.openMonth <= G.month) {
      G.stores++;
      G.staff += (P().staffCount || 3);
      G.rampingStores.push({ months: 0, rampMonths: ps.rampMonths });
      return false;
    }
    return true;
  });
  // 爬坡中的店：按进度折算有效门店数（50% 起步，6 个月爬满）
  let effectiveStores = G.stores;
  G.rampingStores.forEach(rs => {
    rs.months++;
    const progress = Math.min(1, 0.5 + (rs.months / rs.rampMonths) * 0.5);
    effectiveStores -= (1 - progress);
  });
  G.rampingStores = G.rampingStores.filter(rs => rs.months < rs.rampMonths);

  const stores = effectiveStores;

  // ── 1. 营收（含波动）──
  let baseRev = p.revenue * stores;
  // 口碑影响营收（40-60 为基准，越高越好）
  // 口碑影响客流：最低 0.85，最高 1.20（口碑差会掉客流，但不是腰斩——靠老客和位置兜底）
  // 口碑影响客流（真实：餐饮业口碑就是命，差评会真的没人来）
  //  口碑 0 → 45% 客流（只剩过路客老客硬撑）｜50 → 85%｜80 → 109%｜100 → 125%
  const repFactor = 0.45 + (G.reputation / 100) * 0.8;   // 0.45 ~ 1.25
  // 士气影响（士气低 → 服务差 → 客流降）
  const morFactor = 0.85 + (G.morale / 100) * 0.3;      // 0.85 ~ 1.15
  // 季节波动（正餐冬季旺、茶饮夏季旺）
  const seasonFactor = seasonFactorFor(G.seg, G.month);
  // 随机波动
  const rand = 1 + (Math.random() * 2 - 1) * p.volatility;

  const revMod = 1 + modSum('revenueDelta');

  // ═══ 城市系数：城市的客流水平 ═══
  const cityRev = (G.cityMod && G.cityMod.revenueMult) || 1.0;
  // ═══ 竞争压制：对手越多越强，客流越少 ═══
  const compPressure = (typeof competitionPressure === 'function') ? competitionPressure() : 1.0;
  // ═══ 历史大环境：疫情/反弹/消费降级 ═══
  const hist = (typeof historyRevenueMult === 'function')
    ? historyRevenueMult(G.month, G.startYear) : { mult: 1, events: [] };
  G.historyEvent = hist.events.length ? hist.events : null;

  // 违法操作带来的短期营收增益（刷单/虚假宣传）
  const illegalBoost = (G.illegalActs && G.illegalActs.fake) ? 1.15 : 1.0;
  const rev = Math.max(0,
    baseRev * repFactor * morFactor * seasonFactor * rand * revMod * cityRev * compPressure * hist.mult * illegalBoost);
  G.revenueLast = rev;
  G.revenueLast = rev;
  log.items.push(['营业收入', rev, 'in']);

  // ── 2. 成本 ──
  // 供应商账期影响进货报价（现结有折扣，长账期涨价）
  const deal = (typeof currentDeal === 'function') ? currentDeal() : { priceUp: 0 };
  // 建了总部 = 统一采购，食材成本降 3%；没建且店多 = 采购没议价权
  const hqDiscount = G.hasHQ ? 0.97 : (stores > 8 ? 1.02 : 1.0);
  const foodCost = rev * (p.foodCostRate + modSum('foodCostDelta')) * (1 + deal.priceUp) * hqDiscount;
  // 人工是固定成本：按「员工数 × 人均工资」算，不随营收变动
  // （真实商业：生意差了不可能当月就裁人减薪，工资照发）
  const wagePerHead = p.staffFixedWage || (p.revenue * p.staffRate / 10);
  // 工资受城市水平影响（一线城市工资高一截）
  const cityWage = (G.cityMod && G.cityMod.wageMult) || 1.0;
  const staffCost = G.staff * wagePerHead * cityWage * (1 + modSum('staffRateDelta')) + modSum('staffDelta');
  // 房租按门店数固定（真实：房租是固定成本，不随营收变动）
  // 涨租有天花板：最多涨到基准的 2 倍（再贵就换铺位了）
  // 房租受「城市×商圈」和涨租修饰器影响（一线核心商圈真实能贵出好几倍）
  const cityRent = (G.cityMod && G.cityMod.rentMult) || 1.0;
  const rentMult = Math.min(2.0, 1 + modSum('rentDelta'));
  const rentCost = p.rentFixed * stores * rentMult * cityRent;
  const utilCost = p.utilFixed * stores;
  // 其他运营成本（耗材/营销/外卖抽成/支付手续费/维修）——真实餐饮这笔不小
  const otherOpexCost = rev * (p.otherOpexRate || 0.05);
  // 折旧：装修与设备按年摊销（真实：一次性投入要分摊到每月成本里）
  const depreciationCost = p.setupCost * stores * (p.depreciationRate || 0.05) / 12;
  // ═══ 管理费：建了组织 = 固定开支；没建 = 效率损失（风险累积）═══
  let orgCost = 0;
  let efficiencyLoss = 0;
  if (G.hasHQ) orgCost += 150000 * stores / Math.max(1, stores);  // 总部固定 15 万/月（不随店数线性涨）
  else if (stores > 8) efficiencyLoss += 0.02;                    // 8 店以上没总部：采购无议价、管理失控
  if (G.hasCompany) orgCost += 400000;                            // 公司化固定 40 万/月
  else if (stores > 25) efficiencyLoss += 0.025;                  // 25 店以上没公司化：开票/用工/贷款全受限

  // 风险累积：该建没建的月份，风险往上爬
  const needHQ = stores >= 10 && !G.hasHQ;
  const needCo = stores >= 30 && !G.hasCompany;
  if (needHQ) G.riskBuildup += 1.2;
  if (needCo) G.riskBuildup += 2.0;
  if (!needHQ && !needCo) G.riskBuildup = Math.max(0, G.riskBuildup - 0.5);

  const miscCost = rev * (p.miscRate + efficiencyLoss) + orgCost;
  const grossProfit = rev - foodCost - staffCost - rentCost - utilCost - miscCost - otherOpexCost - depreciationCost;

  log.items.push(['食材成本', foodCost, 'out']);
  log.items.push(['人工成本', staffCost, 'out']);
  log.items.push(['房租', rentCost, 'out']);
  log.items.push(['水电', utilCost, 'out']);
  log.items.push(['杂费/管理费', miscCost, 'out']);
  log.items.push(['其他运营成本', otherOpexCost, 'out']);
  log.items.push(['折旧摊销', depreciationCost, 'out']);

  // ── 3. 贷款月供（等额本息：本金+利息一起还）──
  let totalPayment = 0, totalInterest = 0;
  G.loans.forEach(ln => {
    if (ln.remain <= 0) return;
    const r = ln.rate / 12;                                     // 月利率
    const n = ln.term;                                          // 总期数
    const pay = ln.principal * r * Math.pow(1 + r, n) / (Math.pow(1 + r, n) - 1);
    const intPart = ln.remain * r;
    const priPart = Math.min(pay - intPart, ln.remain);
    ln.remain -= priPart;
    totalPayment += priPart + intPart;
    totalInterest += intPart;
  });
  G.loans = G.loans.filter(l => l.remain > 0.01);
  if (totalPayment > 0) {
    log.items.push(['贷款月供', totalPayment, 'out']);
    log.items.push(['　其中利息', totalInterest, 'memo']);
  }

  const netProfit = grossProfit - totalInterest;

  // 利息不重复扣（已在月供里）——下面现金流只扣 totalPayment

  // ── 4. 现金流：营收不是当月全到账 ──
  //    按账期排队
  G.receivables.forEach(r => {
    if (r.dueMonth <= G.month) {
      G.cash += r.amount;
      log.items.push(['收到应收账', r.amount, 'in']);
      r.paid = true;
    }
  });
  G.receivables = G.receivables.filter(r => !r.paid);
  // ═══ 真实收款结构：堂食现结，外卖/团购有账期 ═══
  //  外卖平台（美团/饿了么）：T+7 ~ T+30，取 15 天
  //  团购券（抖音/美团）：T+15 ~ T+45，取 30 天
  //  这两块当月收不回来，是真实现金流压力的主要来源
  const dineInRate = p.dineInRatio !== undefined ? p.dineInRatio : 0.6;
  const cashNow = rev * dineInRate;
  G.cash += cashNow;

  const deliveryAmt = rev * (1 - dineInRate) * 0.6;   // 其中外卖
  const grouponAmt  = rev * (1 - dineInRate) * 0.4;   // 其中团购券
  if (deliveryAmt > 0) {
    G.receivables.push({ amount: deliveryAmt, dueMonth: G.month + 1, paid: false });
  }
  if (grouponAmt > 0) {
    G.receivables.push({ amount: grouponAmt, dueMonth: G.month + 1 + (Math.random() < 0.4 ? 1 : 0), paid: false });
  }
  const deferred = deliveryAmt + grouponAmt;
  if (deferred > 0) {
    log.items.push(['外卖/团购挂账（未到账）', -deferred, 'memo']);
  }

  // ── 5. 付钱（雷打不动的部分）──
  // 工资、房租必须当月付
  // 注意：折旧是会计成本，不是现金流出，所以这里不扣（利润里已经算过）
  const mustPay = staffCost + rentCost + utilCost + miscCost + otherOpexCost;
  log.items.push(['支付工资房租等', mustPay, 'out']);
  G.cash -= mustPay;

  // 货款按应付账期（用玩家谈下来的账期，不是品类默认）
  const apDays = deal.apDays !== undefined ? deal.apDays : p.apDays;
  if (apDays > 0) {
    const delay = Math.max(1, Math.round(apDays / 30));
    G.payables.push({ amount: foodCost, dueMonth: G.month + delay, paid: false });
  } else {
    G.cash -= foodCost;
  }
  G.payables.forEach(a => {
    if (a.dueMonth <= G.month) {
      G.cash -= a.amount;
      log.items.push(['支付货款', a.amount, 'out']);
      a.paid = true;
    }
  });
  G.payables = G.payables.filter(a => !a.paid);

  // 月供必须当月还（还不上就是逾期）
  if (totalPayment > 0) {
    if (G.cash >= totalPayment) {
      G.cash -= totalPayment;
      G.credit = Math.min(100, G.credit + 0.5);      // 按时还款加分
    } else {
      // 逾期：罚息 + 扣信用
      const penalty = totalPayment * 0.05;
      G.cash -= (totalPayment + penalty);
      G.overdue++;
      G.credit = Math.max(0, G.credit - 15);
      log.events.push({ type: 'bad',
        text: '⚠️ 贷款逾期！罚息 ' + (penalty / 1e4).toFixed(1) + ' 万，信用评分 -15（现 ' + G.credit.toFixed(0) + '）' });
    }
  }

  // ── 6. 破产判定 ──
  if (G.cash < 0) {
    // 现金断了 → 看能不能紧急借
    // 现金断裂时，银行只肯给高息过桥贷（信用差的人借不到）
    const emergLimit = creditLimit() - totalDebt();
    if (emergLimit > 0 && G.credit >= 30) {
      const amt = Math.min(emergLimit, 200000);
      const rate = loanRate() * 2.5;     // 过桥贷利率极高
      const r = rate / 12, n = 6;
      const pay = amt * r * Math.pow(1 + r, n) / (Math.pow(1 + r, n) - 1);
      G.loans.push({ principal: amt, remain: amt, rate, term: n, startMonth: G.month, product: '过桥贷' });
      G.cash += amt;
      G.credit = Math.max(0, G.credit - 5);
      log.events.push({ type: 'warn',
        text: '💸 现金断裂！银行只给过桥贷 ' + (amt / 1e4).toFixed(1) + ' 万，年化 ' + (rate * 100).toFixed(1) + '%，每月还 ' + (pay / 1e4).toFixed(2) + ' 万' });
    } else {
      G.status = 'bankrupt';
      log.events.push({ type: 'bad', text: '💀 现金耗尽，供应商停供，公司破产' });
    }
  }

  // ── 7. 士气 / 口碑自然变化 ──
  if (netProfit < 0) {
    G.monthsNegProfit++;
    G.morale = Math.max(0, G.morale - 3);
    if (G.monthsNegProfit >= 3 && G.events.length < 3) {
      log.events.push({ type: 'warn', text: '连续 ' + G.monthsNegProfit + ' 个月亏损，员工开始人心浮动' });
    }
  } else {
    G.monthsNegProfit = 0;
    G.morale = Math.min(100, G.morale + 1);
  }
  // 口碑机制（真实：声誉是最慢的资产，也是最快的负债）
  //  ① 只有赚钱（客人真的回来了）才恢复；亏钱口碑还在跌
  //  ② 离天花板越近恢复越慢：长期稳定在 70 上下才真实
  //  ③ 店越多恢复越慢（管理半径）
  const scaleDrag = 1 / (1 + G.stores * 0.05);
  const ceilling = 70;
  let recover;
  if (netProfit > 0) {
    const gap = Math.max(0, ceilling - G.reputation);
    recover = Math.min(1.2, gap * 0.06 + 0.15) * scaleDrag;
  } else {
    recover = -0.2;
  }
  G.reputation = Math.max(0, Math.min(100, G.reputation + recover));

  // 士气太低 → 员工流失
  if (G.morale < 30 && Math.random() < 0.3) {
    const leave = 1;
    G.staff = Math.max(1, G.staff - leave);
    log.events.push({ type: 'bad', text: '骨干离职（士气过低），员工减至 ' + G.staff + ' 人' });
  }

  // 上市后强制分红：净利的 30% 分给股东
  if (G.listed && netProfit > 0) {
    const div = netProfit * 0.30;
    G.cash -= div;
    log.items.push(['股东分红（上市强制）', div, 'out']);
  }

  // ═══ 风险爆发（跳过组织的代价，平时看不出，爆了就致命）═══
  G.riskEvent = null;
  if (G.riskBuildup > 0 && Math.random() < Math.min(0.55, G.riskBuildup / 60)) {
    const heavy = G.riskBuildup >= 30;
    const pool = [];
    if (!G.hasCompany) {
      pool.push({ text: '🕵️ 突击检查：社保用工不合规被查处，罚款 ',
                  cash: rev * 0.15, rep: -12, morale: -8 });
      pool.push({ text: '🧾 税务稽查：个体户群账目混乱，补税加罚金 ',
                  cash: rev * 0.25, rep: -8, morale: -5 });
      if (heavy) pool.push({ text: '💼 大客户集体解约：开不了增值税发票，一夜之间丢单 ',
                  revenueCut: 0.4, rep: -15, morale: -12 });
    }
    if (!G.hasHQ) {
      pool.push({ text: '🍲 食安事故：没有总部督导，一家店出事连累全品牌，赔偿 ',
                  cash: rev * 0.12, rep: -20, morale: -10 });
      if (heavy) pool.push({ text: '📉 各店失控：没有统一管理，多家店同时出问题 ',
                  revenueCut: 0.3, rep: -14, morale: -15 });
    }
    if (pool.length) {
      const hit = pool[Math.floor(Math.random() * pool.length)];
      G.riskEvent = hit;
      if (hit.cash) { G.cash -= hit.cash; }
      if (hit.rep) G.reputation = Math.max(0, G.reputation + hit.rep);
      if (hit.morale) G.morale = Math.max(0, G.morale + hit.morale);
      if (hit.revenueCut) addMod('revenueDelta', -hit.revenueCut, 3);
      log.events.push({ type: 'bad',
        text: hit.text + (hit.cash ? (hit.cash / 1e4).toFixed(1) + ' 万' : '') });
      G.riskBuildup = Math.max(0, G.riskBuildup - (heavy ? 25 : 10));  // 爆一次泄一部分
    }
  }

  // 断供检查（长账期的代价）
  if (typeof checkSupplyCut === 'function') {
    const cut = checkSupplyCut();
    if (cut) {
      addMod('revenueDelta', cut.revenueDelta, cut.months);
      log.events.push({ type: 'bad', text: cut.text });
    }
  }

  // ═══ 违法操作：短期省钱，长期要命 ═══
  if (typeof illegalMonthly === 'function') {
    const ill = illegalMonthly(rev, foodCost, staffCost);
    if (ill.foodSave > 0) {
      G.cash += ill.foodSave;
      log.items.push(['省下的食材钱（劣质油）', -ill.foodSave, 'memo']);
    }
    if (ill.staffSave > 0) {
      G.cash += ill.staffSave;
      log.items.push(['省下的人工钱（黑工）', -ill.staffSave, 'memo']);
    }
    if (ill.taxSave > 0) {
      G.cash += ill.taxSave;
      log.items.push(['没交的税', -ill.taxSave, 'memo']);
    }
    ill.warnings.forEach(w => log.events.push({ type: 'warn', text: w }));
    if (ill.caught) {
      // 被查了 —— 先不判生死，把决定权交给玩家
      if (typeof makeAftermath === 'function') {
        G.pendingAftermath = makeAftermath(ill.caught);
        log.events.push({ type: 'bad',
          text: '🚨 「' + ill.caught.name + '」被查了！现场被控制，接下来怎么办，你自己决定。' });
      } else {
        const res = handleCaught(ill.caught);
        log.events.push({ type: 'bad', text: res.text, detail: res.detail });
      }
    }
  }

  // ═══ 对手行动（他们会成长、打价格战、挖人）═══
  if (typeof rivalsMonthly === 'function' && G.rivals) {
    const rivalEv = rivalsMonthly();
    rivalEv.forEach(t => log.events.push({ type: 'warn', text: t }));
    if (typeof rivalsPoach === 'function') {
      const poach = rivalsPoach();
      if (poach) log.events.push({ type: 'bad', text: poach });
    }
  }

  // ═══ 加盟抽成（权利金 + 总部供货加价）═══
  if (G.franchise && typeof franchiseMonthlyCost === 'function') {
    const fc = franchiseMonthlyCost(rev);
    if (fc.royalty > 0) {
      G.cash -= fc.royalty;
      log.items.push(['加盟权利金', fc.royalty, 'out']);
    }
    if (typeof checkFranchiseTrap === 'function') {
      const trap = checkFranchiseTrap();
      if (trap) {
        if (trap.foodDelta) addMod('foodCostDelta', trap.foodDelta, trap.months || 2);
        if (trap.cash) G.cash += trap.cash;
        log.events.push({ type: 'bad', text: trap.text });
      }
    }
  }

  // ═══ 未来事件预警（提前 1~3 个月给信号）═══
  G.warnings = [];
  if (typeof upcomingEvents === 'function') {
    const up = upcomingEvents(G.month, G.startYear);
    up.forEach(ev => {
      G.warnings.push(ev);
      log.events.push({ type: 'warn',
        text: '📡 风声：' + ev.inMonths + ' 个月后可能「' + ev.name + '」（' + ev.severity + '）' });
    });
  }

  // ═══ 打点之后的关系：来要钱 / 或者落马 ═══
  if (typeof officialMonthly === 'function' && G.official && G.official.active) {
    const off = officialMonthly();
    if (off) {
      if (off.type === 'busted') log.events.push({ type: 'bad', text: off.text });
      else if (off.type === 'escape') log.events.push({ type: 'warn', text: off.text });
      else if (off.type === 'demand') {
        G.pendingOfficialDemand = off.demand;
        log.events.push({ type: 'warn', text: off.text });
      }
    }
  }

  // ═══ 挂着的罪名：逃过一次不等于安全，调查组会一直跟进 ═══
  if (typeof checkPendingCrimes === 'function') {
    const crimeHit = checkPendingCrimes();
    if (crimeHit) log.events.push({ type: 'bad', text: crimeHit });
  }

  // 对赌到期检查
  if (typeof checkVC === 'function') {
    const vc = checkVC();
    if (vc) log.events.push(vc);
  }

  expireMods();
  G.usedEvents = [];
  log.netProfit = netProfit;
  log.revenue = rev;
  log.cashAfter = G.cash;
  G.history.push(log);
  return log;
}

function seasonFactorFor(seg, month) {
  const m = ((month - 1) % 12) + 1;
  if (seg === 'chayin') {
    // 茶饮夏季旺
    return [0.85, 0.9, 1.0, 1.1, 1.2, 1.25, 1.25, 1.2, 1.05, 0.95, 0.85, 0.85][m - 1];
  }
  const winter = [1.15, 1.2, 1.05, 0.95, 0.9, 0.85, 0.85, 0.9, 1.0, 1.1, 1.15, 1.2];
  return winter[m - 1];
}

/* 开店：从 1 家扩到 2 家，成本 = setupCost */
function openStore() {
  const p = P();
  const cost = p.setupCost * 0.8;   // 第二家起规模效应，省 20%
  if (G.cash < cost) return { ok: false, msg: '现金不足，需要 ' + (cost / 1e4).toFixed(0) + ' 万' };

  G.pendingStores = G.pendingStores || [];
  // 真实限制：团队精力有限，同时只能开 1 家
  const maxPending = G.hasHQ ? 2 : 1;
  if (G.pendingStores.length >= maxPending) {
    return { ok: false, msg: '已有门店在筹备中，团队精力有限，先等这家开起来' };
  }
  const prepMonths = G.hasHQ ? 2 : 4;   // 没总部：选址装修办证全靠老板自己跑
  G.cash -= cost;
  G.pendingStores.push({ openMonth: G.month + prepMonths, rampMonths: 6, seg: G.seg });
  return { ok: true,
    msg: '🏗 新店进入筹备期（2 个月后开业），已投入 ' + (cost / 1e4).toFixed(0) +
         ' 万。开业后还有 6 个月爬坡期，客流从 50% 起步' };
}

/* ═══ 真实商业借贷系统 ═══
 * 真实规则：
 *  1. 授信额度取决于「信用评分 + 经营能力」，不是想借多少借多少
 *  2. 利率分档：信用越好越便宜；基准利率浮动
 *  3. 还款方式：等额本息，每月固定还，不能选择性不还
 *  4. 逾期代价：罚息 5% + 信用暴跌 15 分，还会连锁影响后续授信
 */

/* 计算当前授信额度（真实银行逻辑：看现金流、看资产、看信用） */
function creditLimit() {
  const p = P();
  // 年化营收规模
  const annualRev = p.revenue * G.stores * 12;
  // 净资产（现金 + 资产 - 负债）
  const assets = G.stores * p.setupCost * 0.7;
  const netWorth = G.cash + assets - totalDebt();
  // 银行最看重：年营收的 30% 为上限，且不超过净资产 2 倍
  const byRev = annualRev * 0.30;
  const byNet = Math.max(0, netWorth) * 2.0;
  // 信用系数 0.3 ~ 1.0
  const creditCoef = 0.3 + (G.credit / 100) * 0.7;
  // 已逾期过 → 授信打折
  const overdueCoef = Math.max(0.3, 1 - G.overdue * 0.15);
  return Math.max(0, Math.min(byRev, byNet) * creditCoef * overdueCoef);
}

function totalDebt() {
  return G.loans.reduce((s, l) => s + Math.max(0, l.remain), 0);
}

/* 利率（年化）：基准 + 信用溢价 */
function loanRate() {
  // 信用 100 分 → 基准；信用 0 分 → 基准 + 12%
  const premium = (100 - G.credit) / 100 * 0.12;
  return G.lastRBI / 100 + premium;
}

/* 贷款产品（真实银行的几类） */
const LOAN_PRODUCTS = [
  { id: 'credit',  name: '信用贷',   term: 12, minCredit: 60,
    desc: '无抵押，看经营流水。额度小、利率高、期限短' },
  { id: 'business',name: '经营贷',   term: 36, minCredit: 40,
    desc: '需经营满 6 个月。额度中等，可用设备/门店抵押' },
  { id: 'longterm',name: '长期贷',   term: 60, minCredit: 70,
    desc: '信用优秀才能申请。额度大、期限长，用于扩张' }
];

/* 申请贷款 */
function applyLoan(productId, amount) {
  const prod = LOAN_PRODUCTS.find(p => p.id === productId);
  if (!prod) return { ok: false, msg: '没有这种贷款' };
  if (G.credit < prod.minCredit) {
    return { ok: false, msg: '信用评分 ' + G.credit.toFixed(0) + ' 分，不够申请' + prod.name + '（要求 ' + prod.minCredit + ' 分）' };
  }
  if (prod.id === 'business' && G.month < 6) {
    return { ok: false, msg: '经营贷要求经营满 6 个月（当前 ' + G.month + ' 个月）' };
  }
  const limit = creditLimit() - totalDebt();
  if (amount > limit) {
    return { ok: false, msg: '超出可贷额度（还能借 ' + (Math.max(0, limit) / 1e4).toFixed(1) + ' 万）' };
  }
  const rate = loanRate();
  // 等额本息月供
  const r = rate / 12, n = prod.term;
  const payment = amount * r * Math.pow(1 + r, n) / (Math.pow(1 + r, n) - 1);
  G.loans.push({ principal: amount, remain: amount, rate, term: n, startMonth: G.month, product: prod.name });
  G.cash += amount;
  return { ok: true, rate, payment, term: n,
    msg: prod.name + ' ' + (amount / 1e4).toFixed(1) + ' 万，年利率 ' + (rate * 100).toFixed(2) + '%，' +
         n + ' 期，每月还 ' + (payment / 1e4).toFixed(2) + ' 万' };
}

/* 提前还款（真实：可以还，但可能收违约金） */
function repayLoan(idx, amount) {
  const ln = G.loans[idx];
  if (!ln) return { ok: false, msg: '没有这笔贷款' };
  const actual = Math.min(amount, ln.remain, G.cash);
  if (actual <= 0) return { ok: false, msg: '没得还' };
  const penalty = actual * 0.01;    // 提前还款违约金 1%
  G.cash -= (actual + penalty);
  ln.remain -= actual;
  if (ln.remain - actual < 0.01) ln.remain = 0;
  G.loans = G.loans.filter(l => l.remain > 0.01);
  return { ok: true, msg: '提前还款 ' + (actual / 1e4).toFixed(1) + ' 万（违约金 ' + (penalty / 1e4).toFixed(2) + ' 万）' };
}

/* 换赛道：老爹要求的核心机制 */
function switchSegment(toSeg) {
  const from = P();
  const to = SEGMENTS[toSeg];
  if (!to) return { ok: false, msg: 'no such segment' };

  const stage = STAGES.find(s => G.stores >= s.minStores && G.stores <= s.maxStores) || STAGES[0];
  const lossRate = similarityLoss(G.seg, toSeg);
  const assets = G.stores * from.setupCost * 0.7;   // 现有资产（折旧后）
  const nonReuseAssets = assets * stage.nonReuse * lossRate;

  // 遣散费：裁员 20%，每人 2 个月工资
  const avgWage = 6000;
  const layoff = Math.round(G.staff * 0.2);
  const severance = layoff * avgWage * 2;

  // 租约违约金：每店 3 万
  const penalty = G.stores * 30000;

  const totalCost = nonReuseAssets + severance + penalty;
  if (G.cash < totalCost) {
    return { ok: false, msg: '转换成本 ' + (totalCost / 1e4).toFixed(1) + ' 万，现金不够' };
  }

  // 成功率
  const baseRate = lossRate <= 0.25 ? BASE_SUCCESS.same :
                   lossRate <= 0.5 ? BASE_SUCCESS.similar : BASE_SUCCESS.cross;
  const cashRatio = totalCost / G.cash;
  const fundCoef = cashRatio < 0.3 ? 1.0 : cashRatio < 0.6 ? 0.85 : cashRatio < 0.9 ? 0.6 : 0.3;
  const expCoef = Math.min(1.3, 1 + G.month * 0.003);      // 经验
  const teamCoef = G.morale / 100;                          // 士气即团队系数
  const timingCoef = 1.0;                                   // 平期

  const successRate = baseRate * fundCoef * expCoef * teamCoef * timingCoef;

  return {
    ok: true, canAfford: true,
    cost: totalCost, successRate,
    detail: { lossRate, stage: stage.name, nonReuseAssets, severance, penalty,
              baseRate, fundCoef, expCoef, teamCoef },
    msg: '转换需 ' + (totalCost / 1e4).toFixed(1) + ' 万，成功率 ' + (successRate * 100).toFixed(1) + '%'
  };
}

function executeSwitch(toSeg, preview) {
  G.cash -= preview.cost;
  if (Math.random() < preview.successRate) {
    G.seg = toSeg;
    G.reputation = Math.max(20, G.reputation - 10);
    return { success: true, msg: '✅ 转型成功，现在是' + SEGMENTS[toSeg].name };
  } else {
    // 失败：额外损失
    const extra = preview.cost * 0.5;
    G.cash -= extra;
    G.reputation = Math.max(0, G.reputation - 25);
    G.morale = Math.max(0, G.morale - 20);
    if (G.cash < 0) G.status = 'bankrupt';
    return { success: false, msg: '❌ 转型失败，额外损失 ' + (extra / 1e4).toFixed(1) + ' 万' };
  }
}

if (typeof module !== 'undefined') module.exports = { G, settleMonth, openStore, borrow, switchSegment, executeSwitch, seasonFactorFor };
