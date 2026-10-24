/* 公司经营模拟 · 竞争对手系统  v1.4.0 2026-10-24 肥鱼
 *
 * 现实规则：
 *  竞争强度由「城市分级 × 商圈等级」决定
 *  一线核心商圈：大品牌扎堆，你一个小店很难冒头
 *  三线社区：几乎没对手，但也几乎没客人
 *
 *  对手会自己发展：他们会开店、会打价格战、会挖你的人
 *  你不进步，他们就会挤掉你
 *
 *  ⚠️ 品牌名全部虚构，竞争逻辑取自真实现象
 */

const RIVAL_POOL = {
  huoguo: [
    { name:'蜀香源', size:'small', strength:0.6 },
    { name:'牛气冲天', size:'mid',   strength:1.0 },
    { name:'围炉记', size:'big',     strength:1.6 }
  ],
  zhengcan: [
    { name:'家常小馆', size:'small', strength:0.6 },
    { name:'聚福楼',   size:'mid',   strength:1.0 },
    { name:'宴宾阁',   size:'big',   strength:1.6 }
  ],
  kuaican: [
    { name:'快客来',   size:'small', strength:0.6 },
    { name:'一碗好饭', size:'mid',   strength:1.0 },
    { name:'速食王',   size:'big',   strength:1.6 }
  ],
  chayin: [
    { name:'茶小铺',   size:'small', strength:0.6 },
    { name:'鲜果时光', size:'mid',   strength:1.0 },
    { name:'茗悦茶饮', size:'big',   strength:1.6 }
  ]
};

/* 初始化竞争环境（开局时调用） */
function initRivals(cityId, districtId, seg) {
  const m = cityModifiers(cityId, districtId);
  const comp = m.compMult;
  const pool = RIVAL_POOL[seg] || RIVAL_POOL.zhengcan;

  // 竞争越强，出现的对手越多、越强
  const count = Math.min(3, Math.max(0, Math.round(comp * 1.2)));
  const rivals = [];
  for (let i = 0; i < count; i++) {
    const src = pool[Math.min(pool.length - 1, Math.floor(comp * (i + 1) / 2))];
    rivals.push({
      name: src.name, size: src.size,
      strength: src.strength * (0.8 + Math.random() * 0.4),
      monthsActive: 0,
      priceWar: false
    });
  }
  G.rivals = rivals;
  G.compIntensity = comp;
  return { count, comp };
}

/* 每月对手行动（在结算里调用） */
function rivalsMonthly() {
  if (!G.rivals) return [];
  const events = [];
  G.rivals.forEach(r => {
    r.monthsActive++;
    // 对手成长：每 6 个月强一点
    if (r.monthsActive % 6 === 0) r.strength *= 1.06;

    // 打价格战：竞争激烈时，大对手会降价抢客
    if (!r.priceWar && G.compIntensity > 1.2 && Math.random() < 0.08) {
      r.priceWar = true;
      G.rivalsPriceWarMonths = 3;
      events.push('⚔️ 「' + r.name + '」开始打价格战，全场七折，客流被抢走一部分');
    }
  });

  // 价格战对营收的压制
  if (G.rivalsPriceWarMonths > 0) {
    G.rivalsPriceWarMonths--;
    addMod('revenueDelta', -0.12, 1);
  }
  return events;
}

/* 竞争对营收的持续压制：对手总强度越高，你的客流越少 */
function competitionPressure() {
  if (!G.rivals || !G.rivals.length) return 1.0;
  const total = G.rivals.reduce((s, r) => s + r.strength, 0);
  // 每 1.0 强度压 12% 客流，最多压 35%
  return Math.max(0.65, 1 - total * 0.12);
}

/* 挖人：对手会挖你的骨干 */
function rivalsPoach() {
  if (!G.rivals || !G.rivals.length) return null;
  const strongRival = G.rivals.reduce((a, b) => a.strength > b.strength ? a : b);
  if (strongRival.strength < 1.2) return null;
  if (Math.random() > 0.06 + strongRival.strength * 0.03) return null;
  G.staff = Math.max(1, G.staff - 1);
  G.morale = Math.max(0, G.morale - 6);
  return '🎯 「' + strongRival.name + '」挖走了你一个熟手，员工 -1，士气 -6';
}
