// 回归：netsh 输出解析（中文 / 英文 / 已连接 / 已断开 / 多网卡 / GBK 字节）
const assert = require('assert');
const ni = require('../server/src/utils/network-info');

let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + ' —— ' + e.message); }
}

const ZH_CONNECTED = [
  '',
  '系统上有 1 个接口: ',
  '',
  '    名称                   : WLAN 2',
  '    描述                   : Intel(R) Wireless-AC 9462',
  '    GUID                   : 42d7d972-30c2-4215-b8a6-ba280a9823e7',
  '    物理地址               : dc:46:28:15:cc:23',
  '    状态                   : 已连接',
  '    SSID                   : ChangyanSTU218',
  '    BSSID                  : f0:9f:c2:11:22:33',
  '    网络类型               : 结构',
  '    无线电类型             : 802.11ac',
  '    身份验证               : WPA2 - 个人',
  '    密码                   : CCMP',
  '    连接模式               : 自动发现',
  '    信道                   : 44',
  '    接收速率(Mbps)         : 780',
  '    传输速率(Mbps)         : 780',
  '    信号                   : 100%',
  '    配置文件               : ChangyanSTU218',
  '',
  '承载网络状态  : 不可用'
].join('\r\n');

const ZH_DISCONNECTED = [
  '系统上有 1 个接口: ',
  '',
  '    名称                   : WLAN 2',
  '    描述                   : Intel(R) Wireless-AC 9462',
  '    GUID                   : 42d7d972-30c2-4215-b8a6-ba280a9823e7',
  '    物理地址               : dc:46:28:15:cc:23',
  '    状态                   : 已断开连接',
  '    无线电状态             : 硬件 开',
  '                             软件 开',
  '',
  '    承载网络状态  : 不可用'
].join('\r\n');

const EN_CONNECTED = [
  'There is 1 interface on the system:',
  '',
  '    Name                   : Wi-Fi',
  '    Description            : Intel(R) Wireless-AC 9462',
  '    GUID                   : 42d7d972-30c2-4215-b8a6-ba280a9823e7',
  '    Physical address       : dc:46:28:15:cc:23',
  '    State                  : connected',
  '    SSID                   : ChangyanSTU218',
  '    Signal                 : 99%'
].join('\r\n');

const EN_DISCONNECTED = EN_CONNECTED.replace('State                  : connected', 'State                  : disconnected');

const MULTI = [
  '系统上有 2 个接口: ',
  '',
  '    名称                   : WLAN',
  '    状态                   : 已断开连接',
  '',
  '    名称                   : WLAN 2',
  '    状态                   : 已连接',
  '    SSID                   : ChangyanSTU218'
].join('\r\n');

console.log('== pickConnectedWifi ==');
check('中文已连接 → 取到 SSID', () => {
  assert.strictEqual(ni.pickConnectedWifi(ZH_CONNECTED).ssid, 'ChangyanSTU218');
});
check('中文已断开 → null', () => {
  assert.strictEqual(ni.pickConnectedWifi(ZH_DISCONNECTED), null);
});
check('英文 connected → 取到 SSID', () => {
  assert.strictEqual(ni.pickConnectedWifi(EN_CONNECTED).ssid, 'ChangyanSTU218');
});
check('英文 disconnected → null（connected 子串不得误判）', () => {
  assert.strictEqual(ni.pickConnectedWifi(EN_DISCONNECTED), null);
});
check('多网卡 → 选已连接的那块', () => {
  assert.strictEqual(ni.pickConnectedWifi(MULTI).ssid, 'ChangyanSTU218');
});
check('空串 → null', () => {
  assert.strictEqual(ni.pickConnectedWifi(''), null);
});
check('undefined → null', () => {
  assert.strictEqual(ni.pickConnectedWifi(undefined), null);
});
check('「无线电状态 : 硬件 开」不得污染 state', () => {
  const hit = ni.pickConnectedWifi(ZH_CONNECTED);
  assert.strictEqual(hit.state.trim(), '已连接');
});

console.log('== isConnectedState ==');
check('已连接 = true', () => assert.strictEqual(ni.isConnectedState('已连接'), true));
check('已断开连接 = false', () => assert.strictEqual(ni.isConnectedState('已断开连接'), false));
check('connected = true', () => assert.strictEqual(ni.isConnectedState('connected'), true));
check('disconnected = false', () => assert.strictEqual(ni.isConnectedState('disconnected'), false));
check('空 = false', () => assert.strictEqual(ni.isConnectedState(''), false));

console.log('== decodeWinOutput（GBK 字节） ==');
check('gb18030 解码中文', () => {
  const buf = Buffer.from('\xd7\xb4\xcc\xac', 'latin1'); // 状态
  assert.strictEqual(ni.decodeWinOutput(buf), '状态');
});

console.log('== Env 覆盖分支（独立进程，改写 env 后重取） ==');
check('LOCK_INFO_WIFI 生效且不跑 netsh', () => {
  const path = require.resolve('../server/src/utils/network-info');
  process.env.LOCK_INFO_WIFI = 'ChangyanSTU218';
  delete require.cache[path];
  const fresh = require(path);
  const done = { ok: false, data: null };
  fresh.getNetworkInfo((e, d) => { done.ok = true; done.data = d; });
  // env 分支是同步回调，故此处可立即断言
  assert.strictEqual(done.ok, true);
  assert.strictEqual(done.data.wifi, 'ChangyanSTU218');
  assert.strictEqual(done.data.connected, true);
  assert.strictEqual(done.data.source, 'env');
  // 必须还原，否则会污染下面「真实本机探测」这条用例
  process.env.LOCK_INFO_WIFI = '';
});

console.log('== getNetworkInfo（真实本机探测） ==');
ni.getNetworkInfo((err, info) => {
  if (err) {
    fail++; console.log('  ✗ 探测抛错 —— ' + err.message);
  } else {
    pass++;
    console.log('  ✓ 无异常返回 ' + JSON.stringify(info));
    if (info.source === 'env') {
      fail++; console.log('  ✗ env 变量泄漏到真实探测用例');
    } else if (info.source === 'netsh' && info.connected) {
      fail++; console.log('  ✗ 本机 WiFi 应处于断开，却判定为已连接');
    } else {
      pass++;
      console.log('  ✓ 本机（WiFi 关闭）判定为 ' + info.state + '/source=' + info.source);
    }
  }
  console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
});
