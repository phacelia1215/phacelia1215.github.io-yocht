'use strict';

// ============================================================
// ヨットダイスゲーム - ゲームロジック
// ============================================================

/* ---------- ★ ここに認証情報を埋め込めます ----------
   値を入れると設定画面をスキップして自動接続します。
   空文字のままにすると起動時に入力画面が表示されます。
   ※ このファイルを公開する場合はキーを削除してください。
------------------------------------------------------- */
const CONFIG = {
  SUPABASE_URL: '',   // 例: 'https://xxxxxxxxxx.supabase.co'
  SUPABASE_KEY: '',   // 例: 'eyJhbGci...'
};

/* ---------- 定数 ---------- */
const CATEGORIES = [
  // 上半部
  { id: 'ones',          label: 'ワンズ',               desc: '1の目の合計',        section: 'upper' },
  { id: 'twos',          label: 'ツーズ',               desc: '2の目の合計',        section: 'upper' },
  { id: 'threes',        label: 'スリーズ',             desc: '3の目の合計',        section: 'upper' },
  { id: 'fours',         label: 'フォーズ',             desc: '4の目の合計',        section: 'upper' },
  { id: 'fives',         label: 'ファイブズ',           desc: '5の目の合計',        section: 'upper' },
  { id: 'sixes',         label: 'シックスズ',           desc: '6の目の合計',        section: 'upper' },
  // 下半部
  { id: 'chance',        label: 'チャンス',             desc: '全サイコロの合計',      section: 'lower' },
  { id: 'full_house',    label: 'フルハウス',           desc: '3つ+2つ同じ → 25点',   section: 'lower' },
  { id: 'four_of_a_kind',label: 'フォーオブアカインド', desc: '4つ以上同じ → 40点',   section: 'lower' },
  { id: 'small_straight',label: 'スモールストレート',   desc: '4連続 → 30点',          section: 'lower' },
  { id: 'large_straight',label: 'ラージストレート',     desc: '5連続 → 40点',          section: 'lower' },
  { id: 'yacht',         label: 'ヨット！',             desc: '5つ全部同じ → 50点',    section: 'lower' },
];

const PLAYER_COLORS = ['#3b82f6', '#f59e0b', '#22c55e', '#ec4899'];
const PLAYER_EMOJIS = ['🔵', '🟡', '🟢', '🔴'];
const TOTAL_ROUNDS = 12;

// サイコロのドット位置（3×3グリッド、0-8インデックス）
const PIP_POSITIONS = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

// サイコロの各面のオーバーレイ色
const DIE_FACE_COLORS = [
  null,
  'rgba(59,130,246,0.08)',
  'rgba(245,158,11,0.08)',
  'rgba(34,197,94,0.08)',
  'rgba(236,72,153,0.08)',
  'rgba(168,85,247,0.08)',
  'rgba(239,68,68,0.08)',
];

/* ---------- 状態 ---------- */
let supabaseClient = null;
let gameChannel = null;

const state = {
  screen: 'setup',
  playerId: null,
  playerName: null,
  gameId: null,
  roomCode: null,
  isHost: false,
  players: [],
  game: null,
  isRolling: false,
  localDice: [0, 0, 0, 0, 0],
  localHeld: [false, false, false, false, false],
};

/* ---------- ユーティリティ ---------- */
function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function generateRoomCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += chars[randomInt(0, chars.length - 1)];
  }
  return code;
}

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const el = document.getElementById(id);
  if (el) el.classList.add('active');
  state.screen = id.replace('-screen', '');
}

function showToast(msg, type = 'info', duration = 3000) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.className = `toast ${type} show`;
  setTimeout(() => { toast.className = 'toast'; }, duration);
}

/* ---------- Supabase 接続 ---------- */
async function connectSupabase(url, key) {
  try {
    const { createClient } = window.supabase;
    supabaseClient = createClient(url.trim(), key.trim());
    // 接続確認
    const { error } = await supabaseClient.from('yacht_games').select('id').limit(1);
    if (error && error.code !== 'PGRST116') {
      throw new Error(error.message);
    }
    return true;
  } catch (e) {
    console.error(e);
    return false;
  }
}

/* ---------- ルーム作成 ---------- */
async function createRoom(playerName) {
  let roomCode;
  let tries = 0;
  let gameData;

  // 重複しないコードを生成
  while (tries < 10) {
    roomCode = generateRoomCode();
    const { data, error } = await supabaseClient
      .from('yacht_games')
      .insert({ room_code: roomCode })
      .select()
      .single();

    if (!error) {
      gameData = data;
      break;
    }
    tries++;
  }

  if (!gameData) throw new Error('ルームの作成に失敗しました');

  // ホストをプレイヤーとして追加
  const { data: playerData, error: pe } = await supabaseClient
    .from('yacht_players')
    .insert({
      game_id: gameData.id,
      name: playerName,
      player_order: 0,
      is_host: true,
    })
    .select()
    .single();

  if (pe) throw new Error(pe.message);

  state.gameId     = gameData.id;
  state.roomCode   = roomCode;
  state.playerId   = playerData.id;
  state.playerName = playerName;
  state.isHost     = true;
  state.game       = gameData;

  return gameData;
}

