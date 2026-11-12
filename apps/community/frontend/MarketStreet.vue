<template>
  <div class="market-street">
    <!-- ══════════ 牌楼：集市的第一眼 ══════════ -->
    <header class="ms-gate">
      <div class="ms-gate-eave"></div>
      <button class="ms-refresh" type="button" @click="load" :disabled="loading">
        <i class="fa-solid fa-rotate-right"></i>
      </button>
      <div class="ms-gate-inner">
        <div class="ms-gate-title-row">
          <span class="ms-lamp"></span>
          <h2 class="ms-title">班级集市</h2>
          <span class="ms-lamp"></span>
        </div>
        <div class="ms-cry">{{ cryText }}</div>
        <div class="ms-gate-stats">
          <div class="ms-stat"><b>{{ goods.length }}</b><em>在售</em></div>
          <div class="ms-stat"><b>{{ peerStalls.length }}</b><em>同学摊</em></div>
          <div class="ms-stat"><b>{{ myGoods.length }}</b><em>我的货</em></div>
        </div>
      </div>
    </header>

    <!-- 错误态：拉不到 ≠ 没有 -->
    <div v-if="loadError" class="ms-state error">
      <div class="ms-state-icon">🌧</div>
      <div class="ms-state-title">集市没开成门</div>
      <div class="ms-state-sub">{{ loadError }}</div>
      <button class="ms-btn primary" type="button" @click="load">再敲一次门</button>
    </div>
    <div v-else-if="loading" class="ms-state">
      <div class="ms-state-icon">🎐</div>
      <div class="ms-state-title">正在开市…</div>
    </div>

    <div v-else class="ms-body">
      <!-- ══════════ 官铺 ══════════ -->
      <section class="ms-block">
        <div class="ms-head">
          <span class="ms-head-icon official"><i class="fa-solid fa-building-columns"></i></span>
          <div class="ms-head-txt">
            <b>官铺</b>
            <em>班管上架，只能用充值学元兑换</em>
          </div>
          <span class="ms-count">{{ official.length }}</span>
        </div>
        <div v-if="!official.length" class="ms-none">
          <span class="ms-none-mark">今日无货</span>
          <span class="ms-none-tip">官铺由班管上架，通常在有活动或兑换品时开张</span>
        </div>
        <div v-else class="ms-grid">
          <button
            v-for="g in official" :key="'o' + g.id"
            class="ms-stall official" type="button" @click="openBuy(g)"
          >
            <span class="ms-awning official"></span>
            <span v-if="g.cover" class="ms-cover">{{ g.cover }}</span>
            <span class="ms-stall-body">
              <span class="ms-stall-name">{{ g.name }}</span>
              <span v-if="g.description" class="ms-desc">{{ g.description }}</span>
              <span class="ms-stall-meta">
                <span class="ms-tag">{{ kindLabel(g.kind) }}</span>
                <span class="ms-stock">{{ stockLabel(g) }}</span>
                <span class="ms-badge-off">官方</span>
              </span>
            </span>
            <span class="ms-price-tag"><b>{{ money(g.price_cent) }}</b><i>学元</i></span>
          </button>
        </div>
      </section>

      <!-- ══════════ 同学摊位 ══════════ -->
      <section class="ms-block">
        <div class="ms-head">
          <span class="ms-head-icon peer"><i class="fa-solid fa-store"></i></span>
          <div class="ms-head-txt">
            <b>同学摊位</b>
            <em>大家自己摆的摊，货款直接进卖家钱包</em>
          </div>
          <span class="ms-count">{{ peerStalls.length }}</span>
        </div>
        <button v-if="!peerStalls.length" class="ms-vacant" type="button" @click="focusStand">
          <span class="ms-vacant-awning"></span>
          <span class="ms-vacant-mark">招 租</span>
          <span class="ms-vacant-tip">这条街还空着<br>你来开第一摊</span>
          <span class="ms-vacant-cta">去摆摊 ↓</span>
        </button>
        <div v-else class="ms-grid">
          <button
            v-for="g in peerStalls" :key="'p' + g.id"
            class="ms-stall peer" type="button" @click="openBuy(g)"
          >
            <span class="ms-awning"></span>
            <span v-if="g.cover" class="ms-cover">{{ g.cover }}</span>
            <span class="ms-stall-body">
              <span class="ms-stall-name">{{ g.name }}</span>
              <span v-if="g.description" class="ms-desc">{{ g.description }}</span>
              <span class="ms-stall-meta">
                <span class="ms-tag">{{ kindLabel(g.kind) }}</span>
                <span class="ms-stock">{{ stockLabel(g) }}</span>
                <span class="ms-seller">
                  <i class="ms-dot" :style="{ background: avatarBg(stallName(g)) }">{{ firstChar(stallName(g)) }}</i>
                  {{ stallName(g) }}
                </span>
              </span>
            </span>
            <span class="ms-price-tag"><b>{{ money(g.price_cent) }}</b><i>学元</i></span>
          </button>
        </div>
      </section>

      <!-- ══════════ 我的摊位 ══════════ -->
      <section class="ms-block">
        <div class="ms-head">
          <span class="ms-head-icon mine"><i class="fa-solid fa-basket-shopping"></i></span>
          <div class="ms-head-txt">
            <b>我的摊位</b>
            <em>摆一件东西，等同学来逛</em>
          </div>
        </div>

        <div class="ms-stand" ref="stand">
          <input
            v-model.trim="form.name" class="ms-name-input" type="text"
            maxlength="20" placeholder="摊上卖什么？例如：手绘贴纸"
            @keyup.enter="createSale"
          />
          <input
            v-model.trim="form.description" class="ms-name-input ms-desc-input" type="text"
            maxlength="80" placeholder="一句话说明：颜色、尺寸、取货方式（可选）"
          />
          <div class="ms-stand-row">
            <label class="ms-field cover">
              <input v-model.trim="form.cover" type="text" maxlength="2" placeholder="封面 emoji（可选）" />
            </label>
            <label class="ms-field stock">
              <input v-model="form.stock" type="number" min="0" step="1" placeholder="库存（空=不限量）" />
              <em>件</em>
            </label>
          </div>
          <div class="ms-stand-row">
            <label class="ms-field price">
              <i>¥</i>
              <input v-model="form.price" type="number" min="0" step="0.01" placeholder="售价" />
              <em>学元</em>
            </label>
            <label class="ms-field select">
              <select v-model="form.kind">
                <option value="digital">数字商品</option>
                <option value="physical">实物</option>
                <option value="service">服务</option>
              </select>
            </label>
            <button
              class="ms-btn primary grow-btn" type="button"
              :disabled="form.busy || !form.name || !(Number(form.price) > 0)"
              @click="createSale"
            >{{ form.busy ? '摆摊中…' : '开张摆上' }}</button>
          </div>
          <p class="ms-stand-tip">可设库存（留空=不限量）；同学付款后钱先托管，交付/确认收货后才进你钱包。</p>
        </div>

        <div v-if="myGoods.length" class="ms-paper">
          <div class="ms-paper-head">我摆着的<em>{{ myGoods.length }}</em></div>
          <div v-for="g in myGoods" :key="'m' + g.id" class="ms-line">
            <span class="ms-line-name">{{ g.name }}</span>
            <span class="ms-line-price">{{ money(g.price_cent) }}</span>
            <span class="ms-chip" :class="g.status === 'on_shelf' ? 'on' : 'off'">
              {{ g.status === 'on_shelf' ? '在售' : '已收摊' }}
            </span>
            <button v-if="g.status === 'on_shelf'" class="ms-mini-btn" type="button" @click="offShelf(g)">收摊</button>
          </div>
        </div>

        <div v-if="sales.length" class="ms-paper">
          <div class="ms-paper-head">同学下的单<em>{{ sales.length }}</em></div>
          <div v-for="o in sales" :key="'s' + o.id" class="ms-line">
            <span class="ms-line-name">{{ o.goods_name || ('订单 #' + o.id) }}</span>
            <span class="ms-line-qty">× {{ o.qty || 1 }}</span>
            <span v-if="o.note" class="ms-line-note">{{ o.note }}</span>
            <span class="ms-line-price">{{ money(o.face_cent) }}</span>
            <span class="ms-chip" :class="statusClass(o.status)">{{ statusLabel(o.status) }}</span>
            <button v-if="o.status === 'paid'" class="ms-mini-btn hot" type="button" @click="sellerAct(o, 'fulfill')">已交付</button>
            <button v-else-if="o.status === 'fulfilled'" class="ms-mini-btn hot" type="button" @click="sellerAct(o, 'settle')">收钱</button>
            <button v-else-if="o.status === 'refunding'" class="ms-mini-btn" type="button" @click="sellerAct(o, 'refund')">同意退款</button>
          </div>
        </div>
      </section>

      <!-- ══════════ 我的买单 ══════════ -->
      <section class="ms-block">
        <div class="ms-head">
          <span class="ms-head-icon bill"><i class="fa-solid fa-receipt"></i></span>
          <div class="ms-head-txt">
            <b>我的买单</b>
            <em>买过的东西都记在这张纸条上</em>
          </div>
          <span v-if="myOrders.length" class="ms-count">{{ myOrders.length }}</span>
        </div>
        <div v-if="!myOrders.length" class="ms-none slim">
          <span class="ms-none-tip">还没买过东西，逛逛上面的摊吧</span>
        </div>
        <div v-else class="ms-paper flat">
          <div v-for="o in myOrders" :key="'b' + o.id" class="ms-line">
            <span class="ms-line-name">{{ o.goods_name || ('订单 #' + o.id) }}</span>
            <span class="ms-line-qty">× {{ o.qty || 1 }}</span>
            <span v-if="o.note" class="ms-line-note">{{ o.note }}</span>
            <span class="ms-line-price">{{ money(o.face_cent) }}</span>
            <span class="ms-chip" :class="statusClass(o.status)">{{ statusLabel(o.status) }}</span>
            <button
              v-if="o.status === 'fulfilled'"
              class="ms-mini-btn hot" type="button" @click="buyerConfirm(o)"
            >确认收货</button>
            <button
              v-if="o.status === 'paid' || o.status === 'fulfilled'"
              class="ms-mini-btn" type="button" @click="askRefund(o)"
            >申请退款</button>
          </div>
        </div>
      </section>
    </div>

    <!-- ══════════ 柜台：报价与结账 ══════════ -->
    <div v-if="quote" class="ms-counter-mask" @click.self="closeBuy">
      <div class="ms-counter">
        <div class="ms-counter-head">
          <span>🧮 柜台结账</span>
          <button class="ms-x" type="button" @click="closeBuy">✕</button>
        </div>
        <div class="ms-counter-name">{{ quote.name }}</div>
        <p v-if="quote.description" class="ms-counter-desc">{{ quote.description }}</p>
        <div class="ms-counter-row">
          <span>单价</span>
          <b>{{ money(quote.unit_price_cent) }} <i>学元</i> × {{ quote.qty }}</b>
        </div>
        <div class="ms-counter-row">
          <span>库存</span>
          <b :class="quote.stock_qty === 0 ? 'no' : ''">{{ quote.stock_qty < 0 ? '不限量' : ('剩 ' + quote.stock_qty + ' 件') }}</b>
        </div>
        <div class="ms-counter-row">
          <span>数量</span>
          <span class="ms-qty">
            <button type="button" class="ms-qty-btn" @click="changeQty(-1)">−</button>
            <b>{{ quote.qty }}</b>
            <button type="button" class="ms-qty-btn" @click="changeQty(1)">+</button>
          </span>
        </div>
        <div class="ms-counter-row">
          <span>合计</span>
          <b>{{ money(quote.face_cent) }} <i>学元</i></b>
        </div>
        <input
          v-model.trim="buyNote" class="ms-note-input" type="text" maxlength="80"
          placeholder="给卖家留言：取货地点/时间（可选）"
        />
        <div class="ms-counter-row">
          <span>我的充值学元</span>
          <b :class="quote.enough ? '' : 'no'">{{ money(quote.balance_cash_cent) }}</b>
        </div>
        <p class="ms-counter-tip">只能用自己充值的学元买东西；赠送学元、炒股赚的买不了，但可以转账、发红包。</p>
        <p v-if="!quote.enough" class="ms-counter-tip no">还差 {{ money(quote.short_cent) }} 学元，找班管充值后再来。</p>
        <div class="ms-counter-actions">
          <button class="ms-btn" type="button" @click="closeBuy">再看看</button>
          <button class="ms-btn primary" type="button" :disabled="busy || !quote.enough || quote.stock_qty === 0" @click="confirmBuy">
            {{ busy ? '结账中…' : (quote.stock_qty === 0 ? '已售罄' : (quote.enough ? '付钱拿下' : '余额不足')) }}
          </button>
        </div>
      </div>
    </div>

    <transition name="ms-fade">
      <div v-if="toastText" class="ms-toast">{{ toastText }}</div>
    </transition>
  </div>
