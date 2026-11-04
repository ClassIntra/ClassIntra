// 桌宠 UI 改版验证：加载宠物屋 → 截图 + 捕获页面异常 + 关键元素几何自检
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const APP = 'http://127.0.0.1:9001';
const OUT = join(tmpdir(), 'ci-pet-ui');
mkdirSync(OUT, { recursive: true });
const W = Number(process.argv[2] || 1043);
const H = Number(process.argv[3] || 1500);

const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--remote-debugging-port=9403',
  `--user-data-dir=${join(tmpdir(), 'ci-pet-ui-profile')}`,
  '--no-first-run', '--disable-extensions', '--mute-audio',
  '--autoplay-policy=no-user-gesture-required',
  `--window-size=${W},${H}`, 'about:blank'
], { stdio: 'ignore' });

const g = async (p) => (await fetch(`http://127.0.0.1:9403${p}`)).json();
for (let i = 0; i < 60; i++) { try { await g('/json/version'); break; } catch { await sleep(500); } }
const pageT = (await g('/json/list')).find((t) => t.type === 'page');
const ws = new WebSocket(pageT.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let id = 0;
const pend = new Map();
const ERRORS = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.method === 'Runtime.exceptionThrown') {
    const x = m.params.exceptionDetails;
    const desc = String((x.exception && x.exception.description) || x.text);
    const fr = ((x.stackTrace && x.stackTrace.callFrames) || [])[0];
    ERRORS.push(desc.split('\n')[0] + (fr ? ' @' + (fr.lineNumber + 1) + ':' + (fr.columnNumber + 1) : ''));
  }
  if (m.id && pend.has(m.id)) {
    const { res, rej } = pend.get(m.id); pend.delete(m.id);
    m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
  }
};
const send = (method, params = {}) => new Promise((res, rej) => {
  const i = ++id; pend.set(i, { res, rej });
  ws.send(JSON.stringify({ id: i, method, params }));
});
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error('页面异常: ' + String((r.exceptionDetails && r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text).split('\n')[0]);
  return r.result.value;
};

