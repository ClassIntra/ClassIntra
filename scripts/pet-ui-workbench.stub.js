/* 桌宠 UI 工作台的浏览器端 stub（独立文件，避免模板字面量转义地狱）
 * 注入方式：Page.addScriptToEvaluateOnNewDocument
 * 数据形状必须与 backend/routes.js 真实下发一致，否则 UI 会按假数据设计。
 */
(function () {
  var CALLS = [];
  var ST = {
    adopted: true, name: '大肥鱼', bond: 78, exp: 40, affection: 60,
    fed_today: 1, last_fed_at: new Date(Date.now() - 8 * 60000).toISOString(),
    enabled: true, poked_today: 3,
    adopted_at: new Date(Date.now() - 12 * 86400000).toISOString(),
    coins: 6, focus_min: 30, focus_rounds: 2, focus_bond: 4, focus_date: '2026-10-31',
    design: { type: 'video', character: 'dsh-whale' }
  };
  // 逗它玩的每日额度（后端 PLAY_DAILY_CAP=6）。放独立对象而不是塞进 ST，
  // 因为它是「当天累计」而不是存档字段，探针重置 ST 时不该一起清掉。
  var PLAY = { gain: 0, cap: 6 };

  var ELEMENTS = [
    { id: 'fire', name: '火', icon: '🔥', color: '#FF6B4A', beats: 'grass', beatsName: '草', weakTo: 'water', weakToName: '水' },
    { id: 'grass', name: '草', icon: '🌿', color: '#34C759', beats: 'earth', beatsName: '土', weakTo: 'fire', weakToName: '火' },
    { id: 'earth', name: '土', icon: '⛰️', color: '#B07A4A', beats: 'electric', beatsName: '电', weakTo: 'grass', weakToName: '草' },
    { id: 'electric', name: '电', icon: '⚡', color: '#E6A700', beats: 'water', beatsName: '水', weakTo: 'earth', weakToName: '土' },
    { id: 'water', name: '水', icon: '💧', color: '#0A84FF', beats: 'fire', beatsName: '火', weakTo: 'electric', weakToName: '电' }
  ];

  var WILD = [
    { id: 'huomiao', name: '火苗狸', type: 'fire', rarity: 'common', bond: 18, icon: '🦊', desc: '尾巴上有一簇不会灭的小火', skills: [], power: 96 },
    { id: 'caotuan', name: '草团子', type: 'grass', rarity: 'common', bond: 20, icon: '🌱', desc: '在墙根晒太阳，一碰就滚成球', skills: [], power: 100 },
    { id: 'yanhu', name: '炎狐', type: 'fire', rarity: 'rare', bond: 52, icon: '🔥', desc: '跑过的地方会留下焦黑的小脚印', skills: ['heavy'], power: 160 },
    { id: 'tengman', name: '藤蔓怪', type: 'grass', rarity: 'rare', bond: 58, icon: '🌿', desc: '会把你掉在地上的橡皮筋收进窝', skills: ['lifesteal'], power: 172 },
    { id: 'yanjia', name: '岩甲兽', type: 'earth', rarity: 'rare', bond: 64, icon: '🪨', desc: '趴着的时候和石头一模一样', skills: ['shield'], power: 184 },
    { id: 'gushu', name: '古树精', type: 'grass', rarity: 'legend', bond: 116, icon: '🌳', desc: '比学校还老，树皮里刻着历届学生的名字', skills: ['shield', 'pierce'], power: 300 }
  ];

  var OWNED = { caotuan: true, tengman: true };

  var DIARY = {
    today: {
      date: '2026-10-31', count: 2,
      text: '陪主人安静坐了 30 分钟，我连尾巴都没晃。还吃到了豪华大餐，是今天最亮的时刻。'
    },
    history: [
      { date: '2026-10-30', text: '吃了 2 顿，肚子圆了一点。被摸了 5 下，毛都顺了。' },
      { date: '2026-10-29', text: '安静的一天。我数了 137 次呼吸，最后数乱了。' }
    ]
  };

  var FOCUS = { todayMin: 30, rounds: 2, bondToday: 4, bondCap: 6, coins: 6, feastCost: 5 };

  function typeOf(id) {
    for (var i = 0; i < ELEMENTS.length; i++) if (ELEMENTS[i].id === id) return ELEMENTS[i];
    return ELEMENTS[1];
  }

  function dexList() {
    var out = [];
    for (var i = 0; i < WILD.length; i++) {
      var w = WILD[i];
      var t = typeOf(w.type);
      var owned = !!OWNED[w.id];
      out.push({
        id: w.id, name: w.name, type: w.type, typeName: t.name, typeIcon: t.icon, typeColor: t.color,
        rarity: w.rarity,
        rarityName: w.rarity === 'legend' ? '传说' : (w.rarity === 'rare' ? '稀有' : '常见'),
        rarityIcon: w.rarity === 'legend' ? '🟡' : (w.rarity === 'rare' ? '🔵' : '⚪'),
        bond: w.bond, icon: w.icon, desc: w.desc, skills: w.skills, power: w.power,
        owned: owned,
        capture: owned ? null : (w.rarity === 'legend' ? 0.2 : (w.rarity === 'rare' ? 0.4 : 0.62)),
        fails: w.id === 'huomiao' ? 1 : 0,
        spotlight: w.id === 'huomiao'
      });
    }
    return out;
  }

  function dexMeta() {
    var list = dexList();
    var owned = 0;
    var byType = {};
    for (var i = 0; i < list.length; i++) {
      var t = list[i].type;
      if (!byType[t]) byType[t] = { owned: 0, total: 0 };
      byType[t].total++;
      if (list[i].owned) { owned++; byType[t].owned++; }
    }
    return { total: list.length, ownedCount: owned, byType: byType };
  }

  function questsView() {
    var defs = [
      { id: 'care', icon: '🤝', title: '陪它一会儿', desc: '摸摸 + 喂食累计 5 次', goal: 5, progress: 5, reward: { bond: 2 }, rewardText: '羁绊 +2' },
      { id: 'spar', icon: '⚔️', title: '活动筋骨', desc: '练习赛打满 3 场', goal: 3, progress: 3, reward: { points: 4 }, rewardText: '积分 +4' },
      { id: 'wild', icon: '🌿', title: '去野外看看', desc: '挑战野生精灵 2 次', goal: 2, progress: 1, reward: { points: 3 }, rewardText: '积分 +3' }
    ];
    var list = [];
    var doneCount = 0, claimedCount = 0, pendingCount = 0;
    var claimed = { spar: true };
    for (var i = 0; i < defs.length; i++) {
      var d = defs[i];
      var done = d.progress >= d.goal;
      var isClaimed = !!claimed[d.id];
      if (done) doneCount++;
      if (isClaimed) claimedCount++;
      if (done && !isClaimed) pendingCount++;
      list.push({
        id: d.id, icon: d.icon, title: d.title, desc: d.desc, goal: d.goal, progress: d.progress,
        done: done, claimed: isClaimed, reward: d.reward, rewardText: d.rewardText
      });
    }
    return {
      date: '2026-10-31', list: list, total: list.length, done: doneCount, claimed: claimedCount,
      pending: pendingCount, allDone: doneCount >= list.length, allClaimed: claimedCount >= list.length,
      bonus: 6, bonusText: '三个都领完再 +6 积分', bonusClaimed: claimedCount >= list.length
    };
  }

  // ---- 战斗档案：严格对齐 backend/routes.js 的 /pet/battle/profile 返回形状 ----
  function battleProfile() {
    var combat = {
      bond: 78, tier: 2, tierName: '亲密',
      hp: 118, atk: 15, def: 5, spd: 7, crit: 16, power: 128
    };
    var opponents = [
      { id: 'spar', name: '街角野猫', kind: 'npc', desc: '适合练手，先找找手感', bond: 75, tierName: '亲密', power: 124, hp: 115, type: 'grass', typeName: '草', typeIcon: '🌿', typeMul: 1, odds: 0.55, oddsText: '五五开' },
      { id: 'rival', name: '巷口团子', kind: 'npc', desc: '和你半斤八两的家伙', bond: 80, tierName: '亲密', power: 132, hp: 120, type: 'water', typeIcon: '💧', typeMul: 1.5, odds: 0.45, oddsText: '略占下风' },
      { id: 'boss', name: '深海水母', kind: 'npc', desc: '比你壮一圈，敢不敢试', bond: 85, tierName: '形影不离', power: 148, hp: 125, type: 'electric', typeIcon: '⚡', typeMul: 1, odds: 0.3, oddsText: '有点悬' }
    ];
    var shadows = [
      { id: 'sh1', name: '影子 · 街角野猫', type: 'grass', typeName: '草', typeIcon: '🌿', power: 124, hp: 115, tierName: '亲密', skills: ['finesse'] },
      { id: 'sh2', name: '影子 · 巷口团子', type: 'water', typeName: '水', typeIcon: '💧', power: 132, hp: 120, tierName: '亲密', skills: ['heavy'] }
    ];
    var skillCatalog = [
      { id: 'blast', name: '爆裂', icon: '💥', tier: 0, type: 'active', rarity: 'common', tierName: '普通', unlockBond: 0, unlocked: true, desc: '造成 1.2 倍攻击伤害' },
      { id: 'heavy', name: '重击', icon: '🔨', tier: 0, type: 'active', rarity: 'common', tierName: '普通', unlockBond: 0, unlocked: true, desc: '造成 1.6 倍攻击伤害' },
      { id: 'regen', name: '愈合', icon: '💚', tier: 0, type: 'active', rarity: 'common', tierName: '普通', unlockBond: 0, unlocked: true, desc: '恢复 20% 最大生命' },
      { id: 'smash', name: '碎击', icon: '🪨', tier: 1, type: 'active', rarity: 'uncommon', tierName: '稀有', unlockBond: 20, unlocked: true, desc: '造成 1.8 倍攻击伤害' },
      { id: 'finesse', name: '巧劲', icon: '🌀', tier: 1, type: 'active', rarity: 'uncommon', tierName: '稀有', unlockBond: 20, unlocked: true, desc: '本回合速度翻倍' },
      { id: 'shield', name: '护盾', icon: '🛡️', tier: 1, type: 'passive', rarity: 'uncommon', tierName: '稀有', unlockBond: 20, unlocked: true, desc: '受到的伤害降低 20%' },
      { id: 'evade', name: '闪避', icon: '💨', tier: 2, type: 'passive', rarity: 'rare', tierName: '史诗', unlockBond: 60, unlocked: true, desc: '闪避率 +15%' },
      { id: 'pierce', name: '穿透', icon: '🎯', tier: 2, type: 'passive', rarity: 'rare', tierName: '史诗', unlockBond: 60, unlocked: true, desc: '无视对方 30% 防御' },
      { id: 'toughness', name: '坚韧', icon: '🪨', tier: 2, type: 'passive', rarity: 'rare', tierName: '史诗', unlockBond: 60, unlocked: true, desc: '最大生命 +15%' },
      { id: 'lifesteal', name: '汲取', icon: '🩸', tier: 3, type: 'passive', rarity: 'epic', tierName: '传说', unlockBond: 100, unlocked: false, desc: '造成伤害的 30% 回复自身' }
    ];
    // ⚠️ 形状必须和 backend/routes.js 一致，否则 UI 会按假数据"验证通过"：
    //   skills        = 技能定义数组（skillsOf）
    //   equipped      = **id 字符串数组**（equippedSkills 返回 out.push(want[j])）
    //   inventory.owned = **对象数组**（inventoryView 返回 { owned: items }）
    // 这里以前写成"equipped 是对象数组 + owned 是 id 数组"，正好两头都反了，
    // 结果装备行整片渲染不出来、技能高亮永远不亮 —— 探针看不出是 bug。
    var equippedIds = ['blast', 'regen', 'shield'];
    var equipped = [
      { id: 'blast', name: '爆裂', icon: '💥', tier: 0, type: 'active', rarity: 'common', tierName: '普通', desc: '造成 1.2 倍攻击伤害' },
      { id: 'regen', name: '愈合', icon: '💚', tier: 0, type: 'active', rarity: 'common', tierName: '普通', desc: '恢复 20% 最大生命' },
      { id: 'shield', name: '护盾', icon: '🛡️', tier: 1, type: 'passive', rarity: 'uncommon', tierName: '稀有', desc: '受到的伤害降低 20%' }
    ];
    var elements = ELEMENTS.map(function (e) {
      return {
        id: e.id, name: e.name, icon: e.icon, color: e.color,
        beats: e.beats, beatsName: typeOf(e.beats).name, weakTo: '', weakToName: ''
      };
    });
    var dex = {
      list: dexList(), total: WILD.length, ownedCount: 2, byType: dexMeta().byType, buddy: 'caotuan',
      // v0.34.0：对齐后端形状——顶层 spotlight 摘要（焦点卡头部）+ 加成；list 各项带 spotlight 布尔（找完整数据用）
      spotlight: (function(){ var s = dexList().filter(function(w){ return w.spotlight; })[0];
        return s ? { id: s.id, name: s.name, type: s.type, icon: s.icon } : null; })(),
      spotlightBonus: 0.1
    };
    return {
      combat: combat,
      record: { total: 9, win: 7, lose: 2, points: 61 },
      today: 3, cap: 5, left: 2, full: false,
      opponents: opponents,
      shadows: shadows,
      defend: null,
      inbox: [{
        id: 1, from: '李同桌', fromNet: '250801', avatar: '', at: '2026-10-31T01:30:00.000Z',
        title: '巷口团子', type: 'earth', power: 128, kind: 'challenge'
      }],
      tactics: [
        { id: 'guard', name: '稳守', desc: '受到伤害 -20%' },
        { id: 'rush', name: '猛攻', desc: '造成伤害 +20%' },
        { id: 'focus', name: '凝神', desc: '暴击率 +15%' }
      ],
      tactic: 'guard',
      skills: equipped,
      equipped: equippedIds,
      skillSlots: 3,
      skillCatalog: skillCatalog,
      build: {
        skills: equippedIds, equipment: { weapon: null, accessory: null, consumable: null },
        strategy_name: '', power_score: 128, fitness: 72, slots: 3
      },
      inventory: {
        owned: [
          { id: 'wood_sword', name: '木剑', icon: '🗡️', type: 'weapon', effect: '攻击 +5', rarity: 'common', charges: null },
          { id: 'wind_charm', name: '风之护符', icon: '🧿', type: 'accessory', effect: '速度 +3', rarity: 'uncommon', charges: null }
        ]
      },
      equippedEffects: [],
      environment: {
        id: 'wind_valley', name: '风之峡谷', icon: '🍃', week: 2,
        effectText: '闪避率 +20% · 速度系技能 +50%',
        mods: { evasion_rate: 1.2, speed_skill_power: 1.5 },
        boss: {
          name: '风元素精灵', icon: '🌪️', desc: '峡谷的风里全是残影，打不中它什么都白搭',
          type: 'electric', typeName: '电', typeIcon: '⚡', bond: 156, hp: 196, power: 168,
          skills: ['evade', 'finesse', 'lifesteal']
        },
        reward: { id: 'lightning_stone', name: '雷石', icon: '⚡' },
        firstKillDone: false, bossWins: 0, usedToday: 0, cap: 1
      },
      evolution: { stage: 2, name: '大肥鱼', icon: '🐋', slots: 3 },
      elements: elements,
      battleType: 'grass',
      typeInfo: typeOf('grass'),
      dex: dex,
      tower: {
        // v0.28.0：改成「塔已通关 + 深渊开启」状态，让深渊面板（本版新增 UI）能被探针照到。
        // 塔进行中的渲染路径没有改动，交互探针 26 项继续覆盖它。
        cleared: 10, total: 10, today: 1, cap: 0, left: -1,
        dailyMods: [
          { id: 'haste', name: '疾风地带', icon: '💨', text: '双方速度 +25%' },
          { id: 'glass', name: '玻璃大炮', icon: '🔮', text: '双方伤害 ×1.3' }
        ],
        floors: Array.from({ length: 10 }, function(_, i) {
          return { f: i + 1, name: '第 ' + (i + 1) + ' 层', power: 40 + i * 22, cleared: true };
        }),
        abyss: {
          depth: 4, gain: 52, buff: 1.74,
          next: { f: 15, name: '断线的木偶', desc: '深渊第 2 段 · 它的系别一直在换',
                  depth: 5, bond: 190, power: 480, skills: ['heavy', 'shield'],
                  type: 'electric', typeName: '电', typeIcon: '⚡' }
        },
        next: null
      },
      titles: [
        { id: 'rookie', name: '初出茅庐', icon: '🌱' },
        { id: 'streak', name: '三连胜', icon: '🔥' }
      ],
      achievements: ['rookie'],
      achievementList: [
        { id: 'first_win', name: '首胜', icon: '🎉', desc: '赢下第一场对战', done: true },
        { id: 'collect_5', name: '小小收藏家', icon: '📖', desc: '收服 5 只野生精灵', done: false }
      ],
      rank: [
        { rank: 1, net: '250803', name: '张小雨', points: 320, pets: 6 },
        { rank: 2, net: '250815', name: '陈默', points: 280, pets: 5 },
        { rank: 3, net: '250822', name: '王一', points: 240, pets: 4 },
        { rank: 4, net: '251801', name: '我', points: 61, pets: 2 }
      ],
      myRank: 4,
      last: null,
      expedition: {
        locked: false, unlockTower: 3, maxDepth: 5,
        active: false, depth: 0, boons: [], pending: null,
        best: 3, runsToday: 0
      },
      assistant: { id: 'caotuan', name: '草团子', icon: '🌱', type: 'grass',
        typeName: '草', typeIcon: '🌿', bonusText: '血量见底时挡一半（一次）' },
      cmdSlots: 3,
      weather: {
        id: 'wind', name: '微风', icon: '🍃', desc: '风穿过草地，草属性的孩子脚步更轻',
        type: 'grass', typeName: '草', typeIcon: '🌿', typeColor: '#34C759',
        bonus: { atk: 2, spd: 1 }, bonusText: '攻 +2 · 速 +1'
      },
      quests: questsView(),
      history: [
        { at: '2026-10-31T02:10:00.000Z', kind: 'battle', win: true, title: '巷口团子', sub: '练习赛 · 4 回合', gain: 10, points: 61 },
        { at: '2026-10-31T01:40:00.000Z', kind: 'tower', win: true, title: '第 5 层守关', sub: '试炼塔 · 6 回合 · 通关第 5 层', gain: 8, points: 51 },
        { at: '2026-10-31T01:10:00.000Z', kind: 'wild', win: false, title: '藤蔓怪', sub: '野外 · 5 回合 · 没打过', gain: 0, points: 43 }
      ]
    };
  }

  // ---- 远征（v0.29.0）stub：start/boon 走内存态，fight 复用战斗 mock ----
  var EXP = {
    locked: false, unlockTower: 3, maxDepth: 5,
    active: false, depth: 0, boons: [], pending: null, best: 3, runsToday: 0
  };
  var EXP_BOONS = [
    { id: 'vamp', icon: '🩸', name: '汲血', text: '攻击附带 8% 吸血', once: false },
    { id: 'wall', icon: '🛡️', name: '铁壁', text: '防御 +20%', once: false },
    { id: 'spark', icon: '🌟', name: '星火', text: '这一层首击伤害 ×2（一次性）', once: true }
  ];
  var ROUTES = [
    { re: /pet\/play$/, data: {}, before: function (body) {
        // 与 backend POST /play 同口径：base = round(score*0.06)+1，每日封顶 PLAY_DAILY_CAP
        var sc = Math.max(0, Math.min(200, Math.floor(Number(body && body.score) || 0)));
        var base = sc <= 0 ? 1 : Math.round(sc * 0.06) + 1;
        var prev = PLAY.gain;
        PLAY.gain = Math.min(PLAY.cap, prev + base);
        var added = PLAY.gain - prev;
        ST.bond = (ST.bond || 0) + added;
        return { added: added, total: PLAY.gain, cap: PLAY.cap, state: ST };
      } },
    { re: /expedition\/start/, data: {}, before: function () {
        EXP.runsToday += 1;
        EXP.active = true; EXP.depth = 0; EXP.boons = []; EXP.pending = null;
        return { expedition: EXP };
      } },
    { re: /expedition\/boon/, data: {}, before: function (body) {
        var pick = body && body.id;
        var b = null;
        for (var i = 0; i < EXP_BOONS.length; i++) { if (EXP_BOONS[i].id === pick) b = EXP_BOONS[i]; }
        if (b) EXP.boons.push(b);
        EXP.pending = null;
        return { expedition: EXP };
      } },
    { re: /level\/info/, data: { level: 5 } },
    {
      re: /pet\/focus$/,
      data: {
        coinsGain: 4, bondGain: 2, tierUp: false, capped: false, done: true, tooShort: false,
        focusMin: 45, focusRounds: 3, state: ST
      }
    },
    {
      re: /battle\/fight/,
      data: {
        win: true, rounds: 3, seed: 12345, fightId: 'stub-fight-1',
        // 默契指令（v0.25.0）：形状对齐 COMMANDS。⚠️ 故意不带 cmds 字段——
        // fireCommand 里 `nd.cmds || next` 拿不到回显时会用本地 next，牌才能正确变灰。
        cmdSlots: 3,
        manualSkills: [
          { id: 'blast', name: '爆发冲击', icon: '💢', cooldown: 2,
            desc: '单回合造成 200% 伤害，下回合无法行动' },
          { id: 'heal', name: '紧急治疗', icon: '💚', cooldown: 4,
            desc: '立即恢复 30% 最大 HP' }
        ],
        commands: [
          { id: 'strike', name: '全力一击', icon: '💥', word: '豁出去了',
            desc: '这一击 ×1.8，代价是接下来两回合挨打 ×1.25' },
          { id: 'guard', name: '护住它', icon: '🛡️', word: '挡在它前面',
            desc: '这一击只吃 35% 伤害，但自己这一回合的攻击只剩 75%' },
          { id: 'charge', name: '憋一发', icon: '✨', word: '深吸一口气',
            desc: '这一回合不出手，下一击 ×1.2 且必定暴击' }
        ],
        steps: [
          { r: 1, by: 0, dmg: 21, crit: true, hpMe: 118, hpFoe: 89, tags: ['crit', 'weak'] },
          { r: 1, by: 1, dmg: 13, crit: false, hpMe: 105, hpFoe: 89, tags: ['resist'] },
          { r: 2, by: 0, dmg: 24, crit: false, hpMe: 105, hpFoe: 65, tags: [] },
          { r: 2, by: 1, dmg: 12, crit: false, hpMe: 93, hpFoe: 65, tags: [] },
          { r: 3, by: 0, dmg: 70, crit: true, hpMe: 93, hpFoe: 0, tags: ['crit'] }
        ],
        me: { name: '大肥鱼', power: 128, hp: 120, atk: 15, def: 5, spd: 7, crit: 16,
              type: 'grass', typeName: '草', typeIcon: '🌿',
              mood: { id: 'bliss', name: '很满足', icon: '😊', tone: 'high' },
              assist: { id: 'caotuan', name: '草团子', icon: '🌱', type: 'grass',
                        typeName: '草', typeIcon: '🌿', bonusText: '血量见底时挡一半（一次）' } },
        foe: { id: 'zhoutuan', name: '巷口团子', type: 'earth', power: 128, hp: 120 },
        gain: 10, record: { points: 61, streak: 2 }, today: 3,
        result: { win: true, gained: 10, points: 61 },
        state: ST
      }
    },
    { re: /battle\/profile/, data: battleProfile() },
    // v0.34.0：野生挑战（形状对齐 backend /pet/wild/fight 的返回体，取 playFight 渲染所需字段）
    {
      re: /wild\/fight/,
      data: {
        win: true, captured: true, buddySet: false,
        chance: 0.72, nextChance: null, rounds: 3, seed: 777,
        steps: [
          { r: 1, by: 0, dmg: 18, crit: false, hpMe: 120, hpFoe: 82, tags: ['weak'] },
          { r: 1, by: 1, dmg: 11, crit: false, hpMe: 109, hpFoe: 82, tags: [] },
          { r: 2, by: 0, dmg: 26, crit: true, hpMe: 109, hpFoe: 56, tags: ['crit'] },
          { r: 2, by: 1, dmg: 9, crit: false, hpMe: 100, hpFoe: 56, tags: [] },
          { r: 3, by: 0, dmg: 56, crit: false, hpMe: 100, hpFoe: 0, tags: [] }
        ],
        me: { name: '大肥鱼', power: 128, hp: 120, atk: 15, def: 5, spd: 7, crit: 16,
              type: 'grass', typeName: '草', typeIcon: '🌿', mood: null, assist: null },
        foe: { id: 'huomiao', name: '火苗狸', type: 'fire', typeName: '火', typeIcon: '🔥',
               power: 96, hp: 90, atk: 12, def: 4, spd: 8, crit: 10 },
        creature: { id: 'huomiao', name: '火苗狸', type: 'fire', typeName: '火', typeIcon: '🔥',
                    rarity: 'common', rarityName: '常见', rarityIcon: '⚪', icon: '🦊',
                    desc: '尾巴上有一簇不会灭的小火', bond: 18, power: 96, owned: true },
        drop: null, dexCount: 3, dexTotal: 6,
        skills: [], manualSkills: [],
        unlocked: [], types: { me: 'grass', foe: 'fire', mulMe: 1.18, mulFoe: 0.86 },
        weather: { id: 'sunny', name: '晴', icon: '☀️' },
        cmdSlots: 3, commands: [], cmds: [],
        result: { win: true, captured: true },
        state: ST
      }
    },
    // 剧情：形状必须与 backend/routes.js 的 GET /story 一致。
    // v0.32.0 起后端才下发 chapters / reqs / next，这里原来给的是 v0.15 的
    // {current:{text}, list} 结构 —— 结果工作台一直渲染「第 NaN / undefined 章」，
    // 而探针从来不查剧情，谁也没发现。
    {
      re: /pet\/story\/claim/,
      data: {
        claimed: 2, addedCoins: 12, addedBond: 5,
        chapter: { id: 'ch3', title: '第三章 · 亲密', icon: '💖' }
      }
    },
    {
      re: /pet\/story/,
      data: {
        chapters: [
          { id: 'ch1', title: '第一章 · 相遇', icon: '🌱', reqs: [], reward: { coins: 5, bond: 2 },
            narrative: '它从一个小小的像素蛋里探出头，睁着圆圆的眼睛看你。从今天起，它就是你的了。',
            unlocked: true, claimed: true, isCurrent: false },
          { id: 'ch2', title: '第二章 · 熟悉', icon: '🤝', reward: { coins: 8, bond: 3 },
            reqs: [{ key: 'bond', label: '羁绊', unit: '', have: 78, need: 20, ok: true, short: 0, target: 'home' }],
            narrative: '它开始会主动蹭你，晚上会蹲在桌角等你。它认得你的键盘声了。',
            unlocked: true, claimed: true, isCurrent: false },
          { id: 'ch3', title: '第三章 · 亲密', icon: '💖', reward: { coins: 12, bond: 5 },
            reqs: [
              { key: 'bond', label: '羁绊', unit: '', have: 78, need: 60, ok: true, short: 0, target: 'home' },
              { key: 'wins', label: '胜场', unit: '场', have: 12, need: 3, ok: true, short: 0, target: 'battle' }
            ],
            narrative: '它睡着时会把尾巴卷成一圈，把你的笔帽叼到窝里。你们之间有只属于自己的小秘密了。',
            unlocked: true, claimed: false, isCurrent: true },
          { id: 'ch4', title: '第四章 · 形影不离', icon: '🌸', reward: { coins: 18, bond: 8 }, narrative: '',
            reqs: [
              { key: 'bond', label: '羁绊', unit: '', have: 78, need: 120, ok: false, short: 42, target: 'home' },
              { key: 'wins', label: '胜场', unit: '场', have: 12, need: 5, ok: true, short: 0, target: 'battle' },
              { key: 'dex', label: '图鉴', unit: '只', have: 2, need: 5, ok: false, short: 3, target: 'dex' }
            ],
            unlocked: false, claimed: false, isCurrent: false },
          { id: 'ch5', title: '第五章 · 灵魂伙伴', icon: '✨', reward: { coins: 30, bond: 12 }, narrative: '',
            reqs: [
              { key: 'bond', label: '羁绊', unit: '', have: 78, need: 200, ok: false, short: 122, target: 'home' },
              { key: 'wins', label: '胜场', unit: '场', have: 12, need: 10, ok: true, short: 0, target: 'battle' },
              { key: 'dex', label: '图鉴', unit: '只', have: 2, need: 10, ok: false, short: 8, target: 'dex' }
            ],
            unlocked: false, claimed: false, isCurrent: false },
          { id: 'ch6', title: '第六章 · 永远', icon: '👑', reward: { coins: 50, bond: 20 }, narrative: '',
            reqs: [
              { key: 'bond', label: '羁绊', unit: '', have: 78, need: 200, ok: false, short: 122, target: 'home' },
              { key: 'wins', label: '胜场', unit: '场', have: 12, need: 30, ok: false, short: 18, target: 'battle' },
              { key: 'achievements', label: '成就', unit: '个', have: 8, need: 20, ok: false, short: 12, target: 'battle' }
            ],
            unlocked: false, claimed: false, isCurrent: false }
        ],
        currentIdx: 2,
        claimedIdx: 1,
        canClaim: true,
        current: { id: 'ch3', title: '第三章 · 亲密', icon: '💖',
          narrative: '它睡着时会把尾巴卷成一圈，把你的笔帽叼到窝里。你们之间有只属于自己的小秘密了。' },
        reqs: [
          { key: 'bond', label: '羁绊', unit: '', have: 78, need: 60, ok: true, short: 0, target: 'home' },
          { key: 'wins', label: '胜场', unit: '场', have: 12, need: 3, ok: true, short: 0, target: 'battle' }
        ],
        next: {
          title: '第四章 · 形影不离', icon: '🌸',
          reqs: [
            { key: 'bond', label: '羁绊', unit: '', have: 78, need: 120, ok: false, short: 42, target: 'home' },
            { key: 'wins', label: '胜场', unit: '场', have: 12, need: 5, ok: true, short: 0, target: 'battle' },
            { key: 'dex', label: '图鉴', unit: '只', have: 2, need: 5, ok: false, short: 3, target: 'dex' }
          ]
        },
        unlockedCount: 3,
        totalCount: 6,
        progress: { bond: 78, wins: 12, dex: 2, achievements: 8, achievementsTotal: 20 }
      }
    },
    { re: /pet\/diary/, data: DIARY },
    { re: /pet\/focus\/view/, data: FOCUS },
    { re: /pet\/wish/, data: { wish: null, options: [] } },
    { re: /pet\/wonder/, data: { claimed: false, event: null } },
    {
      re: /pet\/autonomy/,
      data: {
        level: 3,
        actions: [
          { at: '2026-10-31T01:00:00.000Z', text: '在窗台上发了很久的呆' },
          { at: '2026-10-31T03:00:00.000Z', text: '偷吃了半块饼干' }
        ]
      }
    },
    { re: /pet\/offline/, data: { hours: 7, bond: 3, coins: 2 } },
    { re: /pet\/daily/, data: { claimed: false, streak: 3 } },
    {
      re: /pet\/state/,
      data: {
        state: ST, palette: [], templates: [],
        mood: { icon: '🙂', name: '心情不错', text: '今天想被摸摸' },
        personality: { icon: '🍖', name: '贪吃', desc: '闻到吃的就走不动' },
        evolution: { icon: '🐋', name: '大肥鱼', stage: 2 },
        // 首页「今日轨道」要靠这几项填充：天气 / 签到 / 奇遇 / 离线
        weather: {
          id: 'wind', name: '微风', icon: '🍃', desc: '风穿过草地，草属性的孩子脚步更轻',
          type: 'grass', typeName: '草', typeIcon: '🌿', typeColor: '#34C759',
          bonus: { atk: 2, spd: 1 }, bonusText: '攻 +2 · 速 +1'
        },
        quests: questsView(),
        dailyBonus: { granted: true, streak: 3, coins: 5, bond: 2, msg: '欢迎回来！连续登录 3 天，送你 5 条小鱼干 + 2 羁绊' },
        assistant: { id: 'caotuan', name: '草团子', icon: '🌱', type: 'grass',
          typeName: '草', typeIcon: '🌿', bonusText: '血量见底时挡一半（一次）' },
        shop: {
          items: [
            { id: 'feast', name: '豪华大餐', icon: '🍱', cost: 5, kind: 'feed', desc: '喂一次，羁绊 +10（普通饭 +4）', charges: null, soldOut: false },
            { id: 'restore_vial', name: '恢复药剂', icon: '💊', cost: 15, kind: 'item', desc: '下一场战斗第 1 回合末回 40% 血', charges: 2, soldOut: false },
            { id: 'healing_herb', name: '治愈草', icon: '🌿', cost: 20, kind: 'item', desc: '下一场战斗每回合回 3% 血', charges: 0, soldOut: false },
            { id: 'flame_potion', name: '火焰药水', icon: '🧪', cost: 25, kind: 'item', desc: '下一场战斗首击伤害 ×2', charges: 1, soldOut: false },
            { id: 'bell', name: '默契铃铛', icon: '🔔', cost: 40, kind: 'bell', desc: '今天所有战斗默契 +1（每日一枚）', charges: null, soldOut: true }
          ]
        },
        wonder: {
          wonder: { icon: '🎁', title: '在抽屉里翻出一颗糖', text: '它把今天找到的宝贝藏在抽屉最里面。', reward: { coins: 2, bond: 3 } },
          claimed: false
        },
        offlineRecap: {
          events: [{ at: '2026-10-31T01:00:00.000Z', text: '在窗台上发了很久的呆' }],
          gapMin: 420, msg: '它自己待了七个小时，把垫子压出了一个坑。',
          coinGain: 2, bondGain: 3
        }
      }
    }
  ];

  function respond(verb, url, body) {
    CALLS.push({ verb: verb, url: url, body: body });
    for (var i = 0; i < ROUTES.length; i++) {
      if (ROUTES[i].re.test(url)) {
        var data = ROUTES[i].before ? ROUTES[i].before(body) : ROUTES[i].data;
        // ?towerlock=1：塔进行中状态（深渊锁定预告态）——探针用它验证「未通关也能看见深渊」。
        // ⚠️ 开关在 location.search 上，不在 api 的 url 里（api 调用只传 path）。
        if (/towerlock=1/.test(String(window.location.search)) && data && data.tower) {
          data = JSON.parse(JSON.stringify(data));
          data.tower.cleared = 7;
          data.tower.abyss = null;
          data.tower.next = { f: 8, name: '夜市的守护兽', desc: '两个摊主都拦不住它',
            bond: 180, power: 420, skills: ['combo', 'heavy'],
            type: 'earth', typeName: '土', typeIcon: '⛰️' };
        }
        return Promise.resolve({ data: { code: 200, data: data } });
      }
    }
    return Promise.resolve({ data: { code: 200, data: {} } });
  }

  window.__ci = { calls: CALLS, state: ST, appDef: null, ovlDef: null, onDestroy: null };

  window.ClassIntraMarket = {
    apps: {},
    elements: ELEMENTS,
    define: function (d) { window.__ci.appDef = d; },
    defineOverlay: function (d) { window.__ci.ovlDef = d; },
    _elements: ELEMENTS,
    _type: typeOf,
    _api: respond,
    createContext: function (name, manifest) {
      return {
        data: {
          api: {
            get: function (u) { return respond('get', u, null); },
            put: function (u, b) { return respond('put', u, b); },
            post: function (u, b) { return respond('post', u, b); }
          },
          storage: {
            get: function (k, d) {
              try {
                var v = JSON.parse(localStorage.getItem('ci:app:pet:' + k));
                return v === null ? d : v;
              } catch (e) { return d; }
            },
            set: function (k, v) {
              try { localStorage.setItem('ci:app:pet:' + k, JSON.stringify(v)); } catch (e) {}
            }
          },
          realtime: null
        },
        app: { onDestroy: function (fn) { window.__ci.onDestroy = fn; } },
        ui: {},
        manifest: manifest || {}
      };
    }
  };
})();
