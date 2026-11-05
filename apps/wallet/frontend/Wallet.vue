<template>
  <div class="wallet-page">
    <AppNavBar title="学元钱包">
      <template slot="actions">
        <button class="nav-btn" title="刷新" @click="reloadAll">
          <i class="fa-solid fa-rotate" :class="{ spinning: loading }"></i>
        </button>
      </template>
    </AppNavBar>

    <div class="wallet-scroll">
      <div class="wallet-inner">
        <!-- 余额卡：充值学元与赠送学元分开记账 -->
        <div class="bal-card">
          <div class="bal-glow"></div>
          <div class="bal-head">
            <span class="bal-label">学元总余额</span>
            <span class="bal-ico"><i class="fa-solid fa-coins"></i></span>
          </div>
          <div class="bal-amount">{{ money(account.balance) }}</div>

          <div class="bp-row">
            <div class="bp-item">
              <span class="bp-name"><i class="fa-solid fa-wallet"></i> 充值学元</span>
              <span class="bp-num">{{ money(account.cash) }}</span>
              <span class="bp-sub">
                可用 {{ money(account.available_cash) }}
                <em v-if="account.frozen_cash"> · 冻结 {{ money(account.frozen_cash) }}</em>
              </span>
            </div>
            <div class="bp-item">
              <span class="bp-name"><i class="fa-solid fa-gift"></i> 赠送学元</span>
              <span class="bp-num">{{ money(account.grant) }}</span>
              <span class="bp-sub">
                可用 {{ money(account.available_grant) }}
                <em v-if="account.frozen_grant"> · 冻结 {{ money(account.frozen_grant) }}</em>
              </span>
              <span class="bp-tag">不可提现</span>
            </div>
          </div>

          <div class="bal-withdraw" @click="switchTab('withdraw')">
            <span>可提现 <b>{{ money(withdrawable) }}</b> 学元</span>
            <span class="bw-link">去提现<i class="fa-solid fa-chevron-right"></i></span>
          </div>

          <div class="bal-foot">
            <button class="daily-btn" :class="{ done: daily.claimed }" :disabled="daily.claimed || claiming" @click="claimDaily">
              <i :class="daily.claimed ? 'fa-solid fa-check' : 'fa-solid fa-calendar-day'"></i>
              <span v-if="claiming">领取中…</span>
              <span v-else-if="daily.claimed">今日已领 · 连签 {{ daily.streak }} 天</span>
              <span v-else>领今日津贴 +{{ money(daily.amount) }}</span>
            </button>
            <div class="bal-week">
              本周 <b class="in">+{{ money(week.in) }}</b> / <b class="out">-{{ money(week.out) }}</b>
            </div>
          </div>
        </div>

        <!-- 快捷操作 -->
        <div class="quick-row">
          <button class="quick" @click="openTransfer">
            <span class="q-ico blue"><i class="fa-solid fa-money-bill-transfer"></i></span>
            <span class="q-txt">转账</span>
          </button>
          <button class="quick" @click="openPacket">
            <span class="q-ico red"><i class="fa-solid fa-envelope-open-text"></i></span>
            <span class="q-txt">发红包</span>
          </button>
          <button class="quick" @click="switchTab('packets')">
            <span class="q-ico gold"><i class="fa-solid fa-hand-holding-heart"></i></span>
            <span class="q-txt">领红包</span>
            <span v-if="packetBadge > 0" class="q-badge">{{ packetBadge }}</span>
          </button>
          <button class="quick" @click="switchTab('withdraw')">
            <span class="q-ico purple"><i class="fa-solid fa-money-bill-wave"></i></span>
            <span class="q-txt">提现</span>
          </button>
          <button class="quick" @click="openRecharge">
            <span class="q-ico teal"><i class="fa-solid fa-circle-plus"></i></span>
            <span class="q-txt">充值</span>
          </button>
        </div>

        <!-- 分段 -->
        <div class="seg">
          <button
            v-for="t in tabs"
            :key="t.key"
            class="seg-btn"
            :class="{ active: tab === t.key }"
            @click="switchTab(t.key)"
          >{{ t.label }}</button>
        </div>

        <!-- ============ 明细 ============ -->
        <div v-if="tab === 'ledger'" class="panel">
          <div class="filters">
            <button
              v-for="f in filters"
              :key="f.key"
              class="filter"
              :class="{ active: direction === f.key }"
              @click="setDirection(f.key)"
            >{{ f.label }}</button>
            <span class="filter-sum">本月 {{ month.count }} 笔</span>
          </div>

          <div v-if="ledgerLoading && !rows.length" class="hint">加载中…</div>
          <div v-else-if="!rows.length" class="empty">
            <i class="fa-solid fa-receipt"></i>
            <p>还没有学元流水</p>
            <p class="empty-sub">领一次津贴，或让同学给你转一笔，这里就会开始记账</p>
          </div>
          <div v-else class="ledger">
            <div v-for="row in rows" :key="row.id" class="ledger-row">
              <span class="lr-ico" :class="row.delta_cent > 0 ? 'in' : 'out'">
                <i :class="kindIcon(row.kind)"></i>
              </span>
              <span class="lr-main">
                <span class="lr-title">{{ row.memo || row.kind_label }}</span>
                <span class="lr-sub">
                  <em v-if="row.pool_label" class="lr-pool" :class="row.pool">{{ row.pool_label }}</em>
                  {{ row.kind_label }} · {{ fmtTime(row.created_at) }}
                </span>
              </span>
              <span class="lr-right">
                <span class="lr-amount" :class="row.delta_cent > 0 ? 'in' : 'out'">{{ (row.delta_cent > 0 ? '+' : '') + money(row.delta) }}</span>
                <span class="lr-bal">余 {{ money(row.balance_after) }}</span>
              </span>
            </div>
            <button v-if="nextBeforeId" class="more-btn" :disabled="ledgerLoading" @click="loadMore">
              {{ ledgerLoading ? '加载中…' : '加载更多' }}
            </button>
          </div>
        </div>

        <!-- ============ 红包 ============ -->
        <div v-else-if="tab === 'packets'" class="panel">
          <div class="pkt-actions">
            <button class="pkt-send" @click="openPacket">
              <i class="fa-solid fa-envelope-open-text"></i> 发一个红包
            </button>
            <button class="pkt-code-btn" @click="openClaimCode">
              <i class="fa-solid fa-keyboard"></i> 红包码 / 口令
            </button>
          </div>
          <div class="pkt-tip">
            跨班红包会得到一个 6 位红包码，本班和外班同学都能凭码领取；24 小时没领完，剩余自动退回。
          </div>

          <div v-if="packets.mineCross && packets.mineCross.length" class="pkt-codes">
            <div class="pkt-codes-head">我的跨班红包码</div>
            <div v-for="p in packets.mineCross" :key="'x' + p.id" class="pkt-code-row">
              <span class="pcr-code">{{ p.code }}</span>
              <span class="pcr-main">{{ p.note || '红包' }} · {{ money(p.total) }} 元 / {{ p.count }} 个</span>
              <span class="pcr-left">{{ p.remaining_count > 0 ? ('还剩 ' + p.remaining_count) : '已领完' }}</span>
              <button class="pcr-copy" @click="copyPacketCode(p.code)">{{ copiedCode === p.code ? '已复制' : '复制' }}</button>
            </div>
          </div>

          <div class="sec-title">
            可领红包
            <span v-if="packets.available.length" class="sec-count">{{ packets.available.length }}</span>
          </div>
          <div v-if="!packets.available.length" class="empty small">
            <i class="fa-solid fa-inbox"></i>
            <p>暂时没有可领的红包</p>
          </div>
          <div v-else class="pkt-list">
            <div v-for="p in packets.available" :key="p.id" class="pkt-card">
              <span class="pkt-face" :class="p.kind"><i :class="p.kind === 'phrase' ? 'fa-solid fa-key' : (p.kind === 'designated' ? 'fa-solid fa-user-tag' : 'fa-solid fa-envelope-open-text')"></i></span>
              <span class="pkt-main">
                <span class="pkt-title">{{ p.sender_name }} 的{{ kindText(p.kind) }}
                  <em v-if="p.for_me" class="pkt-me-tag">发给我的</em>
                </span>
                <span class="pkt-sub">{{ p.note || '恭喜发财' }} · 还剩 {{ p.remaining_count }}/{{ p.count }} 个</span>
              </span>
              <button class="pkt-claim" :disabled="claimingId === p.id || (p.kind === 'phrase' && false)"
                @click="p.kind === 'phrase' ? openClaimPhrase(p) : claimPacket(p)">
                {{ claimingId === p.id ? '…' : (p.kind === 'phrase' ? '输口令' : '领取') }}
              </button>
            </div>
          </div>

          <div class="sec-title">我发出的</div>
          <div v-if="!packets.mine.length" class="empty small">
            <i class="fa-solid fa-paper-plane"></i>
            <p>还没发过红包</p>
          </div>
          <div v-else class="pkt-list">
            <div v-for="p in packets.mine" :key="'m' + p.id" class="pkt-card mine">
              <span class="pkt-face gold"><i class="fa-solid fa-coins"></i></span>
              <span class="pkt-main">
                <span class="pkt-title">{{ p.note || '红包' }} · {{ money(p.total) }} 学元</span>
                <span class="pkt-sub">{{ p.claimed_count }}/{{ p.count }} 已领 · {{ packetStateText(p) }}</span>
              </span>
              <span class="pkt-state" :class="p.status">{{ packetStateShort(p) }}</span>
            </div>
          </div>

          <div class="sec-title">我领到的</div>
          <div v-if="!packets.claimed.length" class="empty small">
            <i class="fa-solid fa-hand-holding-heart"></i>
            <p>还没抢到过红包</p>
          </div>
          <div v-else class="pkt-list">
            <div v-for="c in packets.claimed" :key="'c' + c.id + c.created_at" class="pkt-card claimed">
              <span class="pkt-face"><i class="fa-solid fa-check"></i></span>
              <span class="pkt-main">
                <span class="pkt-title">{{ c.sender_name }} 的红包</span>
                <span class="pkt-sub">{{ c.note || '恭喜发财' }} · {{ fmtTime(c.created_at) }}</span>
              </span>
              <span class="pkt-amount in">+{{ money(c.amount) }}</span>
            </div>
          </div>
        </div>

        <!-- ============ 提现 ============ -->
        <div v-else-if="tab === 'withdraw'" class="panel">
          <div class="wd-hero">
            <span class="wd-hero-label">可提现学元</span>
            <span class="wd-hero-num">{{ money(withdrawable) }}</span>
            <span class="wd-hero-tip">只有线下向班管充值的学元能提现；赠送学元和投资收益都不能提现，防止把系统赠金套成现金。</span>
          </div>

          <div class="wd-form">
            <div class="pay-row">
              <span>提现金额</span>
              <input v-model="withdraw.amount" type="number" inputmode="decimal" :placeholder="'最低 ' + money(limits.withdraw_min)" />
            </div>
            <div class="pay-row">
              <span>备注</span>
              <input v-model="withdraw.memo" maxlength="30" placeholder="选填，给班管看" />
            </div>
            <div class="wd-hint">
              1 元 = {{ money(yuanRate) }} 学元 · 单笔 {{ money(limits.withdraw_min) }}–{{ money(limits.withdraw) }} 学元。
              提交后学元先冻结，班管审批通过并当面给你现金后才真正扣除。
            </div>
            <button class="pay-primary" :disabled="withdraw.busy || !canWithdraw" @click="submitWithdraw">
              {{ withdraw.busy ? '提交中…' : '申请提现' }}
            </button>
          </div>

          <div class="sec-title">我的提现记录</div>
          <div v-if="!withdrawals.length" class="empty small">
            <i class="fa-solid fa-money-bill-wave"></i>
            <p>还没有提现记录</p>
          </div>
          <div v-else class="wd-list">
            <div v-for="w in withdrawals" :key="w.id" class="wd-row">
              <span class="wd-ico" :class="w.status">
                <i :class="w.status === 'pending' ? 'fa-solid fa-hourglass-half' : (w.status === 'paid' ? 'fa-solid fa-check' : 'fa-solid fa-rotate-left')"></i>
              </span>
              <span class="wd-main">
                <span class="wd-title">{{ money(w.amount) }} 学元<em class="wd-status" :class="w.status">{{ withdrawStatusText(w.status) }}</em></span>
                <span class="wd-sub">{{ fmtTime(w.created_at) }}<template v-if="w.review_memo"> · {{ w.review_memo }}</template></span>
              </span>
              <button v-if="w.status === 'pending'" class="wd-cancel" :disabled="withdraw.busy" @click="cancelWithdraw(w)">撤销</button>
            </div>
          </div>
        </div>

        <!-- ============ 排行 ============ -->
        <div v-else-if="tab === 'rank'" class="panel">
          <div class="rank-head">
            <span>班级学元榜</span>
            <span class="rank-mine" v-if="rankMe">我的名次 <b>#{{ rankMe.rank }}</b> · {{ money(rankMe.balance) }}</span>
          </div>
          <div v-if="!rank.length" class="hint">加载中…</div>
          <div v-else class="rank-list">
            <div v-for="r in rank" :key="r.user_id" class="rank-row" :class="{ me: r.is_me }">
              <span class="rank-no" :class="'top' + r.rank">{{ r.rank }}</span>
              <span class="rank-name">{{ r.net_name || r.real_name || r.user_id }}<em v-if="r.is_me">我</em></span>
              <span class="rank-bal">{{ money(r.balance) }}</span>
            </div>
          </div>
          <p class="rank-tip">榜单只统计余额，不含冻结。钱多不代表会投资 —— 证券里的收益率榜更值得看。</p>
        </div>

        <!-- 支付密码（没有入口的话，转账/红包会被拦住却无处设置） -->
        <div class="pay-set-row" @click="openPinSet">
          <span class="psr-ico"><i class="fa-solid fa-shield-halved"></i></span>
          <span class="psr-main">
            <span class="psr-title">支付密码</span>
            <span class="psr-sub">{{ payPinSet.set ? '已设置 · 修改或重设' : '还没设置，转账/发红包前需要设置' }}</span>
          </span>
          <span class="psr-act">{{ payPinSet.set ? '修改' : '去设置' }}<i class="fa-solid fa-chevron-right"></i></span>
        </div>

        <!-- 学元来源 -->
        <div class="sources">
          <div class="src-head">
            <span>学元从哪来</span>
            <span class="src-note">赠送学元不可提现 · 充值请找班管</span>
          </div>
          <div class="src-grid">
            <div v-for="s in sources" :key="s.name" class="src-item">
              <span class="src-ico"><i :class="srcIcon(s.icon)"></i></span>
              <span class="src-main">
                <span class="src-name">{{ s.name }}<em>{{ s.amount }}</em></span>
                <span class="src-desc">{{ s.note }}</span>
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ============ 转账（全屏，微信式）============ -->
    <PayPage
      :visible="transfer.open"
      :title="transfer.step === 'pin' ? '转账' : '转账给同学'"
      @close="closeTransfer"
    >
      <div v-if="transfer.step === 'form'" class="pay-form">
        <div class="pay-amount">
          <span class="pay-currency">¥</span>
          <input v-model="transfer.amount" type="number" inputmode="decimal" class="pay-amount-input" placeholder="0.00" />
        </div>
        <div class="quick-row">
          <button v-for="q in quickAmounts" :key="q" class="quick-chip" :class="{ active: Number(transfer.amount) === q }"
            @click="transfer.amount = String(q)">{{ q }}</button>
        </div>
        <div v-if="transfer.peerName" class="peer-picked">
          <i class="fa-solid fa-circle-check"></i>
          <b>{{ transfer.peerName }}</b>
          <em class="pp-id">{{ transfer.to }}</em>
          <span v-if="transfer.cross" class="cp-cross">跨班</span>
          <button class="pp-change" @click="clearPeer">重选</button>
        </div>
        <div v-else class="pay-row">
          <span>收款人</span>
          <input v-model.trim="peopleQ" type="text" placeholder="输入名字筛选，或直接点下面" @input="onSearchPeer" />
        </div>
        <div v-if="!transfer.peerName && recentPeers.length" class="recent-peers">
          <span class="rp-label">最近</span>
          <button v-for="p in recentPeers" :key="'r' + p.name" class="rp-chip" @click="pickRecent(p)">{{ p.name }}</button>
        </div>
        <div v-if="!transfer.peerName" class="people-list">
          <button v-for="p in filteredPeople" :key="p.user_id" class="people-item" @click="pickPeer(p)">
            <span class="pi-name">{{ p.name }}</span>
            <span class="pi-id">{{ p.user_id }}</span>
            <span v-if="p.class_admin" class="cp-admin">班管</span>
            <span v-if="p.remote" class="cp-cross">跨班</span>
          </button>
          <div v-if="!filteredPeople.length" class="people-empty">没有匹配的同学（外班同学要两个班连通后才会出现）</div>
        </div>
        <div class="pay-row">
          <span>备注</span>
          <input v-model="transfer.memo" maxlength="30" placeholder="选填，对方能看到" />
        </div>
        <div class="pay-hint">
          可用学元 {{ money(account.available) }}（充值 {{ money(account.available_cash) }} + 赠送 {{ money(account.available_grant) }}） · 单笔最多 {{ money(limits.transfer) }} 学元 · 今日还可转出 {{ money(limits.daily_left) }} 学元。
        </div>
        <button class="pay-primary" :disabled="transfer.busy" @click="transferNext">下一步</button>
      </div>
      <PayPinPad
        v-else
        :title="'转给 ' + (transfer.peerName || transfer.to || '同学')"
        :subtitle="(transfer.amount || '0') + ' 学元'"
        :error="transfer.pinError"
        :disabled="transfer.busy"
        @submit="submitTransfer"
        @cancel="closeTransfer"
        @forgot="forgotPin"
      />
    </PayPage>

    <!-- ============ 发红包（全屏）============ -->
    <PayPage
      :visible="packet.open"
      :title="packet.step === 'pin' ? '发红包' : '塞钱进红包'"
      @close="closePacket"
    >
      <div v-if="packet.step === 'form'" class="pay-form">
        <div class="pay-amount pay-amount--packet">
          <span class="pay-currency">¥</span>
          <input v-model="packet.total" type="number" inputmode="decimal" class="pay-amount-input" placeholder="0.00" />
        </div>
        <div class="pay-row">
          <span>玩法</span>
          <div class="scope-seg">
            <button :class="{ active: packet.kind === 'normal' }" @click="packet.kind = 'normal'">拼手气</button>
            <button :class="{ active: packet.kind === 'designated' }" @click="packet.kind = 'designated'">指定</button>
            <button :class="{ active: packet.kind === 'phrase' }" @click="packet.kind = 'phrase'">口令</button>
          </div>
        </div>
        <div class="pay-row" v-if="packet.kind !== 'designated'">
          <span>发给谁</span>
          <div class="scope-seg">
            <button :class="{ active: packet.scope === 'local' }" @click="packet.scope = 'local'">本班</button>
            <button :class="{ active: packet.scope === 'cross' }" @click="packet.scope = 'cross'">跨班</button>
          </div>
        </div>

        <div v-if="packet.kind === 'designated'" class="pkt-pick">
          <div class="pp-head">
            <span>选同学（{{ packet.targets.length }} 人，每人约 {{ perTarget }} 学元）</span>
          </div>
          <div class="pay-row" style="border-bottom:none;padding-bottom:6px">
            <span>筛选</span>
            <input v-model.trim="peopleQ" type="text" placeholder="名字 / 学号" />
          </div>
          <div class="people-list pick">
            <button v-for="p in filteredPeople" :key="'pk' + p.user_id" class="people-item"
              :class="{ picked: packet.targets.indexOf(p.user_id) >= 0 }" @click="toggleTarget(p)">
              <span class="pi-name">{{ p.name }}</span>
              <span class="pi-id">{{ p.user_id }}</span>
              <span v-if="p.class_admin" class="cp-admin">班管</span>
              <span v-if="p.remote" class="cp-cross">跨班</span>
              <i class="pi-check fa-solid fa-check"></i>
            </button>
            <div v-if="!filteredPeople.length" class="people-empty">没有匹配的同学</div>
          </div>
        </div>

        <div class="pay-row" v-if="packet.kind !== 'designated'">
          <span>个数</span>
          <input v-model="packet.count" type="tel" placeholder="1–20" />
        </div>
        <div class="pay-row">
          <span>{{ packet.kind === 'phrase' ? '口令' : '祝福语' }}</span>
          <input v-model="packet.note" :maxlength="packet.kind === 'phrase' ? 12 : 20"
            :placeholder="packet.kind === 'phrase' ? '领红包要输这句口令' : '恭喜发财'" />
        </div>
        <div class="pay-hint">
          <template v-if="packet.kind === 'designated'">
            只有选中的同学能领，每人分到 {{ perTarget }} 学元；含外班同学会自动生成红包码。24 小时没领完自动退回。
          </template>
          <template v-else-if="packet.kind === 'phrase'">
            同学领红包时必须<b>原样输入口令</b>；发到聊天里，让大家照着输。24 小时没领完自动退回。
          </template>
          <template v-else>
            红包先用充值学元、不足由赠送学元补足，发出去先冻结，同学领到才真正扣款；{{ limits.packet_count }} 个封顶，今日还可转出 {{ money(limits.daily_left) }} 学元。
            <template v-if="packet.scope === 'cross'"><br />跨班红包会生成 6 位红包码，同学在「红包 → 输入红包码」里领取。</template>
            24 小时没领完自动退回。
          </template>
        </div>
        <button class="pay-primary pay-primary--packet" :disabled="packet.busy || !packetReady" @click="packetNext">塞钱进红包</button>
      </div>
      <PayPinPad
        v-else
        :title="(packet.total || '0') + ' 学元'"
        :subtitle="packet.kind === 'designated'
          ? ('发给 ' + packet.targets.length + ' 位同学')
          : ('共 ' + (packet.count || 1) + ' 个红包')"
        :error="packet.pinError"
        :disabled="packet.busy"
        @submit="submitPacket"
        @cancel="closePacket"
        @forgot="forgotPin"
      />
    </PayPage>

    <!-- ============ 输入红包码 / 口令领取 ============ -->
    <PayPage :visible="claimCode.open" :title="claimCode.mode === 'phrase' ? '输口令领红包' : '输入红包码'" subtitle="跨班红包也能领" @close="claimCode.open = false">
      <div class="pay-form">
        <div v-if="claimCode.info" class="claim-preview">
          <div class="cp-face"><i class="fa-solid fa-envelope-open-text"></i></div>
          <div class="cp-main">
            <div class="cp-title">{{ claimCode.info.sender_name }} 的{{ kindText(claimCode.info.kind) }}</div>
            <div class="cp-sub">
              {{ claimCode.info.note || '恭喜发财' }} · 还剩 {{ claimCode.info.remaining_count }}/{{ claimCode.info.count }} 个
              <span v-if="claimCode.info.cross" class="cp-cross">跨班</span>
            </div>
          </div>
        </div>

        <div class="claim-input" :class="{ 'claim-input--phrase': claimCode.mode === 'phrase' }">
          <input
            v-model.trim="claimCode.input"
            :maxlength="claimCode.mode === 'phrase' ? 12 : 12"
            class="claim-code-input"
            :class="{ 'phrase': claimCode.mode === 'phrase' }"
            :placeholder="claimCode.mode === 'phrase' ? '输入口令' : '6 位红包码'"
            @input="claimCode.error = ''"
          />
        </div>

        <div class="pay-hint" :style="claimCode.error ? 'color:#E4574F' : ''">
          {{ claimCode.error || (claimCode.info
            ? (claimCode.mode === 'phrase' ? '口令对了才能拆，试试看' : '确认是这个红包，再点下面的按钮')
            : (claimCode.mode === 'phrase' ? '发红包的人写了句口令，原样输入就能领' : '字母 O/0、I/1 不会出现在红包码里')) }}
        </div>

        <button v-if="!claimCode.info" class="pay-primary" :disabled="claimCode.busy" @click="lookupCode">
          {{ claimCode.busy ? '查找中…' : '查找红包' }}
        </button>
        <button v-else class="pay-primary" :disabled="claimCode.busy" @click="submitClaimCode">
          {{ claimCode.busy ? '领取中…' : '领取红包' }}
        </button>
        <button v-if="claimCode.info" class="pin-mode-link" @click="resetClaim">换一个红包</button>
      </div>
    </PayPage>

    <!-- ============ 设置支付密码 ============ -->
    <PayPage :visible="pinSet.open" :title="pinSet.title" @close="pinSet.open = false">
      <div class="pay-form">
        <div class="pay-hint" style="margin-top:0">{{ pinSet.tip }}</div>
        <div class="pay-row" v-if="pinSet.mode === 'change'">
          <span>旧密码</span>
          <input v-model="pinSet.oldPin" type="password" inputmode="numeric" maxlength="6" placeholder="当前支付密码" />
        </div>
        <div class="pay-row">
          <span>{{ pinSet.mode === 'change' ? '新密码' : '支付密码' }}</span>
          <input v-model="pinSet.pin" type="password" inputmode="numeric" maxlength="6" placeholder="6 位数字" />
        </div>
        <div class="pay-row" v-if="pinSet.mode !== 'change'">
          <span>登录密码</span>
          <input v-model="pinSet.password" type="password" maxlength="64" placeholder="验证身份" />
        </div>
        <div class="pay-hint" :style="pinSet.error ? 'color:#E4574F' : ''">
          {{ pinSet.error || '支付密码只用于花钱（转账/红包），和登录密码分开。连错 5 次锁 15 分钟。' }}
        </div>
        <button class="pay-primary" :disabled="pinSet.busy" @click="submitPinSet">
          {{ pinSet.busy ? '处理中…' : (pinSet.mode === 'change' ? '确认修改' : '确认设置') }}
        </button>
        <button v-if="pinSet.mode !== 'change'" class="pin-mode-link" @click="switchPinMode('change')">已经设过？修改密码</button>
        <button v-if="pinSet.mode === 'change'" class="pin-mode-link" @click="switchPinMode('reset')">忘记旧密码？用登录密码重设</button>
        <button v-if="pinSet.mode === 'reset'" class="pin-mode-link" @click="switchPinMode('change')">返回修改密码</button>
      </div>
    </PayPage>

    <!-- ============ 结果 ============ -->
    <PayPage :visible="result.open" :title="result.title || '结果'" @close="result.open = false">
      <div class="pay-result">
        <div class="pay-result-icon"><i class="fa-solid fa-check"></i></div>
        <div v-if="result.amount" class="pay-result-amount">+{{ money(result.amount) }}</div>
        <div class="pay-result-text">{{ result.text }}</div>
        <div v-if="result.code" class="result-code">
          <span class="rc-label">红包码</span>
          <span class="rc-num">{{ result.code }}</span>
          <button class="rc-copy" @click="copyResultCode">{{ result.copied ? '已复制' : '复制' }}</button>
        </div>
        <button class="pay-primary" @click="result.open = false">完成</button>
      </div>
    </PayPage>

    <!-- ============ 充值说明 ============ -->
    <PayPage :visible="recharge.open" title="充值学元" subtitle="线下找班管，现金换学元" @close="recharge.open = false">
      <div class="pay-form">
        <div class="rc-rate">
          <span class="rc-rate-label">当前汇率</span>
          <span class="rc-rate-num">1 元 = {{ money(yuanRate) }} 学元</span>
        </div>
        <div class="rc-steps">
          <div class="rc-step"><em>1</em><span>线下把现金交给班管，说明要充多少。</span></div>
          <div class="rc-step"><em>2</em><span>班管在管控中心「学元」页录入，学元立即到账。</span></div>
          <div class="rc-step"><em>3</em><span>充值学元可转账、发红包、跨班、投资，也可申请提现。</span></div>
        </div>
        <div class="rc-split">
          <div class="rc-split-item cash"><i class="fa-solid fa-wallet"></i><b>充值学元</b><span>转账 / 红包 / 跨班 / 投资 / 提现</span></div>
          <div class="rc-split-item grant"><i class="fa-solid fa-gift"></i><b>赠送学元</b><span>可转账 / 红包 / 跨班 / 投资，不可提现</span></div>
        </div>
        <div class="pay-hint">
          单次充值上限 {{ money(limits.recharge) }} 学元。充值记录可查，班管乱录会被审计对账发现。
        </div>
        <button class="pay-primary" @click="recharge.open = false">知道了</button>
      </div>
    </PayPage>

  </div>