/* ---------- ルーム参加 ---------- */
async function joinRoom(playerName, code) {
  const { data: gameData, error: ge } = await supabaseClient
    .from('yacht_games')
    .select('*')
    .eq('room_code', code.toUpperCase())
    .single();

  if (ge || !gameData) throw new Error('ルームが見つかりません');
  if (gameData.status !== 'waiting') throw new Error('このゲームはすでに開始されています');

  const { data: existingPlayers } = await supabaseClient
    .from('yacht_players')
    .select('id')
    .eq('game_id', gameData.id);

  if (existingPlayers && existingPlayers.length >= 4) {
    throw new Error('ルームが満員です（最大4人）');
  }

  const order = existingPlayers ? existingPlayers.length : 0;

  const { data: playerData, error: pe } = await supabaseClient
    .from('yacht_players')
    .insert({
      game_id: gameData.id,
      name: playerName,
      player_order: order,
      is_host: false,
    })
    .select()
    .single();

  if (pe) throw new Error(pe.message);

  state.gameId     = gameData.id;
  state.roomCode   = code.toUpperCase();
  state.playerId   = playerData.id;
  state.playerName = playerName;
  state.isHost     = false;
  state.game       = gameData;

  return gameData;
}

/* ---------- プレイヤー一覧を再取得 ---------- */
async function refreshPlayers() {
  if (!state.gameId) return;
  const { data } = await supabaseClient
    .from('yacht_players')
    .select('*')
    .eq('game_id', state.gameId)
    .order('player_order');
  if (data) state.players = data;
}

/* ---------- ゲーム開始 ---------- */
async function startGame() {
  if (!state.isHost) return;
  if (state.players.length < 2) {
    showToast('2人以上必要です', 'error');
    return;
  }

  const { error } = await supabaseClient
    .from('yacht_games')
    .update({
      status: 'playing',
      current_player_index: 0,
      current_round: 1,
      rolls_remaining: 3,
      dice: [0, 0, 0, 0, 0],
      held: [false, false, false, false, false],
    })
    .eq('id', state.gameId);

  if (error) showToast('開始エラー: ' + error.message, 'error');
}

/* ---------- サイコロを振る ---------- */
async function performRoll() {
  if (!isMyTurn()) return;
  if (state.game.rolls_remaining <= 0) {
    showToast('これ以上振れません。スコアを選択してください', 'error');
    return;
  }
  if (state.isRolling) return;

  state.isRolling = true;
  document.getElementById('roll-btn').disabled = true;

  // 新しいダイス値を計算
  const newDice = [...state.localDice];
  for (let i = 0; i < 5; i++) {
    if (!state.localHeld[i]) {
      newDice[i] = randomInt(1, 6);
    }
  }

  // アニメーション実行
  await animateDiceRoll(newDice, state.localHeld);

  // ローカル状態更新
  state.localDice = newDice;
  const newRolls = state.game.rolls_remaining - 1;

  // DBに保存
  const { data, error } = await supabaseClient
    .from('yacht_games')
    .update({
      dice: newDice,
      held: state.localHeld,
      rolls_remaining: newRolls,
    })
    .eq('id', state.gameId)
    .select()
    .single();

  if (!error && data) {
    state.game = data;
  }

  renderDice();
  updateGameHeader();
  buildScoreTable();

  state.isRolling = false;
  document.getElementById('roll-btn').disabled = false;

  // ヒント表示
  if (newRolls > 0) {
    document.getElementById('hold-hint').classList.remove('hidden');
  } else {
    document.getElementById('hold-hint').classList.add('hidden');
    showToast('スコアを選択してください！', 'info');
  }
}

/* ---------- サイコロホールド切り替え ---------- */
function toggleHold(index) {
  if (!isMyTurn()) return;
  if (state.game.rolls_remaining <= 0) return;
  if (state.game.rolls_remaining === 3) return; // 一度も振っていない

  state.localHeld[index] = !state.localHeld[index];
  renderDice();
}

/* ---------- スコア記録 ---------- */
async function recordScore(categoryId) {
  if (!isMyTurn()) return;
  if (state.game.rolls_remaining === 3) {
    showToast('先にサイコロを振ってください', 'error');
    return;
  }

  const myPlayer = state.players.find(p => p.id === state.playerId);
  if (!myPlayer) return;
  if (myPlayer.scores && myPlayer.scores[categoryId] !== undefined) {
    showToast('このカテゴリはすでに使用済みです', 'error');
    return;
  }

  const score = calculateScore(categoryId, state.localDice);

  // ヨット達成演出
  if (categoryId === 'yacht' && score === 50) {
    triggerYachtEffect();
  }

  const newScores = { ...(myPlayer.scores || {}), [categoryId]: score };

  const { error: pe } = await supabaseClient
    .from('yacht_players')
    .update({ scores: newScores })
    .eq('id', state.playerId);

  if (pe) { showToast('保存エラー: ' + pe.message, 'error'); return; }

  // 次のターンへ
  await advanceTurn();
}