</template>

<script>
// 班级集市（社区里的新街）
// ------------------------------------------------------------
// 为什么独立成文件：社区 Community.vue 已有 4600+ 行，再塞一个集市会变成迷宫。
// 这里自包含：拉货 / 摆摊 / 结账 / 卖家收钱 / 退款，全走 /xy/* 现成接口，
// 与钱包小铺共用同一套账本，绝不开第二本账。
// Chrome 80 基线：var / function、不用 flex gap、不用 :is()、不用 aspect-ratio。
import api from '@/utils/api';

var CRIES = [
  '新鲜上架，走过路过别错过～',
  '同学自己摆的摊，逛一逛再走',
  '只能用自己充值的学元买哦',
  '买卖公平，货款直接进卖家钱包',
  '收摊下架随时来，钱一分不卡'
];

var STATUS = {
  created: '待支付', paid: '已支付', fulfilled: '待收货', done: '已完成',
  closed: '已关闭', refunding: '退款中', refunded: '已退款', disputed: '争议中'
};

export default {
  name: 'MarketStreet',
  data: function () {
    return {
      loading: true,
      loadError: '',
      goods: [], myGoods: [], myOrders: [], sales: [],
      form: {
        name: '', price: '', kind: 'digital',
        description: '', cover: '', stock: '', busy: false
      },
      quote: null, buyNote: '', busy: false, toastText: '', cryIndex: 0
    };
  },
  computed: {
    official: function () {
      return this.goods.filter(function (g) { return g.seller_kind !== 'user' && g.status === 'on_shelf'; });
    },
    peerStalls: function () {
      return this.goods.filter(function (g) { return g.seller_kind === 'user' && g.status === 'on_shelf'; });
    },
    cryText: function () {
      var g = this.peerStalls[0] || this.official[0];
      return g ? ('「' + g.name + '」刚摆上摊 · ' + CRIES[this.cryIndex]) : CRIES[this.cryIndex];
    }
  },
  mounted: function () {
    var self = this;
    self.load();
    self._cryTimer = setInterval(function () {
      self.cryIndex = (self.cryIndex + 1) % CRIES.length;
    }, 6000);
  },
  beforeDestroy: function () {
    if (this._cryTimer) clearInterval(this._cryTimer);
    if (this._toastTimer) clearTimeout(this._toastTimer);
  },
  methods: {
    money: function (cent) {
      var n = (Number(cent) || 0) / 100;
      return n % 1 === 0 ? String(n) : n.toFixed(2);
    },
    kindLabel: function (k) {
      if (k === 'physical') return '实物';
      if (k === 'service') return '服务';
      return '数字';
    },
    stockLabel: function (g) {
      var n = Number(g.stock_qty);
      if (!isFinite(n) || n < 0) return '不限量';
      if (n === 0) return '已售罄';
      return '剩 ' + n + ' 件';
    },
    statusLabel: function (s) { return STATUS[s] || s; },
    statusClass: function (s) {
      if (s === 'done') return 'done';
      if (s === 'refunding') return 'refund';
      if (s === 'paid' || s === 'fulfilled') return 'on';
      return 'off';
    },
    stallName: function (g) {
      if (g.seller_name) return String(g.seller_name);
      var id = String(g.seller_owner || '');
      return id.length > 4 ? '…' + id.slice(-4) : id;
    },
    firstChar: function (name) {
      var s = String(name || '?').replace(/^…/, '');
      return s ? s.charAt(0) : '?';
    },
    // 摊位小头像：按名字散列取色，每条街都不一样，不用记学号也认得出人
    avatarBg: function (name) {
      var s = String(name || '?');
      var h = 0;
      for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
      return 'hsl(' + h + ', 48%, 46%)';
    },
    toast: function (msg) {
      var self = this;
      self.toastText = msg;
      if (self._toastTimer) clearTimeout(self._toastTimer);
      self._toastTimer = setTimeout(function () { self.toastText = ''; }, 2600);
    },
    errMsg: function (e, fallback) {
      var b = e && e.response && e.response.data;
      return (b && b.message) || (e && e.message) || fallback;
    },
    me: function () {
      var s = this.$store && this.$store.state && this.$store.state.auth;
      return (s && s.user && s.user.user_id) ? String(s.user.user_id) : '';
    },
    load: function () {
      var self = this;
      var me = self.me();
      self.loading = true;
      self.loadError = '';
      return Promise.all([
        api.get('/xy/goods', { params: { limit: 100 } }),
        api.get('/xy/orders', { params: { limit: 20 } }),
        me ? api.get('/xy/goods', { params: { seller: me, limit: 50 } }).catch(function () { return null; }) : Promise.resolve(null),
        me ? api.get('/xy/orders', { params: { seller: me, status: 'paid,fulfilled,refunding', limit: 30 } }).catch(function () { return null; }) : Promise.resolve(null)
      ]).then(function (rs) {
        self.goods = self.dataOf(rs[0]);
        self.myOrders = self.dataOf(rs[1]);
        self.myGoods = self.dataOf(rs[2]);
        self.sales = self.dataOf(rs[3]);
        self.loading = false;
      }).catch(function (err) {
        self.loading = false;
        self.loadError = self.errMsg(err, '商品和订单没拉到');
        // 拉不到 ≠ 没有：保留已有数据，只显示错误条，绝不渲染「街上空空的」
        self.toast(self.loadError);
      });
    },
    dataOf: function (r) {
      if (!r) return [];
      var d = (r.data && r.data.data) || [];
      return Array.isArray(d) ? d : (d.list || []);
    },
    // ---- 买家 ----
    openBuy: function (g) {
      var self = this;
      self.buyNote = '';
      return self.fetchQuote(g.id, 1).then(function () {
        if (self.quote && self.quote.stock_qty === 0) self.toast('这件已经售罄了');
      });
    },
    fetchQuote: function (goodsId, qty) {
      var self = this;
      return api.get('/xy/orders/quote', { params: { goods_id: goodsId, qty: qty } })
        .then(function (res) { self.quote = (res.data && res.data.data) || null; })
        .catch(function (err) { self.toast(self.errMsg(err, '柜台没算成这笔账')); });
    },
    changeQty: function (delta) {
      var self = this;
      if (!self.quote) return;
      var next = Number(self.quote.qty) + delta;
      if (next < 1) next = 1;
      if (self.quote.stock_qty >= 0 && next > self.quote.stock_qty) next = self.quote.stock_qty;
      if (next < 1 || next === self.quote.qty) return;
      self.fetchQuote(self.quote.goods_id, next);
    },
    closeBuy: function () { this.quote = null; },
    // 空摊位的「去摆摊」：滚到登记台并把光标放进去，少点一次
    focusStand: function () {
      var el = this.$refs.stand;
      if (!el) return;
      if (el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      var input = el.querySelector ? el.querySelector('.ms-name-input') : null;
      if (input && input.focus) setTimeout(function () { input.focus(); }, 220);
    },
    confirmBuy: function () {
      var self = this;
      if (!self.quote || self.busy) return;
      self.busy = true;
      var rid = 'market:' + Date.now() + ':' + Math.random().toString(36).slice(2, 8);
      api.post('/xy/orders', {
        goods_id: self.quote.goods_id,
        qty: self.quote.qty,
        note: self.buyNote,
        ref: rid + ':create'
      })
        .then(function (res) {
          var order = (res.data && res.data.data) || {};
          if (!order.id) throw new Error('下单失败');
          return api.post('/xy/orders/' + order.id + '/pay', { ref: rid + ':pay' });
        })
        .then(function () {
          self.busy = false; self.quote = null; self.buyNote = '';
          self.toast('拿下啦！记得去「我的买单」看一眼');
          self.load();
        })
        .catch(function (err) {
          self.busy = false;
          self.toast(self.errMsg(err, '结账失败'));
        });
    },
    askRefund: function (o) {
      var self = this;
      api.post('/xy/orders/' + o.id + '/refund-request', { ref: 'market:refund:' + o.id + ':' + Date.now() })
        .then(function () { self.toast('已申请退款，等班管确认'); self.load(); })
        .catch(function (err) { self.toast(self.errMsg(err, '申请退款失败')); });
    },
    buyerConfirm: function (o) {
      var self = this;
      api.post('/xy/orders/' + o.id + '/confirm', { ref: 'market:confirm:' + o.id + ':' + Date.now() })
        .then(function () { self.toast('已确认收货，货款已结算给卖家'); self.load(); })
        .catch(function (err) { self.toast(self.errMsg(err, '确认收货失败')); });
    },
    // ---- 卖家 ----
    createSale: function () {
      var self = this;
      var f = self.form;
      var price = Number(f.price);
      if (!f.name || !(price > 0)) return self.toast('商品名和售价都要填');
      if (f.busy) return;
      f.busy = true;
      // ⚠️ 输入框是「学元」，账本 price_cent 是 1/100 学元，必须 ×100。
      // 钱包旧版直接把学元数当分传，标价会缩小 100 倍（本组件修正）。
      api.post('/xy/market/goods', {
        name: f.name,
        description: f.description,
        cover: f.cover,
        price_cent: Math.round(price * 100),
        kind: f.kind,
        stock_qty: String(f.stock).trim() === '' ? -1 : Math.max(0, Math.floor(Number(f.stock)))
      }).then(function () {
        self.toast('开张啦，等同学来逛～');
        self.form = {
          name: '', price: '', kind: f.kind,
          description: '', cover: '', stock: '', busy: false
        };
        self.load();
      }).catch(function (err) {
        self.toast(self.errMsg(err, '摆摊失败'));
        f.busy = false;
      });
    },
    offShelf: function (g) {
      var self = this;
      api.post('/xy/goods/' + g.id + '/status', { status: 'off_shelf' })
        .then(function () { self.toast('已收摊'); self.load(); })
        .catch(function (err) { self.toast(self.errMsg(err, '收摊失败')); });
    },
    sellerAct: function (o, act) {
      var self = this;
      var rid = 'market:' + act + ':' + o.id + ':' + Date.now();
      var p;
      if (act === 'fulfill') p = api.post('/xy/orders/' + o.id + '/fulfill', { ref: rid });
      else if (act === 'settle') p = api.post('/xy/orders/' + o.id + '/settle', { ref: rid });
      else p = api.post('/xy/orders/' + o.id + '/refund', { ref: rid, reason: '卖家同意退款' });
      p.then(function () {
        self.toast(act === 'refund' ? '已同意退款' : (act === 'settle' ? '货款已进钱包' : '已标记交付'));
        self.load();
      }).catch(function (err) { self.toast(self.errMsg(err, '操作失败')); });
    }
  }
};
</script>

<style scoped>
/* ══════════════════════════════════════════════════════════
   集市配色：朱红 + 暖黄 + 米纸。
   结构性颜色（牌楼/雨棚/价签）用固定暖色，明暗主题都成立；
   文字、卡片底、边框一律走主题变量，避免暗色下瞎掉。
   ══════════════════════════════════════════════════════════ */
.market-street {
  /* width:100% 不能省：父级是 flex column，margin:auto 会吃掉 stretch，
     少了它整个集市会缩成内容的固有宽度（表现为只排 2 列、大片留白）。 */
  width: 100%;
  max-width: 1080px;
  margin: 0 auto;
  padding: 12px 18px 104px;
  color: var(--text-primary);
  box-sizing: border-box;
}

/* ── 牌楼 ───────────────────────────────────────────── */
.ms-gate {
  position: relative;
  margin: 0 0 20px;
  border-radius: 16px;
  overflow: hidden;
  background: linear-gradient(135deg, #9C2A1D 0%, #BE3A2B 50%, #A9531F 100%);
  box-shadow: 0 10px 26px rgba(120, 40, 20, 0.22);
}
/* 檐：瓦当纹，让牌楼有厚度 */
.ms-gate-eave {
  height: 12px;
  background-image: repeating-linear-gradient(90deg,
    #6E1E14 0, #6E1E14 13px,
    #8E2B1C 13px, #8E2B1C 26px);
  box-shadow: inset 0 -2px 0 rgba(0, 0, 0, 0.22);
}
.ms-gate-inner { padding: 15px 20px 17px; text-align: center; }
.ms-gate-title-row { display: flex; align-items: center; justify-content: center; }
/* 灯笼：CSS 画，不依赖 emoji 字体（校园平板字体不齐时 emoji 会变黑方块） */
.ms-lamp {
  position: relative;
  display: inline-block;
  width: 15px;
  height: 19px;
  margin: 0 15px;
  border-radius: 50% / 46%;
  background: radial-gradient(circle at 34% 30%, #FF8562 0%, #E0452C 46%, #A3271A 100%);
  box-shadow: 0 0 14px rgba(255, 122, 62, 0.45), inset 0 -2px 4px rgba(60, 10, 4, 0.28);
}
.ms-lamp::before {
  content: '';
  position: absolute;
  top: -6px;
  left: 50%;
  width: 1px;
  height: 6px;
  margin-left: -0.5px;
  background: rgba(255, 232, 196, 0.5);
}
.ms-lamp::after {
  content: '';
  position: absolute;
  bottom: -6px;
  left: 50%;
  width: 2px;
  height: 6px;
  margin-left: -1px;
  border-radius: 1px;
  background: #E8C078;
  box-shadow: 0 0 6px rgba(255, 200, 120, 0.55);
}
.ms-title {
  margin: 0;
  font-size: 23px;
  font-weight: 700;
  letter-spacing: 10px;
  text-indent: 10px;
  color: #FFF6E4;
  text-shadow: 0 2px 8px rgba(70, 16, 6, 0.42);
}
.ms-cry {
  margin-top: 8px;
  font-size: 11.5px;
  line-height: 1.5;
  color: rgba(255, 246, 228, 0.82);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ms-gate-stats {
  display: flex;
  justify-content: center;
  margin-top: 11px;
}
.ms-stat {
  min-width: 68px;
  margin: 0 5px;
  padding: 6px 10px 5px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.13);
  border: 1px solid rgba(255, 236, 200, 0.22);
  box-sizing: border-box;
}
.ms-stat b { display: block; font-size: 17px; line-height: 1.15; color: #FFF6E4; }
.ms-stat em {
  display: block;
  margin-top: 1px;
  font-style: normal;
  font-size: 10px;
  letter-spacing: 0.5px;
  color: rgba(255, 246, 228, 0.7);
}
.ms-refresh {
  position: absolute;
  top: 20px;
  right: 12px;
  z-index: 2;
  width: 28px;
  height: 28px;
  padding: 0;
  border-radius: 50%;
  border: 1px solid rgba(255, 236, 200, 0.35);
  background: rgba(255, 255, 255, 0.14);
  color: #FFF6E4;
  font-size: 11px;
  line-height: 1;
  cursor: pointer;
}
.ms-refresh:hover { background: rgba(255, 255, 255, 0.26); }
.ms-refresh:disabled { opacity: 0.5; cursor: default; }

/* ── 状态 ───────────────────────────────────────────── */
.ms-state { padding: 54px 16px; text-align: center; }
.ms-state-icon { font-size: 34px; line-height: 1.2; }
.ms-state-title { margin-top: 10px; font-size: 14px; font-weight: 600; }
.ms-state-sub { margin: 6px 0 16px; font-size: 12px; opacity: 0.66; line-height: 1.6; }
.ms-state.error .ms-state-title { color: #D9534F; }

/* ── 区块头：木牌 ───────────────────────────────────── */
.ms-block { margin: 0 0 22px; }
.ms-head {
  display: flex;
  align-items: center;
  padding: 0 2px 9px;
  margin-bottom: 12px;
  border-bottom: 1px solid var(--border-color);
}
.ms-head-icon {
  flex: 0 0 auto;
  width: 30px;
  height: 30px;
  margin-right: 10px;
  border-radius: 9px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  line-height: 1;
  background: rgba(192, 57, 43, 0.12);
}
.ms-head-icon.official { background: rgba(192, 57, 43, 0.12); }
.ms-head-icon.peer { background: rgba(214, 138, 48, 0.16); }
.ms-head-icon.mine { background: rgba(78, 154, 106, 0.14); }
.ms-head-icon.bill { background: rgba(108, 123, 196, 0.14); }
.ms-head-txt { flex: 1; min-width: 0; }
.ms-head-txt b { display: block; font-size: 14.5px; font-weight: 600; letter-spacing: 0.2px; }
.ms-head-txt em {
  display: block;
  margin-top: 1px;
  font-style: normal;
  font-size: 11px;
  line-height: 1.5;
  opacity: 0.58;
}
.ms-count {
  flex: 0 0 auto;
  min-width: 22px;
  padding: 2px 7px;
  border-radius: 999px;
  font-size: 11px;
  text-align: center;
  color: #8A4B12;
  background: rgba(214, 138, 48, 0.2);
}
[data-theme="dark"] .ms-count { color: #E9B676; background: rgba(214, 138, 48, 0.18); }

/* ── 摊位网格 ───────────────────────────────────────── */
.ms-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(166px, 1fr));
  grid-gap: 12px;
  gap: 12px;
}
.ms-stall {
  position: relative;
  display: flex;
  flex-direction: column;
  padding: 0;
  padding-top: 9px;
  border: 1px solid var(--border-color);
  border-radius: 12px;
  background: var(--card-bg);
  color: var(--text-primary);
  font-family: inherit;
  text-align: left;
  overflow: hidden;
  cursor: pointer;
  transition: transform 0.16s ease, box-shadow 0.16s ease, border-color 0.16s ease;
}
.ms-stall:hover {
  transform: translateY(-3px);
  border-color: rgba(214, 138, 48, 0.55);
  box-shadow: 0 10px 22px rgba(120, 60, 20, 0.16);
}
.ms-stall:active { transform: translateY(-1px); }
/* 雨棚：市集最强的那个符号 */
.ms-awning {
  position: absolute;
  top: 0; left: 0; right: 0;
  height: 9px;
  background-image: repeating-linear-gradient(90deg,
    #D68A30 0, #D68A30 13px,
    #F7E7CE 13px, #F7E7CE 26px);
}
.ms-awning.official {
  background-image: repeating-linear-gradient(90deg,
    #C0392B 0, #C0392B 13px,
    #F7E7CE 13px, #F7E7CE 26px);
}
/* 卡片主体：名字吃掉剩余高度，让标签紧贴价签上方，等高卡片不会中间空一大块 */
.ms-stall-body {
  display: flex;
  flex-direction: column;
  flex: 0 0 auto;
  padding: 9px 12px 10px;
}
.ms-stall-name {
  flex: 1;
  padding: 0;
  font-size: 13.5px;
  font-weight: 600;
  line-height: 1.45;
  min-height: 40px;
  word-break: break-word;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.ms-stall-meta {
  display: flex;
  align-items: center;
  margin-top: 8px;
  font-size: 10.5px;
  overflow: hidden;
}
.ms-tag {
  flex: 0 0 auto;
  padding: 1px 7px;
  border-radius: 5px;
  color: #8A4B12;
  background: rgba(214, 138, 48, 0.17);
}
.ms-badge-off { margin-left: 6px; color: #C0392B; font-weight: 600; }
.ms-seller {
  display: flex;
  align-items: center;
  margin-left: 8px;
  min-width: 0;
  opacity: 0.72;
}
.ms-dot {
  flex: 0 0 auto;
  width: 16px;
  height: 16px;
  margin-right: 4px;
  border-radius: 50%;
  color: #fff;
  font-style: normal;
  font-size: 10px;
  line-height: 16px;
  text-align: center;
}
/* 价签：暖黄贴纸。用实色而不是半透明——半透明叠在暗色卡上会变成一坨脏灰。 */
.ms-price-tag {
  display: flex;
  align-items: baseline;
  margin-top: auto;
  padding: 7px 12px 8px;
  border-top: 1px solid rgba(214, 138, 48, 0.22);
  background: #FBF0DC;
}
.ms-price-tag b {
  font-size: 19px;
  font-weight: 700;
  color: #A93226;
  letter-spacing: -0.3px;
}
.ms-price-tag i {
  margin-left: 3px;
  font-style: normal;
  font-size: 10px;
  color: #9A6B2E;
}
[data-theme="dark"] .ms-price-tag { background: rgba(214, 138, 48, 0.16); border-top-color: rgba(214, 138, 48, 0.22); }
[data-theme="dark"] .ms-price-tag b { color: #F5B96F; }
[data-theme="dark"] .ms-price-tag i { color: #C79A63; }

/* ── 空态：官铺「今日无货」牌 ─────────────────────────── */
.ms-none {
  display: flex;
  align-items: center;
  padding: 13px 15px;
  border-radius: 11px;
  border: 1px dashed var(--border-color);
  background: rgba(214, 138, 48, 0.06);
}
.ms-none-mark {
  flex: 0 0 auto;
  margin-right: 12px;
  padding: 3px 10px;
  border-radius: 6px;
  font-size: 11px;
  letter-spacing: 1px;
  color: #8A4B12;
  background: rgba(214, 138, 48, 0.16);
}
.ms-none-tip { font-size: 11px; line-height: 1.6; opacity: 0.55; }
.ms-none.slim { justify-content: center; padding: 14px 15px; }

/* ── 空态：招租摊位（同学摊为 0 时的主画面） ───────────── */
.ms-vacant {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 100%;
  padding: 26px 18px 20px;
  border-radius: 12px;
  border: 2px dashed rgba(214, 138, 48, 0.45);
  background: rgba(214, 138, 48, 0.05);
  color: var(--text-primary);
  font-family: inherit;
  cursor: pointer;
  overflow: hidden;
  box-sizing: border-box;
  transition: border-color 0.16s ease, background 0.16s ease;
}
.ms-vacant:hover { border-color: rgba(192, 57, 43, 0.6); background: rgba(214, 138, 48, 0.09); }
.ms-vacant-awning {
  position: absolute;
  top: 0; left: 0; right: 0;
  height: 8px;
  background-image: repeating-linear-gradient(90deg,
    rgba(214, 138, 48, 0.5) 0, rgba(214, 138, 48, 0.5) 13px,
    rgba(247, 231, 206, 0.45) 13px, rgba(247, 231, 206, 0.45) 26px);
}
.ms-vacant-mark {
  padding: 4px 16px;
  border-radius: 7px;
  font-size: 15px;
  font-weight: 700;
  letter-spacing: 3px;
  text-indent: 3px;
  color: #A93226;
  background: rgba(214, 138, 48, 0.2);
  border: 1px solid rgba(192, 57, 43, 0.3);
}
.ms-vacant-tip {
  margin-top: 12px;
  font-size: 12px;
  line-height: 1.75;
  text-align: center;
  opacity: 0.6;
}
.ms-vacant-cta { margin-top: 10px; font-size: 11.5px; color: #B4651F; }

/* ── 摆摊台 ─────────────────────────────────────────── */
.ms-stand {
  padding: 14px;
  border-radius: 12px;
  border: 1px solid var(--border-color);
  background: var(--card-bg);
}
.ms-name-input {
  width: 100%;
  height: 38px;
  margin-bottom: 10px;
  padding: 0 11px;
  border-radius: 9px;
  border: 1px solid var(--border-color);
  background: var(--bg-color);
  color: var(--text-primary);
  font-family: inherit;
  font-size: 12.5px;
  outline: none;
  box-sizing: border-box;
}
.ms-name-input:focus { border-color: rgba(192, 57, 43, 0.6); }
.ms-field {
  display: flex;
  align-items: center;
  height: 38px;
  padding: 0 11px;
  border-radius: 9px;
  border: 1px solid var(--border-color);
  background: var(--bg-color);
  box-sizing: border-box;
}
.ms-field input {
  flex: 1;
  min-width: 0;
  height: 100%;
  padding: 0;
  border: none;
  outline: none;
  background: transparent;
  color: var(--text-primary);
  font-family: inherit;
  font-size: 12.5px;
}
.ms-field input::-webkit-outer-spin-button,
.ms-field input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
.ms-field input[type=number] { -moz-appearance: textfield; }
.ms-field.price { flex: 1 1 118px; min-width: 110px; margin: 0 8px 8px 0; }
.ms-field.price i { font-style: normal; margin-right: 4px; font-size: 11px; opacity: 0.5; }
.ms-field.price em { flex: 0 0 auto; font-style: normal; font-size: 10.5px; opacity: 0.5; }
.ms-field.select { flex: 1 1 118px; min-width: 110px; margin: 0 8px 8px 0; padding: 0 8px; }
.ms-field.select select {
  flex: 1;
  min-width: 0;
  height: 100%;
  border: none;
  outline: none;
  background: transparent;
  color: var(--text-primary);
  font-family: inherit;
  font-size: 12.5px;
}
.ms-stand-row { display: flex; flex-wrap: wrap; align-items: center; }
.ms-stand-row .grow-btn { flex: 1 1 130px; margin: 0 0 8px; }
.ms-stand-tip {
  margin: 2px 0 0;
  font-size: 10.5px;
  line-height: 1.65;
  opacity: 0.5;
}

/* ── 纸条（列表） ───────────────────────────────────── */
.ms-paper {
  margin-top: 12px;
  padding: 0 14px;
  border-radius: 12px;
  border: 1px solid var(--border-color);
  background: var(--card-bg);
}
.ms-paper.flat { margin-top: 0; }
.ms-paper-head {
  display: flex;
  align-items: center;
  padding: 11px 0 8px;
  font-size: 12px;
  font-weight: 600;
  border-bottom: 1px solid var(--border-color);
}
.ms-paper-head em {
  margin-left: 6px;
  padding: 0 6px;
  border-radius: 999px;
  font-style: normal;
  font-size: 10.5px;
  font-weight: 400;
  opacity: 0.62;
  background: rgba(128, 128, 128, 0.14);
}
.ms-line {
  display: flex;
  align-items: center;
  padding: 10px 0;
  font-size: 12.5px;
  border-bottom: 1px dashed var(--border-color);
}
.ms-line:last-child { border-bottom: none; }
.ms-line-name {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ms-line-price {
  flex: 0 0 auto;
  margin: 0 10px;
  font-weight: 600;
  color: #B23A22;
}
.ms-chip {
  flex: 0 0 auto;
  padding: 1px 8px;
  border-radius: 999px;
  font-size: 10.5px;
  background: rgba(128, 128, 128, 0.14);
  opacity: 0.85;
}
.ms-chip.on { color: #8A4B12; background: rgba(214, 138, 48, 0.2); }
.ms-chip.done { color: #2F7A52; background: rgba(78, 154, 106, 0.16); }
.ms-chip.refund { color: #B03A2E; background: rgba(217, 83, 79, 0.16); }
.ms-chip.off { opacity: 0.5; }
[data-theme="dark"] .ms-chip { color: #C9C9CE; background: rgba(255, 255, 255, 0.08); }
[data-theme="dark"] .ms-chip.on { color: #E9B676; background: rgba(214, 138, 48, 0.18); }
[data-theme="dark"] .ms-chip.done { color: #7FC79B; background: rgba(78, 154, 106, 0.2); }
[data-theme="dark"] .ms-chip.refund { color: #F08A80; background: rgba(217, 83, 79, 0.2); }
.ms-mini-btn {
  flex: 0 0 auto;
  margin-left: 8px;
  padding: 3px 10px;
  border-radius: 999px;
  border: 1px solid rgba(214, 138, 48, 0.6);
  background: transparent;
  color: #B4651F;
  font-family: inherit;
  font-size: 10.5px;
  cursor: pointer;
}
.ms-mini-btn:hover { background: rgba(214, 138, 48, 0.12); }
.ms-mini-btn.hot {
  color: #fff;
  background: #C0392B;
  border-color: #C0392B;
}
.ms-mini-btn.hot:hover { background: #A93226; }
[data-theme="dark"] .ms-mini-btn { color: #E9B676; border-color: rgba(214, 138, 48, 0.5); }
[data-theme="dark"] .ms-mini-btn.hot { color: #FFF6E4; background: #C0392B; border-color: #C0392B; }

/* ── 按钮 ───────────────────────────────────────────── */
.ms-btn {
  padding: 0 16px;
  height: 38px;
  border-radius: 9px;
  border: 1px solid var(--border-color);
  background: var(--card-bg);
  color: var(--text-primary);
  font-family: inherit;
  font-size: 12.5px;
  cursor: pointer;
}
.ms-btn.primary {
  border-color: #C0392B;
  background: #C0392B;
  color: #FFF6E4;
  font-weight: 600;
}
.ms-btn.primary:hover { background: #A93226; }
.ms-btn:disabled { opacity: 0.45; cursor: not-allowed; }

/* ── 柜台 ───────────────────────────────────────────── */
.ms-counter-mask {
  position: fixed;
  top: 0; right: 0; bottom: 0; left: 0;
  z-index: 3000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: rgba(24, 14, 8, 0.52);
}
.ms-counter {
  width: 100%;
  max-width: 340px;
  max-height: 84vh;
  overflow-y: auto;
  padding: 18px;
  border-radius: 16px;
  background: var(--card-bg);
  color: var(--text-primary);
  border: 1px solid rgba(214, 138, 48, 0.5);
  box-shadow: 0 22px 56px rgba(30, 15, 5, 0.38);
  box-sizing: border-box;
}
.ms-counter-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12.5px;
  font-weight: 600;
  opacity: 0.8;
}
.ms-x {
  width: 24px;
  height: 24px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: inherit;
  font-size: 12px;
  opacity: 0.55;
  cursor: pointer;
}
.ms-x:hover { opacity: 1; background: rgba(128, 128, 128, 0.14); }
.ms-counter-name {
  margin: 14px 0 12px;
  font-size: 16px;
  font-weight: 700;
  line-height: 1.4;
  word-break: break-word;
}
.ms-counter-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  padding: 9px 0;
  font-size: 12px;
  border-bottom: 1px dashed var(--border-color);
  opacity: 0.9;
}
.ms-counter-row b { font-size: 15px; color: #B23A22; font-weight: 700; }
.ms-counter-row b i { font-style: normal; font-size: 10px; font-weight: 400; opacity: 0.6; }
.ms-counter-row b.no { color: #D9534F; }
.ms-counter-tip {
  margin: 12px 0 0;
  font-size: 10.5px;
  line-height: 1.7;
  opacity: 0.55;
}
.ms-counter-tip.no { color: #D9534F; opacity: 1; }
.ms-counter-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 18px;
}
.ms-counter-actions .ms-btn { margin-left: 8px; }

/* ── 提示条 ─────────────────────────────────────────── */
.ms-toast {
  position: fixed;
  left: 50%;
  bottom: 56px;
  transform: translateX(-50%);
  z-index: 3100;
  max-width: 76vw;
  padding: 10px 18px;
  border-radius: 999px;
  background: rgba(38, 24, 14, 0.94);
  color: #FFF6E4;
  font-size: 12px;
  line-height: 1.5;
  box-shadow: 0 8px 22px rgba(0, 0, 0, 0.28);
}
.ms-fade-enter-active, .ms-fade-leave-active { transition: opacity 0.2s ease; }
.ms-fade-enter, .ms-fade-leave-to { opacity: 0; }

/* ── 窄屏 ───────────────────────────────────────────── */
@media (max-width: 720px) {
  .market-street { padding: 10px 12px 96px; }
  .ms-title { font-size: 21px; letter-spacing: 7px; text-indent: 7px; }
  .ms-grid { grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); grid-gap: 10px; gap: 10px; }
  .ms-stall-body { padding: 8px 10px 9px; }
  .ms-stall-name { font-size: 12.5px; min-height: 36px; }
  .ms-stall-meta { margin-top: 6px; }
  .ms-price-tag { padding: 6px 10px 7px; }
  .ms-price-tag b { font-size: 17px; }
  .ms-stat { min-width: 66px; margin: 0 4px; padding: 5px 8px 4px; }
  .ms-counter { max-width: 320px; }
}
@media (max-width: 460px) {
  .ms-grid { grid-template-columns: repeat(2, 1fr); }
  .ms-title { font-size: 19px; letter-spacing: 5px; text-indent: 5px; }
  .ms-lamp { margin: 0 10px; }
}

/* ── 商品详情 / 库存 / 数量 ─────────────────────────── */
.ms-cover {
  position: absolute; top: 6px; right: 8px; z-index: 2;
  font-size: 22px; line-height: 1;
  filter: drop-shadow(0 2px 2px rgba(90, 45, 10, 0.25));
}
.ms-desc {
  display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2;
  overflow: hidden; margin-top: 3px;
  font-size: 10.5px; line-height: 1.45;
  color: rgba(120, 70, 30, 0.78);
}
.ms-stock {
  padding: 1px 5px; border-radius: 4px;
  font-size: 9.5px; color: #8a5a1f;
  background: rgba(200, 120, 40, 0.14);
}
.ms-line-qty { font-size: 10px; color: rgba(120, 70, 30, 0.7); }
.ms-line-note {
  max-width: 34%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-size: 10px; color: rgba(120, 70, 30, 0.6);
}
.ms-desc-input { margin-top: 7px; font-size: 12px; }
.ms-field.cover { flex: 0 0 92px; margin: 0 8px 8px 0; }
.ms-field.cover input { width: 100%; text-align: center; font-size: 18px; }
.ms-field.stock { flex: 1.4; }
.ms-counter-desc { margin: 4px 0 6px; font-size: 11px; line-height: 1.5; color: rgba(120, 70, 30, 0.8); }
.ms-qty { display: inline-flex; align-items: center; }
.ms-qty b { min-width: 34px; text-align: center; font-size: 14px; }
.ms-qty-btn {
  width: 28px; height: 28px; border-radius: 8px;
  border: 1px solid rgba(140, 80, 30, 0.28);
  background: rgba(255, 248, 232, 0.9); color: #6b3f16;
  font-size: 16px; line-height: 1; cursor: pointer;
}
.ms-note-input {
  width: 100%; margin: 8px 0 4px; padding: 7px 9px;
  border-radius: 8px; border: 1px solid rgba(140, 80, 30, 0.22);
  background: rgba(255, 252, 244, 0.95); color: #4a2c12;
  font-size: 11.5px; font-family: inherit;
  box-sizing: border-box;
}
</style>