</template>

<script>
import api from '@/utils/api';
import AppNavBar from '@/components/AppNavBar.vue';
import PayPage from '@/components/pay/PayPage.vue';
import PayPinPad from '@/components/pay/PayPinPad.vue';

var KIND_ICON = {
  welcome: 'fa-solid fa-gift',
  daily: 'fa-solid fa-calendar-day',
  admin_grant: 'fa-solid fa-chalkboard-user',
  admin_deduct: 'fa-solid fa-scissors',
  transfer: 'fa-solid fa-right-left',
  trade: 'fa-solid fa-chart-line',
  fee: 'fa-solid fa-receipt',
  reward: 'fa-solid fa-medal',
  refund: 'fa-solid fa-rotate-left',
  adjust: 'fa-solid fa-sliders'
};

var SRC_ICON = {
  wallet: 'fa-solid fa-wallet',
  gift: 'fa-solid fa-gift',
  practice: 'fa-solid fa-chart-line',
  daily: 'fa-solid fa-calendar-day',
  medal: 'fa-solid fa-medal',
  trophy: 'fa-solid fa-trophy',
  teacher: 'fa-solid fa-chalkboard-user',
  swap: 'fa-solid fa-right-left'
};

function pad2(n) { return n < 10 ? '0' + n : String(n); }