const STUB = `
window.ClassIntraMarket = {
  apps: {},
  _elements: [
    { id: 'fire',     name: '火', icon: '🔥', color: '#FF6B4A', beats: 'grass',    beatsName: '草', weakTo: 'water',    weakToName: '水' },
    { id: 'grass',    name: '草', icon: '🌿', color: '#34C759', beats: 'earth',    beatsName: '土', weakTo: 'fire',     weakToName: '火' },
    { id: 'earth',    name: '土', icon: '⛰️', color: '#B07A4A', beats: 'electric', beatsName: '电', weakTo: 'grass',    weakToName: '草' },
    { id: 'electric', name: '电', icon: '⚡', color: '#E6A700', beats: 'water',    beatsName: '水', weakTo: 'earth',    weakToName: '土' },
    { id: 'water',    name: '水', icon: '💧', color: '#0A84FF', beats: 'fire',     beatsName: '火', weakTo: 'electric', weakToName: '电' }
  ],
  _type: function(id) {
    var l = window.ClassIntraMarket._elements;
    for (var i = 0; i < l.length; i++) if (l[i].id === id) return l[i];
    return l[1];
  },
  _wild: [
    { id: 'huomiao', name: '火苗狸', type: 'fire', rarity: 'common', bond: 18, icon: '🦊', desc: '尾巴上有一簇不会灭的小火', skills: [], power: 96 },
    { id: 'caotuan', name: '草团子', type: 'grass', rarity: 'common', bond: 20, icon: '🌱', desc: '在墙根晒太阳，一碰就滚成球', skills: [], power: 100 },
    { id: 'yanhu', name: '炎狐', type: 'fire', rarity: 'rare', bond: 52, icon: '🔥', desc: '跑过的地方会留下焦黑的小脚印', skills: ['heavy'], power: 160 },
    { id: 'tengman', name: '藤蔓怪', type: 'grass', rarity: 'rare', bond: 58, icon: '🌿', desc: '会把你掉在地上的橡皮筋收进窝', skills: ['lifesteal'], power: 172 },
    { id: 'yanjia', name: '岩甲兽', type: 'earth', rarity: 'rare', bond: 64, icon: '🪨', desc: '趴着的时候和石头一模一样', skills: ['shield'], power: 184 },
    { id: 'gushu', name: '古树精', type: 'grass', rarity: 'legend', bond: 116, icon: '🌳', desc: '比学校还老，树皮里刻着历届学生的名字', skills: ['shield', 'pierce'], power: 300 }
  ],
  _dexNames: { huomiao: '火苗狸', caotuan: '草团子', yanhu: '炎狐', tengman: '藤蔓怪', yanjia: '岩甲兽', gushu: '古树精' },
  _owned: { caotuan: true, tengman: true },
  // v0.10.0：天气 / 每日任务 / 战报。三块都是「服务端算好、前端只画」，
  // 桩里就按真实后端下发的形状写死一份，不一致后端一改探针就会叫。
  _weather: { id: 'wind', name: '微风', icon: '🍃', desc: '风穿过草地，草属性的孩子脚步更轻',
              type: 'grass', typeName: '草', typeIcon: '🌿', typeColor: '#34C759',
              bonus: { atk: 2, spd: 1 }, bonusText: '攻 +2 · 速 +1' },
  _questClaimed: { spar: true },
  _questsView: function(){
    var S = window.ClassIntraMarket;
    // 刻意做成三种状态各一条：已完成待领 / 已领 / 进行中
    var defs = [
      { id: 'care', icon: '🤝', title: '陪它一会儿', desc: '摸摸 + 喂食累计 5 次', goal: 5, progress: 5,
        reward: { bond: 2 }, rewardText: '羁绊 +2' },
      { id: 'spar', icon: '⚔️', title: '活动筋骨', desc: '练习赛打满 3 场', goal: 3, progress: 3,
        reward: { points: 4 }, rewardText: '积分 +4' },
      { id: 'wild', icon: '🌿', title: '去野外看看', desc: '挑战野生精灵 2 次', goal: 2, progress: 1,
        reward: { points: 3 }, rewardText: '积分 +3' }
    ];
    var list = [], doneCount = 0, claimedCount = 0, pendingCount = 0;
    for (var i = 0; i < defs.length; i++) {
      var d = defs[i];
      var done = d.progress >= d.goal;
      var isClaimed = !!S._questClaimed[d.id];
      if (done) doneCount++;
      if (isClaimed) claimedCount++;
      if (done && !isClaimed) pendingCount++;
      list.push({ id: d.id, icon: d.icon, title: d.title, desc: d.desc,
                  goal: d.goal, progress: d.progress, done: done, claimed: isClaimed,
                  reward: d.reward, rewardText: d.rewardText });
    }
    return { date: '2026-10-29', list: list, total: list.length,
             done: doneCount, claimed: claimedCount, pending: pendingCount,
             allDone: doneCount >= list.length, allClaimed: claimedCount >= list.length,
             bonus: 6, bonusText: '三个都领完再 +6 积分', bonusClaimed: claimedCount >= list.length };
  },
  _history: [
    { at: '2026-10-29T02:10:00.000Z', kind: 'battle', win: true,  title: '巷口团子', sub: '练习赛 · 4 回合', gain: 10, points: 61 },
    { at: '2026-10-29T01:40:00.000Z', kind: 'tower',  win: true,  title: '第 5 层守关', sub: '试炼塔 · 6 回合 · 通关第 5 层', gain: 8, points: 51 },
    { at: '2026-10-29T01:10:00.000Z', kind: 'wild',   win: false, title: '藤蔓怪', sub: '野外 · 5 回合 · 没打过', gain: 0, points: 43 }
  ],
  _dexList: function() {
    var S = window.ClassIntraMarket;
    var out = [];
    for (var i = 0; i < S._wild.length; i++) {
      var w = S._wild[i];
      var t = S._type(w.type);
      var owned = !!S._owned[w.id];
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
  },
  _dexMeta: function() {
    var S = window.ClassIntraMarket;
    var list = S._dexList();
    var owned = 0;
    var byType = {};
    for (var i = 0; i < list.length; i++) {
      var t = list[i].type;
      if (!byType[t]) byType[t] = { owned: 0, total: 0 };
      byType[t].total++;
      if (list[i].owned) { owned++; byType[t].owned++; }
    }
    return { total: list.length, ownedCount: owned, byType: byType };
  },
  _st: { adopted: true, name: '大肥鱼', bond: 78, exp: 40, affection: 60,
         fed_today: 1, last_fed_at: new Date(Date.now() - 8*60000).toISOString(),
         enabled: true, poked_today: 3, adopted_at: new Date(Date.now()-12*86400000).toISOString(),
         coins: 6, focus_min: 30, focus_rounds: 2, focus_bond: 4, focus_date: '2026-10-29',
         design: { type: 'video', character: 'dsh-whale' } },
  // v0.11.0：日记与专注额度（真实服务端由 diaryView() / focus 视图生成）
  _diary: {
    today: { date: '2026-10-29', count: 2,
             text: '陪主人安静坐了 30 分钟，我连尾巴都没晃。还吃到了豪华大餐，是今天最亮的时刻。' },
    history: [
      { date: '2026-10-28', text: '吃了 2 顿，肚子圆了一点。被摸了 5 下，毛都顺了。' },
      { date: '2026-10-27', text: '安静的一天。我数了 137 次呼吸，最后数乱了。' }
    ]
  },
  _focus: { todayMin: 30, rounds: 2, bondToday: 4, bondCap: 6, coins: 6, feastCost: 5 },
  _api: function(verb, url, body){
    var S = window.ClassIntraMarket;
    return new Promise(function(res){
      setTimeout(function(){
        if (/level\\/info/.test(url)) return res({ data: { code: 200, data: { level: 5 } } });
        // v0.11.0 专注结算：记下调用次数与请求体，供探针断言「只发一次、参数正确」
        if (/pet\\/focus/.test(url)) {
          S._focusCalls = (S._focusCalls || 0) + 1;
          S._focusLast = body;
          return res({ data: { code: 200, data: {
            coinsGain: 4, bondGain: 2, tierUp: false, capped: false,
            done: !!(body && body.done), tooShort: false,
            focusMin: 45, focusRounds: 3,
            state: Object.assign({}, S._st, { coins: 10, focus_min: 45 })
          } } });
        }
        if (/battle\\/fight/.test(url)) {
          return res({ data: { code: 200, data: {
            win: true, rounds: 3, seed: 12345,
            steps: [
              { r: 1, by: 0, dmg: 21, crit: true,  hpMe: 118, hpFoe: 89, tags: ['crit', 'weak'] },
              { r: 1, by: 1, dmg: 13, crit: false, hpMe: 105, hpFoe: 89, tags: ['resist'] },
              { r: 2, by: 0, dmg: 24, crit: false, hpMe: 105, hpFoe: 65, tags: [] },
              { r: 2, by: 1, dmg: 12, crit: false, hpMe: 93,  hpFoe: 65, tags: [] },
              { r: 3, by: 0, dmg: 70, crit: true,  hpMe: 93,  hpFoe: 0, tags: ['crit'] }
            ],
            me: { name: '大肥鱼', power: 285, hp: 118, atk: 15, def: 5, spd: 7, crit: 16, type: 'grass', typeName: '草', typeIcon: '🌿' },
            foe: { name: '街角野猫', power: 272, hp: 110, atk: 14, def: 5, spd: 7, crit: 16, type: 'grass', typeName: '草', typeIcon: '🌿' },
            gain: 10, record: { total: 8, win: 5, lose: 3, points: 61, streak: 3, best: 4 }, today: 3, cap: 0,
            tactic: 'guard',
            unlocked: [
              { id: 'streak_5', name: '势不可挡', icon: '⚡', desc: '拿到 5 连胜' }
            ],
            opp: { id: 'p:251801', realId: '251801', kind: 'shadow', name: 'DD', owner: '今安在', bond: 75, power: 279 },
            defended: { name: 'DD', held: false, gain: 3 }
          } } });
        }
        if (/wild\\/fight/.test(url)) {
          var wid = (body && body.id) || 'huomiao';
          var ww = null;
          for (var wj = 0; wj < S._wild.length; wj++) if (S._wild[wj].id === wid) ww = S._wild[wj];
          if (!ww) ww = S._wild[0];
          S._owned[ww.id] = true;
          var ownedN = 0;
          for (var wk = 0; wk < S._wild.length; wk++) if (S._owned[S._wild[wk].id]) ownedN++;
          var wt = S._type(ww.type);
          return res({ data: { code: 200, data: {
            win: true, captured: true, buddySet: false, chance: 0.62, nextChance: null,
            rounds: 3,
            steps: [
              { r: 1, by: 0, dmg: 18, crit: false, tags: ['weak'],  hpMe: 118, hpFoe: Math.max(0, ww.power - 18) },
              { r: 1, by: 1, dmg: 9,  crit: false, tags: ['resist'], hpMe: 109, hpFoe: Math.max(0, ww.power - 18) },
              { r: 2, by: 0, dmg: 96, crit: true,  tags: ['weak', 'crit'], hpMe: 109, hpFoe: 0 }
            ],
            me: { name: '大肥鱼', power: 285, hp: 118, atk: 15, def: 5, spd: 7, crit: 16, type: 'grass', typeName: '草', typeIcon: '🌿' },
            foe: { name: ww.name, power: ww.power, hp: ww.power, atk: 8, def: 3, spd: 5, crit: 8,
                   type: ww.type, typeName: wt.name, typeIcon: wt.icon },
            creature: { id: ww.id, name: ww.name, icon: ww.icon, type: ww.type, typeName: wt.name,
                        rarity: ww.rarity, rarityName: ww.rarity === 'legend' ? '传说' : (ww.rarity === 'rare' ? '稀有' : '常见') },
            dexCount: ownedN, dexTotal: S._wild.length,
            unlocked: [{ id: 'dex_1', name: '初次收服', icon: '🔴', desc: '收服第一只野生精灵' }],
            types: { me: 'grass', foe: ww.type, mulMe: 1, mulFoe: 1 }
          } } });
        }
        if (/pet\\/buddy/.test(url)) {
          window.__buddyPosts = (window.__buddyPosts || 0) + 1;
          var bid = (body && body.id) || '';
          var bw = null;
          for (var wi = 0; wi < S._wild.length; wi++) if (S._wild[wi].id === bid) bw = S._wild[wi];
          return res({ data: { code: 200, data: {
            buddy: bw ? { id: bw.id, name: bw.name, icon: bw.icon, type: bw.type, typeName: S._type(bw.type).name,
                          rarity: bw.rarity, rarityName: bw.rarity === 'legend' ? '传说' : (bw.rarity === 'rare' ? '稀有' : '常见'),
                          rarityIcon: bw.rarity === 'legend' ? '🟡' : (bw.rarity === 'rare' ? '🔵' : '⚪'),
                          bonus: bw.type === 'grass' ? { hp: 0, atk: 0, def: 2, spd: 0, crit: 0 } : { hp: 0, atk: 3, def: 0, spd: 0, crit: 0 } } : null,
            buddyBonus: { hp: 0, atk: 0, def: 2, spd: 0, crit: 0 },
            combat: { bond: 78, tier: 2, tierName: '亲密', hp: 118, atk: 15, def: 7, spd: 7, crit: 16, power: 293 },
            evolution: { stage: 1, name: '成长期', icon: '🌱', bond: 78, slots: 2, desc: '开始有自己的脾气了', nextAt: 120, nextName: '完全体', pct: 30 }
          } } });
        }
        if (/battle\\/type/.test(url)) {
          window.__typePosts = (window.__typePosts || 0) + 1;
          var nt = (body && body.type) || 'grass';
          return res({ data: { code: 200, data: {
            battleType: nt,
            typeInfo: S._type(nt)
          } } });
        }
        if (/battle\\/skills/.test(url)) {
          window.__skillPosts = (window.__skillPosts || 0) + 1;
          return res({ data: { code: 200, data: { equipped: (body && body.skills) || [] } } });
        }
        if (/battle\\/inbox\\/read/.test(url)) {
          window.__inboxReadCalls = (window.__inboxReadCalls || 0) + 1;
          S._st.battle_inbox = [];
          return res({ data: { code: 200, data: { ok: true } } });
        }
        if (/battle\\/profile/.test(url)) {
          var dm = S._dexMeta();
          return res({ data: { code: 200, data: {
            combat: { bond: 78, tier: 2, tierName: '亲密', hp: 118, atk: 15, def: 5, spd: 7, crit: 16, power: 285 },
            record: { total: 7, win: 4, lose: 3, points: 51, streak: 2, best: 4 },
            today: 2, cap: 0, left: -1,
            opponents: [
              { id: 'spar', name: '街角野猫', desc: '适合练手，先找找手感', bond: 70, tierName: '亲密', power: 272, hp: 110, odds: 'easy', oddsText: '好打', kind: 'npc', type: 'grass', typeName: '草', typeIcon: '🌿', typeMul: 1 },
              { id: 'rival', name: '巷口团子', desc: '和你半斤八两的家伙', bond: 78, tierName: '亲密', power: 285, hp: 118, odds: 'even', oddsText: '势均', kind: 'npc', type: 'water', typeName: '水', typeIcon: '💧', typeMul: 0.86 },
              { id: 'boss', name: '深海水母', desc: '比你壮一圈，敢不敢试', bond: 85, tierName: '亲密', power: 297, hp: 125, odds: 'hard', oddsText: '吃力', kind: 'npc', type: 'electric', typeName: '电', typeIcon: '⚡', typeMul: 1 }
            ],
            shadows: [
              { id: 'p:251801', realId: '251801', kind: 'shadow', name: 'DD', owner: '今安在', desc: '', bond: 75, tierName: '亲密', power: 279, hp: 115, odds: 'easy', oddsText: '好打', type: 'earth', typeName: '土', typeIcon: '⛰️', typeMul: 1.18 },
              { id: 'p:251802', realId: '251802', kind: 'shadow', name: '鱼', owner: '桥本环奈', desc: '', bond: 82, tierName: '亲密', power: 295, hp: 122, odds: 'even', oddsText: '势均', type: 'grass', typeName: '草', typeIcon: '🌿', typeMul: 1 }
            ],
            defend: { total: 4, held: 3, broken: 1, points: 27 },
            tactics: [
              { id: 'assault', name: '猛攻', icon: '⚔️', desc: '攻击 x1.15，防御只留 0.75——速战速决，拖久了会崩' },
              { id: 'guard', name: '稳守', icon: '🛡️', desc: '防御 x1.45、血量 x1.05，攻击降到 0.90——熬到对面先倒' },
              { id: 'nimble', name: '灵巧', icon: '🌀', desc: '速度 +5、暴击 +8 个点，但防御只剩 0.85——抢节奏的赌法' }
            ],
            tactic: 'guard',
            skills: [
              { id: 'heavy', name: '千钧一击', icon: '💥', tier: 0, desc: '每 3 回合打出 1.6 倍伤害' },
              { id: 'lifesteal', name: '鲸吞', icon: '🩸', tier: 0, desc: '造成伤害的 12% 回血' },
              { id: 'shield', name: '泡泡护盾', icon: '🫧', tier: 1, desc: '血量快见底时挡下一半伤害（一次）' },
              { id: 'combo', name: '连打', icon: '⚡', tier: 1, desc: '25% 概率追加半次攻击' },
              { id: 'pierce', name: '破甲', icon: '🔨', tier: 1, desc: '无视对手 30% 防御，至少多打 1 点' }
            ],
            equipped: ['heavy', 'shield'],
            skillSlots: 2,
            // v2.0：Build / 环境 / 装备库存（形状对齐真实 /battle/profile 下发）
            skillCatalog: [
              { id: 'heavy', name: '千钧一击', icon: '💥', tier: 0, type: 'passive', rarity: 'common', tierName: '普通', unlockBond: 0, unlocked: true, desc: '每 3 回合打出 1.6 倍伤害' },
              { id: 'lifesteal', name: '鲸吞', icon: '💫', tier: 0, type: 'passive', rarity: 'common', tierName: '普通', unlockBond: 0, unlocked: true, desc: '造成伤害的 12% 回血' },
              { id: 'heal', name: '紧急治疗', icon: '💚', tier: 0, type: 'heal', rarity: 'common', tierName: '普通', unlockBond: 0, unlocked: true, desc: '立即恢复 30% 最大 HP' },
              { id: 'toughness', name: '坚韧', icon: '💪', tier: 0, type: 'stat', rarity: 'common', tierName: '普通', unlockBond: 0, unlocked: true, desc: '最大 HP +15%' },
              { id: 'strength', name: '力量', icon: '🏋️', tier: 0, type: 'stat', rarity: 'common', tierName: '普通', unlockBond: 0, unlocked: true, desc: '攻击力 +12%' },
              { id: 'shield', name: '泡泡护盾', icon: '🔵', tier: 1, type: 'passive', rarity: 'uncommon', tierName: '优良', unlockBond: 20, unlocked: true, desc: '血量快见底时挡下一半伤害（一次）' },
              { id: 'combo', name: '连打', icon: '⚡', tier: 1, type: 'passive', rarity: 'uncommon', tierName: '优良', unlockBond: 20, unlocked: true, desc: '25% 概率追加半次攻击' },
              { id: 'pierce', name: '破甲', icon: '🔨', tier: 1, type: 'passive', rarity: 'uncommon', tierName: '优良', unlockBond: 20, unlocked: true, desc: '无视对手 30% 防御，至少多打 1 点' },
              { id: 'blast', name: '爆发冲击', icon: '💢', tier: 1, type: 'active', rarity: 'uncommon', tierName: '优良', unlockBond: 20, unlocked: true, desc: '单回合造成 200% 伤害，下回合无法行动' },
              { id: 'berserk', name: '狂怒', icon: '🔥', tier: 1, type: 'buff', rarity: 'uncommon', tierName: '优良', unlockBond: 20, unlocked: true, desc: '攻击 +50%，防御 -30%，持续 3 回合' },
              { id: 'regen', name: '活力', icon: '🍀', tier: 1, type: 'passive', rarity: 'uncommon', tierName: '优良', unlockBond: 20, unlocked: true, desc: '每回合结束恢复 2% 最大 HP' },
              { id: 'finesse', name: '敏捷', icon: '🦶', tier: 1, type: 'stat', rarity: 'uncommon', tierName: '优良', unlockBond: 20, unlocked: true, desc: '速度 +10%' },
              { id: 'aura', name: '斗志光环', icon: '✨', tier: 1, type: 'passive', rarity: 'uncommon', tierName: '优良', unlockBond: 20, unlocked: true, desc: '每场战斗首回合攻击力 +25%' },
              { id: 'guard_stance', name: '钢铁壁垒', icon: '🛡️', tier: 2, type: 'buff', rarity: 'rare', tierName: '稀有', unlockBond: 60, unlocked: true, desc: '防御 +40%，速度 -20%，持续 3 回合' },
              { id: 'smash', name: '重锤砸击', icon: '🔨', tier: 2, type: 'active', rarity: 'rare', tierName: '稀有', unlockBond: 60, unlocked: true, desc: '本回合伤害翻倍，但自身掉 15% 血' },
              { id: 'counter', name: '反击领域', icon: '⚔️', tier: 2, type: 'passive', rarity: 'rare', tierName: '稀有', unlockBond: 60, unlocked: true, desc: '受到攻击时有 40% 概率自动反击' },
              { id: 'evade', name: '闪避精通', icon: '🌀', tier: 2, type: 'passive', rarity: 'rare', tierName: '稀有', unlockBond: 60, unlocked: true, desc: '闪避率 +15%，连续触发时提升至 25%' },
              { id: 'sharp', name: '精准', icon: '🎯', tier: 2, type: 'stat', rarity: 'rare', tierName: '稀有', unlockBond: 60, unlocked: true, desc: '暴击伤害 +20%' }
            ],
            build: {
              skills: ['heavy', 'shield'],
              equipment: { weapon: 'blunt_sword', accessory: 'crystal_amulet', consumable: 'flame_potion' },
              strategy_name: '稳如老狗',
              power_score: 341,
              fitness: { score: 2, stars: 3, max: 5 },
              slots: 2
            },
            inventory: { owned: [
              { id: 'blunt_sword', name: '钝剑', icon: '⚔️', type: 'weapon', effect: '攻击后回复 5% 最大 HP', rarity: 'common', charges: null },
              { id: 'crystal_amulet', name: '水晶护符', icon: '💎', type: 'accessory', effect: '防御 +15%', rarity: 'common', charges: null },
              { id: 'flame_potion', name: '火焰药水', icon: '🧪', type: 'consumable', effect: '首回合伤害翻倍（仅使用一次）', rarity: 'uncommon', charges: 2 },
              { id: 'restore_vial', name: '恢复药剂', icon: '💊', type: 'consumable', effect: '第 1 回合结束恢复 40% 最大 HP', rarity: 'common', charges: 3 }
            ] },
            equippedEffects: { atk: '+12%', def: '+15%', crit_dmg: '+20%', heal: '+25%' },
            environment: {
              id: 'wind_valley', name: '风之峡谷', icon: '🍃', week: 43,
              effectText: '闪避率 +20% · 速度系技能 +50%',
              mods: { id: 'wind_valley', evadeMul: 1.2, fireMul: 1, dotPercent: 0, cdBonus: 0, critMul: 1, healMul: 1 },
              boss: { name: '风元素精灵', desc: '峡谷的风里全是残影，打不中它什么都白搭', type: 'electric', typeName: '电', typeIcon: '⚡', bond: 86, hp: 150, power: 318, skills: ['evade', 'finesse', 'lifesteal'] },
              reward: { id: 'lightning_stone', name: '闪电石', icon: '⚡' },
              firstKillDone: false, bossWins: 2, dailyLeft: 1, dailyCap: 1,
              next: { id: 'magma_cave', name: '岩浆洞窟', icon: '🔥', preview: '下周开放' },
              bestScore: 341
            },
            evolution: { stage: 1, name: '成长期', icon: '🌱', bond: 78, slots: 2, desc: '开始有自己的脾气了', nextAt: 120, nextName: '完全体', pct: 30 },
            elements: window.ClassIntraMarket._elements,
            battleType: 'grass',
            typeInfo: window.ClassIntraMarket._type('grass'),
            dex: {
              total: dm.total, ownedCount: dm.ownedCount,
              byType: dm.byType,
              spotlight: { id: 'huomiao', name: '火苗狸', icon: '🦊', type: 'fire', typeName: '火', rarity: 'common', rarityName: '常见' },
              spotlightBonus: 0.1,
              buddy: { id: 'caotuan', name: '草团子', icon: '🌱', type: 'grass', typeName: '草', typeIcon: '🌿', rarity: 'common', rarityName: '常见', rarityIcon: '⚪', bonus: { hp: 0, atk: 0, def: 2, spd: 0, crit: 0 } },
              buddyBonus: { hp: 0, atk: 0, def: 2, spd: 0, crit: 0 },
              captureBase: { common: 0.62, rare: 0.4, legend: 0.2 },
              list: window.ClassIntraMarket._dexList()
            },
            tower: {
              cleared: 4, total: 10, today: 1, cap: 0, left: -1,
              floors: [1,2,3,4,5,6,7,8,9,10].map(function(n){
                return { f: n, name: '第' + n + '层守关', desc: '', bond: 10 + n * 12,
                         tierName: '熟悉', power: 160 + n * 12, skills: [], cleared: n <= 4 };
              }),
              next: { f: 5, name: '图书馆的猫头鹰', desc: '专挑你的破绽下手',
                      bond: 56, tierName: '熟悉', power: 230, hp: 96, skills: ['pierce'],
                      type: 'earth', typeName: '土', typeIcon: '⛰️' }
            },
            titles: [
              { id: 'rookie', name: '初出茅庐', icon: '🌱' },
              { id: 'hot', name: '手感火热', icon: '🔥' },
              { id: 'climber', name: '攀塔者', icon: '🧗' }
            ],
            achievements: ['first_win', 'streak_3'],
            achievementList: [
              { id: 'first_win', name: '第一滴血', icon: '🩸', desc: '赢下第一场对战' },
              { id: 'streak_3', name: '手感火热', icon: '🔥', desc: '拿到 3 连胜' },
              { id: 'streak_5', name: '势不可挡', icon: '⚡', desc: '拿到 5 连胜' },
              { id: 'beat_boss', name: '越级者', icon: '🐙', desc: '击败深海水母' },
              { id: 'underdog', name: '以弱胜强', icon: '🎯', desc: '战力低于对手仍获胜' }
            ],
            rank: [
              { rank: 1, name: '欧鲸鲸', owner: '今安在', points: 143, power: 330, win: 9 },
              { rank: 2, name: '大肥鱼', owner: '高子翼', points: 61, power: 285, win: 5 },
              { rank: 3, name: '波刚', owner: '老张', points: 44, power: 170, win: 3 }
            ],
            myRank: 2,
            inbox: [
              { at: '2026-10-28T02:00:00.000Z', date: '2026-10-28', uid: '251803', who: '波刚', whoOwner: '老张', held: true, rounds: 7 },
              { at: '2026-10-28T01:00:00.000Z', date: '2026-10-28', uid: '251804', who: '一米八', whoOwner: '', held: false, rounds: 9 }
            ],
            last: null,
            weather: S._weather,
            quests: S._questsView(),
            history: S._history
          } } });
        }
        res({ data: { code: 200, data: {
          state: S._st, palette: [], templates: [],
          elements: S._elements,
          wild: S._wild,
          buddy: { id: 'caotuan', name: '草团子', icon: '🌱', type: 'grass', typeName: '草', typeIcon: '🌿', rarity: 'common', rarityName: '常见', rarityIcon: '⚪', bonus: { hp: 0, atk: 0, def: 2, spd: 0, crit: 0 } },
          evolution: { stage: 1, name: '成长期', icon: '🌱', bond: 78, slots: 2, desc: '开始有自己的脾气了', nextAt: 120, nextName: '完全体', pct: 30 },
          weather: S._weather,
          quests: S._questsView(),
          diary: S._diary,
          focus: S._focus
        } } });
      }, 6);
    });
  },
  createContext: function(){
    var S = window.ClassIntraMarket;
    return {
      data: {
        api: { get: function(u){ return S._api('get', u); }, put: function(u,b){ return S._api('put',u,b); }, post: function(u,b){ return S._api('post',u,b); } },
        storage: {
          get: function(k,d){ try { var v=JSON.parse(localStorage.getItem('ci:app:pet:'+k)); return v===null?d:v; } catch(e){ return d; } },
          set: function(k,v){ try { localStorage.setItem('ci:app:pet:'+k, JSON.stringify(v)); } catch(e){} }
        },
        realtime: null
      },
      app: { onDestroy: function(){} },
      system: { toast: function(){} }
    };
  },
  define: function(d){ window.__entryDef = d; }
};
`;