/* ---------- ターンを進める ---------- */
async function advanceTurn() {
  const totalPlayers = state.players.length;
  let nextIdx = (state.game.current_player_index + 1) % totalPlayers;
  let nextRound = state.game.current_round;

  if (nextIdx === 0) {
    nextRound++;
  }

  // ゲーム終了チェック
  if (nextRound > TOTAL_ROUNDS) {
    await supabaseClient
      .from('yacht_games')
      .update({ status: 'finished' })
      .eq('id', state.gameId);
    return;
  }

  await supabaseClient
    .from('yacht_games')
    .update({
      current_player_index: nextIdx,
      current_round: nextRound,
      rolls_remaining: 3,
      dice: [0, 0, 0, 0, 0],
      held: [false, false, false, false, false],
    })
    .eq('id', state.gameId);
}

/* ---------- スコア計算 ---------- */
function calculateScore(categoryId, dice) {
  const counts = {};
  for (const d of dice) counts[d] = (counts[d] || 0) + 1;
  const countVals = Object.values(counts);
  const sum = dice.reduce((s, d) => s + d, 0);

  switch (categoryId) {
    case 'ones':   return dice.filter(d => d === 1).reduce((s, d) => s + d, 0);
    case 'twos':   return dice.filter(d => d === 2).reduce((s, d) => s + d, 0);
    case 'threes': return dice.filter(d => d === 3).reduce((s, d) => s + d, 0);
    case 'fours':  return dice.filter(d => d === 4).reduce((s, d) => s + d, 0);
    case 'fives':  return dice.filter(d => d === 5).reduce((s, d) => s + d, 0);
    case 'sixes':  return dice.filter(d => d === 6).reduce((s, d) => s + d, 0);
    case 'chance': return sum;
    case 'full_house':
      return (countVals.includes(3) && countVals.includes(2)) ? 25 : 0;
    case 'four_of_a_kind':
      return countVals.some(c => c >= 4) ? 40 : 0;
    case 'small_straight': {
      const uniq = [...new Set(dice)].sort((a, b) => a - b);
      const straights = [[1,2,3,4],[2,3,4,5],[3,4,5,6]];
      const ok = straights.some(s => s.every(n => uniq.includes(n)));
      return ok ? 30 : 0;
    }
    case 'large_straight': {
      const uniq = [...new Set(dice)].sort((a, b) => a - b);
      const ok = (JSON.stringify(uniq) === JSON.stringify([1,2,3,4,5]) ||
                  JSON.stringify(uniq) === JSON.stringify([2,3,4,5,6]));
      return ok ? 40 : 0;
    }
    case 'yacht':
      return countVals.includes(5) ? 50 : 0;
    default:
      return 0;
  }
}

/* ---------- 上半部ボーナス計算 ---------- */
function calcUpperBonus(scores) {
  const upperIds = ['ones','twos','threes','fours','fives','sixes'];
  const total = upperIds.reduce((s, id) => s + (scores[id] || 0), 0);
  const filled = upperIds.every(id => scores[id] !== undefined);
  return { total, bonus: filled && total >= 63 ? 35 : 0, filled };
}

/* ---------- 合計スコア計算 ---------- */
function calcTotalScore(scores) {
  const { bonus } = calcUpperBonus(scores);
  let total = bonus;
  for (const cat of CATEGORIES) {
    if (scores[cat.id] !== undefined) total += scores[cat.id];
  }
  return total;
}

/* ---------- 自分のターン判定 ---------- */
function isMyTurn() {
  if (!state.game || state.game.status !== 'playing') return false;
  const cp = state.players[state.game.current_player_index];
  return cp && cp.id === state.playerId;
}

/* ============ UI 描画 ============ */

/* -- ゲームヘッダー更新 -- */
function updateGameHeader() {
  if (!state.game) return;
  document.getElementById('round-num').textContent = state.game.current_round;
  document.getElementById('rolls-left').textContent = state.game.rolls_remaining;

  const cp = state.players[state.game.current_player_index];
  document.getElementById('current-turn').textContent = cp ? cp.name : '-';

  const rollBtn = document.getElementById('roll-btn');
  const myTurnHint = document.getElementById('my-turn-hint');
  const holdHint = document.getElementById('hold-hint');

  if (isMyTurn()) {
    rollBtn.disabled = state.game.rolls_remaining <= 0 || state.isRolling;
    myTurnHint.style.display = 'none';
    if (state.game.rolls_remaining < 3 && state.game.rolls_remaining > 0) {
      holdHint.classList.remove('hidden');
    }
  } else {
    rollBtn.disabled = true;
    myTurnHint.style.display = 'block';
    holdHint.classList.add('hidden');
  }
}