function toNum(v) {
  var n = Number(v);
  return isFinite(n) ? n : 0;
}

export default {
  name: 'Wallet',
  components: { AppNavBar: AppNavBar, PayPage: PayPage, PayPinPad: PayPinPad },

  data: function () {
    return {
      loading: false,
      tab: 'ledger',
      tabs: [
        { key: 'ledger', label: '明细' },
        { key: 'packets', label: '红包' },
        { key: 'withdraw', label: '提现' },
        { key: 'rank', label: '学元榜' }
      ],
      filters: [
        { key: '', label: '全部' },
        { key: 'in', label: '收入' },
        { key: 'out', label: '支出' }
      ],
      direction: '',

      account: {
        balance: 0,
        available: 0,
        frozen: 0,
        cash: 0,
        grant: 0,
        available_cash: 0,
        available_grant: 0,
        frozen_cash: 0,
        frozen_grant: 0
      },
      withdrawable: 0,
      yuanRate: 1000,
      daily: { claimed: true, amount: 0, streak: 0, base: 1000, bonus: 2000, bonus_from: 7, next_day: 1 },
      week: { in: 0, out: 0, count: 0 },
      month: { in: 0, out: 0, count: 0 },
      sources: [],
      limits: { transfer: 500000, packet_total: 500000, packet_count: 20, recharge: 2000000, withdraw: 1000000, withdraw_min: 1000, daily_out: 2000000, daily_left: 2000000 },
      packetBadge: 0,

      withdrawals: [],
      withdraw: { amount: '', memo: '', busy: false },
      recharge: { open: false },

      claiming: false,
      claimingId: 0,

      rows: [],
      ledgerLoading: false,
      nextBeforeId: 0,

      packets: { available: [], mine: [], claimed: [], mineCross: [] },
      copiedCode: '',
      quickAmounts: [5, 10, 20, 50],
      recentPeers: [],
      people: [],
      peopleQ: '',
      peopleLoaded: false,
      claimCode: { open: false, mode: 'code', input: '', info: null, busy: false, error: '' },

      rank: [],
      rankMe: null,

      transfer: { open: false, step: 'form', to: '', peerName: '', amount: '', memo: '', busy: false, pinError: '', cross: false },
      peerHits: [],
      searchTimer: null,

      packet: { open: false, step: 'form', total: '', count: '5', note: '', scope: 'local', kind: 'normal', targets: [], busy: false, pinError: '' },

      result: { open: false, title: '', amount: 0, text: '', code: '', copied: false },

      payPinSet: { set: false },
      pinSet: { open: false, mode: 'set', title: '设置支付密码', tip: '', pin: '', password: '', oldPin: '', busy: false, error: '' }
    };
  },

  computed: {
    filteredPeople: function () {
      var q = String(this.peopleQ || '').trim().toLowerCase();
      var list = this.people || [];
      if (!q) return list;
      return list.filter(function (p) {
        return p.name.toLowerCase().indexOf(q) >= 0 || String(p.user_id).indexOf(q) >= 0;
      });
    },
    perTarget: function () {
      var n = this.packet.targets.length;
      var total = toNum(this.packet.total);
      if (!(n > 0) || !(total > 0)) return 0;
      return Math.floor(total / n * 100) / 100;
    },
    packetReady: function () {
      if (this.packet.kind === 'designated') return this.packet.targets.length > 0;
      return true;
    },
    canWithdraw: function () {
      var a = toNum(this.withdraw.amount);
      if (!(a > 0)) return false;
      if (a < toNum(this.limits.withdraw_min)) return false;
      if (a > toNum(this.limits.withdraw)) return false;
      return a <= toNum(this.withdrawable) + 1e-9;
    },
    balanceText: function () {
      return this.money(this.account.balance);
    },
    myName: function () {
      try {
        var u = this.$store.state.auth.user || {};
        return u.net_name || u.real_name || u.user_id || '';
      } catch (e) { return ''; }
    }
  },

  created: function () {
    this.reloadAll();
  },

  methods: {
    money: function (n) {
      var v = toNum(n);
      var neg = v < 0;
      var s = Math.abs(v).toFixed(2);
      var parts = s.split('.');
      parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
      return (neg ? '-' : '') + parts.join('.');
    },

    fmtTime: function (ts) {
      if (!ts) return '';
      var d = new Date(ts);
      var now = new Date();
      var sameDay = d.getFullYear() === now.getFullYear() &&
        d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
      var hm = pad2(d.getHours()) + ':' + pad2(d.getMinutes());
      if (sameDay) return '今天 ' + hm;
      return (d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' + hm;
    },

    kindIcon: function (kind) {
      return KIND_ICON[kind] || 'fa-solid fa-circle-dot';
    },

    srcIcon: function (key) {
      return SRC_ICON[key] || 'fa-solid fa-coins';
    },

    toast: function (msg, type) {
      try {
        this.$store.commit('toast/SHOW_TOAST', { message: msg, type: type || 'info' });
      } catch (e) {
        // 兜底：store 不可用时至少不静默
        if (type === 'error') console.warn('[wallet]', msg);
      }
    },

    reloadAll: function () {
      var self = this;
      self.loading = true;
      self.loadOverview();
      self.loadLedger(true);
      self.loadPackets();
      if (self.tab === 'rank') self.loadRank();
      setTimeout(function () { self.loading = false; }, 600);
    },

    loadOverview: function () {
      var self = this;
      return api.get('/wallet').then(function (res) {
        var d = (res.data && res.data.data) || {};
        self.account = d.account || self.account;
        if (d.daily) self.daily = d.daily;
        if (d.week) self.week = d.week;
        if (d.month) self.month = d.month;
        if (d.sources) self.sources = d.sources;
        if (d.pay_pin) self.payPinSet = d.pay_pin;
        if (d.limits) self.limits = d.limits;
        if (d.withdrawable !== undefined) self.withdrawable = d.withdrawable;
        if (d.yuan_rate) self.yuanRate = d.yuan_rate;
        if (d.packets) self.packetBadge = d.packets.available || 0;
      }).catch(function (err) {
        self.toast(self.errMsg(err, '钱包数据加载失败'), 'error');
      });
    },

    loadLedger: function (reset) {
      var self = this;
      if (self.ledgerLoading) return;
      self.ledgerLoading = true;
      var params = { limit: 20, direction: self.direction };
      if (!reset && self.nextBeforeId) params.beforeId = self.nextBeforeId;
      api.get('/wallet/ledger', { params: params }).then(function (res) {
        var d = (res.data && res.data.data) || {};
        var list = d.list || [];
        self.rows = reset ? list : self.rows.concat(list);
        self.nextBeforeId = d.next_before_id || 0;
      }).catch(function (err) {
        self.toast(self.errMsg(err, '流水加载失败'), 'error');
      }).then(function () {
        self.ledgerLoading = false;
      });
    },

    loadMore: function () {
      this.loadLedger(false);
    },

    setDirection: function (key) {
      if (this.direction === key) return;
      this.direction = key;
      this.rows = [];
      this.nextBeforeId = 0;
      this.loadLedger(true);
    },

    switchTab: function (key) {
      this.tab = key;
      if (key === 'packets') this.loadPackets();
      if (key === 'withdraw') this.loadWithdrawals();
      if (key === 'rank' && !this.rank.length) this.loadRank();
    },

    loadPackets: function () {
      var self = this;
      return api.get('/wallet/packets').then(function (res) {
        var d = (res.data && res.data.data) || {};
        var mine = d.mine || [];
        self.packets = {
          available: d.available || [],
          mine: mine,
          claimed: d.claimed || [],
          mineCross: mine.filter(function (x) { return x.scope === 'cross' && x.code; })
        };
        self.packetBadge = self.packets.available.length;
      }).catch(function (err) {
        self.toast(self.errMsg(err, '红包加载失败'), 'error');
      });
    },

    loadRank: function () {
      var self = this;
      api.get('/wallet/leaderboard', { params: { limit: 20 } }).then(function (res) {
        var d = (res.data && res.data.data) || {};
        self.rank = d.list || [];
        self.rankMe = d.me || null;
      }).catch(function (err) {
        self.toast(self.errMsg(err, '榜单加载失败'), 'error');
      });
    },

    openRecharge: function () {
      this.recharge.open = true;
    },

    loadWithdrawals: function () {
      var self = this;
      return api.get('/xueyuan/withdraw/list').then(function (res) {
        var d = (res.data && res.data.data) || {};
        self.withdrawals = d.list || [];
        if (d.withdrawable !== undefined) self.withdrawable = d.withdrawable;
      }).catch(function (err) {
        self.toast(self.errMsg(err, '提现记录加载失败'), 'error');
      });
    },

    submitWithdraw: function () {
      var self = this;
      if (self.withdraw.busy || !self.canWithdraw) return;
      var amount = toNum(self.withdraw.amount);
      self.withdraw.busy = true;
      api.post('/xueyuan/withdraw/request', {
        amount: amount,
        memo: self.withdraw.memo,
        requestId: 'wd' + Date.now() + '-' + Math.floor(Math.random() * 100000)
      }).then(function (res) {
        var body = res.data || {};
        if (body.code !== 200) throw { message: body.message };
        var d = body.data || {};
        if (d.account) self.account = d.account;
        self.withdraw.amount = '';
        self.withdraw.memo = '';
        self.toast(body.message || '提现申请已提交', 'success');
        self.loadWithdrawals();
        self.loadOverview();
      }).catch(function (err) {
        self.toast(self.errMsg(err, '提现申请失败'), 'error');
      }).then(function () {
        self.withdraw.busy = false;
      });
    },

    cancelWithdraw: function (w) {
      var self = this;
      if (self.withdraw.busy) return;
      self.withdraw.busy = true;
      api.post('/xueyuan/withdraw/cancel/' + w.id).then(function (res) {
        var body = res.data || {};
        if (body.code !== 200) throw { message: body.message };
        var d = body.data || {};
        if (d.account) self.account = d.account;
        self.toast('已撤销，学元退回可用', 'success');
        self.loadWithdrawals();
        self.loadOverview();
      }).catch(function (err) {
        self.toast(self.errMsg(err, '撤销失败'), 'error');
      }).then(function () {
        self.withdraw.busy = false;
      });
    },

    withdrawStatusText: function (s) {
      if (s === 'pending') return '待审批';
      if (s === 'paid') return '已提现';
      if (s === 'rejected') return '已驳回';
      if (s === 'cancelled') return '已撤销';
      return s || '';
    },

    claimDaily: function () {
      var self = this;
      if (self.daily.claimed || self.claiming) return;
      self.claiming = true;
      api.post('/wallet/daily').then(function (res) {
        var body = res.data || {};
        var d = body.data || {};
        if (body.code !== 200) throw { message: body.message };
        if (d.duplicate) {
          self.toast('今天已经领过了', 'info');
        } else {
          self.toast('津贴 +' + self.money(d.amount) + ' 学元，已到账', 'success');
          self.result = {
            open: true,
            amount: d.amount,
            text: '连签 ' + (d.streak || 1) + ' 天' + (d.streak >= self.daily.bonus_from ? '，今天拿的是加倍津贴' : '，第 ' + self.daily.bonus_from + ' 天起翻倍')
          };
        }
        if (d.account) self.account = d.account;
        if (d.daily) self.daily = d.daily;
        self.loadLedger(true);
        self.loadOverview();
      }).catch(function (err) {
        self.toast(self.errMsg(err, '领取失败'), 'error');
      }).then(function () {
        self.claiming = false;
      });
    },

    claimPacket: function (p) {
      var self = this;
      if (self.claimingId) return;
      self.claimingId = p.id;
      api.post('/wallet/packet/' + p.id + '/claim').then(function (res) {
        var body = res.data || {};
        if (body.code !== 200) throw { message: body.message };
        var d = body.data || {};
        if (d.account) self.account = d.account;
        self.result = {
          open: true,
          amount: d.amount || 0,
          text: d.duplicate ? '这个红包你已经领过了' : ('来自 ' + (p.sender_name || '同学') + ' 的红包')
        };
        self.loadPackets();
        self.loadLedger(true);
        self.loadOverview();
      }).catch(function (err) {
        self.toast(self.errMsg(err, '领取失败'), 'error');
      }).then(function () {
        self.claimingId = 0;
      });
    },

    packetStateShort: function (p) {
      if (p.status === 'done') return '已领完';
      if (p.status === 'expired') return '已过期';
      var left = Math.max(0, Math.round((p.expire_at - Date.now()) / 3600000));
      return left > 0 ? left + ' 小时' : '即将过期';
    },

    packetStateText: function (p) {
      if (p.status === 'done') return '全部领完';
      if (p.status === 'expired') return '未领完部分已退回';
      return '还剩 ' + p.remaining_count + ' 个，' + this.money(p.remaining) + ' 待领';
    },

    onSearchPeer: function () {
      // 选人模式下只做本地过滤（filteredPeople computed）
    },
    pickPeer: function (p) {
      this.transfer = Object.assign({}, this.transfer, {
        to: p.user_id,
        peerName: p.name || '',
        cross: !!p.remote
      });
      this.peopleQ = '';
    },
    pickRecent: function (p) {
      this.transfer.to = p.user_id;
      this.transfer.peerName = p.name || '';
      this.transfer.cross = false;
    },
    // 最近转账对象：从真实流水里提取，不额外维护一张表
    loadRecentPeers: function () {
      var self = this;
      api.get('/wallet/ledger', { params: { direction: 'out', limit: 30 } }).then(function (res) {
        var list = ((res.data && res.data.data) || {}).list || [];
        var seen = {};
        var out = [];
        list.forEach(function (r) {
          if (r.kind !== 'transfer') return;
          var name = String(r.memo || '').replace(/^转给\s*/, '').replace(/^跨班转出\s*·\s*/, '').trim();
          if (!name || seen[name] || out.length >= 3) return;
          seen[name] = 1;
          out.push({ user_id: '', name: name });
        });
        self.recentPeers = out;
      }).catch(function () { /* 没有最近联系人也正常 */ });
    },

    // ---- 转账：两步（填单 → 支付密码）----
    openTransfer: function () {
      this.transfer = { open: true, step: 'form', to: '', peerName: '', amount: '', memo: '', busy: false, pinError: '', cross: false };
      this.peopleQ = '';
      this.peerHits = [];
      this.loadPeople();
      this.loadRecentPeers();
    },
    clearPeer: function () {
      this.transfer = Object.assign({}, this.transfer, { to: '', peerName: '', cross: false });
    },
    // 全班名单（含跨班镜像同学，remote 标记），一次拉取本地过滤
    loadPeople: function () {
      var self = this;
      if (self.peopleLoaded) return;
      api.get('/wallet/people', { params: { limit: 120 } }).then(function (res) {
        var d = (res.data && res.data.data) || {};
        self.people = d.list || [];
        self.peopleLoaded = true;
      }).catch(function () { self.people = []; });
    },
    toggleTarget: function (p) {
      var arr = this.packet.targets.slice();
      var i = arr.indexOf(p.user_id);
      if (i >= 0) arr.splice(i, 1); else arr.push(p.user_id);
      this.packet = Object.assign({}, this.packet, { targets: arr });
    },
    closeTransfer: function () {
      this.transfer.open = false;
      this.transfer.busy = false;
    },
    transferNext: function () {
      var self = this;
      var f = self.transfer;
      var amount = toNum(f.amount);
      if (!(amount > 0)) return self.toast('金额要大于 0', 'error');
      if (amount > self.limits.transfer) return self.toast('单笔最多 ' + self.money(self.limits.transfer) + ' 学元', 'error');
      if (amount > self.account.available) return self.toast('可用学元不够（冻结部分不可用）', 'error');

      var to = String(f.to || '').trim();
      if (!to || !f.peerName) return self.toast('先选一位收款的同学', 'error');
      // 没设支付密码：直接带去设置页，别等输完 6 位再报错
      if (!self.payPinSet.set) {
        self.openPinSet();
        self.toast('先设置支付密码，再回来转账', 'info');
        return;
      }
      self.transfer = Object.assign({}, f, { step: 'pin', pinError: '' });
    },
    submitTransfer: function (pin) {
      var self = this;
      var f = self.transfer;
      if (f.busy) return;
      var amount = toNum(f.amount);
      self.transfer = Object.assign({}, f, { busy: true, pinError: '' });
      api.post('/wallet/transfer', {
        to: f.to,
        amount: amount,
        memo: f.memo,
        pin: pin,
        request_id: 'w' + Date.now() + '-' + Math.floor(Math.random() * 10000)
      }).then(function (res) {
        var body = res.data || {};
        if (body.code !== 200) {
          var e = new Error(body.message || '转账失败');
          e.payPin = body.data && body.data.pay_pin;
          throw e;
        }
        var d = body.data || {};
        if (d.account) self.account = d.account;
        self.transfer.open = false;
        var pendingCross = d.status === 'pending';
        self.result = {
          open: true,
          title: pendingCross ? '转账处理中' : '转账成功',
          amount: 0,
          text: '已转给 ' + (f.peerName || d.to_name || d.to) + ' ' + self.money(d.amount) + ' 学元' +
            (f.memo ? '（' + f.memo + '）' : '') +
            (d.cross ? ' · 跨班，对方班级已入账' : '') +
            (pendingCross ? '（对方班级暂时没响应，稍后自动重试）' : ''),
          code: '',
          copied: false
        };
        self.loadLedger(true);
        self.loadOverview();
      }).catch(function (err) {
        var pp = err && err.payPin;
        var msg = self.errMsg(err, '转账失败');
        if (pp && pp.need_setup) msg = '还没设置支付密码，请先到「支付密码」里设置';
        else if (pp && pp.locked) msg = '连续输错已锁定，请 15 分钟后再试';
        else if (pp && typeof pp.remaining === 'number') msg = msg + '（还剩 ' + pp.remaining + ' 次）';
        self.transfer = Object.assign({}, self.transfer, { busy: false, pinError: msg });
      });
    },

    // ---- 红包：两步 ----
    openPacket: function () {
      this.packet = { open: true, step: 'form', total: '', count: '5', note: '', scope: 'local', kind: 'normal', targets: [], busy: false, pinError: '' };
      this.peopleQ = '';
      this.loadPeople();
    },
    closePacket: function () {
      this.packet.open = false;
      this.packet.busy = false;
    },
    packetNext: function () {
      var self = this;
      var f = self.packet;
      var total = toNum(f.total);
      var count = parseInt(f.count, 10);
      if (!(total > 0)) return self.toast('总金额要大于 0', 'error');
      if (f.kind === 'designated') {
        if (!f.targets.length) return self.toast('先选要发给哪些同学', 'error');
        if (self.perTarget <= 0) return self.toast('金额不够分，每人至少 0.01 学元', 'error');
      } else {
        if (!(count >= 1 && count <= self.limits.packet_count)) {
          return self.toast('红包个数要在 1–' + self.limits.packet_count + ' 之间', 'error');
        }
        if (f.kind === 'phrase' && !String(f.note || '').trim()) {
          return self.toast('写一句口令，领红包的时候要输的', 'error');
        }
      }
      if (total > self.account.available) return self.toast('可用学元不够（冻结部分不可用）', 'error');
      if (!self.payPinSet.set) {
        self.openPinSet();
        self.toast('先设置支付密码，再回来发红包', 'info');
        return;
      }
      self.packet = Object.assign({}, f, { step: 'pin', pinError: '' });
    },
    submitPacket: function (pin) {
      var self = this;
      var f = self.packet;
      if (f.busy) return;
      var total = toNum(f.total);
      var count = parseInt(f.count, 10);
      self.packet = Object.assign({}, f, { busy: true, pinError: '' });
      api.post('/wallet/packet', {
        total: total, count: count, note: f.note, pin: pin, scope: f.scope || 'local',
        kind: f.kind || 'normal', targets: f.kind === 'designated' ? f.targets : []
      }).then(function (res) {
        var body = res.data || {};
        if (body.code !== 200) {
          var e = new Error(body.message || '发红包失败');
          e.payPin = body.data && body.data.pay_pin;
          throw e;
        }
        var d = body.data || {};
        self.packet.open = false;
        var isCross = (d.scope === 'cross');
        var kind = d.kind || 'normal';
        var title = '红包已发出';
        var text;
        if (kind === 'designated') {
          title = '专属红包已发出';
          text = '已冻结 ' + self.money(d.total) + ' 学元，' + (d.count || count) +
            ' 位同学各领一份；只有被选中的同学能领，24 小时没领完自动退回';
        } else if (kind === 'phrase') {
          title = '口令红包已发出';
          text = '已冻结 ' + self.money(d.total) + ' 学元。领的时候要输入口令「' + (d.passphrase || f.note) + '」，发到聊天里让大家照着输；24 小时没领完自动退回';
        } else if (isCross) {
          text = '已冻结 ' + self.money(d.total) + ' 学元，' + (d.count || count) +
            ' 个。把下面的红包码发给外班同学，他们在「红包 → 红包码 / 口令」里领取；24 小时没领完自动退回';
        } else {
          text = '已冻结 ' + self.money(d.total) + ' 学元，' + (d.count || count) + ' 个；同学在红包页领取，24 小时没领完自动退回';
        }
        self.result = {
          open: true,
          title: title,
          amount: 0,
          text: text,
          code: (isCross && d.code) ? d.code : '',
          copied: false
        };
        self.loadOverview();
        self.loadPackets();
        self.loadLedger(true);
        self.switchTab('packets');
      }).catch(function (err) {
        var pp = err && err.payPin;
        var msg = self.errMsg(err, '发红包失败');
        if (pp && pp.need_setup) msg = '还没设置支付密码，请先到「支付密码」里设置';
        else if (pp && pp.locked) msg = '连续输错已锁定，请 15 分钟后再试';
        else if (pp && typeof pp.remaining === 'number') msg = msg + '（还剩 ' + pp.remaining + ' 次）';
        self.packet = Object.assign({}, self.packet, { busy: false, pinError: msg });
      });
    },

    // ---- 支付密码 ----
    openPinSet: function () {
      var isSet = !!this.payPinSet.set;
      this.pinSet = {
        open: true,
        mode: isSet ? 'change' : 'set',
        title: isSet ? '修改支付密码' : '设置支付密码',
        tip: isSet ? '修改前需要验证当前支付密码' : '第一次使用要先设置 6 位支付密码',
        pin: '', password: '', oldPin: '', busy: false, error: ''
      };
    },
    switchPinMode: function (mode) {
      this.pinSet = Object.assign({}, this.pinSet, {
        mode: mode,
        title: mode === 'reset' ? '重设支付密码' : (mode === 'change' ? '修改支付密码' : '设置支付密码'),
        tip: mode === 'reset' ? '用登录密码证明是你本人，然后设一个新的支付密码' : '修改前需要验证当前支付密码',
        error: '', pin: '', password: '', oldPin: ''
      });
    },
    submitPinSet: function () {
      var self = this;
      var f = self.pinSet;
      if (f.busy) return;
      if (!/^\d{6}$/.test(String(f.pin || ''))) {
        self.pinSet = Object.assign({}, f, { error: '支付密码必须是 6 位数字' });
        return;
      }
      var url, payload;
      if (f.mode === 'change') {
        if (!/^\d{6}$/.test(String(f.oldPin || ''))) {
          self.pinSet = Object.assign({}, f, { error: '请输入 6 位旧支付密码' });
          return;
        }
        url = '/wallet/pay-pin/change';
        payload = { old_pin: f.oldPin, new_pin: f.pin };
      } else if (f.mode === 'reset') {
        url = '/wallet/pay-pin/reset';
        payload = { password: f.password, new_pin: f.pin };
      } else {
        url = '/wallet/pay-pin';
        payload = { pin: f.pin, password: f.password };
      }
      self.pinSet = Object.assign({}, f, { busy: true, error: '' });
      api.post(url, payload).then(function (res) {
        var body = res.data || {};
        if (body.code !== 200) throw new Error(body.message || '设置失败');
        self.payPinSet = { set: true };
        self.pinSet = Object.assign({}, self.pinSet, { busy: false, open: false });
        self.result = { open: true, title: '支付密码', amount: 0, text: '支付密码已就绪，现在可以转账和发红包了' };
      }).catch(function (err) {
        self.pinSet = Object.assign({}, self.pinSet, {
          busy: false,
          error: self.errMsg(err, '设置失败')
        });
      });
    },

    // ---- 红包码（跨班）----
    packetCodeText: function (code) {
      return '学元红包码 ' + code + '，在「学元钱包 → 红包 → 输入红包码」里领取';
    },
    copyPacketCode: function (code) {
      var self = this;
      if (!code) return;
      self.copyText(self.packetCodeText(code)).then(function () {
        self.copiedCode = code;
        self.toast('红包码已复制：' + code, 'success');
        setTimeout(function () { if (self.copiedCode === code) self.copiedCode = ''; }, 3000);
      });
    },
    copyResultCode: function () {
      var self = this;
      if (!self.result.code) return;
      self.copyText(self.packetCodeText(self.result.code)).then(function () {
        self.result = Object.assign({}, self.result, { copied: true });
        self.toast('红包码已复制', 'success');
      });
    },
    // 通用复制（平板浏览器可能没有 clipboard API）
    copyText: function (text) {
      return new Promise(function (resolve) {
        function fallback() {
          try {
            var ta = document.createElement('textarea');
            ta.value = text;
            ta.style.position = 'fixed';
            ta.style.left = '-9999px';
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
            resolve(true);
          } catch (e) { resolve(false); }
        }
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(function () { resolve(true); }).catch(fallback);
        } else { fallback(); }
      });
    },

    // ---- 凭红包码 / 口令领取（本班/跨班同一个入口）----
    openClaimCode: function () {
      this.claimCode = { open: true, mode: 'code', input: '', info: null, busy: false, error: '' };
    },
    // 列表里的口令红包：直接带着红包信息进输入口令页
    openClaimPhrase: function (p) {
      this.claimCode = { open: true, mode: 'phrase', input: '', info: p, busy: false, error: '' };
    },
    resetClaim: function () {
      this.claimCode = Object.assign({}, this.claimCode, { info: null, input: '', error: '' });
    },
    lookupCode: function () {
      var self = this;
      var input = String(self.claimCode.input || '').trim();
      if (!input) return self.claimCode = Object.assign({}, self.claimCode, { error: '先输入红包码或口令' });
      var isCode = /^[A-Z0-9]{4,12}$/.test(input.toUpperCase()) && !/[\u4e00-\u9fa5]/.test(input);
      self.claimCode = Object.assign({}, self.claimCode, { busy: true, error: '' });
      var params = isCode ? { code: input.toUpperCase() } : { phrase: input };
      api.get('/wallet/packet/info', { params: params }).then(function (res) {
        var body = res.data || {};
        if (body.code !== 200) throw new Error(body.message || '没找到这个红包');
        var d = body.data || {};
        if (d.mine) throw new Error('这是你自己发的红包');
        self.claimCode = Object.assign({}, self.claimCode, { busy: false, info: d });
      }).catch(function (err) {
        self.claimCode = Object.assign({}, self.claimCode, {
          busy: false,
          error: self.errMsg(err, '没找到这个红包，检查一下红包码或口令')
        });
      });
    },
    submitClaimCode: function () {
      var self = this;
      if (self.claimCode.busy) return;
      var info = self.claimCode.info || {};
      var input = String(self.claimCode.input || '').trim();
      self.claimCode = Object.assign({}, self.claimCode, { busy: true, error: '' });
      var req;
      if (self.claimCode.mode === 'phrase') {
        // 列表点进来的口令红包（本班）：原接口带 phrase
        req = api.post('/wallet/packet/' + info.id + '/claim', { phrase: input });
      } else if (info.id && !info.cross) {
        req = api.post('/wallet/packet/' + info.id + '/claim', { phrase: info.kind === 'phrase' ? input : undefined });
      } else {
        // 跨班：红包码 / 口令 / pid 都走同一个入口
        req = api.post('/wallet/packet/claim-code', {
          code: info.code || undefined,
          phrase: info.kind === 'phrase' ? input : (info.code ? undefined : input),
          packet_id: info.cross && info.id ? info.id : undefined,
          base: info.base_url || ''
        });
      }
      req.then(function (res) {
        var body = res.data || {};
        if (body.code !== 200) throw new Error(body.message || '领取失败');
        var d = body.data || {};
        if (d.account) self.account = d.account;
        self.claimCode.open = false;
        self.result = {
          open: true,
          title: d.pending ? '红包领取中' : '红包到账',
          amount: d.amount || 0,
          text: d.pending
            ? '红包已在分配，班级之间网络恢复后会自动到账（不用重复操作）'
            : (d.duplicate ? '这个红包你已经领过了' : '已存入学元余额'),
          code: '',
          copied: false
        };
        self.loadOverview();
        self.loadPackets();
        self.loadLedger(true);
        if (self.tab === 'packets') self.switchTab('packets');
      }).catch(function (err) {
        self.claimCode = Object.assign({}, self.claimCode, {
          busy: false,
          error: self.errMsg(err, '领取失败')
        });
      });
    },
    kindText: function (kind) {
      if (kind === 'designated') return '专属红包';
      if (kind === 'phrase') return '口令红包';
      return '红包';
    },

    forgotPin: function () {
      // 在密码键盘上忘密码 / 没设置：直接带到设置页
      this.openPinSet();
    },

    errMsg: function (err, fallback) {
      if (err && err.__offline) return '网络不可用，请检查连接';
      // 业务文案优先：后端返回的「未设置支付密码 / 可用学元不足…」才是用户要看的。
      // 之前先取 err.message，而 axios 对 4xx 永远给一句
      // "Request failed with status code 400"，把真正的原因挡在了后面。
      var body = (err && err.business) || (err && err.response && err.response.data);
      if (body && body.message) return body.message;
      if (err && err.message) return err.message;
      return fallback;
    }
  }
};
</script>

