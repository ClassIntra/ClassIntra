(function() {
  var NAME = 'gomoku';
  var definitions = window.ClassIntraMarket && window.ClassIntraMarket.apps;

  function request(context, method, path, body) {
    var action = context.api && context.api[method.toLowerCase()];
    if (typeof action !== 'function') return Promise.reject(new Error('SDK API 不可用'));
    var response = method === 'GET' ? action.call(context.api, path) : action.call(context.api, path, body);
    return response.then(function(result) {
      var payload = result && result.data ? result.data : result;
      return payload && payload.data ? payload.data : payload;
    });
  }

  function mount(container, context) {
    if (!container || container.__gomokuUnmount) return;
    var websocket = context.websocket || (window.ClassIntra && window.ClassIntra.websocket);
    var route = context.route || {};
    var routeRoom = (route.params && (route.params.roomCode || route.params.room_code)) || (route.query && (route.query.roomCode || route.query.room_code));
    var roomCode = routeRoom ? String(routeRoom).toUpperCase() : '';
    var state = { size: 15, board: [], turn: 'black', winner: null, status: 'active', members: [] };
    var disposed = false;
    var pending = false;
    var subscriptions = [];
    var root = document.createElement('section');
    root.className = 'gomoku-app';
    root.innerHTML = '<div class="gomoku-shell"><div class="gomoku-header"><div><p class="gomoku-kicker">CLASSINTRA GAME</p><h1>五子棋</h1><p class="gomoku-status" aria-live="polite"></p></div><div class="gomoku-actions"><button type="button" data-action="copy" class="is-secondary">复制房间码</button><button type="button" data-action="share-chat" class="is-secondary">发到聊天</button><button type="button" data-action="share-community" class="is-secondary">发到社区</button><button type="button" data-action="leave" class="is-secondary">离开房间</button></div></div>' + '<div class="gomoku-entry"><div class="gomoku-entry-card"><h2>进入棋局</h2><p>创建房间或输入房间码加入，支持 15、19、21 路棋盘。</p><div class="gomoku-entry-row"><label>棋盘规格<select data-field="size" data-size="15"><option value="15">15 × 15</option><option value="19">19 × 19</option><option value="21">21 × 21</option></select></label><button type="button" data-action="create">创建房间</button></div><div class="gomoku-entry-row"><label>房间码<input data-field="room" maxlength="6" autocomplete="off" placeholder="输入 6 位房间码"></label><button type="button" data-action="join">加入对局</button><button type="button" data-action="watch" class="is-secondary">观战</button></div><p class="gomoku-error" aria-live="polite"></p></div></div><div class="gomoku-roombar"><strong data-role="room">未进入房间</strong><span data-role="identity"></span><span data-role="connection">未连接</span></div><div class="gomoku-layout"><div class="gomoku-board" role="grid" aria-label="五子棋棋盘"></div><aside class="gomoku-info"><h2>房间成员</h2><ul data-role="members"></ul><div class="gomoku-finished"><p data-role="finished"></p><button type="button" data-action="continue">继续下一局</button><button type="button" data-action="color" class="is-secondary">换色</button></div></aside></div></div>';
    container.replaceChildren(root);

    var statusElement = root.querySelector('.gomoku-status');
    var boardElement = root.querySelector('.gomoku-board');
    var entryElement = root.querySelector('.gomoku-entry');
    var errorElement = root.querySelector('.gomoku-error');
    var roomElement = root.querySelector('[data-role="room"]');
    var identityElement = root.querySelector('[data-role="identity"]');
    var connectionElement = root.querySelector('[data-role="connection"]');
    var membersElement = root.querySelector('[data-role="members"]');
    var finishedElement = root.querySelector('[data-role="finished"]');
    var continueButton = root.querySelector('[data-action="continue"]');
    var colorButton = root.querySelector('[data-action="color"]');

    function currentUserId() {
      return String(context.user && (context.user.user_id || context.user.id) || '');
    }
    function currentMember() {
      return state.members.filter(function(member) { return String(member.user_id) === currentUserId(); })[0] || null;
    }
    function emptyBoard(size) {
      return Array.from({ length: size }, function() { return Array(size).fill(null); });
    }
    function setError(message) { errorElement.textContent = message || ''; }
    function send(message) { if (websocket && typeof websocket.send === 'function') websocket.send(message); }
    function transportReady() { return !!(websocket && typeof websocket.send === 'function' && typeof websocket.on === 'function'); }
    function shareRoom(target) {
      if (!roomCode) { setError('请先进入房间'); return; }
      var message = '来和我一起下五子棋，房间码：' + roomCode;
      var encoded = encodeURIComponent(message);
       if (target === 'chat') {
          if (context.router && typeof context.router.push === 'function') context.router.push({ path: '/chat', query: { prefill: encoded } });
          setError('已打开聊天，房间码已填入输入框');
          return;
        }
        if (context.router && typeof context.router.push === 'function') context.router.push({ path: '/community', query: { prefill: encoded } });
        setError('已打开社区，房间码已填入发布内容');
    }
    function onSocket(type, handler) {
      if (!websocket || typeof websocket.on !== 'function') return;
      websocket.on(type, handler);
      subscriptions.push(function() { if (typeof websocket.off === 'function') websocket.off(type, handler); });
    }
    function applyState(next) {
      if (!next) return;
      state = Object.assign(state, next);
      state.size = Number(state.size) || 15;
      state.board = Array.isArray(state.board) ? state.board : emptyBoard(state.size);
      render();
    }
    function renderMembers() {
      membersElement.replaceChildren();
      state.members.forEach(function(member) {
        var item = document.createElement('li');
        var name = member.user_id === currentUserId() ? '我' : String(member.user_id);
        item.textContent = name + ' · ' + (member.role === 'owner' ? '房主' : member.role === 'spectator' ? '观战' : member.color === 'black' ? '黑棋' : '白棋');
        membersElement.appendChild(item);
      });
    }
    function render() {
      root.style.setProperty('--gomoku-size', state.size);
      roomElement.textContent = roomCode ? '房间码 ' + roomCode : '未进入房间';
      var member = currentMember();
      identityElement.textContent = member ? '我的身份：' + (member.role === 'spectator' ? '观战者' : member.role === 'owner' ? '房主 · ' + (member.color === 'black' ? '黑棋' : '白棋') : member.color === 'black' ? '黑棋' : '白棋') : '';
      statusElement.textContent = state.winner ? (state.winner === 'black' ? '黑棋获胜' : '白棋获胜') : state.status !== 'active' ? '等待下一局' : '轮到' + (state.turn === 'black' ? '黑棋' : '白棋');
      connectionElement.textContent = roomCode ? connectionElement.textContent : '未连接';
      entryElement.hidden = !!roomCode;
      boardElement.replaceChildren();
      (state.board.length ? state.board : emptyBoard(state.size)).forEach(function(row, rowIndex) {
        row.forEach(function(color, colIndex) {
          var cell = document.createElement('button');
          cell.type = 'button';
          cell.className = 'gomoku-cell' + (color ? ' is-' + color : '');
          cell.dataset.row = rowIndex;
          cell.dataset.col = colIndex;
          cell.setAttribute('aria-label', (rowIndex + 1) + '行' + (colIndex + 1) + '列');
          cell.disabled = !roomCode || !!color || !!state.winner || state.status !== 'active' || pending || !member || !member.color;
          boardElement.appendChild(cell);
        });
      });
      renderMembers();
      var owner = member && member.role === 'owner';
      var finished = !!state.winner || state.status !== 'active';
      finishedElement.textContent = finished ? (state.winner ? '本局结束，房主可以继续或离开。' : '准备下一局。') : '';
      continueButton.hidden = !finished || !owner;
      colorButton.hidden = !finished || !member || !member.color;
    }
    function loadState() {
      if (!roomCode) { state.board = emptyBoard(15); render(); return Promise.resolve(); }
      return request(context, 'GET', '/gomoku/rooms/' + encodeURIComponent(roomCode)).then(applyState).catch(function(error) { setError(error.message || '房间加载失败'); });
    }
    function enter(code, mode) {
      var normalized = String(code || '').trim().toUpperCase();
      if (!/^[A-Z0-9]{6}$/.test(normalized)) { setError('请输入 6 位房间码'); return; }
      var path = '/gomoku/rooms/' + encodeURIComponent(normalized) + '/' + mode;
      request(context, 'POST', path, {}).then(function(data) {
        roomCode = normalized;
        applyState(data);
        setError('');
        send({ type: 'gomoku_subscribe', room_code: roomCode });
      }).catch(function(error) { setError(error.message || '进入房间失败'); });
    }
    function create() {
      request(context, 'POST', '/gomoku/rooms', { size: Number(root.querySelector('[data-field="size"]').value) }).then(function(data) {
        roomCode = data.roomCode;
        applyState(data);
        setError('');
        send({ type: 'gomoku_subscribe', room_code: roomCode });
      }).catch(function(error) { setError(error.message || '创建房间失败'); });
    }
    function actionRequest(path, message) {
      return request(context, 'POST', '/gomoku/rooms/' + encodeURIComponent(roomCode) + path, {}).then(applyState).catch(function(error) { setError(error.message || message); });
    }
    function leaveRoom() {
      actionRequest('/leave', '离开房间失败').then(function() { send({ type: 'gomoku_unsubscribe', room_code: roomCode }); roomCode = ''; render(); });
    }
    function leave() {
      if (!roomCode) return navigateHome();
      if (context.modal && typeof context.modal.confirm === 'function') {
        context.modal.confirm({ title: '离开房间', message: '离开后需要重新输入房间码才能回来，确定离开吗？', confirmText: '离开', cancelText: '取消' }).then(function(confirmed) {
          if (confirmed) leaveRoom();
        });
        return;
      }
      leaveRoom();
    }
    function navigateHome() { if (context.router && typeof context.router.push === 'function') context.router.push('/'); }
    function onBoardClick(event) {
      var cell = event.target.closest('.gomoku-cell');
      if (!cell || !roomCode || pending) return;
      pending = true;
      render();
      send({ type: 'gomoku_move', room_code: roomCode, row: Number(cell.dataset.row), col: Number(cell.dataset.col) });
      if (!transportReady()) actionRequest('/move', '落子失败');
      window.setTimeout(function() { pending = false; render(); }, 1200);
    }
    function onAction(event) {
      var action = event.target.closest('[data-action]');
      if (!action) return;
      if (action.dataset.action === 'create') create();
      if (action.dataset.action === 'join') enter(root.querySelector('[data-field="room"]').value, 'join');
      if (action.dataset.action === 'watch') enter(root.querySelector('[data-field="room"]').value, 'watch');
      if (action.dataset.action === 'copy' && roomCode) {
        var copyPromise = navigator.clipboard && navigator.clipboard.writeText
          ? navigator.clipboard.writeText(roomCode)
          : Promise.reject(new Error('clipboard-unavailable'));
        copyPromise.then(function() { setError('房间码已复制'); }).catch(function() { setError('房间码：' + roomCode); });
      }
      if (action.dataset.action === 'share-chat') shareRoom('chat');
      if (action.dataset.action === 'share-community') shareRoom('community');
      if (action.dataset.action === 'leave') leave();
      if (action.dataset.action === 'continue') { if (transportReady()) send({ type: 'gomoku_continue', room_code: roomCode }); else actionRequest('/reset', '继续对局失败'); }
      if (action.dataset.action === 'color' && roomCode) actionRequest('/color', '换色失败');
    }
    onSocket('gomoku_room_state', function(message) { if (message.room_code === roomCode) applyState(message.state); });
    onSocket('gomoku_room_changed', function(message) { if (message.room_code === roomCode) { pending = false; applyState(message.state); } });
    onSocket('gomoku_game_continued', function(message) { if (message.room_code === roomCode) { pending = false; applyState(message.state); } });
    onSocket('gomoku_move_rejected', function(message) { if (message.room_code === roomCode) { pending = false; setError(message.reason || '落子被拒绝'); if (message.state) applyState(message.state); else render(); } });
    onSocket('_connectionStateChange', function(message) { connectionElement.textContent = message.state === 'connected' ? '实时连接正常' : '连接断开，正在恢复'; if (message.state === 'connected' && roomCode) send({ type: 'gomoku_subscribe', room_code: roomCode }); if (message.state === 'disconnected' && roomCode) loadState(); });
    boardElement.addEventListener('click', onBoardClick);
    root.addEventListener('click', onAction);
    container.__gomokuUnmount = function() { disposed = true; if (roomCode) send({ type: 'gomoku_unsubscribe', room_code: roomCode }); subscriptions.forEach(function(remove) { remove(); }); boardElement.removeEventListener('click', onBoardClick); root.removeEventListener('click', onAction); container.replaceChildren(); delete container.__gomokuUnmount; };
    loadState();
  }

  function unmount(container) { if (container && typeof container.__gomokuUnmount === 'function') container.__gomokuUnmount(); }
  var definition = { name: NAME, mount: mount, unmount: unmount };
  if (window.ClassIntraMarket && typeof window.ClassIntraMarket.define === 'function') window.ClassIntraMarket.define(definition);
  else if (definitions) definitions[NAME] = definition;
})();