// 复刻真实宿主约束：MarketRuntime.vue 的 .market-runtime-container 是
// height:100%; min-height:0; overflow:hidden。之前探针用 min-height:100% 的松容器，
// .ci-pethome 的 height:100% 拿不到确定高度 → 退化成内容高度 → 滚动落到 window 上，
// 于是"容器自己滚不动"这种真 bug 永远测不出来（10-27 踩过）。
const HTML = `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="/market-static/pet/frontend/style.css">
<style>
html,body{margin:0;height:100%;overflow:hidden;background:#F2F3F7;color:#1B1B1F;font-family:-apple-system,"Segoe UI","Microsoft YaHei",sans-serif}
</style></head><body><div id="root" style="height:100%;min-height:0;overflow:hidden"></div></body></html>`;

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
ws.onmessage = (function (orig) {
  return function (e) {
    const m = JSON.parse(e.data);
    if (m.method === 'Fetch.requestPaused') {
      const url = m.params.request.paused ? '' : m.params.request.url;
      if (/harness-ui/.test(url)) {
        send('Fetch.fulfillRequest', {
          requestId: m.params.requestId, responseCode: 200,
          responseHeaders: [{ name: 'Content-Type', value: 'text/html; charset=utf-8' }],
          body: b64(HTML)
        }).catch(() => {});
      } else {
        send('Fetch.continueRequest', { requestId: m.params.requestId }).catch(() => {});
      }
    }
    orig(e);
  };
})(ws.onmessage);