<style scoped>
.wallet-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg-color);
  color: var(--text-primary);
}

.nav-btn {
  width: 34px;
  height: 34px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  color: var(--text-secondary);
  background: transparent;
}
.nav-btn:hover { background: rgba(var(--primary-rgb, 0, 122, 255), 0.08); }
.spinning { animation: spin 0.9s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

.wallet-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}
.wallet-inner {
  max-width: 880px;
  margin: 0 auto;
  padding: 16px 18px 28px;
  box-sizing: border-box;
}

/* ---------- 余额卡 ---------- */
.bal-card {
  position: relative;
  overflow: hidden;
  padding: 18px 20px 16px;
  border-radius: 20px;
  color: #fff;
  background: linear-gradient(135deg, #F2A93B 0%, #E08B1E 52%, #C8731A 100%);
  box-shadow: 0 12px 30px rgba(200, 121, 26, 0.26);
}
.bal-glow {
  position: absolute;
  top: -60px;
  right: -40px;
  width: 200px;
  height: 200px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(255, 255, 255, 0.34), rgba(255, 255, 255, 0) 70%);
}
.bal-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  position: relative;
}
.bal-label { font-size: var(--font-size-footnote); opacity: 0.9; letter-spacing: 0.4px; }
.bal-ico {
  width: 30px;
  height: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.2);
  font-size: 13px;
}
.bal-amount {
  position: relative;
  margin: 6px 0 2px;
  font-size: 36px;
  font-weight: 700;
  letter-spacing: -0.5px;
  line-height: 1.15;
  font-variant-numeric: tabular-nums;
}
.bal-split {
  position: relative;
  display: flex;
  align-items: center;
  font-size: var(--font-size-caption);
  opacity: 0.92;
}
.bal-split b { font-weight: 600; }
.bal-split .dot {
  width: 3px;
  height: 3px;
  margin: 0 8px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.6);
}
.bal-foot {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 14px;
}
.daily-btn {
  display: flex;
  align-items: center;
  height: 34px;
  padding: 0 14px;
  border-radius: 17px;
  background: rgba(255, 255, 255, 0.95);
  color: #B4690E;
  font-size: var(--font-size-footnote);
  font-weight: 600;
}
.daily-btn i { margin-right: 6px; }
.daily-btn:active { transform: scale(0.97); }
.daily-btn.done {
  background: rgba(255, 255, 255, 0.22);
  color: rgba(255, 255, 255, 0.92);
  font-weight: 500;
}
.bal-week { font-size: var(--font-size-caption); opacity: 0.95; }
.bal-week b { font-weight: 600; }
.bal-week .in { color: #FFF6D8; }
.bal-week .out { color: rgba(255, 255, 255, 0.85); }

/* 双钱包：充值/赠送分栏 */
.bp-row {
  position: relative;
  display: flex;
  margin-top: 10px;
}
.bp-item {
  flex: 1;
  min-width: 0;
  padding: 9px 11px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.14);
  display: flex;
  flex-direction: column;
}
.bp-item + .bp-item { margin-left: 10px; }
.bp-name {
  display: flex;
  align-items: center;
  font-size: 10px;
  opacity: 0.92;
}
.bp-name i { margin-right: 5px; }
.bp-num {
  margin-top: 3px;
  font-size: 17px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.bp-sub { font-size: 10px; opacity: 0.86; }
.bp-sub em { font-style: normal; }
.bp-tag {
  align-self: flex-start;
  margin-top: 4px;
  padding: 1px 6px;
  border-radius: 7px;
  background: rgba(255, 255, 255, 0.22);
  font-size: 9px;
}
.bal-withdraw {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 10px;
  padding: 8px 11px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.12);
  font-size: 11px;
  cursor: pointer;
}
.bal-withdraw b { font-weight: 700; }
.bw-link { display: flex; align-items: center; font-size: 10px; opacity: 0.9; }
.bw-link i { margin-left: 3px; font-size: 9px; }
.bal-withdraw:active { opacity: 0.75; }