/* -- プレイヤー状態リスト -- */
function renderPlayerStatusList() {
  const list = document.getElementById('player-status-list');
  if (!list) return;
  list.innerHTML = state.players.map((p, i) => {
    const total = calcTotalScore(p.scores || {});
    const isActive = state.game && state.game.current_player_index === i;
    const isMe = p.id === state.playerId;
    return `
      <div class="player-status-item ${isActive ? 'active-player' : ''}">
        <span style="color:${PLAYER_COLORS[i]};font-size:16px;">${PLAYER_EMOJIS[i]}</span>
        <span class="ps-name">${escapeHtml(p.name)}${isMe ? ' (あなた)' : ''}${isActive ? ' ▶' : ''}</span>
        <span class="ps-score">${total}点</span>
      </div>
    `;
  }).join('');
}

/* -- 待機室プレイヤーリスト -- */
function renderWaitingPlayers() {
  const list = document.getElementById('waiting-players');
  if (!list) return;
  list.innerHTML = state.players.map((p, i) => `
    <div class="waiting-player-item">
      <div class="player-avatar" style="background:${PLAYER_COLORS[i]}20;color:${PLAYER_COLORS[i]}">
        ${escapeHtml(p.name.charAt(0).toUpperCase())}
      </div>
      <span class="waiting-player-name">${escapeHtml(p.name)}${p.id === state.playerId ? ' (あなた)' : ''}</span>
      ${p.is_host ? '<span class="host-badge">ホスト</span>' : ''}
    </div>
  `).join('');

  const statusEl = document.getElementById('waiting-status');
  statusEl.textContent = `プレイヤーを待っています... (${state.players.length}/4)`;

  const startBtn = document.getElementById('start-game-btn');
  if (state.isHost && state.players.length >= 2) {
    startBtn.classList.remove('hidden');
  } else {
    startBtn.classList.add('hidden');
  }
}

/* -- サイコロレンダリング -- */
function renderDice() {
  const container = document.getElementById('dice-container');
  if (!container) return;

  const dice = state.localDice;
  const held = state.localHeld;
  const myTurn = isMyTurn();
  const canHold = myTurn && state.game && state.game.rolls_remaining < 3 && state.game.rolls_remaining > 0;

  container.innerHTML = dice.map((val, i) => {
    const isHeld = held[i];
    return `
      <div class="die-wrapper ${isHeld ? 'held-wrapper' : ''}" style="position:relative;">
        ${buildDieHTML(val, i, isHeld, myTurn, canHold)}
        <div class="hold-label">${isHeld ? 'HOLD' : ''}</div>
      </div>
    `;
  }).join('');

  // クリックイベント
  container.querySelectorAll('.die').forEach((dieEl, i) => {
    dieEl.addEventListener('click', () => {
      if (canHold) toggleHold(i);
    });
  });
}

function buildDieHTML(val, index, isHeld, myTurn, canHold) {
  const pipGrid = buildPipGrid(val);
  const heldClass = isHeld ? 'held' : '';
  const interactClass = (myTurn && canHold) ? 'interactive' : '';
  return `
    <div class="die ${heldClass}" data-index="${index}" title="${isHeld ? 'ホールド解除' : 'ホールド'}">
      <div class="die-face face-front">${buildPipGrid(val)}</div>
      <div class="die-face face-back">${buildPipGrid(7 - val)}</div>
      <div class="die-face face-right">${buildPipGrid(val === 1 ? 2 : val === 2 ? 1 : val === 3 ? 4 : val === 4 ? 3 : val === 5 ? 6 : 5)}</div>
      <div class="die-face face-left">${buildPipGrid(val === 1 ? 5 : val === 5 ? 1 : val === 2 ? 6 : val === 6 ? 2 : val === 3 ? 4 : 3)}</div>
      <div class="die-face face-top">${buildPipGrid(val === 1 ? 2 : val === 2 ? 1 : 3)}</div>
      <div class="die-face face-bottom">${buildPipGrid(val === 1 ? 5 : val === 5 ? 1 : 4)}</div>
    </div>
  `;
}

function buildPipGrid(val) {
  const positions = PIP_POSITIONS[val] || PIP_POSITIONS[1];
  const cells = Array(9).fill(false);
  positions.forEach(i => cells[i] = true);
  return cells.map(active => `<div class="pip ${active ? 'active' : ''}"></div>`).join('');
}