await send('Page.enable');
await send('Runtime.enable');
await send('Fetch.enable', { patterns: [{ urlPattern: '*harness*', requestStage: 'Request' }] });
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
await send('Page.addScriptToEvaluateOnNewDocument', { source: STUB });

const shot = async (name) => {
  const s = await send('Page.captureScreenshot', { format: 'png' });
  const buf = Buffer.from(s.data, 'base64');
  const file = join(OUT, name + '.png');
  writeFileSync(file, buf);
  console.log('  📷 ' + file + '  (' + buf.length + ' bytes)');
  return file;
};

try {
  await send('Page.navigate', { url: APP + '/harness-ui.html' });
  await sleep(1200);
  const SRC = await ev(`fetch('/market-static/pet/frontend/entry.js',{cache:'no-store'}).then(function(r){return r.text();})`);
  console.log('entry.js 字符数:', SRC.length);
  await ev(SRC);
  await sleep(300);
  await ev(`window.__entryDef.mount(document.getElementById('root'), window.ClassIntraMarket.createContext())`);
  await sleep(2600);

  // ---- 首页（小家）：分区 tab + 冒险入口 + 随行/进化 ----
  console.log('\n== 首页（小家）自检 ==');
  const homeInfo = await ev(`(function(){
    var q = function(s){ return document.querySelector(s); };
    var qa = function(s){ return Array.prototype.slice.call(document.querySelectorAll(s)); };
    var on = q('.ci-pet-tab.is-on');
    return {
      hero: !!q('.ci-pet-hero'),
      video: !!q('.ci-pet-hero-video'),
      stats: qa('.ci-pet-statrow').length,
      primaryBtn: (q('.ci-pet-bigbtn--primary') || {}).textContent,
      tabs: qa('.ci-pet-tab').map(function(e){ return e.getAttribute('data-tab'); }),
      tabOn: on ? on.getAttribute('data-tab') : null,
      advlinks: qa('.ci-pet-advlink').map(function(e){ return e.getAttribute('data-link'); }),
      advSubs: qa('.ci-pet-advlink-sub').map(function(e){ return e.textContent; }),
      buddy: (q('.ci-pet-buddy-name') || {}).textContent,
      evoBadge: (q('.ci-pet-badge--evo') || {}).textContent,
      battleOnHome: !!q('.ci-pet-battle'),
      weatherName: (q('.ci-pet-weather-name') || {}).textContent,
      weatherFit: (q('.ci-pet-weather-fit') || {}).textContent,
      weatherVisible: (function(){
        var w = q('.ci-pet-weather');
        if (!w) return false;
        var r = w.getBoundingClientRect();
        return r.height > 0 && getComputedStyle(w).display !== 'none';
      })(),
      questRows: qa('.ci-pet-quest').length,
      questClaim: qa('.ci-pet-quest-claim').length,
      questClaimedTag: qa('.ci-pet-quest.is-claimed').length,
      questTitles: qa('.ci-pet-quest-title').map(function(e){ return e.textContent; })
    };
  })()`);
  console.log(JSON.stringify(homeInfo, null, 1));
  if (!homeInfo.hero || !homeInfo.video) { console.log('  ❌ 首页 hero/视频没渲染'); process.exitCode = 1; }
  if (homeInfo.stats !== 2) { console.log('  ❌ 状态条应有 2 行，实为 ' + homeInfo.stats); process.exitCode = 1; }
  if (homeInfo.tabs.join(',') !== 'home,battle,dex,rank') { console.log('  ❌ tab 不对：' + homeInfo.tabs.join(',')); process.exitCode = 1; }
  if (homeInfo.tabOn !== 'home') { console.log('  ❌ 默认 tab 不是小家：' + homeInfo.tabOn); process.exitCode = 1; }
  if (homeInfo.advlinks.join(',') !== 'battle,dex,rank') { console.log('  ❌ 冒险入口不对：' + homeInfo.advlinks.join(',')); process.exitCode = 1; }
  if (!homeInfo.buddy || homeInfo.buddy.indexOf('草团子') < 0) { console.log('  ❌ 随行伙伴没显示：' + homeInfo.buddy); process.exitCode = 1; }
  if (!homeInfo.evoBadge || homeInfo.evoBadge.indexOf('成长期') < 0) { console.log('  ❌ 进化徽章没显示：' + homeInfo.evoBadge); process.exitCode = 1; }
  if (homeInfo.battleOnHome) { console.log('  ❌ 首页还塞着完整对战，分区没生效'); process.exitCode = 1; }
  if (!homeInfo.weatherVisible) { console.log('  ❌ 首页天气条没渲染'); process.exitCode = 1; }
  if (!homeInfo.weatherName || homeInfo.weatherName.indexOf('微风') < 0) { console.log('  ❌ 天气条文案不对：' + homeInfo.weatherName); process.exitCode = 1; }
  if (!homeInfo.weatherFit || homeInfo.weatherFit.indexOf('本命契合') < 0) { console.log('  ❌ 天气条没认出本命契合（草遇微风）：' + homeInfo.weatherFit); process.exitCode = 1; }
  if (homeInfo.questRows !== 3) { console.log('  ❌ 每日任务应有 3 条，实为 ' + homeInfo.questRows); process.exitCode = 1; }
  if (homeInfo.questClaim !== 1) { console.log('  ❌ 待领任务领取按钮应只有 1 个，实为 ' + homeInfo.questClaim); process.exitCode = 1; }
  if (homeInfo.questClaimedTag !== 1) { console.log('  ❌ 已领任务应有 1 条，实为 ' + homeInfo.questClaimedTag); process.exitCode = 1; }
  if (!/今日 \d+ 场/.test(homeInfo.advSubs[0] || '')) { console.log('  ❌ 对战入口副标题没补上今日场次：' + homeInfo.advSubs[0]); process.exitCode = 1; }
  if (!homeInfo.advSubs[1] || homeInfo.advSubs[1].indexOf('已收服 2 / 6') < 0) { console.log('  ❌ 图鉴入口副标题不对：' + homeInfo.advSubs[1]); process.exitCode = 1; }
  await shot('pethome-home');

  // ---- v0.11.0 新组件：日记卡 / 小卖部 / 专注入口 ----
  // 这几项必须在这里断言，而不是只看截图：日记文案是服务端生成的，
  // 万一字段没下发，卡片会静默降级成"今天还没什么可记的"，截图上看不出区别。
  const newInfo = await ev(`(function(){
    var q = function(s){ return document.querySelector(s); };
    var quote = q('.ci-pet-diary-text');
    var tag = q('.ci-pet-diary-tag');
    var buy = q('.ci-pet-shoppe-buy');
    var coins = q('.ci-pet-shoppe-num');
    var acts = document.querySelectorAll('.ci-pet-actions .ci-pet-bigbtn');
    var focusBtn = q('.ci-pet-focusbtn');
    return {
      diary: !!q('.ci-pet-diary'),
      quote: quote ? quote.textContent : '',
      tag: tag ? tag.textContent : '',
      more: !!q('.ci-pet-diary-more'),
      buy: buy ? buy.textContent : '',
      buyDisabled: buy ? !!buy.disabled : null,
      coins: coins ? coins.textContent : '',
      actCount: acts.length,
      focusBtn: focusBtn ? focusBtn.textContent : '',
      // ⚠️ 不能用 .ci-pethome 的 scrollWidth 判溢出：.ci-pet-actions 有 margin:-6px，
      //    它天然让 scrollWidth 比 clientWidth 大 12px，但父级 overflow-x:hidden 会裁掉，
      //    视觉上没有任何横向滚动。判据必须落在文档层面。
      overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth
    };
  })()`);
  console.log('\n== v0.11.0 新组件 ==');
  console.log(JSON.stringify(newInfo, null, 1));
  if (!newInfo.diary) { console.log('  ❌ 日记卡没渲染'); process.exitCode = 1; }
  if (!newInfo.quote || newInfo.quote.length < 10) { console.log('  ❌ 日记正文没拿到：' + newInfo.quote); process.exitCode = 1; }
  if (!newInfo.tag || newInfo.tag.indexOf('30 分钟') < 0) { console.log('  ❌ 专注标签不对：' + newInfo.tag); process.exitCode = 1; }
  if (!newInfo.more) { console.log('  ❌ 「翻翻以前」入口没渲染'); process.exitCode = 1; }
  if (!newInfo.coins || newInfo.coins !== '6') { console.log('  ❌ 小鱼干余额不对：' + newInfo.coins); process.exitCode = 1; }
  if (!newInfo.buy || newInfo.buy.indexOf('豪华大餐') < 0) { console.log('  ❌ 小卖部按钮不对：' + newInfo.buy); process.exitCode = 1; }
  if (newInfo.actCount !== 4) { console.log('  ❌ 互动按钮应为 4 个（喂/摸/呼唤/专注），实为 ' + newInfo.actCount); process.exitCode = 1; }
  if (!newInfo.focusBtn || newInfo.focusBtn.indexOf('专注') < 0) { console.log('  ❌ 专注按钮文案不对：' + newInfo.focusBtn); process.exitCode = 1; }
  if (newInfo.overflowX) { console.log('  ❌ 首页出现横向溢出'); process.exitCode = 1; }
  await ev(`(function(){ var d=document.querySelector('.ci-pet-diary'); if(!d) return false; d.scrollIntoView({block:'center'}); return true; })()`);
  await sleep(420);
  await shot('pethome-diary');

  // ---- 专注流程：开始 → 倒计时递减 → 提前收工只发一次请求 ----
  // 这几条是「点了没反应 / 计时器不停 / 结算重复提交」三类事故的守门人。
  await ev(`(function(){ var b=document.querySelector('.ci-pet-focusbtn'); if(b) b.click(); return !!b; })()`);
  await sleep(320);
  const pickCount = await ev(`document.querySelectorAll('.ci-pet-focuspick-btn').length`);
  console.log('\n== 专注流程 ==');
  console.log('时长选项数:', pickCount);
  if (pickCount !== 3) { console.log('  ❌ 专注时长应有 3 个选项，实为 ' + pickCount); process.exitCode = 1; }

  await ev(`(function(){ var b=document.querySelector('.ci-pet-focuspick-btn[data-focus-min="15"]'); if(b) b.click(); return !!b; })()`);
  await sleep(700);
  const label1 = await ev(`(document.querySelector('.ci-pet-focusbtn .ci-pet-bigbtn-label')||{}).textContent || ''`);
  await sleep(1600);
  const label2 = await ev(`(document.querySelector('.ci-pet-focusbtn .ci-pet-bigbtn-label')||{}).textContent || ''`);
  console.log('按钮文案:', JSON.stringify({ t1: label1, t2: label2 }));
  if (label1.indexOf('专注中') < 0) { console.log('  ❌ 开始后按钮没进入「专注中」：' + label1); process.exitCode = 1; }
  if (label1 === label2) { console.log('  ❌ 倒计时没走：两次读数一样（' + label1 + '）'); process.exitCode = 1; }

  await ev(`(function(){ var b=document.querySelector('.ci-pet-focusbtn'); if(b) b.click(); return !!b; })()`);
  await sleep(600);
  const fCall = await ev(`(function(){ var S=window.ClassIntraMarket; return { calls: S._focusCalls||0, body: S._focusLast||null }; })()`);
  console.log('结算请求:', JSON.stringify(fCall));
  if (fCall.calls !== 1) { console.log('  ❌ 提前收工应只发 1 次结算，实为 ' + fCall.calls); process.exitCode = 1; }
  if (!fCall.body || Number(fCall.body.minutes) !== 15) { console.log('  ❌ 结算参数 minutes 不对：' + JSON.stringify(fCall.body)); process.exitCode = 1; }
  if (fCall.body && fCall.body.done !== false) { console.log('  ❌ 提前收工不应标记 done=true'); process.exitCode = 1; }
  const backLabel = await ev(`(document.querySelector('.ci-pet-focusbtn .ci-pet-bigbtn-label')||{}).textContent || ''`);
  if (backLabel.indexOf('专注中') >= 0) { console.log('  ❌ 结算后按钮仍停在专注中：' + backLabel); process.exitCode = 1; }

  await ev(`(function(){ var r=document.querySelector('.ci-pethome'); if(r) r.scrollTop=0; return true; })()`);
  await sleep(220);

  // 进对战页
  await ev(`(function(){ var b=document.querySelector('.ci-pet-tab[data-tab="battle"]'); if(b) b.click(); return !!b; })()`);
  await sleep(900);

  console.log('\n== 页面元素自检 ==');
  const info = await ev(`(function(){
    var q = function(s){ return document.querySelector(s); };
    var primary = q('.ci-pet-bigbtn--primary');
    var bar = q('.ci-pet-statbar > span');
    return {
      hero: !!q('.ci-pet-hero'),
      stage: !!q('.ci-pet-hero-stage'),
      video: !!q('.ci-pet-hero-video'),
      stats: document.querySelectorAll('.ci-pet-statrow').length,
      statValue: (q('.ci-pet-statvalue')||{}).textContent,
      statFoot: (q('.ci-pet-statfoot')||{}).textContent,
      barWidth: bar ? bar.style.width : null,
      barFill: bar ? getComputedStyle(bar).backgroundColor : null,
      primaryBtn: primary ? (primary.textContent||'').replace(/\\s+/g,' ').trim() : null,
      primaryBg: primary ? getComputedStyle(primary).backgroundImage.slice(0, 60) : null,
      sections: document.querySelectorAll('.ci-pet-section').length,
      battleSubs: Array.prototype.map.call(document.querySelectorAll('.ci-pet-battle-sub'), function(e){ return e.textContent; }),
      battlePower: (q('.ci-pet-power-num')||{}).textContent,
      battleMeta: (q('.ci-pet-battle-record')||{}).textContent,
      defendLine: Array.prototype.map.call(document.querySelectorAll('.ci-pet-battle-quota'), function(e){ return e.textContent; }).join(' | '),
      inboxTitle: (q('.ci-pet-inbox-title')||{}).textContent,
      inboxLines: Array.prototype.map.call(document.querySelectorAll('.ci-pet-inbox-item'), function(e){ return e.textContent; }),
      inboxHit: Array.prototype.map.call(document.querySelectorAll('.ci-pet-inbox-hit'), function(b){ return b.textContent + (b.disabled?'(灰)':''); }),
      streakLine: (q('.ci-pet-battle-streak')||{}).textContent,
      oddsTags: Array.prototype.map.call(document.querySelectorAll('.ci-pet-odds'), function(e){ return e.textContent; }),
      shadowCards: Array.prototype.slice.call(document.querySelectorAll('.ci-pet-foe--shadow')).map(function(e){
        return e.querySelector('.ci-pet-foe-name').textContent + '/' + e.querySelector('.ci-pet-foe-owner').textContent;
      }),
      foeCards: document.querySelectorAll('.ci-pet-foe').length,
      foeBtns: Array.prototype.map.call(document.querySelectorAll('.ci-pet-foe-btn'), function(b){ return b.textContent; }),
      battleWeather: (q('.ci-pet-ops-weather') || {}).textContent,
      histRows: document.querySelectorAll('.ci-pet-hist-row').length,
      histFirst: (q('.ci-pet-hist-row') || {}).textContent,
      pageHeight: document.body.scrollHeight
    };
  })()`);
  console.log(JSON.stringify(info, null, 1));

  // v2.1：对战页改为竞技场制，天气/战报的断言移到「竞技场契约」章


  // 横向溢出自检：装饰性光晕/负边距很容易把宿主页面顶出水平滚动条
  const ovf = await ev(`(function(){
    var d = document.documentElement;
    return { scrollWidth: d.scrollWidth, clientWidth: d.clientWidth, overflowX: d.scrollWidth > d.clientWidth + 1 };
  })()`);
  console.log('横向溢出自检:', JSON.stringify(ovf));
  if (ovf.overflowX) { console.log('  ❌ 页面被撑宽了 ' + (ovf.scrollWidth - ovf.clientWidth) + 'px'); process.exitCode = 1; }
  else console.log('  ✅ 无横向滚动');

  // 纵向滚动自检：「宠物屋页面滑不动」是用户实报症状，必须真的滚得动。
  // 关键判据不是 overflow 的声明值，而是「滚了之后偏移量真的变了」。
  const scrollChk = await ev(`(function(){
    var el = document.querySelector('.ci-pethome');
    if (!el) return { err: 'no .ci-pethome' };
    var cs = getComputedStyle(el);
    var before = el.scrollTop;
    el.scrollTop = 99999;
    var selfAfter = el.scrollTop;
    el.scrollTop = before;
    var de = document.documentElement;
    var winBefore = window.scrollY;
    window.scrollTo(0, 99999);
    var winAfter = window.scrollY;
    window.scrollTo(0, winBefore);
    // 触摸能否滚动，除了 overflow 还取决于祖先链上的 touch-action
    var ta = '';
    for (var n = el; n && n !== document.documentElement; n = n.parentElement) {
      var t = getComputedStyle(n).touchAction;
      if (t && t !== 'auto' && t.indexOf('pan-y') < 0 && t.indexOf('manipulation') < 0) {
        ta = (n.id || n.className || n.tagName) + ':' + t;
        break;
      }
    }
    return {
      overflowY: cs.overflowY, overflowX: cs.overflowX, height: cs.height,
      scrollHeight: el.scrollHeight, clientHeight: el.clientHeight,
      needScroll: el.scrollHeight > el.clientHeight + 4 || de.scrollHeight > de.clientHeight + 4,
      selfAfter: Math.round(selfAfter),
      winAfter: Math.round(winAfter),
      docScrollHeight: de.scrollHeight, docClientHeight: de.clientHeight,
      touchActionBlocked: ta || ''
    };
  })()`);
  console.log('纵向滚动自检:', JSON.stringify(scrollChk));
  if (scrollChk.err) { console.log('  ❌ ' + scrollChk.err); process.exitCode = 1; }
  // ⚠️ 绝不能拿「scrollTop 能不能设」当判据：overflow:hidden 的元素照样能被程序化滚动
  //    （只是用户手势滚不动、下面内容看不见）。真正的判据是下面的手势实测。

  // 手势实测：headless 的 synthesizeScrollGesture(touch) 连纯长页面都滚不动
  // （对照实验 scripts/_gesture-control.mjs 已证），拿它当判据只会得到假阴性。
  // 这里用手势（mouse 源）打在内容区，验证「容器自身的滚动通道真的通」；
  // 触摸可行性另由祖先链的 touch-action 判定。
  let gestureScrolled = null;
  if (scrollChk.needScroll) {
    await ev(`(function(){ var el=document.querySelector('.ci-pethome'); if(el) el.scrollTop=0; window.scrollTo(0,0); return 1; })()`);
    await send('Input.synthesizeScrollGesture', {
      x: Math.round(W / 2), y: 520, xDistance: 0, yDistance: -340,
      speed: 900, gestureSourceType: 'mouse'
    }).catch(() => {});
    await sleep(600);
    gestureScrolled = await ev(`(function(){
      var el = document.querySelector('.ci-pethome');
      return { elScrollTop: el ? Math.round(el.scrollTop) : null, winScrollY: Math.round(window.scrollY) };
    })()`);
    const moved = (gestureScrolled.elScrollTop > 0) || (gestureScrolled.winScrollY > 0);
    console.log('滚动手势后:', JSON.stringify(gestureScrolled), moved ? '✅ 滚动通道可用' : '❌ 滚动被阻断');
    if (!moved) process.exitCode = 1;
    await ev(`(function(){ var el=document.querySelector('.ci-pethome'); if(el) el.scrollTop=0; window.scrollTo(0,0); return 1; })()`);
    await sleep(300);
  }
  if (scrollChk.touchActionBlocked) {
    console.log('  ❌ 祖先链 touch-action 阻断触摸滚动: ' + scrollChk.touchActionBlocked);
    process.exitCode = 1;
  } else {
    console.log('  ✅ 祖先链无 touch-action 阻断，触摸可滚');
  }

  // ---- 尺子有效性阴性对照 ----
  // 注入旧版错误（overflow 简写会把纵向一起关死），确认上面的判定真的能报出"滑不动"。
  // 只证明探针有检出能力，不计入最终失败。
  {
    await ev(`(function(){ var s=document.createElement('style'); s.id='__neg'; s.textContent='.ci-pethome{overflow:hidden !important}'; document.head.appendChild(s); return 1; })()`);
    await sleep(250);
    await ev(`(function(){ var el=document.querySelector('.ci-pethome'); if(el) el.scrollTop=0; window.scrollTo(0,0); return 1; })()`);
    await send('Input.synthesizeScrollGesture', {
      x: Math.round(W / 2), y: 520, xDistance: 0, yDistance: -340,
      speed: 900, gestureSourceType: 'mouse'
    }).catch(() => {});
    await sleep(600);
    const neg = await ev(`(function(){
      var el = document.querySelector('.ci-pethome');
      return {
        overflowY: getComputedStyle(el).overflowY,
        elScrollTop: el ? Math.round(el.scrollTop) : null,
        winScrollY: Math.round(window.scrollY)
      };
    })()`);
    const negMoved = (neg.elScrollTop > 0) || (neg.winScrollY > 0);
    console.log('阴性对照（注入 overflow:hidden）:', JSON.stringify(neg),
      !negMoved ? '✅ 探针能检出「手势滑不动」' : '❌ 探针抓不到该 bug，结论不可信');
    if (negMoved) process.exitCode = 1;
    await ev(`(function(){ var s=document.getElementById('__neg'); if(s) s.remove(); return 1; })()`);
    await sleep(250);
    await ev(`(function(){ var el=document.querySelector('.ci-pethome'); if(el) el.scrollTop=0; window.scrollTo(0,0); return 1; })()`);
  }

  // ---- 对战回放实测：真点一次「挑战」，验证血条推进 + 胜负横幅 + 回到列表 ----
  {
    await send('Emulation.setDeviceMetricsOverride', { width: W, height: 900, deviceScaleFactor: 1, mobile: false });
    await ev(`(function(){
      var btns = document.querySelectorAll('.ci-pet-cmdbtn');
      var opened = false;
      for (var i = 0; i < btns.length; i++) {
        if (btns[i].textContent.indexOf('对战') >= 0) { btns[i].click(); opened = true; break; }
      }
      return opened;

    })()`);
    await sleep(700);
    const mid = await ev(`(function(){
      var arena = document.querySelector('.ci-pet-arena');
      var hp = document.querySelectorAll('.ci-pet-hptext');
      return {
        arena: !!arena,
        hpMe: hp[0] ? hp[0].textContent : null,
        hpFoe: hp[1] ? hp[1].textContent : null,
        log: (document.querySelector('.ci-pet-arena-log') || {}).textContent
      };
    })()`);
    console.log('\n== 对战回放（打到一半）==');
    console.log(JSON.stringify(mid));
    if (!mid.arena) { console.log('  ❌ 点了挑战没有进入战斗舞台'); process.exitCode = 1; }

    await sleep(2400);
    const done = await ev(`(function(){
      var r = document.querySelector('.ci-pet-arena-result');
      return {
        banner: !!r,
        title: (document.querySelector('.ci-pet-result-title') || {}).textContent,
        sub: (document.querySelector('.ci-pet-result-sub') || {}).textContent,
        quota: (document.querySelector('.ci-pet-result-quota') || {}).textContent,
        share: (document.querySelector('.ci-pet-result-share') || {}).textContent,
        skipGone: !document.querySelector('.ci-pet-arena-skip') || document.querySelector('.ci-pet-arena-skip').style.display === 'none'
      };
    })()`);
    console.log('\n== 对战回放（打完了）==');
    console.log(JSON.stringify(done));
    if (!done.banner) { console.log('  ❌ 没有出现胜负横幅'); process.exitCode = 1; }
    if (!done.sub || done.sub.indexOf('积分') < 0) { console.log('  ❌ 横幅没写积分'); process.exitCode = 1; }
    if (!done.share || done.share.indexOf('留言') < 0) { console.log('  ❌ 打真人却没有「已留言」那一行'); process.exitCode = 1; }

    // 连胜提示：3 连胜（>1）才出现
    const streak = await ev(`(document.querySelector('.ci-pet-result-streak') || {}).textContent || ''`);
    console.log('结算连胜行:', JSON.stringify(streak));
    if (streak.indexOf('3 连胜') < 0) { console.log('  ❌ 结算横幅没显示 3 连胜'); process.exitCode = 1; }

    await ev(`(function(){ var r=document.querySelector('.ci-pet-arena-result'); if(r) r.scrollIntoView({block:'center'}); return 1; })()`);
    await sleep(300);
    await shot('pethome-battle');

    // 回到竞技场：结算后按「回到列表」应重渲竞技场
    const backOk = await ev(`(function(){
      var btns = document.querySelectorAll('.ci-pet-arena-result .ci-pet-foe-btn');
      if (btns[0]) btns[0].click();
      return btns.length;
    })()`);
    await sleep(900);
    const arenaBack = await ev(`(function(){
      return {
        scene: !!document.querySelector('.ci-pet-arena-scene'),
        plates: document.querySelectorAll('.ci-pet-hpplate').length,
        cmds: document.querySelectorAll('.ci-pet-cmdbtn').length,
        rec: (document.querySelector('.ci-pet-arena-rec') || {}).textContent || ''
      };
    })()`);
    console.log('回到竞技场:', JSON.stringify(arenaBack));
    if (!backOk) { console.log('  ❌ 没有「回到列表」按钮'); process.exitCode = 1; }
    if (!arenaBack.scene || arenaBack.plates !== 2 || arenaBack.cmds !== 4) { console.log('  ❌ 回到竞技场失败：' + JSON.stringify(arenaBack)); process.exitCode = 1; }

    // 荣誉抽屉：留言反击 / 知道了 → inbox/read 真的被调用
    await ev(`(function(){
      var btns = document.querySelectorAll('.ci-pet-cmdbtn');
      for (var i = 0; i < btns.length; i++) { if (btns[i].textContent.indexOf('荣誉') >= 0) { btns[i].click(); break; } }
      return 1;
    })()`);
    await sleep(500);
    const hitInfo = await ev(`(function(){
      var bs = document.querySelectorAll('.ci-pet-inbox-hit');
      return { n: bs.length, texts: Array.prototype.map.call(bs, function(b){ return b.textContent + (b.disabled ? '(灰)' : ''); }) };
    })()`);
    console.log('反击入口:', JSON.stringify(hitInfo));
    if (hitInfo.n < 1) { console.log('  ❌ 荣誉抽屉里没有「找他算账」'); process.exitCode = 1; }

    const cleared0 = await ev(`(function(){
      var b = document.querySelector('.ci-pet-inbox-clear');
      if (!b) return { btn: false };
      b.click();
      return { btn: true, after: !!document.querySelector('.ci-pet-inbox') };
    })()`);
    await sleep(500);
    const posted = await ev(`window.__inboxReadCalls || 0`);
    const cleared = Object.assign({}, cleared0, { posted: posted });
    console.log('清空留言:', JSON.stringify(cleared));
    if (!cleared.btn) { console.log('  ❌ 没有「知道了」按钮'); process.exitCode = 1; }
    if (cleared.after) { console.log('  ❌ 点完留言框还在'); process.exitCode = 1; }
    if (cleared.posted !== 1) { console.log('  ❌ 没有真的调用 inbox/read，call=' + cleared.posted); process.exitCode = 1; }

    // 对战抽屉契约：准备区（天气/属性/战术）+ 三标签 + 影子行
    await ev(`(function(){
      var btns = document.querySelectorAll('.ci-pet-cmdbtn');
      for (var i = 0; i < btns.length; i++) { if (btns[i].textContent.indexOf('对战') >= 0) { btns[i].click(); break; } }
      return 1;
    })()`);
    await sleep(500);
    const ext = await ev(`(function(){
      var q = function(s){ return document.querySelector(s); };
      var qa = function(s){ return Array.prototype.slice.call(document.querySelectorAll(s)); };
      return {
        sheet: !!q('.ci-pet-sheet'),
        weather: (q('.ci-pet-ops-weather') || {}).textContent || '',
        tacticCount: qa('.ci-pet-ops-tactic').length,
        tacticOn: (q('.ci-pet-ops-tactic.is-on') || {}).textContent,
        tabs: qa('.ci-pet-sheettab').length,
        shadowRows: qa('.ci-pet-sheetpane')[0] ? qa('.ci-pet-sheetpane')[0].querySelectorAll('.ci-pet-foe').length : 0
      };
    })()`);
    console.log('对战抽屉:', JSON.stringify(ext));
    if (!ext.sheet) { console.log('  ❌ 对战抽屉没打开'); process.exitCode = 1; }
    if (ext.weather.indexOf('微风') < 0) { console.log('  ❌ 准备区天气徽章没显示：' + ext.weather); process.exitCode = 1; }
    if (ext.tacticCount !== 3) { console.log('  ❌ 战术数量应为 3，实为 ' + ext.tacticCount); process.exitCode = 1; }
    if (!ext.tacticOn || ext.tacticOn.indexOf('稳守') < 0) { console.log('  ❌ 默认战术没高亮（应稳守）'); process.exitCode = 1; }
    if (ext.tabs !== 3) { console.log('  ❌ 对战抽屉应有 3 个标签，实为 ' + ext.tabs); process.exitCode = 1; }
    if (ext.shadowRows !== 2) { console.log('  ❌ 影子行应 2 行，实为 ' + ext.shadowRows); process.exitCode = 1; }

    // 练习赛标签：3 行 + 难度标签
    const sparrowTab = await ev(`(function(){
      var tabs = document.querySelectorAll('.ci-pet-sheettab');
      if (tabs[1]) tabs[1].click();
      var pane = document.querySelectorAll('.ci-pet-sheetpane')[1];
      return {
        rows: pane ? pane.querySelectorAll('.ci-pet-foe').length : 0,
        odds: pane ? pane.querySelectorAll('.ci-pet-odds').length : 0,
        oddsCls: pane ? Array.prototype.map.call(pane.querySelectorAll('.ci-pet-odds'), function(e){ return e.className.replace('ci-pet-odds ', ''); }) : []
      };
    })()`);
    console.log('练习赛标签:', JSON.stringify(sparrowTab));
    if (sparrowTab.rows !== 3) { console.log('  ❌ 练习赛应 3 行，实为 ' + sparrowTab.rows); process.exitCode = 1; }
    if (sparrowTab.odds !== 3 || !sparrowTab.oddsCls.every(function (c) { return c.indexOf('ci-pet-odds--') === 0; })) {
      console.log('  ❌ 练习赛难度标签不对：' + JSON.stringify(sparrowTab)); process.exitCode = 1;
    }

    // 试炼塔标签：进度格 / 下一层
    const tw = await ev(`(function(){
      var tabs = document.querySelectorAll('.ci-pet-sheettab');
      if (tabs[2]) tabs[2].click();
      var q = function(s){ return document.querySelector(s); };
      var qa = function(s){ return Array.prototype.slice.call(document.querySelectorAll(s)); };
      var nextCard = q('.ci-pet-tower-card');
      return {
        title: (q('.ci-pet-tower-title') || {}).textContent,
        pips: qa('.ci-pet-tower-pip').length,
        donePips: qa('.ci-pet-tower-pip.is-done').length,
        nextPip: (q('.ci-pet-tower-pip.is-next') || {}).textContent,
        nextName: nextCard ? nextCard.querySelector('.ci-pet-foe-name').textContent : null,
        nextMeta: nextCard ? nextCard.querySelector('.ci-pet-foe-meta').textContent : null,
        nextType: nextCard ? (nextCard.querySelector('.ci-pet-el') || {}).textContent : null
      };
    })()`);
    console.log('试炼塔标签:', JSON.stringify(tw));
    if (!tw.title || tw.title.indexOf('4 / 10') < 0) { console.log('  ❌ 塔进度不对：' + tw.title); process.exitCode = 1; }
    if (tw.pips !== 10) { console.log('  ❌ 应有 10 个进度格，实为 ' + tw.pips); process.exitCode = 1; }
    if (tw.donePips !== 4) { console.log('  ❌ 已通关格应为 4，实为 ' + tw.donePips); process.exitCode = 1; }
    if (tw.nextPip !== '5') { console.log('  ❌ 下一层高亮应是 5，实为 ' + tw.nextPip); process.exitCode = 1; }
    if (!tw.nextName || tw.nextName.indexOf('图书馆') < 0) { console.log('  ❌ 下一层名字不对：' + tw.nextName); process.exitCode = 1; }
    if (!tw.nextMeta || tw.nextMeta.indexOf('会 1 个技能') < 0) { console.log('  ❌ 没显示对手技能数：' + tw.nextMeta); process.exitCode = 1; }
    if (!tw.nextType || tw.nextType.indexOf('土') < 0) { console.log('  ❌ 塔层没显示土属性：' + tw.nextType); process.exitCode = 1; }

    // 战术切换（抽屉内）：高亮跟手 + 说明进 title
    const switched = await ev(`(function(){
      var list = document.querySelectorAll('.ci-pet-ops-tactic');
      if (!list[2]) return { ok: false };
      list[2].click();
      return {
        ok: true,
        on: (document.querySelector('.ci-pet-ops-tactic.is-on') || {}).textContent,
        hint: (document.querySelector('.ci-pet-ops-tactic.is-on') || {}).title
      };
    })()`);
    console.log('切换战术:', JSON.stringify(switched));
    if (!switched.on || switched.on.indexOf('灵巧') < 0) { console.log('  ❌ 点灵巧后高亮没换'); process.exitCode = 1; }
    if (!switched.hint || switched.hint.indexOf('速度') < 0) { console.log('  ❌ 说明没进 title：' + switched.hint); process.exitCode = 1; }

    // 备战 = 整页编辑器：目录 18 格 + 返回回竞技场
    await ev(`(function(){
      var btns = document.querySelectorAll('.ci-pet-cmdbtn');
      for (var i = 0; i < btns.length; i++) { if (btns[i].textContent.indexOf('备战') >= 0) { btns[i].click(); break; } }
      return 1;
    })()`);
    await sleep(700);
    const ed = await ev(`(function(){
      var qa = function(s){ return Array.prototype.slice.call(document.querySelectorAll(s)); };
      return {
        page: !!document.querySelector('.ci-pet-beditor'),
        cells: qa('.ci-pet-beditor-skill').length,
        on: qa('.ci-pet-beditor-skill.is-on').length,
        save: !!document.querySelector('.ci-pet-beditor-save')
      };
    })()`);
    console.log('备战编辑器:', JSON.stringify(ed));
    if (!ed.page || ed.cells !== 18) { console.log('  ❌ 编辑器没打开或目录不全：' + JSON.stringify(ed)); process.exitCode = 1; }
    if (!ed.save) { console.log('  ❌ 没有保存按钮'); process.exitCode = 1; }
    await ev(`(function(){ var b = document.querySelector('.ci-pet-beditor-back'); if (b) b.click(); return 1; })()`);
    await sleep(700);
    const backArena2 = await ev(`!!document.querySelector('.ci-pet-arena-scene')`);
    if (!backArena2) { console.log('  ❌ 编辑器返回后没回到竞技场'); process.exitCode = 1; }

    // 竞技场尺寸契约：场景要撑得起首屏
    const sizeChk = await ev(`(function(){
      var s = document.querySelector('.ci-pet-arena-scene');
      return s ? Math.round(s.getBoundingClientRect().height) : 0;
    })()`);
    console.log('竞技场场景高度:', sizeChk);
    if (!(sizeChk >= 330)) { console.log('  ❌ 竞技场场景太矮：' + sizeChk); process.exitCode = 1; }


    // v2.1：竞技场页不产生长滚动，HUD 贴顶断言由契约中的场景高度断言替代


    // ---- 切页必须回到顶部（v0.9.1）：滚到一半再点别的 tab ----
    await ev(`(function(){ var el=document.querySelector('.ci-pethome'); if(el) el.scrollTop = el.scrollHeight; return 1; })()`);
    await sleep(150);
    const scrolled = await ev(`(function(){ var el=document.querySelector('.ci-pethome'); return el ? Math.round(el.scrollTop) : -1; })()`);
    await ev(`(function(){ var b=document.querySelector('.ci-pet-tab[data-tab="rank"]'); if(b) b.click(); return 1; })()`);
    await sleep(320);
    const afterSwitch = await ev(`(function(){ var el=document.querySelector('.ci-pethome'); return el ? Math.round(el.scrollTop) : -1; })()`);
    console.log('\n== 切页回顶 ==');
    console.log(JSON.stringify({ scrolled: scrolled, afterSwitch: afterSwitch }));
    if (!(scrolled > 0)) { console.log('  （竞技场页无长滚动，切页回顶在该页免检）'); }
    if (afterSwitch !== 0) { console.log('  ❌ 切页后没回到顶部：scrollTop=' + afterSwitch); process.exitCode = 1; }

    // ---- 排行页：榜单 / 成就 / 称号全部搬到这里 ----
    await ev(`(function(){ var b=document.querySelector('.ci-pet-tab[data-tab="rank"]'); if(b) b.click(); return 1; })()`);
    await sleep(800);
    const rk = await ev(`(function(){
      var q = function(s){ return document.querySelector(s); };
      var qa = function(s){ return Array.prototype.slice.call(document.querySelectorAll(s)); };
      var on = q('.ci-pet-tab.is-on');
      return {
        tabOn: on ? on.getAttribute('data-tab') : null,
        me: (q('.ci-pet-rankme-num') || {}).textContent,
        meSub: (q('.ci-pet-rankme-sub') || {}).textContent,
        rankTitle: (q('.ci-pet-rank-title') || {}).textContent,
        rankRows: qa('.ci-pet-rank-item').length,
        rankMe: qa('.ci-pet-rank-item.is-me').length,
        achTitle: (q('.ci-pet-ach-title') || {}).textContent,
        achOwned: qa('.ci-pet-ach-chip.is-on').length,
        titles: qa('.ci-pet-title-chip').map(function(e){ return e.textContent; }),
        hudPower: (q('.ci-pet-hud-power') || {}).textContent,
        hudTypeCls: (q('.ci-pet-hud-type') || {}).className,
        battleOnRank: !!q('.ci-pet-battle')
      };
    })()`);
    console.log('\n== 排行页 ==');
    console.log(JSON.stringify(rk));
    if (rk.tabOn !== 'rank') { console.log('  ❌ 排行 tab 没亮：' + rk.tabOn); process.exitCode = 1; }
    if (!/⚔\uFE0F? \d+/.test(rk.hudPower || '')) { console.log('  ❌ HUD 战力还停在占位符：' + rk.hudPower); process.exitCode = 1; }
    if (!/ci-pet-el--/.test(rk.hudTypeCls || '')) { console.log('  ❌ HUD 属性胶囊没套上属性配色：' + rk.hudTypeCls); process.exitCode = 1; }
    if (!rk.me || rk.me.indexOf('第 2 名') < 0) { console.log('  ❌ 我的名次卡不对：' + rk.me); process.exitCode = 1; }
    if (!rk.meSub || rk.meSub.indexOf('积分 51') < 0) { console.log('  ❌ 我的积分不对：' + rk.meSub); process.exitCode = 1; }
    if (rk.rankRows !== 3) { console.log('  ❌ 榜单应 3 行，实为 ' + rk.rankRows); process.exitCode = 1; }
    if (rk.rankMe !== 1) { console.log('  ❌ 榜单里自己那行没高亮'); process.exitCode = 1; }
    if (!rk.achTitle || rk.achTitle.indexOf('2 / 5') < 0) { console.log('  ❌ 成就计数不对：' + rk.achTitle); process.exitCode = 1; }
    if (rk.achOwned !== 2) { console.log('  ❌ 已解锁成就应高亮 2 个，实为 ' + rk.achOwned); process.exitCode = 1; }
    if (rk.titles.length !== 3) { console.log('  ❌ 称号应有 3 个，实为 ' + rk.titles.length); process.exitCode = 1; }
    if (rk.battleOnRank) { console.log('  ❌ 排行页混进了对战内容'); process.exitCode = 1; }
    await shot('pethome-rank');

    // ---- 图鉴页：进化 / 属性 / 随行 / 收服 ----
    await ev(`(function(){ var b=document.querySelector('.ci-pet-tab[data-tab="dex"]'); if(b) b.click(); return 1; })()`);
    await sleep(800);
    const dx = await ev(`(function(){
      var q = function(s){ return document.querySelector(s); };
      var qa = function(s){ return Array.prototype.slice.call(document.querySelectorAll(s)); };
      var on = q('.ci-pet-tab.is-on');
      var typeOn = q('.ci-pet-type.is-on');
      return {
        tabOn: on ? on.getAttribute('data-tab') : null,
        evoName: (q('.ci-pet-evo-name') || {}).textContent,
        evoSub: (q('.ci-pet-evo-sub') || {}).textContent,
        types: qa('.ci-pet-type').map(function(e){ return e.getAttribute('data-type'); }),
        typeOn: typeOn ? typeOn.getAttribute('data-type') : null,
        typeNote: (q('.ci-pet-types-note') || {}).textContent,
        buddy: (q('.ci-pet-buddy-name') || {}).textContent,
        buddySub: (q('.ci-pet-buddy-sub') || {}).textContent,
        dexTitle: (q('.ci-pet-dex-title') || {}).textContent,
        dexTypes: qa('.ci-pet-dex-type').length,
        wildCards: qa('.ci-pet-wild').length,
        ownedCards: qa('.ci-pet-wild.is-owned').length,
        spotCards: qa('.ci-pet-wild.is-spot').length,
        ownedTags: qa('.ci-pet-wild-owned').length,
        chanceTexts: qa('.ci-pet-wild-chance').map(function(e){ return e.textContent; }),
        buddyBtns: qa('.ci-pet-wild.is-owned .ci-pet-foe-btn').map(function(b){ return b.textContent + (b.disabled ? '(灰)' : ''); }),
        challengeBtns: qa('.ci-pet-wild:not(.is-owned) .ci-pet-foe-btn').length,
        spotBonus: (q('.ci-pet-wild-spot-bonus') || {}).textContent,
        badge: (q('.ci-pet-tab[data-tab="dex"] .ci-pet-tab-badge') || {}).textContent
      };
    })()`);
    console.log('\n== 图鉴页 ==');
    console.log(JSON.stringify(dx));
    if (dx.tabOn !== 'dex') { console.log('  ❌ 图鉴 tab 没亮：' + dx.tabOn); process.exitCode = 1; }
    if (!dx.evoName || dx.evoName.indexOf('成长期') < 0 || dx.evoName.indexOf('2') < 0) { console.log('  ❌ 进化卡不对：' + dx.evoName); process.exitCode = 1; }
    if (!dx.evoSub || dx.evoSub.indexOf('再 +42') < 0) { console.log('  ❌ 进化进度文案不对：' + dx.evoSub); process.exitCode = 1; }
    if (dx.types.join(',') !== 'fire,grass,earth,electric,water') { console.log('  ❌ 属性按钮不对：' + dx.types.join(',')); process.exitCode = 1; }
    if (dx.typeOn !== 'grass') { console.log('  ❌ 本命没高亮草：' + dx.typeOn); process.exitCode = 1; }
    if (!dx.typeNote || dx.typeNote.indexOf('克制') < 0) { console.log('  ❌ 属性说明不对：' + dx.typeNote); process.exitCode = 1; }
    if (!dx.buddy || dx.buddy.indexOf('草团子') < 0) { console.log('  ❌ 随行卡不对：' + dx.buddy); process.exitCode = 1; }
    if (!dx.buddySub || dx.buddySub.indexOf('+2 防') < 0) { console.log('  ❌ 随行加成没写出来：' + dx.buddySub); process.exitCode = 1; }
    if (dx.dexTitle !== '图鉴 2 / 6') { console.log('  ❌ 图鉴计数不对：' + dx.dexTitle); process.exitCode = 1; }
    if (dx.dexTypes !== 5) { console.log('  ❌ 属性进度应有 5 个，实为 ' + dx.dexTypes); process.exitCode = 1; }
    if (dx.wildCards !== 6) { console.log('  ❌ 野生精灵应 6 张，实为 ' + dx.wildCards); process.exitCode = 1; }
    if (dx.ownedCards !== 2 || dx.ownedTags !== 2) { console.log('  ❌ 已收服标记不对：card=' + dx.ownedCards + ' tag=' + dx.ownedTags); process.exitCode = 1; }
    if (dx.spotCards !== 1) { console.log('  ❌ 今日焦点高亮应 1 张，实为 ' + dx.spotCards); process.exitCode = 1; }
    if (!dx.spotBonus || dx.spotBonus.indexOf('+10%') < 0) { console.log('  ❌ 焦点加成没写出来：' + dx.spotBonus); process.exitCode = 1; }
    if (!dx.chanceTexts.some(function(t){ return t.indexOf('收服率 62%') >= 0; })) { console.log('  ❌ 常见精灵没显示 62% 收服率：' + dx.chanceTexts.join(' | ')); process.exitCode = 1; }
    if (!dx.chanceTexts.some(function(t){ return t.indexOf('已失败 1 次') >= 0; })) { console.log('  ❌ 失败次数没显示：' + dx.chanceTexts.join(' | ')); process.exitCode = 1; }
    if (dx.buddyBtns.length !== 2) { console.log('  ❌ 已收服的应各有 1 个随行按钮，实为 ' + dx.buddyBtns.length); process.exitCode = 1; }
    if (dx.buddyBtns[0].indexOf('随行中(灰)') < 0) { console.log('  ❌ 当前随行没标成「随行中(灰)」：' + dx.buddyBtns[0]); process.exitCode = 1; }
    if (dx.challengeBtns !== 4) { console.log('  ❌ 未收服的应各有 1 个挑战按钮，实为 ' + dx.challengeBtns); process.exitCode = 1; }
    if (!dx.badge) { console.log('  ❌ 图鉴 tab 没有未收集角标'); process.exitCode = 1; }
    await shot('pethome-dex');

    // 换本命属性：点「火」，说明跟上，且真的发了 /battle/type
    const typeSwitch = await ev(`(function(){
      var b = document.querySelector('.ci-pet-type[data-type="fire"]');
      if (b) b.click();
      return !!b;
    })()`);
    await sleep(600);
    const typeAfter = await ev(`(function(){
      var on = document.querySelector('.ci-pet-type.is-on');
      return {
        on: on ? on.getAttribute('data-type') : null,
        note: (document.querySelector('.ci-pet-types-note') || {}).textContent,
        posted: window.__typePosts || 0
      };
    })()`);
    console.log('切换本命:', JSON.stringify(typeAfter));
    if (!typeSwitch) { console.log('  ❌ 没有火属性按钮'); process.exitCode = 1; }
    if (typeAfter.on !== 'fire') { console.log('  ❌ 点完火之后没高亮：' + typeAfter.on); process.exitCode = 1; }
    if (!typeAfter.note || typeAfter.note.indexOf('草') < 0) { console.log('  ❌ 属性说明没更新：' + typeAfter.note); process.exitCode = 1; }
    if (typeAfter.posted < 1) { console.log('  ❌ 没发出 /battle/type'); process.exitCode = 1; }

    // 收服：点未收服的火苗狸挑战 → 战报里应有「效果拔群 / 效果一般」→ 结算写收服成功
    await ev(`(function(){
      var b = document.querySelector('.ci-pet-wild:not(.is-owned) .ci-pet-foe-btn');
      if (b) { b.scrollIntoView({block:'center'}); b.click(); }
      return !!b;
    })()`);
    await sleep(2600);
    const wildDone = await ev(`(function(){
      var r = document.querySelector('.ci-pet-arena-result');
      var log = (document.querySelector('.ci-pet-arena-log') || {}).textContent || '';
      return {
        arena: !!document.querySelector('.ci-pet-arena'),
        banner: !!r,
        title: (document.querySelector('.ci-pet-result-title') || {}).textContent,
        sub: (document.querySelector('.ci-pet-result-sub') || {}).textContent,
        quota: (document.querySelector('.ci-pet-result-quota') || {}).textContent,
        skipGone: !document.querySelector('.ci-pet-arena-skip') || document.querySelector('.ci-pet-arena-skip').style.display === 'none'
      };
    })()`);
    console.log('\n== 收服结算 ==');
    console.log(JSON.stringify(wildDone));
    if (!wildDone.arena) { console.log('  ❌ 点挑战没进战斗舞台'); process.exitCode = 1; }
    if (!wildDone.banner) { console.log('  ❌ 没有收服结算横幅'); process.exitCode = 1; }
    if (!wildDone.title || wildDone.title.indexOf('收服成功') < 0) { console.log('  ❌ 结算标题不对：' + wildDone.title); process.exitCode = 1; }
    if (!wildDone.sub || wildDone.sub.indexOf('3 / 6') < 0) { console.log('  ❌ 结算没报图鉴进度：' + wildDone.sub); process.exitCode = 1; }
    if (!wildDone.quota || wildDone.quota.indexOf('不消耗练习赛次数') < 0) { console.log('  ❌ 结算没说明收服不占次数：' + wildDone.quota); process.exitCode = 1; }
    if (!wildDone.skipGone) { console.log('  ❌ 结算后「跳过动画」没消失'); process.exitCode = 1; }
    await shot('pethome-wild');

    // 收服完回到图鉴：应该重新取档案并渲染列表
    await ev(`(function(){ var b=document.querySelector('.ci-pet-arena-result .ci-pet-foe-btn'); if(b) b.click(); return !!b; })()`);
    await sleep(900);
    const dexBack = await ev(`(function(){
      var q = function(s){ return document.querySelector(s); };
      return {
        title: (q('.ci-pet-dex-title') || {}).textContent,
        wildCards: document.querySelectorAll('.ci-pet-wild').length,
        arena: !!q('.ci-pet-arena')
      };
    })()`);
    console.log('收服后回到图鉴:', JSON.stringify(dexBack));
    if (dexBack.title !== '图鉴 3 / 6') { console.log('  ❌ 回图鉴后计数错了：' + dexBack.title); process.exitCode = 1; }
    if (dexBack.wildCards !== 6) { console.log('  ❌ 回图鉴后列表没重画：' + dexBack.wildCards); process.exitCode = 1; }
    if (dexBack.arena) { console.log('  ❌ 回图鉴后战斗舞台没清掉'); process.exitCode = 1; }

    // 回到对战页，后面的截图与收尾断言仍按旧流程走
    await ev(`(function(){ var b=document.querySelector('.ci-pet-tab[data-tab="battle"]'); if(b) b.click(); return 1; })()`);
    await sleep(800);
  }

  // 按内容真实高度截图，避免视口高于内容造成"底部大片空白"的假象
  const pageH = await ev(`Math.max(document.body.scrollHeight, document.documentElement.scrollHeight)`);
  console.log('内容真实高度:', pageH);
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: Math.min(pageH + 8, 4000), deviceScaleFactor: 1, mobile: false });
  await sleep(700);
  await shot('pethome-full');
  // 再截一张只到 hero+stats 的上半部
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: 620, deviceScaleFactor: 1, mobile: false });
  await sleep(600);
  await shot('pethome-hero');
  // 滚到底再截一张：成就 / 榜单在这一屏
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: 900, deviceScaleFactor: 1, mobile: false });
  await ev(`(function(){ var el=document.querySelector('.ci-pethome'); if(el) el.scrollTop=el.scrollHeight; return 1; })()`);
  await sleep(600);
  await shot('pethome-bottom');
  // 塔单独截一张（它在页面中段，容易被上下两张图挤掉）
  await ev(`(function(){ var el=document.querySelector('.ci-pet-tower'); if(el) el.scrollIntoView({block:'center'}); return 1; })()`);
  await sleep(500);
  await shot('pethome-tower');

  console.log('\n== 页面异常 ==');
  if (!ERRORS.length) console.log('  ✅ 无任何 JS 异常');
  else ERRORS.slice(0, 10).forEach((e) => console.log('  ❌ ' + e));
  if (ERRORS.length) process.exitCode = 1;
} catch (e) {
  console.error('✗ 截图探针异常:', e.message);
  process.exitCode = 1;
} finally {
  try { ws.close(); } catch {}
  try { chrome.kill(); } catch {}
}