/* 流水资金池标签 */
.lr-pool {
  display: inline-block;
  margin-right: 4px;
  padding: 0 5px;
  border-radius: 4px;
  font-style: normal;
  font-size: 9px;
  line-height: 14px;
}
.lr-pool.cash { color: #2F7CF6; background: rgba(47, 124, 246, 0.1); }
.lr-pool.grant { color: #D08A17; background: rgba(208, 138, 23, 0.12); }

/* ---------- 快捷 ---------- */
.quick-row {
  display: flex;
  margin: 14px -6px 4px;
}
.quick {
  position: relative;
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 62px;
  margin: 0 6px;
  border-radius: 14px;
  background: var(--card-bg);
  border: 1px solid var(--border-color);
  color: var(--text-primary);
  font-size: 11px;
  line-height: 1;
}
.quick:active { transform: scale(0.985); }
.q-ico {
  width: 26px;
  height: 26px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 5px;
  border-radius: 9px;
  font-size: 12px;
}
.q-txt { font-size: 11px; color: var(--text-secondary); }
.q-ico.blue { color: #2F7CF6; background: rgba(47, 124, 246, 0.12); }
.q-ico.red { color: #E4574F; background: rgba(228, 87, 79, 0.12); }
.q-ico.gold { color: #D08A17; background: rgba(208, 138, 23, 0.14); }
.q-ico.purple { color: #7B5CD6; background: rgba(123, 92, 214, 0.12); }
.q-ico.teal { color: #0E9AA7; background: rgba(14, 154, 167, 0.12); }
.q-badge {
  position: absolute;
  top: 4px;
  right: 10px;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 8px;
  background: #E4574F;
  color: #fff;
  font-size: 10px;
  line-height: 16px;
  text-align: center;
}

/* ---------- 分段 ---------- */
.seg {
  display: flex;
  margin: 14px 0 10px;
  padding: 3px;
  border-radius: 12px;
  background: rgba(var(--primary-rgb, 0, 122, 255), 0.06);
}
.seg-btn {
  flex: 1;
  height: 32px;
  border-radius: 9px;
  font-size: var(--font-size-footnote);
  color: var(--text-secondary);
}
.seg-btn.active {
  background: var(--card-bg);
  color: var(--text-primary);
  font-weight: 600;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.08);
}

/* ---------- 明细 ---------- */
.panel { min-height: 120px; }
.filters {
  display: flex;
  align-items: center;
  margin-bottom: 8px;
}
.filter {
  height: 28px;
  padding: 0 12px;
  margin-right: 8px;
  border-radius: 14px;
  background: var(--card-bg);
  border: 1px solid var(--border-color);
  color: var(--text-secondary);
  font-size: var(--font-size-caption);
}
.filter.active {
  border-color: transparent;
  background: rgba(var(--primary-rgb, 0, 122, 255), 0.12);
  color: var(--primary-color);
  font-weight: 600;
}
.filter-sum {
  margin-left: auto;
  font-size: var(--font-size-caption);
  color: var(--text-tertiary);
}
.ledger {
  border-radius: 14px;
  background: var(--card-bg);
  border: 1px solid var(--border-color);
  overflow: hidden;
}
.ledger-row {
  display: flex;
  align-items: center;
  padding: 11px 14px;
}
.ledger-row + .ledger-row { border-top: 1px solid var(--separator-color, var(--border-color)); }
.lr-ico {
  flex: 0 0 32px;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-right: 10px;
  border-radius: 10px;
  font-size: 12px;
}
.lr-ico.in { color: #D9534F; background: rgba(217, 83, 79, 0.1); }
.lr-ico.out { color: #2E9E5B; background: rgba(46, 158, 91, 0.1); }
.lr-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.lr-title {
  font-size: var(--font-size-subheadline);
  color: var(--text-primary);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.lr-sub {
  margin-top: 2px;
  font-size: 11px;
  color: var(--text-tertiary);
}
.lr-right {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  margin-left: 10px;
}
.lr-amount {
  font-size: var(--font-size-subheadline);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.lr-amount.in { color: #D9534F; }
.lr-amount.out { color: #2E9E5B; }
.lr-bal {
  margin-top: 2px;
  font-size: 10px;
  color: var(--text-tertiary);
  font-variant-numeric: tabular-nums;
}
.more-btn {
  width: 100%;
  height: 42px;
  border-top: 1px solid var(--border-color);
  color: var(--primary-color);
  font-size: var(--font-size-footnote);
  background: transparent;
}
.hint { padding: 22px; text-align: center; color: var(--text-tertiary); font-size: var(--font-size-footnote); }

.empty {
  padding: 34px 18px;
  text-align: center;
  color: var(--text-tertiary);
}
.empty i { font-size: 26px; opacity: 0.5; }
.empty p { margin: 8px 0 0; font-size: var(--font-size-footnote); }
.empty-sub { font-size: var(--font-size-caption); opacity: 0.8; }
.empty.small { padding: 18px; }
.empty.small i { font-size: 20px; }

/* ---------- 红包 ---------- */
.pkt-actions {
  display: flex;
  align-items: center;
  margin-bottom: 12px;
}
.pkt-send {
  height: 36px;
  padding: 0 16px;
  border-radius: 18px;
  background: #E4574F;
  color: #fff;
  font-size: var(--font-size-footnote);
  font-weight: 600;
}
.pkt-send i { margin-right: 6px; }
.pkt-code-btn {
  height: 36px;
  margin-left: 10px;
  padding: 0 14px;
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid var(--border-color);
  color: var(--text-primary);
  font-size: var(--font-size-footnote);
}
.pkt-code-btn i { margin-right: 6px; color: var(--text-secondary); }
.pkt-tip {
  margin: 0 0 12px;
  font-size: 11px;
  line-height: 1.7;
  color: var(--text-tertiary);
}
/* 我的跨班红包码 */
.pkt-codes {
  margin-bottom: 14px;
  padding: 10px 12px;
  border-radius: 12px;
  background: rgba(228, 87, 79, 0.06);
  border: 1px solid rgba(228, 87, 79, 0.18);
}
.pkt-codes-head {
  margin-bottom: 8px;
  font-size: 11px;
  color: var(--text-secondary);
}
.pkt-code-row {
  display: flex;
  align-items: center;
  padding: 6px 0;
}
.pkt-code-row + .pkt-code-row { border-top: 1px solid rgba(255, 255, 255, 0.05); }
.pcr-code {
  flex: 0 0 auto;
  margin-right: 10px;
  padding: 3px 8px;
  border-radius: 6px;
  background: rgba(228, 87, 79, 0.14);
  color: #FF8B80;
  font-size: 13px;
  font-weight: 700;
  font-family: 'SF Mono', Menlo, Consolas, monospace;
  letter-spacing: 1px;
}
.pcr-main {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 11px;
  color: var(--text-secondary);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.pcr-left { flex: 0 0 auto; margin: 0 8px; font-size: 11px; color: var(--text-tertiary); }
.pcr-copy {
  flex: 0 0 auto;
  padding: 4px 10px;
  border-radius: 10px;
  background: rgba(228, 87, 79, 0.16);
  color: #FF8B80;
  font-size: 11px;
}
.sec-title {
  display: flex;
  align-items: center;
  margin: 14px 2px 8px;
  font-size: var(--font-size-footnote);
  font-weight: 600;
  color: var(--text-secondary);
}
.sec-count {
  margin-left: 6px;
  padding: 0 6px;
  height: 16px;
  border-radius: 8px;
  background: #E4574F;
  color: #fff;
  font-size: 10px;
  line-height: 16px;
}
.pkt-list { display: flex; flex-direction: column; }
.pkt-card {
  display: flex;
  align-items: center;
  padding: 12px 14px;
  margin-bottom: 8px;
  border-radius: 14px;
  background: var(--card-bg);
  border: 1px solid var(--border-color);
}
.pkt-face {
  flex: 0 0 34px;
  width: 34px;
  height: 34px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-right: 10px;
  border-radius: 10px;
  background: rgba(228, 87, 79, 0.1);
  color: #E4574F;
}
.pkt-face.gold { background: rgba(208, 138, 23, 0.12); color: #D08A17; }
.pkt-main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.pkt-title { font-size: var(--font-size-subheadline); color: var(--text-primary); }
.pkt-sub { margin-top: 2px; font-size: 11px; color: var(--text-tertiary); }
.pkt-claim {
  height: 30px;
  padding: 0 14px;
  border-radius: 15px;
  background: #E4574F;
  color: #fff;
  font-size: var(--font-size-caption);
  font-weight: 600;
}
.pkt-state { font-size: var(--font-size-caption); color: var(--text-tertiary); }
.pkt-state.done { color: #2E9E5B; }
.pkt-state.expired { color: var(--text-tertiary); }
.pkt-amount { font-size: var(--font-size-subheadline); font-weight: 600; }
.pkt-amount.in { color: #D9534F; }

/* ---------- 排行 ---------- */
.rank-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 10px;
  font-size: var(--font-size-footnote);
  font-weight: 600;
}
.rank-mine { font-size: var(--font-size-caption); font-weight: 400; color: var(--text-secondary); }
.rank-mine b { color: var(--primary-color); }
.rank-list {
  border-radius: 14px;
  background: var(--card-bg);
  border: 1px solid var(--border-color);
  overflow: hidden;
}
.rank-row {
  display: flex;
  align-items: center;
  padding: 10px 14px;
}
.rank-row + .rank-row { border-top: 1px solid var(--separator-color, var(--border-color)); }
.rank-row.me { background: rgba(var(--primary-rgb, 0, 122, 255), 0.06); }
.rank-no {
  flex: 0 0 26px;
  font-size: var(--font-size-footnote);
  font-weight: 600;
  color: var(--text-tertiary);
  font-variant-numeric: tabular-nums;
}
.rank-no.top1 { color: #E0A020; }
.rank-no.top2 { color: #9AA4AE; }
.rank-no.top3 { color: #C08457; }
.rank-name { flex: 1; font-size: var(--font-size-subheadline); }
.rank-name em {
  margin-left: 6px;
  padding: 1px 5px;
  border-radius: 6px;
  background: rgba(var(--primary-rgb, 0, 122, 255), 0.12);
  color: var(--primary-color);
  font-size: 10px;
  font-style: normal;
}
.rank-bal { font-size: var(--font-size-subheadline); font-weight: 600; font-variant-numeric: tabular-nums; }
.rank-tip {
  margin: 10px 2px 0;
  font-size: 11px;
  line-height: 1.6;
  color: var(--text-tertiary);
}

/* ---------- 来源 ---------- */
.sources {
  margin-top: 18px;
  padding: 14px 16px;
  border-radius: 16px;
  background: var(--card-bg);
  border: 1px solid var(--border-color);
}
.src-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 10px;
  font-size: var(--font-size-footnote);
  font-weight: 600;
}
.src-note { font-size: 11px; font-weight: 400; color: var(--text-tertiary); }
.src-grid { display: flex; flex-wrap: wrap; margin: 0 -6px; }
.src-item {
  display: flex;
  width: calc(50% - 12px);
  margin: 5px 6px;
  padding: 8px 10px;
  box-sizing: border-box;
  border-radius: 11px;
  background: var(--bg-color);
}
.src-ico {
  flex: 0 0 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-right: 8px;
  border-radius: 8px;
  background: rgba(208, 138, 23, 0.12);
  color: #D08A17;
  font-size: 10px;
}
.src-main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.src-name { font-size: var(--font-size-caption); color: var(--text-primary); }
.src-name em {
  margin-left: 6px;
  font-style: normal;
  color: #D08A17;
  font-weight: 600;
}
.src-desc { margin-top: 2px; font-size: 10px; color: var(--text-tertiary); line-height: 1.5; }

/* ---------- 弹窗 ---------- */
.mask {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 80;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.38);
}
.modal {
  width: 360px;
  max-width: 88vw;
  border-radius: 18px;
  background: var(--card-bg);
  box-shadow: 0 22px 60px rgba(0, 0, 0, 0.28);
  overflow: hidden;
}
.modal-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid var(--border-color);
  font-size: var(--font-size-headline, 15px);
  font-weight: 600;
}
.modal-x {
  width: 30px;
  height: 30px;
  border-radius: 8px;
  color: var(--text-secondary);
}
.modal-x:hover { background: var(--bg-color); }
.modal-body { padding: 14px 16px 16px; }
.fld {
  display: flex;
  align-items: center;
  margin-bottom: 10px;
}
.fld > span {
  flex: 0 0 60px;
  font-size: var(--font-size-footnote);
  color: var(--text-secondary);
}
.fld input {
  flex: 1;
  min-width: 0;
  height: 38px;
  padding: 0 10px;
  box-sizing: border-box;
  border-radius: 9px;
  border: 1px solid var(--border-color);
  background: var(--bg-color);
  color: var(--text-primary);
  font-size: var(--font-size-subheadline);
  outline: none;
}
.fld input:focus { border-color: var(--primary-color); }
.fld-tip {
  margin: 2px 0 12px;
  font-size: 11px;
  line-height: 1.6;
  color: var(--text-tertiary);
}
.peer-hits {
  margin: -4px 0 10px 60px;
  border-radius: 10px;
  border: 1px solid var(--border-color);
  overflow: hidden;
}
.peer-hit {
  display: flex;
  align-items: center;
  width: 100%;
  padding: 7px 10px;
  font-size: var(--font-size-caption);
  color: var(--text-primary);
  text-align: left;
  background: var(--bg-color);
}
.peer-hit + .peer-hit { border-top: 1px solid var(--border-color); }
.peer-hit em { margin-left: auto; font-style: normal; color: var(--text-tertiary); }
.submit {
  width: 100%;
  height: 42px;
  border-radius: 11px;
  background: var(--primary-color);
  color: #fff;
  font-size: var(--font-size-subheadline);
  font-weight: 600;
}
.submit:disabled { opacity: 0.6; }

.result {
  width: 300px;
  padding: 22px 20px 20px;
  text-align: center;
}
.result-face {
  width: 54px;
  height: 54px;
  margin: 0 auto 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: rgba(228, 87, 79, 0.1);
  color: #E4574F;
  font-size: 22px;
}
.result-amount {
  font-size: 30px;
  font-weight: 700;
  color: #D9534F;
  font-variant-numeric: tabular-nums;
}
.result-text {
  margin: 6px 0 16px;
  font-size: var(--font-size-footnote);
  color: var(--text-secondary);
}

/* ---------- 提现 ---------- */
.wd-hero {
  padding: 16px;
  border-radius: 14px;
  background: linear-gradient(135deg, rgba(123, 92, 214, 0.16), rgba(47, 124, 246, 0.1));
  border: 1px solid rgba(123, 92, 214, 0.2);
}
.wd-hero-label { display: block; font-size: 11px; color: var(--text-secondary); }
.wd-hero-num {
  display: block;
  margin: 4px 0 6px;
  font-size: 28px;
  font-weight: 700;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
}
.wd-hero-tip {
  display: block;
  font-size: 10px;
  line-height: 1.7;
  color: var(--text-tertiary);
}
.wd-form {
  margin-top: 12px;
  padding: 0 14px 14px;
  border-radius: 14px;
  background: var(--card-bg);
  border: 1px solid var(--border-color);
}
.wd-hint {
  margin: 10px 0 12px;
  font-size: 10px;
  line-height: 1.7;
  color: var(--text-tertiary);
}
.wd-list {
  border-radius: 14px;
  background: var(--card-bg);
  border: 1px solid var(--border-color);
  overflow: hidden;
}
.wd-row {
  display: flex;
  align-items: center;
  padding: 11px 14px;
}
.wd-row + .wd-row { border-top: 1px solid var(--separator-color, var(--border-color)); }
.wd-ico {
  flex: 0 0 30px;
  width: 30px;
  height: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-right: 10px;
  border-radius: 9px;
  font-size: 11px;
}
.wd-ico.pending { color: #D08A17; background: rgba(208, 138, 23, 0.12); }
.wd-ico.paid { color: #2E9E5B; background: rgba(46, 158, 91, 0.12); }
.wd-ico.rejected { color: #E4574F; background: rgba(228, 87, 79, 0.12); }
.wd-ico.cancelled { color: var(--text-tertiary); background: rgba(127, 127, 127, 0.12); }
.wd-main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.wd-title {
  display: flex;
  align-items: center;
  font-size: var(--font-size-subheadline);
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
}
.wd-status {
  margin-left: 8px;
  padding: 1px 6px;
  border-radius: 7px;
  font-style: normal;
  font-size: 9px;
  line-height: 14px;
}
.wd-status.pending { color: #D08A17; background: rgba(208, 138, 23, 0.12); }
.wd-status.paid { color: #2E9E5B; background: rgba(46, 158, 91, 0.12); }
.wd-status.rejected { color: #E4574F; background: rgba(228, 87, 79, 0.12); }
.wd-status.cancelled { color: var(--text-tertiary); background: rgba(127, 127, 127, 0.12); }
.wd-sub {
  margin-top: 2px;
  font-size: 10px;
  color: var(--text-tertiary);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.wd-cancel {
  flex: 0 0 auto;
  height: 26px;
  margin-left: 8px;
  padding: 0 10px;
  border-radius: 13px;
  border: 1px solid var(--border-color);
  color: var(--text-secondary);
  font-size: 11px;
}
.wd-cancel:active { opacity: 0.7; }

/* ---------- 充值说明 ---------- */
.rc-rate {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-radius: 14px;
  background: linear-gradient(135deg, rgba(208, 138, 23, 0.18), rgba(242, 169, 59, 0.08));
  border: 1px solid rgba(208, 138, 23, 0.22);
}
.rc-rate-label { font-size: 12px; color: var(--text-secondary); }
.rc-rate-num { font-size: 20px; font-weight: 700; color: #D08A17; }
.rc-steps { margin: 14px 0; }
.rc-step {
  display: flex;
  align-items: flex-start;
  padding: 7px 0;
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-secondary);
}
.rc-step em {
  flex: 0 0 20px;
  width: 20px;
  height: 20px;
  margin-right: 9px;
  border-radius: 50%;
  background: rgba(var(--primary-rgb, 0, 122, 255), 0.12);
  color: var(--primary-color);
  font-style: normal;
  font-size: 11px;
  font-weight: 600;
  line-height: 20px;
  text-align: center;
}
.rc-split { display: flex; margin-bottom: 12px; }
.rc-split-item {
  flex: 1;
  display: flex;
  flex-direction: column;
  padding: 10px 12px;
  border-radius: 12px;
  line-height: 1.5;
}
.rc-split-item + .rc-split-item { margin-left: 10px; }
.rc-split-item i { font-size: 13px; margin-bottom: 3px; }
.rc-split-item b { font-size: 12px; }
.rc-split-item span { margin-top: 2px; font-size: 10px; opacity: 0.86; }
.rc-split-item.cash { color: #2F7CF6; background: rgba(47, 124, 246, 0.1); }
.rc-split-item.grant { color: #D08A17; background: rgba(208, 138, 23, 0.12); }

/* ---------- 窄屏 ---------- */
@media (max-width: 620px) {
  .wallet-inner { padding: 12px 12px 22px; }
  .bal-amount { font-size: 30px; }
  .src-item { width: calc(100% - 12px); }
  .q-txt { font-size: 10px; }
  .q-ico { margin-bottom: 4px; }
  .bal-week { font-size: 10px; }
}

/* ---------- 全屏支付页内容 ---------- */
.q-ico.green { color: #1F9D55; background: rgba(31, 157, 85, 0.12); }

.pay-form {
  max-width: 560px;
  margin: 0 auto;
  padding: 18px 22px 26px;
}
.pay-amount {
  display: flex;
  align-items: flex-end;
  padding: 16px 0 12px;
  border-bottom: 1px solid var(--border-color);
}
.pay-currency {
  margin-right: 8px;
  font-size: 26px;
  font-weight: 600;
  color: var(--text-primary);
}
.pay-amount-input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  font-size: 40px;
  font-weight: 700;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
}
.pay-amount--packet .pay-currency,
.pay-amount--packet .pay-amount-input { color: #D93B32; }
.pay-row {
  display: flex;
  align-items: center;
  padding: 13px 0;
  border-bottom: 1px solid var(--border-color);
}
.pay-row > span {
  flex: 0 0 64px;
  font-size: var(--font-size-subheadline);
  color: var(--text-secondary);
}
.pay-row input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  font-size: var(--font-size-subheadline);
  color: var(--text-primary);
  text-align: right;
}
.pay-hint {
  margin: 14px 0 18px;
  font-size: 11px;
  line-height: 1.7;
  color: var(--text-tertiary);
}
.pay-primary {
  width: 100%;
  height: 46px;
  border-radius: 12px;
  background: #07C160;
  color: #fff;
  font-size: 16px;
  font-weight: 600;
}
.pay-primary:disabled { opacity: 0.6; }
.pay-primary--packet { background: #E4574F; }

.pay-result { padding: 52px 26px 26px; text-align: center; }
.pay-result-icon {
  width: 64px;
  height: 64px;
  margin: 0 auto 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: rgba(7, 193, 96, 0.12);
  color: #07C160;
  font-size: 26px;
}
.pay-result-amount {
  font-size: 34px;
  font-weight: 700;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
}
.pay-result-text {
  margin: 10px 0 28px;
  font-size: var(--font-size-footnote);
  line-height: 1.7;
  color: var(--text-secondary);
}

/* ---------- 收付款 ---------- */
.code-wrap {
  max-width: 480px;
  margin: 0 auto;
  padding: 26px 22px;
  text-align: center;
}
.code-card {
  padding: 26px 20px 22px;
  border-radius: 18px;
  background: linear-gradient(150deg, #FFF9EC 0%, #FFEFD2 100%);
  border: 1px solid rgba(208, 138, 23, 0.22);
  color: #8A5A10;
}
.code-face {
  width: 66px;
  height: 66px;
  margin: 0 auto 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 18px;
  background: rgba(208, 138, 23, 0.14);
  color: #C8731A;
  font-size: 28px;
}
.code-name {
  font-size: var(--font-size-subheadline);
  font-weight: 600;
}
.code-num {
  margin: 14px 0 8px;
  font-size: 34px;
  font-weight: 700;
  letter-spacing: 4px;
  font-variant-numeric: tabular-nums;
  font-family: 'SF Mono', Menlo, Consolas, monospace;
}
.code-tip {
  font-size: 11px;
  opacity: 0.8;
}
.code-note {
  margin: 14px 0 0;
  font-size: 11px;
  line-height: 1.7;
  color: var(--text-tertiary);
}

.pay-set-row {
  display: flex;
  align-items: center;
  margin-top: 14px;
  padding: 13px 16px;
  border-radius: 14px;
  background: var(--card-bg);
  border: 1px solid var(--border-color);
  cursor: pointer;
}
.psr-ico {
  width: 30px;
  height: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-right: 10px;
  border-radius: 9px;
  background: rgba(31, 157, 85, 0.12);
  color: #1F9D55;
  font-size: 12px;
}
.psr-main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.psr-title { font-size: var(--font-size-subheadline); color: var(--text-primary); }
.psr-sub { margin-top: 2px; font-size: 11px; color: var(--text-tertiary); }
.psr-act { font-size: var(--font-size-caption); color: var(--text-tertiary); }
.psr-act i { margin-left: 4px; font-size: 10px; }
.pin-mode-link {
  width: 100%;
  margin-top: 12px;
  font-size: var(--font-size-caption);
  color: var(--primary-color);
}

/* ---------- 跨班红包 / 收付款增强（Chrome 80：不用 gap） ---------- */
.scope-seg {
  display: flex;
  margin-left: auto;
  padding: 2px;
  border-radius: 9px;
  background: rgba(255, 255, 255, 0.06);
}
.scope-seg button {
  padding: 5px 14px;
  border-radius: 7px;
  font-size: 12px;
  color: var(--text-secondary);
}
.scope-seg button.active {
  background: #E4574F;
  color: #fff;
  font-weight: 600;
}

.quick-row {
  display: flex;
  flex-wrap: wrap;
  margin: 10px -4px 4px;
}
.quick-chip {
  margin: 0 4px;
  padding: 5px 14px;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid transparent;
  color: var(--text-secondary);
  font-size: 12px;
}
.quick-chip.active {
  border-color: rgba(7, 193, 96, 0.5);
  background: rgba(7, 193, 96, 0.12);
  color: #07C160;
}

.peer-picked {
  display: flex;
  align-items: center;
  margin: 2px 0 6px;
  font-size: 12px;
  color: var(--text-secondary);
}
.peer-picked i { margin-right: 6px; color: #07C160; }
.peer-picked b { color: var(--text-primary); font-weight: 600; }

.recent-peers {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  margin: 4px 0 8px;
}
.rp-label { margin-right: 8px; font-size: 11px; color: var(--text-tertiary); }
.rp-chip {
  margin: 0 6px 6px 0;
  padding: 4px 12px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.06);
  color: var(--text-secondary);
  font-size: 12px;
}

/* 结果页的红包码 */
.result-code {
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 4px 0 20px;
  padding: 12px 14px;
  border-radius: 12px;
  background: rgba(228, 87, 79, 0.08);
  border: 1px solid rgba(228, 87, 79, 0.2);
}
.rc-label { margin-right: 10px; font-size: 11px; color: var(--text-tertiary); }
.rc-num {
  font-size: 24px;
  font-weight: 700;
  letter-spacing: 4px;
  color: #FF8B80;
  font-family: 'SF Mono', Menlo, Consolas, monospace;
}
.rc-copy {
  margin-left: 12px;
  padding: 5px 12px;
  border-radius: 10px;
  background: rgba(228, 87, 79, 0.16);
  color: #FF8B80;
  font-size: 11px;
}

/* 输入红包码 */
.claim-input {
  padding: 18px 0 8px;
  border-bottom: 1px solid var(--border-color);
  text-align: center;
}
.claim-code-input {
  width: 100%;
  border: none;
  outline: none;
  background: transparent;
  text-align: center;
  font-size: 32px;
  font-weight: 700;
  letter-spacing: 10px;
  text-transform: uppercase;
  color: var(--text-primary);
  font-family: 'SF Mono', Menlo, Consolas, monospace;
}
.claim-preview {
  display: flex;
  align-items: center;
  margin: 8px 0 4px;
  padding: 14px;
  border-radius: 12px;
  background: linear-gradient(135deg, rgba(228, 87, 79, 0.16), rgba(217, 59, 50, 0.12));
  border: 1px solid rgba(228, 87, 79, 0.24);
}
.cp-face {
  width: 40px;
  height: 40px;
  margin-right: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: rgba(228, 87, 79, 0.22);
  color: #FFE7B0;
  font-size: 16px;
}
.cp-main { flex: 1; min-width: 0; }
.cp-title { font-size: 14px; font-weight: 600; color: var(--text-primary); }
.cp-sub { margin-top: 3px; font-size: 11px; color: var(--text-secondary); }
.cp-cross {
  margin-left: 6px;
  padding: 1px 6px;
  border-radius: 5px;
  background: rgba(228, 87, 79, 0.2);
  color: #FF8B80;
  font-size: 10px;
}

.cp-admin {
  margin-left: 6px;
  padding: 1px 6px;
  border-radius: 5px;
  background: rgba(240, 181, 76, 0.2);
  color: #F0B54C;
  font-size: 10px;
}

/* 收付款页 */
.code-stats {
  display: flex;
  margin: 16px 0 4px;
}
.cs-item {
  flex: 1;
  padding: 12px 8px;
  margin: 0 5px;
  border-radius: 12px;
  background: var(--card-bg);
  border: 1px solid var(--border-color);
  text-align: center;
}
.cs-num {
  display: block;
  font-size: 20px;
  font-weight: 700;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
}
.cs-label { display: block; margin-top: 3px; font-size: 11px; color: var(--text-tertiary); }

.code-actions { display: flex; margin: 14px -5px 0; }
.code-btn {
  flex: 1;
  height: 44px;
  margin: 0 5px;
  border-radius: 11px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid var(--border-color);
  color: var(--text-primary);
  font-size: 14px;
}
.code-btn i { margin-right: 6px; color: var(--text-secondary); }
.code-btn.primary { background: #07C160; color: #fff; border-color: transparent; }
.code-btn.primary i { color: #fff; }

.code-recent { margin-top: 18px; text-align: left; }
.cr-head { margin-bottom: 6px; font-size: 11px; color: var(--text-tertiary); }
.cr-row {
  display: flex;
  align-items: center;
  padding: 8px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}
.cr-main {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  color: var(--text-secondary);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.cr-time { margin: 0 10px; font-size: 11px; color: var(--text-tertiary); }
.cr-amt { font-size: 13px; font-weight: 600; color: #FF8B80; }

/* ---------- 选人 / 红包玩法 ---------- */
.people-list {
  max-height: 208px;
  overflow-y: auto;
  border: 1px solid var(--border-color);
  border-radius: 12px;
  margin: 8px 0 4px;
}
.people-item {
  display: flex;
  align-items: center;
  width: 100%;
  padding: 10px 12px;
  border-bottom: 1px solid rgba(255,255,255,.05);
  text-align: left;
}
.people-item:last-child { border-bottom: none; }
.people-item:active { background: rgba(255,255,255,.05); }
.pi-name {
  font-size: var(--font-size-subheadline);
  color: var(--text-primary);
  margin-right: 8px;
}
.pi-id {
  flex: 1;
  font-size: 11px;
  color: var(--text-tertiary);
  font-family: 'SF Mono', Menlo, Consolas, monospace;
}
.pi-check { color: #07C160; font-size: 13px; visibility: hidden; }
.people-item.picked { background: rgba(7, 193, 96, 0.1); }
.people-item.picked .pi-check { visibility: visible; }
.people-item.picked .pi-name { color: #07C160; }
.people-empty {
  padding: 16px 12px;
  font-size: 12px;
  color: var(--text-tertiary);
  text-align: center;
}
.pp-id {
  margin: 0 8px;
  font-size: 11px;
  color: var(--text-tertiary);
  font-family: 'SF Mono', Menlo, Consolas, monospace;
}
.pp-change {
  margin-left: auto;
  padding: 4px 10px;
  border-radius: 10px;
  background: rgba(255,255,255,.06);
  color: var(--text-secondary);
  font-size: 11px;
}
.pkt-pick {
  border: 1px solid var(--border-color);
  border-radius: 12px;
  padding: 10px 12px;
  margin-bottom: 10px;
}
.pp-head { margin-bottom: 4px; font-size: 12px; color: var(--text-secondary); }
.pkt-face.phrase { background: rgba(240, 173, 78, 0.16); color: #E0A23C; }
.pkt-face.designated { background: rgba(31, 157, 85, 0.16); color: #1F9D55; }
.pkt-me-tag {
  font-style: normal;
  margin-left: 6px;
  padding: 1px 6px;
  border-radius: 5px;
  background: rgba(7, 193, 96, 0.16);
  color: #07C160;
  font-size: 10px;
}
.q-badge.warn { background: #E4574F; color: #fff; }
.claim-input--phrase .claim-code-input { letter-spacing: 4px; font-size: 24px; }
</style>