/* -- スコアシート構築 -- */
function buildScoreTable() {
  const table = document.getElementById('score-table');
  if (!table || !state.players.length) return;

  const myTurn = isMyTurn();
  const myPlayer = state.players.find(p => p.id === state.playerId);
  const myScores = myPlayer ? (myPlayer.scores || {}) : {};
  const hasRolled = state.game && state.game.rolls_remaining < 3;

  // ヘッダー行
  let html = `<thead><tr>
    <th class="cat-name">カテゴリ</th>
    ${state.players.map((p, i) => `<th class="${p.id === state.playerId ? 'my-col' : ''}">${escapeHtml(p.name)}<br><small>${PLAYER_EMOJIS[i]}</small></th>`).join('')}
  </tr></thead><tbody>`;

  // 上半部ヘッダー
  html += `<tr class="section-header"><td colspan="${state.players.length + 1}">上半部 (Upper Section)</td></tr>`;

  // 上半部カテゴリ
  for (const cat of CATEGORIES.filter(c => c.section === 'upper')) {
    html += buildCategoryRow(cat, myTurn, myScores, hasRolled);
  }

  // ボーナス行
  html += `<tr class="bonus-row">
    <td class="cat-name">ボーナス<small>合計63点以上で+35点</small></td>
    ${state.players.map(p => {
      const { total, bonus, filled } = calcUpperBonus(p.scores || {});
      return `<td>${filled ? (bonus > 0 ? `+35 ✓` : `0 (${total}/63)`) : `(${total}/63)`}</td>`;
    }).join('')}
  </tr>`;

  // 下半部ヘッダー
  html += `<tr class="section-header"><td colspan="${state.players.length + 1}">下半部 (Lower Section)</td></tr>`;

  // 下半部カテゴリ
  for (const cat of CATEGORIES.filter(c => c.section === 'lower')) {
    html += buildCategoryRow(cat, myTurn, myScores, hasRolled);
  }

  // 合計行
  html += `<tr class="total-row">
    <td class="cat-name">合　計</td>
    ${state.players.map(p => `<td>${calcTotalScore(p.scores || {})}点</td>`).join('')}
  </tr>`;

  html += '</tbody>';
  table.innerHTML = html;

  // スコア選択クリックイベント
  table.querySelectorAll('.score-cell.selectable').forEach(cell => {
    cell.addEventListener('click', () => recordScore(cell.dataset.catId));
  });
}

function buildCategoryRow(cat, myTurn, myScores, hasRolled) {
  const cells = state.players.map((p, i) => {
    const scores = p.scores || {};
    const isMe = p.id === state.playerId;

    if (scores[cat.id] !== undefined) {
      const val = scores[cat.id];
      return `<td class="score-cell filled ${val === 0 ? 'zero' : ''}">${val}</td>`;
    }

    if (isMe && myTurn && hasRolled) {
      const preview = calculateScore(cat.id, state.localDice);
      return `<td class="score-cell selectable" data-cat-id="${cat.id}" title="クリックで選択">${preview > 0 ? preview : '0'}</td>`;
    }

    return `<td class="score-cell">-</td>`;
  }).join('');

  return `<tr class="score-row" data-cat="${cat.id}">
    <td class="cat-name">${cat.label}<small>${cat.desc}</small></td>
    ${cells}
  </tr>`;
}

/* ============ アニメーション ============ */

async function animateDiceRoll(newDice, heldDice) {
  const container = document.getElementById('dice-container');
  const dieEls = container.querySelectorAll('.die');

  // アニメーションクラスのバリエーション
  const animNames = ['rolling-anim-1', 'rolling-anim-2', 'rolling-anim-3'];

  const promises = Array.from(dieEls).map((dieEl, i) => {
    if (heldDice[i]) return Promise.resolve();

    return new Promise(resolve => {
      // 前のアニメーションをリセット
      dieEl.classList.remove('rolling-anim-1', 'rolling-anim-2', 'rolling-anim-3', 'pre-shake');

      // ランダムな遅延（最大0.3s）
      const delay = randomInt(0, 300);
      const animIdx = i % animNames.length;
      const animClass = animNames[animIdx];
      const duration = 1400 + (i * 100) + delay;

      setTimeout(() => {
        dieEl.classList.add(animClass);
      }, delay * 0.3);

      setTimeout(() => {
        dieEl.classList.remove('rolling-anim-1', 'rolling-anim-2', 'rolling-anim-3');
        resolve();
      }, duration);
    });
  });

  await Promise.all(promises);

  // ロールボタン揺らし
  document.getElementById('roll-btn').querySelector('.roll-btn-icon').style.animation = 'none';

  // パーティクル
  const rollBtn = document.getElementById('roll-btn');
  const rect = rollBtn.getBoundingClientRect();
  createParticles(rect.left + rect.width / 2, rect.top, 15);
}

/* ---------- パーティクルエフェクト ---------- */
let particleAnimId = null;
const activeParticles = [];

