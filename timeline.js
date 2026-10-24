/* 公司经营模拟 · 真实历史时间线  v1.4.0 2026-10-24 肥鱼
 *
 * 现实规则：
 *  餐饮生意不看日历，看大环境
 *  2020 疫情来了，全国堂食停摆，谁也躲不过
 *  2023 报复性反弹，谁在那年开店谁吃到红利
 *  2024 起消费降级，客单价一路往下
 *
 *  玩家可以选开局年份 —— 2019 年开店和 2023 年开店，是两个游戏
 */

/* 真实历史事件（时间、影响、来源标注） */
const HISTORY_EVENTS = [
  // ── 2020 疫情 ──
  { ym:'2020-01', name:'新冠疫情爆发', type:'shock',
    revenueMult:0.15, months:3, severity:'灾难',
    text:'武汉封城，全国餐饮堂食停摆。春节本该是旺季，结果营收几乎归零',
    real:'2020 年一季度全国餐饮收入同比下降 44.3%（国家统计局）' },
  { ym:'2020-04', name:'缓慢复工', type:'shock',
    revenueMult:0.55, months:6, severity:'重创',
    text:'堂食逐步恢复，但限流、隔座、顾客不敢出门',
    real:'2020 年 4-9 月餐饮收入恢复至同期约六成' },
  { ym:'2020-10', name:'基本恢复常态', type:'recover',
    revenueMult:0.95, months:6, severity:'恢复', text:'客流回到疫情前八九成' },

  // ── 2021 ──
  { ym:'2021-08', name:'局部疫情反复', type:'shock',
    revenueMult:0.7, months:3, severity:'影响',
    text:'Delta 变异株引发多地散发疫情，堂食再次收紧' },

  // ── 2022 ──
  { ym:'2022-03', name:'上海封控', type:'shock',
    revenueMult:0.3, months:3, severity:'重创',
    text:'上海全城封控两个多月，长三角餐饮全面受挫',
    real:'2022 年 4 月上海餐饮收入几乎归零' },
  { ym:'2022-12', name:'放开后感染高峰', type:'shock',
    revenueMult:0.4, months:2, severity:'重创',
    text:'防疫政策放开，第一波感染潮来袭，街上没人敢出门吃饭' },

  // ── 2023 ──
  { ym:'2023-03', name:'报复性反弹', type:'boom',
    revenueMult:1.15, months:8, severity:'红利',
    text:'餐饮消费强势反弹，开店即赚钱，这一年开店的吃到了红利',
    real:'2023 年全国餐饮收入同比增长 20.4%（国家统计局）' },

  // ── 2024 起 ──
  { ym:'2024-05', name:'消费降级', type:'shock',
    revenueMult:0.88, months:12, severity:'压力',
    text:'客人开始算账，客单价往下走，人均消费降到疫情前水平以下',
    real:'2024 年餐饮客单价普遍下滑，头部品牌集体降价' },
  { ym:'2024-12', name:'价格战白热化', type:'shock',
    revenueMult:0.85, months:12, severity:'压力',
    text:'同行都在降价抢客，不打价格战就没人来，打了就赚不到钱' },
  { ym:'2025-06', name:'行业洗牌加速', type:'shock',
    revenueMult:0.9, months:12, severity:'压力',
    text:'关店潮持续，行业进入存量博弈' },
  { ym:'2026-01', name:'存量市场', type:'shock',
    revenueMult:0.92, months:12, severity:'常态',
    text:'市场不再增长，只能从别人碗里抢饭吃' }
];

/* 可选开局年份 */
const START_YEARS = [
  { year:2019, label:'2019 年', hint:'红火的一年，但你不知道明年会发生什么',
    difficulty:'★★★☆☆（先甜后苦）' },
  { year:2020, label:'2020 年', hint:'疫情爆发年，地狱开局',
    difficulty:'★★★★★（地狱）' },
  { year:2022, label:'2022 年', hint:'封控年，熬过去就是2023的反弹',
    difficulty:'★★★★☆（极难）' },
  { year:2023, label:'2023 年', hint:'反弹红利年，开店就能赚——但红利只有一年',
    difficulty:'★★☆☆☆（easy 模式）' },
  { year:2024, label:'2024 年', hint:'消费降级，卷到极致',
    difficulty:'★★★★☆（艰难）' },
  { year:2026, label:'2026 年', hint:'当下，存量市场，拼的是效率',
    difficulty:'★★★☆☆（常态）' }
];

/* 把年月转成绝对月份序号（以 2019-01 为第 1 个月） */
function ymToAbs(ym) {
  const [y, m] = ym.split('-').map(Number);
  return (y - 2019) * 12 + m;
}

/* 玩家第几个月 → 绝对月份（以 2019-01 为第 1 个月） */
function playerMonthToAbs(playerMonth, startYear) {
  return (startYear - 2019) * 12 + playerMonth;
}

/* 取某绝对月份生效的历史事件 */
function eventsAt(monthAbs, startYear) {
  const startAbs = (startYear - 2019) * 12 + 1;
  const out = [];
  HISTORY_EVENTS.forEach(ev => {
    const abs = ymToAbs(ev.ym);
    if (abs <= monthAbs && monthAbs < abs + ev.months) {
      out.push({ ...ev, monthsInto: monthAbs - abs });
    }
  });
  return out;
}

/* 当前月份的营收乘数（把所有生效事件叠乘） */
function historyRevenueMult(playerMonth, startYear) {
  const monthAbs = playerMonthToAbs(playerMonth, startYear);
  const evs = eventsAt(monthAbs, startYear);
  let mult = 1;
  let worst = null;
  evs.forEach(ev => {
    if (ev.revenueMult) {
      mult *= ev.revenueMult;
      if (!worst || ev.revenueMult < worst.revenueMult) worst = ev;
    }
  });
  return { mult, events: evs, worst };
}

/* 未来 1~3 个月内要来的事件（做预警用） */
function upcomingEvents(playerMonth, startYear) {
  const monthAbs = playerMonthToAbs(playerMonth, startYear);
  const out = [];
  for (let ahead = 1; ahead <= 3; ahead++) {
    const t = monthAbs + ahead;
    HISTORY_EVENTS.forEach(ev => {
      const abs = ymToAbs(ev.ym);
      if (abs === t) out.push({ ...ev, inMonths: ahead });
    });
  }
  return out;
}