function createParticles(cx, cy, count = 30, special = false) {
  const canvas = document.getElementById('particles-canvas');
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;

  const colors = special
    ? ['#FFD700', '#FF6600', '#FF0099', '#00FFFF', '#FF0000', '#00FF00', '#8B5CF6']
    : ['#60a5fa', '#f59e0b', '#22c55e', '#ec4899', '#FFD700'];

  for (let i = 0; i < count; i++) {
    activeParticles.push({
      x: cx,
      y: cy,
      vx: (Math.random() - 0.5) * (special ? 30 : 16),
      vy: (Math.random() - 0.5) * (special ? 30 : 16) - (special ? 15 : 8),
      size: Math.random() * (special ? 12 : 7) + (special ? 6 : 3),
      color: colors[Math.floor(Math.random() * colors.length)],
      life: 1.0,
      decay: Math.random() * 0.025 + (special ? 0.008 : 0.015),
      gravity: special ? 0.6 : 0.4,
      shape: special && Math.random() > 0.5 ? 'star' : 'circle',
    });
  }

  if (!particleAnimId) {
    animateParticles();
  }
}

function animateParticles() {
  const canvas = document.getElementById('particles-canvas');
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  let hasAlive = false;

  for (let i = activeParticles.length - 1; i >= 0; i--) {
    const p = activeParticles[i];
    if (p.life <= 0) {
      activeParticles.splice(i, 1);
      continue;
    }
    hasAlive = true;

    p.x  += p.vx;
    p.y  += p.vy;
    p.vy += p.gravity;
    p.vx *= 0.97;
    p.life -= p.decay;

    ctx.save();
    ctx.globalAlpha = Math.max(0, p.life);
    ctx.fillStyle = p.color;

    if (p.shape === 'star') {
      drawStar(ctx, p.x, p.y, 5, p.size * p.life, p.size * p.life * 0.4);
    } else {
      ctx.shadowColor = p.color;
      ctx.shadowBlur = p.size * 2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  if (hasAlive) {
    particleAnimId = requestAnimationFrame(animateParticles);
  } else {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    particleAnimId = null;
  }
}

function drawStar(ctx, cx, cy, spikes, outerRadius, innerRadius) {
  let rot = (Math.PI / 2) * 3;
  const step = Math.PI / spikes;
  ctx.beginPath();
  ctx.moveTo(cx, cy - outerRadius);
  for (let i = 0; i < spikes; i++) {
    ctx.lineTo(cx + Math.cos(rot) * outerRadius, cy + Math.sin(rot) * outerRadius);
    rot += step;
    ctx.lineTo(cx + Math.cos(rot) * innerRadius, cy + Math.sin(rot) * innerRadius);
    rot += step;
  }
  ctx.lineTo(cx, cy - outerRadius);
  ctx.closePath();
  ctx.fill();
}

/* ---------- ヨット演出 ---------- */
function triggerYachtEffect() {
  const overlay = document.getElementById('yacht-overlay');
  overlay.classList.remove('hidden');

  // 画面中央からパーティクル大爆発
  const cx = window.innerWidth / 2;
  const cy = window.innerHeight / 2;
  for (let burst = 0; burst < 4; burst++) {
    setTimeout(() => createParticles(cx, cy, 60, true), burst * 200);
  }

  // 端からもパーティクル
  setTimeout(() => createParticles(0, 0, 30, true), 100);
  setTimeout(() => createParticles(window.innerWidth, 0, 30, true), 150);

  setTimeout(() => {
    overlay.classList.add('hidden');
  }, 2200);
}

/* ============ リアルタイム同期 ============ */

function subscribeToGame() {
  if (gameChannel) {
    supabaseClient.removeChannel(gameChannel);
    gameChannel = null;
  }

  gameChannel = supabaseClient
    .channel(`yacht_room_${state.gameId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'yacht_games',
        filter: `id=eq.${state.gameId}`,
      },
      async (payload) => {
        const prev = state.game;
        state.game = payload.new;

        // ターンが変わったら dice/held をリセット
        if (!prev || prev.current_player_index !== state.game.current_player_index) {
          state.localDice = [...state.game.dice];
          state.localHeld = [...state.game.held];
          document.getElementById('hold-hint').classList.add('hidden');

          if (isMyTurn()) {
            showToast('あなたのターンです！', 'success');
          }
        } else {
          // 他のプレイヤーがロールした場合
          if (!isMyTurn()) {
            state.localDice = [...state.game.dice];
            state.localHeld = [...state.game.held];
          }
        }

        if (state.game.status === 'finished') {
          await refreshPlayers();
          showResult();
          return;
        }

        await refreshPlayers();
        renderDice();
        updateGameHeader();
        buildScoreTable();
        renderPlayerStatusList();
      }
    )
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'yacht_players',
        filter: `game_id=eq.${state.gameId}`,
      },
      async () => {
        await refreshPlayers();
        buildScoreTable();
        renderPlayerStatusList();
      }
    )
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        console.log('リアルタイム購読成功');
      }
    });
}

/* ============ 結果画面 ============ */
function showResult() {
  const ranking = state.players
    .map(p => ({ name: p.name, score: calcTotalScore(p.scores || {}) }))
    .sort((a, b) => b.score - a.score);

  document.getElementById('winner-text').textContent = `🏆 優勝: ${ranking[0].name}`;

  const medals = ['🥇', '🥈', '🥉', '4️⃣'];
  document.getElementById('final-ranking').innerHTML = ranking
    .map((r, i) => `
      <div class="ranking-item">
        <span class="rank-num">${medals[i] || (i + 1)}</span>
        <span class="rank-name">${escapeHtml(r.name)}</span>
        <span class="rank-score">${r.score}点</span>
      </div>
    `).join('');

  showScreen('result-screen');

  // 紙吹雪
  const cx = window.innerWidth / 2;
  const cy = window.innerHeight / 2;
  for (let i = 0; i < 6; i++) {
    setTimeout(() => createParticles(cx + (Math.random() - 0.5) * 400, cy, 50, true), i * 300);
  }
}

/* ============ エスケープ ============ */
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

/* ============ イベントリスナー ============ */
function setupEventListeners() {

  /* --- 設定画面 --- */
  document.getElementById('connect-btn').addEventListener('click', async () => {
    const url = document.getElementById('supabase-url').value.trim();
    const key = document.getElementById('supabase-key').value.trim();

    if (!url || !key) { showToast('URLとキーを入力してください', 'error'); return; }

    const btn = document.getElementById('connect-btn');
    btn.disabled = true;
    btn.textContent = '接続中...';

    const ok = await connectSupabase(url, key);
    if (ok) {
      // 設定を localStorage に保存（利便性のため）
      localStorage.setItem('yacht_url', url);
      localStorage.setItem('yacht_key', key);
      showToast('接続成功！', 'success');
      showScreen('lobby-screen');
    } else {
      showToast('接続失敗。URLとキーを確認してください', 'error');
    }

    btn.disabled = false;
    btn.textContent = '接続する';
  });

  /* --- ロビー画面 --- */
  document.getElementById('create-room-btn').addEventListener('click', async () => {
    const name = document.getElementById('player-name').value.trim();
    if (!name) { showToast('名前を入力してください', 'error'); return; }

    const btn = document.getElementById('create-room-btn');
    btn.disabled = true;

    try {
      await createRoom(name);
      await refreshPlayers();
      document.getElementById('room-code-show').textContent = state.roomCode;
      renderWaitingPlayers();
      subscribeToGame();
      showScreen('waiting-screen');
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      btn.disabled = false;
    }
  });

  document.getElementById('join-room-btn').addEventListener('click', async () => {
    const name = document.getElementById('player-name').value.trim();
    const code = document.getElementById('room-code-input').value.trim();
    if (!name) { showToast('名前を入力してください', 'error'); return; }
    if (code.length !== 4) { showToast('4文字のルームコードを入力してください', 'error'); return; }

    const btn = document.getElementById('join-room-btn');
    btn.disabled = true;

    try {
      await joinRoom(name, code);
      await refreshPlayers();
      document.getElementById('room-code-show').textContent = state.roomCode;
      renderWaitingPlayers();
      subscribeToGame();
      showScreen('waiting-screen');
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      btn.disabled = false;
    }
  });

  // Enterキーでルームコード入力
  document.getElementById('room-code-input').addEventListener('input', function() {
    this.value = this.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  });

  /* --- 待機室 --- */
  document.getElementById('copy-code-btn').addEventListener('click', () => {
    navigator.clipboard.writeText(state.roomCode || '').catch(() => {});
    showToast(`コード「${state.roomCode}」をコピーしました`, 'success');
  });

  document.getElementById('start-game-btn').addEventListener('click', async () => {
    const btn = document.getElementById('start-game-btn');
    btn.disabled = true;
    await startGame();
    btn.disabled = false;
  });

  document.getElementById('leave-room-btn').addEventListener('click', async () => {
    if (state.playerId) {
      await supabaseClient.from('yacht_players').delete().eq('id', state.playerId);
    }
    if (gameChannel) {
      supabaseClient.removeChannel(gameChannel);
      gameChannel = null;
    }
    // 状態リセット
    Object.assign(state, {
      playerId: null, playerName: null, gameId: null, roomCode: null,
      isHost: false, players: [], game: null,
      localDice: [0,0,0,0,0], localHeld: [false,false,false,false,false],
    });
    showScreen('lobby-screen');
  });

  /* --- ゲーム画面 --- */
  document.getElementById('roll-btn').addEventListener('click', async () => {
    if (!isMyTurn()) { showToast('あなたのターンではありません', 'error'); return; }
    await performRoll();
  });

  /* --- 結果画面 --- */
  document.getElementById('play-again-btn').addEventListener('click', () => {
    if (gameChannel) {
      supabaseClient.removeChannel(gameChannel);
      gameChannel = null;
    }
    Object.assign(state, {
      playerId: null, playerName: null, gameId: null, roomCode: null,
      isHost: false, players: [], game: null,
      localDice: [0,0,0,0,0], localHeld: [false,false,false,false,false],
    });
    document.getElementById('player-name').value = '';
    showScreen('lobby-screen');
  });

  /* --- Canvas リサイズ --- */
  window.addEventListener('resize', () => {
    const canvas = document.getElementById('particles-canvas');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  });
}

/* ============ リアルタイム購読で待機室も更新 ============ */
function subscribeToWaiting() {
  if (gameChannel) {
    supabaseClient.removeChannel(gameChannel);
    gameChannel = null;
  }

  gameChannel = supabaseClient
    .channel(`yacht_waiting_${state.gameId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'yacht_games',
        filter: `id=eq.${state.gameId}`,
      },
      async (payload) => {
        state.game = payload.new;

        if (state.game.status === 'playing') {
          // ゲーム開始！
          await refreshPlayers();
          // リアルタイムチャンネルを切り替え
          supabaseClient.removeChannel(gameChannel);
          gameChannel = null;
          initGameScreen();
          subscribeToGame();
          showScreen('game-screen');
          if (isMyTurn()) showToast('ゲーム開始！あなたが最初です', 'success');
          else showToast('ゲーム開始！', 'success');
        }
      }
    )
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'yacht_players',
        filter: `game_id=eq.${state.gameId}`,
      },
      async () => {
        await refreshPlayers();
        renderWaitingPlayers();
      }
    )
    .subscribe();
}

/* waitingScreenに遷移したときの初期化 */
function initWaitingScreen() {
  document.getElementById('room-code-show').textContent = state.roomCode;
  renderWaitingPlayers();
  subscribeToWaiting();
}

/* ゲーム画面の初期化 */
function initGameScreen() {
  state.localDice = [...(state.game.dice || [0,0,0,0,0])];
  state.localHeld = [...(state.game.held || [false,false,false,false,false])];
  renderDice();
  updateGameHeader();
  buildScoreTable();
  renderPlayerStatusList();
}

/* ============ createRoom / joinRoom の後に待機室 ============ */
// subscribeToGame の前に subscribeToWaiting を呼ぶよう修正

/* ============ イベントリスナーを上書き補正 ============ */
function patchEventListeners() {
  // create-room-btn を再バインド
  const crBtn = document.getElementById('create-room-btn');
  crBtn.replaceWith(crBtn.cloneNode(true));
  document.getElementById('create-room-btn').addEventListener('click', async () => {
    const name = document.getElementById('player-name').value.trim();
    if (!name) { showToast('名前を入力してください', 'error'); return; }
    const btn = document.getElementById('create-room-btn');
    btn.disabled = true;
    try {
      await createRoom(name);
      await refreshPlayers();
      initWaitingScreen();
      showScreen('waiting-screen');
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      btn.disabled = false;
    }
  });

  // join-room-btn を再バインド
  const jrBtn = document.getElementById('join-room-btn');
  jrBtn.replaceWith(jrBtn.cloneNode(true));
  document.getElementById('join-room-btn').addEventListener('click', async () => {
    const name = document.getElementById('player-name').value.trim();
    const code = document.getElementById('room-code-input').value.trim();
    if (!name) { showToast('名前を入力してください', 'error'); return; }
    if (code.length !== 4) { showToast('4文字のルームコードを入力してください', 'error'); return; }
    const btn = document.getElementById('join-room-btn');
    btn.disabled = true;
    try {
      await joinRoom(name, code);
      await refreshPlayers();
      initWaitingScreen();
      showScreen('waiting-screen');
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      btn.disabled = false;
    }
  });
}

/* ============ 初期化 ============ */
async function init() {
  setupEventListeners();
  patchEventListeners();

  // Canvas サイズ設定
  const canvas = document.getElementById('particles-canvas');
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;

  // 認証情報の優先順位: CONFIG > localStorage > 手入力
  const url = CONFIG.SUPABASE_URL || localStorage.getItem('yacht_url') || '';
  const key = CONFIG.SUPABASE_KEY || localStorage.getItem('yacht_key') || '';

  if (url) document.getElementById('supabase-url').value = url;
  if (key) document.getElementById('supabase-key').value = key;

  // CONFIG に両方埋め込まれていれば自動接続してロビーへ
  if (url && key) {
    const btn = document.getElementById('connect-btn');
    btn.disabled = true;
    btn.textContent = '接続中...';
    const ok = await connectSupabase(url, key);
    btn.disabled = false;
    btn.textContent = '接続する';
    if (ok) {
      showScreen('lobby-screen');
      return;
    }
    // 失敗したら設定画面を表示してエラーを伝える
    showToast('自動接続に失敗しました。URLとキーを確認してください', 'error');
  }

  showScreen('setup-screen');
}

init();
