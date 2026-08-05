/**
 * app_withdraw.js - 提现转盘系统（砍一刀风格）
 * 悬浮球 + 转盘抽奖 + 分享增加次数 + 煽动性闪屏 + 2日重置
 */
(function() {
  'use strict';

  // ============================================================
  //  0. 样式注入
  // ============================================================
  const css = document.createElement('style');
  css.textContent = `
    /* 悬浮球 */
    #withdraw-float-ball {
      position: absolute;
      right: 12px;
      top: 45%;
      width: 52px;
      height: 52px;
      border-radius: 50%;
      background: linear-gradient(135deg, #ff4444, #ff6b35);
      box-shadow: 0 4px 12px rgba(255,68,68,0.4);
      z-index: 50;
      cursor: pointer;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      color: #fff;
      font-size: 11px;
      font-weight: 700;
      line-height: 1.2;
      text-align: center;
      user-select: none;
      -webkit-user-select: none;
      touch-action: none;
      animation: withdraw-pulse 2s ease-in-out infinite;
      transition: transform 0.15s;
    }
    #withdraw-float-ball:active { transform: scale(0.92); }
    #withdraw-float-ball .ball-icon { font-size: 18px; margin-bottom: 1px; }
    @keyframes withdraw-pulse {
      0%, 100% { box-shadow: 0 4px 12px rgba(255,68,68,0.4); }
      50% { box-shadow: 0 4px 20px rgba(255,68,68,0.7); }
    }
    @keyframes withdraw-spin-icon {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }
    #withdraw-float-ball .ball-icon { animation: withdraw-spin-icon 4s linear infinite; }

    /* 提现转盘 overlay */
    #withdraw-overlay {
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: linear-gradient(180deg, #ff4444 0%, #ff6b35 30%, #ff8c42 60%, #fff5f0 100%);
      z-index: 9999;
      overflow-y: auto;
      display: none;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }
    #withdraw-overlay.active { display: block; }

    /* 闪屏文字（带底色，视觉冲击力） */
    .withdraw-flash {
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      z-index: 10000;
      display: flex;
      align-items: center;
      justify-content: center;
      pointer-events: none;
      animation: withdraw-flash-show 2.5s ease-out forwards;
    }
    .withdraw-flash-text {
      font-size: 30px;
      font-weight: 900;
      text-align: center;
      padding: 24px 32px;
      line-height: 1.45;
      /* 高饱和度底色 + 渐变 + 边框 + 光晕，煽动性视觉冲击 */
      background: linear-gradient(135deg, rgba(255,68,68,0.96) 0%, rgba(255,107,53,0.96) 50%, rgba(255,140,66,0.96) 100%);
      border-radius: 20px;
      border: 3px solid #ffeb3b;
      box-shadow: 0 0 50px rgba(255,68,68,0.9), 0 0 100px rgba(255,193,7,0.6), 0 12px 40px rgba(0,0,0,0.5);
      text-shadow: 0 0 12px rgba(255,255,255,0.9), 0 2px 6px rgba(0,0,0,0.6), 0 0 4px #fff;
      max-width: 80vw;
      animation: withdraw-flash-bounce 0.6s ease-out, withdraw-flash-rainbow 2s linear infinite, withdraw-flash-glow 1s ease-in-out infinite alternate;
    }
    @keyframes withdraw-flash-show {
      0% { opacity: 0; }
      10% { opacity: 1; }
      80% { opacity: 1; }
      100% { opacity: 0; }
    }
    @keyframes withdraw-flash-bounce {
      0% { transform: scale(0.3) rotate(-5deg); }
      50% { transform: scale(1.15) rotate(2deg); }
      70% { transform: scale(0.95) rotate(-1deg); }
      100% { transform: scale(1) rotate(0); }
    }
    @keyframes withdraw-flash-rainbow {
      0% { color: #ffeb3b; }
      25% { color: #fff; }
      50% { color: #ffeb3b; }
      75% { color: #ffc107; }
      100% { color: #ffeb3b; }
    }
    @keyframes withdraw-flash-glow {
      from { box-shadow: 0 0 50px rgba(255,68,68,0.9), 0 0 100px rgba(255,193,7,0.6), 0 12px 40px rgba(0,0,0,0.5); }
      to { box-shadow: 0 0 80px rgba(255,68,68,1), 0 0 160px rgba(255,193,7,0.9), 0 12px 40px rgba(0,0,0,0.5); }
    }

    /* 转盘 */
    .withdraw-wheel-container {
      position: relative;
      width: 260px;
      height: 260px;
      margin: 0 auto;
    }
    .withdraw-wheel {
      width: 100%;
      height: 100%;
      border-radius: 50%;
      transition: transform 4s cubic-bezier(0.17, 0.67, 0.12, 0.99);
      box-shadow: 0 0 0 6px #fff, 0 0 0 8px #ff4444, 0 8px 30px rgba(0,0,0,0.3);
    }
    .withdraw-wheel-pointer {
      position: absolute;
      top: -8px;
      left: 50%;
      transform: translateX(-50%);
      width: 0;
      height: 0;
      border-left: 14px solid transparent;
      border-right: 14px solid transparent;
      border-top: 24px solid #ff4444;
      z-index: 10;
      filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3));
    }
    .withdraw-wheel-center {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: 60px;
      height: 60px;
      border-radius: 50%;
      background: linear-gradient(135deg, #ff4444, #ff6b35);
      color: #fff;
      font-size: 14px;
      font-weight: 700;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      z-index: 11;
      box-shadow: 0 4px 12px rgba(255,68,68,0.4);
      border: 3px solid #fff;
    }

    /* 进度条 */
    .withdraw-progress-bar {
      width: 100%;
      height: 24px;
      background: rgba(255,255,255,0.3);
      border-radius: 12px;
      overflow: hidden;
      position: relative;
    }
    .withdraw-progress-fill {
      height: 100%;
      background: linear-gradient(90deg, #ffeb3b, #ffc107, #ff9800);
      border-radius: 12px;
      transition: width 0.8s ease-out;
      box-shadow: 0 0 10px rgba(255,235,59,0.6);
    }
    .withdraw-progress-text {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      font-size: 12px;
      font-weight: 700;
      color: #333;
      text-shadow: 0 1px 2px rgba(255,255,255,0.8);
    }

    /* 分享链接在聊天中的样式 */
    .withdraw-share-link {
      color: #576b95;
      text-decoration: underline;
      word-break: break-all;
      font-size: 14px;
      line-height: 1.6;
    }
  `;
  document.head.appendChild(css);

  // ============================================================
  //  1. 游戏状态管理
  // ============================================================
  const TARGET_AMOUNT = 700;
  const RESET_HOURS = 48; // 2日重置
  const SUCCESS_SHARE_THRESHOLD = 100; // 100次分享后可成功

  function getGameKey() {
    const pid = localStorage.getItem('active_me_id') || 'default';
    return 'withdraw_game_v1_' + pid;
  }

  function getDefaultGameState() {
    return {
      targetAmount: TARGET_AMOUNT,
      currentAmount: 0,
      spinsLeft: 2,
      totalSpins: 0,
      totalShares: 0,
      wheelLevel: 0,
      currency: '元',
      phase: 'initial',
      startedAt: Date.now(),
      lastSpinAt: 0,
      completed: false,
      completedAmount: 0,
      shareHistory: []
    };
  }

  function loadGameState() {
    try {
      const data = localStorage.getItem(getGameKey());
      if (!data) return getDefaultGameState();
      const state = JSON.parse(data);
      // 检查是否过期（2日重置）
      const elapsed = Date.now() - state.startedAt;
      if (elapsed > RESET_HOURS * 3600000 && !state.completed) {
        // 过期：重置
        const fresh = getDefaultGameState();
        saveGameState(fresh);
        return fresh;
      }
      return state;
    } catch(e) {
      return getDefaultGameState();
    }
  }

  function saveGameState(state) {
    try {
      localStorage.setItem(getGameKey(), JSON.stringify(state));
    } catch(e) { console.warn('提现游戏状态保存失败', e); }
  }

  let gameState = null;
  let isSpinning = false;
  // 本次转盘的实际奖品数组（含可能的大奖位，与转盘显示一致）
  // 每次 renderWithdrawPage 时重新生成，spin 时直接使用，确保显示与中奖一致
  let currentWheelPrizes = null;

  // ============================================================
  //  2. 转盘奖品配置
  // ============================================================
  // 货币换算层级（10苹果=1玫瑰，10玫瑰=1星星，10星星=1钻石，100钻石=1元）
  // 每个奖品的"实际价值"= prize * unitValue（折算成元）
  // 大奖（代金券/实物）以特殊 prize 对象表示，概率极低
  const WHEEL_LEVELS = [
    // Level 0: 大额（初始） - 单位：元
    { currency: '元', unitValue: 1, prizes: [10, 15, 10, 15, 10, 15, 10, 15], colors: ['#ff4444','#ff6b35','#ff4444','#ff6b35','#ff4444','#ff6b35','#ff4444','#ff6b35'] },
    // Level 1: 中额 - 单位：元
    { currency: '元', unitValue: 1, prizes: [3, 5, 3, 5, 3, 5, 3, 5], colors: ['#ff8c42','#ffa726','#ff8c42','#ffa726','#ff8c42','#ffa726','#ff8c42','#ffa726'] },
    // Level 2: 小额 - 单位：元
    { currency: '元', unitValue: 1, prizes: [0.5, 1, 0.5, 1, 0.5, 1, 0.5, 1], colors: ['#ffa726','#ffb74d','#ffa726','#ffb74d','#ffa726','#ffb74d','#ffa726','#ffb74d'] },
    // Level 3: 微额 - 单位：元（缩小到0.1/0.2，避免转39次超700露馅）
    { currency: '元', unitValue: 1, prizes: [0.1, 0.2, 0.1, 0.2, 0.1, 0.2, 0.1, 0.2], colors: ['#ffb74d','#ffcc80','#ffb74d','#ffcc80','#ffb74d','#ffcc80','#ffb74d','#ffcc80'] },
    // Level 4: 钻石（100钻石=1元，奖品0.1/0.2/0.4）
    { currency: '钻石', unitValue: 0.01, prizes: [0.2, 0.4, 0.1, 0.2, 0.4, 0.1, 0.2, 0.4], colors: ['#42a5f5','#66bb6a','#42a5f5','#66bb6a','#42a5f5','#66bb6a','#42a5f5','#66bb6a'] },
    // Level 5: 星星（10星星=1钻石，奖品0.1/0.2/0.4）
    { currency: '星星', unitValue: 0.001, prizes: [0.2, 0.4, 0.1, 0.2, 0.4, 0.1, 0.2, 0.4], colors: ['#ab47bc','#ec407a','#ab47bc','#ec407a','#ab47bc','#ec407a','#ab47bc','#ec407a'] },
    // Level 6: 玫瑰（10玫瑰=1星星，奖品0.1/0.2/0.4）
    { currency: '玫瑰', unitValue: 0.0001, prizes: [0.2, 0.4, 0.1, 0.2, 0.4, 0.1, 0.2, 0.4], colors: ['#ec407a','#f06292','#ec407a','#f06292','#ec407a','#f06292','#ec407a','#f06292'] },
    // Level 7: 苹果（10苹果=1玫瑰，奖品0.1/0.2/0.4）
    { currency: '苹果', unitValue: 0.00001, prizes: [0.2, 0.4, 0.1, 0.2, 0.4, 0.1, 0.2, 0.4], colors: ['#66bb6a','#81c784','#66bb6a','#81c784','#66bb6a','#81c784','#66bb6a','#81c784'] }
  ];

  // 大奖配置：每个 level 的转盘上有概率出现大奖位（替换某个普通奖品位）
  // type: 'voucher' 代金券（结账抵扣）/ 'product' 实物商品（0元下单）
  // probability: 每次转动时该位置出现大奖的概率（极低）
  const BIG_PRIZES = [
    { type: 'voucher', label: '20元代金券', value: 20, probability: 0.008 },
    { type: 'voucher', label: '50元代金券', value: 50, probability: 0.003 },
    { type: 'voucher', label: '100元代金券', value: 100, probability: 0.001 },
    { type: 'product', label: '鸭梨18ProMax', value: 0, probability: 0.001, productName: '鸭梨18ProMax手机', productPrice: 0.01 },
    { type: 'product', label: '蓝牙耳机', value: 0, probability: 0.002, productName: '无线蓝牙耳机', productPrice: 0.01 },
    { type: 'product', label: '智能手表', value: 0, probability: 0.0015, productName: '智能运动手表', productPrice: 0.01 },
    { type: 'product', label: '保温杯', value: 0, probability: 0.003, productName: '不锈钢保温杯', productPrice: 0.01 },
    { type: 'product', label: '充电宝', value: 0, probability: 0.0025, productName: '20000mAh充电宝', productPrice: 0.01 },
    { type: 'product', label: '零食大礼包', value: 0, probability: 0.003, productName: '零食大礼包', productPrice: 0.01 },
    { type: 'voucher', label: '10元代金券', value: 10, probability: 0.012 }
  ];

  // 货币换算关系（显示用，已修正层级关系）
  const CURRENCY_EXCHANGE = {
    '苹果': 0.00001,  // 10苹果=1玫瑰(0.0001)
    '玫瑰': 0.0001,   // 10玫瑰=1星星(0.001)
    '星星': 0.001,    // 10星星=1钻石(0.01)
    '钻石': 0.01,     // 100钻石=1元
    '元': 1
  };

  // 货币换算层级文字（进度条下方展示用）
  const CURRENCY_EXCHANGE_TEXT = '10苹果=1玫瑰 · 10玫瑰=1星星 · 10星星=1钻石 · 100钻石=1元';

  // 生成实际奖品数组：在普通奖品基础上，按概率把某个位置替换成大奖位
  // 返回的数组结构与 level.prizes 一致，但某些位置可能是大奖对象 { __big: true, ...BIG_PRIZES[i] }
  function generateActualPrizes(level) {
    const prizes = level.prizes.slice();
    // 总大奖出现概率（每个 BIG_PRIZE 的 probability 之和）
    const totalBigProb = BIG_PRIZES.reduce((s, p) => s + (p.probability || 0), 0);
    if (totalBigProb <= 0) return prizes;

    // 按概率决定本次是否出现大奖位（最多 1 个，避免露馅）
    if (Math.random() < totalBigProb) {
      // 加权选择一个大奖
      let r = Math.random() * totalBigProb;
      let chosen = BIG_PRIZES[0];
      for (const bp of BIG_PRIZES) {
        r -= (bp.probability || 0);
        if (r <= 0) { chosen = bp; break; }
      }
      // 随机选一个位置替换为大奖位
      const pos = Math.floor(Math.random() * 8);
      prizes[pos] = { __big: true, ...chosen };
    }
    return prizes;
  }

  // 判断奖品是否是大奖位
  function isBigPrize(prize) {
    return prize && typeof prize === 'object' && prize.__big === true;
  }

  // 大奖中奖后续逻辑：代金券→写入 shopping_coupons；实物商品→0元订单
  async function redeemBigPrize(bigPrize) {
    const pid = Number(localStorage.getItem('active_me_id') || 0);
    const now = Date.now();
    try {
      if (bigPrize.type === 'voucher') {
        // 代金券：写入神券表，30天有效
        await db.shopping_coupons.add({
          userId: pid,
          type: '神券',
          faceValue: bigPrize.value,
          expireAt: now + 30 * 86400000,
          usedCount: 0,
          source: '提现大转盘·大奖',
          createdAt: now
        });
        return '已发放到我的-神券，结账时可抵扣 ¥' + bigPrize.value;
      } else if (bigPrize.type === 'product') {
        // 实物商品：直接生成 0 元订单（已付款待发货）
        const orderNo = 'WD' + now.toString(36).toUpperCase() + Math.floor(Math.random() * 1000);
        await db.shopping_orders.add({
          userId: pid,
          orderNo: orderNo,
          status: 'unshipped',
          type: '实物',
          paymentMethod: 'self',
          payerId: pid,
          createdAt: now,
          items: [{ name: bigPrize.productName, price: bigPrize.productPrice, qty: 1, storeName: '提现大转盘·大奖', type: '实物' }],
          address: { name: '', phone: '', address: '' },
          itemTotal: bigPrize.productPrice,
          deliveryFee: 0,
          couponAddOn: 0,
          flashCouponFee: 0,
          deductAmount: 0,
          deductCoupon: null,
          total: bigPrize.productPrice,
          paidAt: now,
          bigPrizeOrder: true
        });
        return '已生成 0 元订单，可在我的-订单查看物流';
      }
    } catch (e) {
      console.warn('大奖兑奖失败:', e);
    }
    return '奖品发放中，请稍后查看';
  }

  // 根据当前进度决定转盘等级（保证转盘上显示的奖品与实际获得一致）
  function determineWheelLevel(state) {
    // 满足成功条件时，沿用当前等级（让 reward 能达到 targetAmount）
    if (canSucceedNow(state)) return state.wheelLevel;

    const remaining = state.targetAmount - state.currentAmount;
    let level;
    if (remaining > 50) level = 0;
    else if (remaining > 10) level = 1;
    else if (remaining > 1) level = 2;
    else if (remaining > 0.1) level = 3;
    else if (remaining > 0.01) level = 4;    // 钻石
    else if (remaining > 0.001) level = 5;   // 星星
    else if (remaining > 0.0001) level = 6;  // 玫瑰
    else level = 7;                           // 苹果

    // 安全检查：当前等级的最大奖品若会让 currentAmount 超过 targetAmount，则升级到更小单位
    while (level < WHEEL_LEVELS.length - 1) {
      const lvl = WHEEL_LEVELS[level];
      const maxPrize = Math.max.apply(null, lvl.prizes.filter(p => typeof p === 'number'));
      if (state.currentAmount + maxPrize * lvl.unitValue >= state.targetAmount - 0.0000001) {
        level++;
      } else {
        break;
      }
    }
    return level;
  }

  // 是否满足"提现成功"的隐藏条件（内部判断，不对用户明示）
  function canSucceedNow(state) {
    const remaining = state.targetAmount - state.currentAmount;
    return state.totalShares >= SUCCESS_SHARE_THRESHOLD && remaining < 5;
  }

  // 格式化奖品显示（转盘上 & 闪屏"获得"）
  function formatPrize(prize, currency) {
    if (isBigPrize(prize)) return prize.label;
    if (currency === '元') return '¥' + Number(prize).toFixed(2);
    if (currency === '钻石') return '💎×' + prize;
    if (currency === '星星') return '⭐×' + prize;
    if (currency === '玫瑰') return '🌹×' + prize;
    if (currency === '苹果') return '🍎×' + prize;
    return String(prize);
  }

  // ============================================================
  //  3. 闪屏文案
  // ============================================================
  const FLASH_MESSAGES = {
    initial: [
      '恭喜！您是优质客户\n700元提现额度已到账！',
      '限时福利！\n立即提现700元！'
    ],
    accelerated: [
      '🔥 您的信誉良好\n我们决定为您加速！\n650元已到账！',
      '⚡ 加速成功！\n这一次，你一定要提现！'
    ],
    approaching: [
      '💰 已到680元！\n提现流程已启动！\n700元已准备就绪！',
      '🎯 离提现只差一步！\n继续分享，马上到账！'
    ],
    near: [
      '✅ 审批已通过！\n正在放款...\n即将到账！',
      '📢 放款已通过！\n700元即将到账！\n再分享一次加速！'
    ],
    very_near: [
      '🔥 就差0.01元！\n再分享一次就能提现！',
      '💎 差一点点！\n已有N人成功提现！\n继续加油！'
    ],
    currency_change: [
      '🌟 恭喜获得钻石！\n100钻石=1元\n继续转，马上提现！',
      '⭐ 恭喜获得星星！\n10星星=1钻石\n坚持就是胜利！',
      '🌹 恭喜获得玫瑰！\n10玫瑰=1星星\n加油，快了！',
      '🍎 恭喜获得苹果！\n10苹果=1玫瑰\n每一点都算数！'
    ],
    need_share: [
      '📢 转盘次数用完啦！\n分享给好友，立即+1次！',
      '🤝 独乐不如众乐\n分享链接给好友\n一起提现700元！'
    ],
    success: [
      '🎉🎉🎉\n提现成功！\n700元已转入钱包！'
    ]
  };

  function getFlashMessage(phase) {
    const msgs = FLASH_MESSAGES[phase] || FLASH_MESSAGES.need_share;
    return msgs[Math.floor(Math.random() * msgs.length)];
  }

  // ============================================================
  //  4. 阶段判定（用于闪屏文案选择）
  // ============================================================
  function determinePhase(state) {
    if (state.completed) return 'success';
    const remaining = state.targetAmount - state.currentAmount;
    if (state.totalSpins <= 2 && state.currentAmount < 100) return 'initial';
    if (state.currentAmount >= 650 && state.currentAmount < 680) return 'accelerated';
    if (state.currentAmount >= 680 && state.currentAmount < 695) return 'approaching';
    if (state.currentAmount >= 695 && state.currentAmount < 699) return 'near';
    if (state.currentAmount >= 699 && state.currentAmount < 699.9) return 'very_near';
    if (state.wheelLevel >= 4) return 'currency_change';
    return 'approaching';
  }

  // ============================================================
  //  5. 悬浮球
  // ============================================================
  function injectFloatBall() {
    if (document.getElementById('withdraw-float-ball')) return;
    const win = document.getElementById('win-shopping');
    if (!win) return;
    const ball = document.createElement('div');
    ball.id = 'withdraw-float-ball';
    ball.innerHTML = '<span class="ball-icon">💰</span><span>提现</span>';
    ball.onclick = function(e) {
      if (ball._dragged) { ball._dragged = false; return; }
      openWithdrawPage();
    };
    // 拖拽
    let startY = 0, startTop = 0, dragging = false;
    ball.addEventListener('pointerdown', function(e) {
      dragging = true;
      startY = e.clientY;
      startTop = ball.offsetTop;
      ball.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    ball.addEventListener('pointermove', function(e) {
      if (!dragging) return;
      const dy = e.clientY - startY;
      const newTop = Math.max(0, Math.min(win.offsetHeight - 52, startTop + dy));
      ball.style.top = newTop + 'px';
      ball.style.bottom = 'auto';
      if (Math.abs(dy) > 5) ball._dragged = true;
    });
    ball.addEventListener('pointerup', function(e) { dragging = false; });
    ball.addEventListener('pointercancel', function(e) { dragging = false; });
    win.appendChild(ball);
  }

  // ============================================================
  //  6. 提现转盘页面
  // ============================================================
  function openWithdrawPage() {
    gameState = loadGameState();
    renderWithdrawPage();
  }

  function renderWithdrawPage() {
    let overlay = document.getElementById('withdraw-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'withdraw-overlay';
      document.body.appendChild(overlay);
    }
    overlay.classList.add('active');

    // 渲染前先根据当前进度刷新转盘等级（保证转盘显示与可获奖品一致）
    if (!gameState.completed) {
      gameState.wheelLevel = determineWheelLevel(gameState);
      gameState.currency = WHEEL_LEVELS[gameState.wheelLevel].currency;
    }

    const phase = determinePhase(gameState);
    const level = WHEEL_LEVELS[gameState.wheelLevel];
    const progressPct = Math.min(100, (gameState.currentAmount / gameState.targetAmount) * 100);

    // 关键：每次渲染转盘前生成本次实际奖品数组（含可能的大奖位）
    // spin 时直接使用 currentWheelPrizes，确保转盘显示与中奖一致
    if (!isSpinning) {
      currentWheelPrizes = generateActualPrizes(level);
    }

    // 进度显示：根据货币单位显示对应的进度（如钻石进度条 2/70000 个钻石）
    let progressText;
    if (gameState.currency === '元') {
      progressText = gameState.currentAmount.toFixed(2) + ' / ' + gameState.targetAmount + ' 元';
    } else {
      // 钻石/星星/玫瑰/苹果：显示当前货币单位数量
      const unitValue = level.unitValue;
      const currentInUnit = gameState.currentAmount / unitValue;
      const targetInUnit = gameState.targetAmount / unitValue;
      const currencySymbols = { '钻石': '💎', '星星': '⭐', '玫瑰': '🌹', '苹果': '🍎' };
      const currencySymbol = currencySymbols[gameState.currency] || '';
      // 根据数量级选择合适的小数位
      const decimals = targetInUnit > 1000 ? 0 : (targetInUnit > 100 ? 1 : 2);
      progressText = currencySymbol + currentInUnit.toFixed(decimals) + ' / ' + targetInUnit.toFixed(0) + ' ' + gameState.currency +
        ' (≈' + gameState.currentAmount.toFixed(2) + '元)';
    }

    // 转盘 SVG
    const wheelSvg = buildWheelSvg(level);

    // 闪屏文案提示
    const phaseMsg = getPhasePrompt(phase, gameState);

    overlay.innerHTML =
      '<div style="min-height:100%;padding:0 0 100px;">' +
        // 顶部栏
        '<div style="display:flex;align-items:center;padding:10px 6px;color:#fff;">' +
          '<button onclick="withdrawSystem.close()" style="border:none;background:none;color:#fff;cursor:pointer;padding:6px;font-size:22px;">‹</button>' +
          '<span style="font-size:16px;font-weight:700;flex:1;text-align:center;">提现大转盘</span>' +
          '<div style="width:34px;"></div>' +
        '</div>' +
        // 标题
        '<div style="text-align:center;color:#fff;padding:10px 20px 0;">' +
          '<div style="font-size:24px;font-weight:900;text-shadow:0 2px 8px rgba(0,0,0,0.2);">' + gameState.targetAmount + '元提现</div>' +
          '<div style="font-size:13px;opacity:0.9;margin-top:4px;">' + phaseMsg + '</div>' +
        '</div>' +
        // 进度条
        '<div style="margin:16px 20px 0;">' +
          '<div class="withdraw-progress-bar">' +
            '<div class="withdraw-progress-fill" style="width:' + progressPct + '%;"></div>' +
            '<div class="withdraw-progress-text">' + progressText + '</div>' +
          '</div>' +
          '<div style="text-align:center;margin-top:6px;font-size:11px;color:rgba(255,255,255,0.8);">' +
            '已分享 ' + gameState.totalShares + ' 次 · 已转 ' + gameState.totalSpins + ' 次' +
          '</div>' +
          // 货币换算层级（让用户明白小奖品也有价值）
          '<div style="text-align:center;margin-top:4px;font-size:10px;color:rgba(255,255,255,0.65);line-height:1.5;">' +
            CURRENCY_EXCHANGE_TEXT +
          '</div>' +
        '</div>' +
        // 转盘
        '<div style="margin:20px 0;text-align:center;">' +
          '<div class="withdraw-wheel-container">' +
            '<div class="withdraw-wheel-pointer"></div>' +
            '<div id="withdraw-wheel" class="withdraw-wheel" style="background: conic-gradient(' + level.colors.map((c, i) => c + ' ' + (i * 45) + 'deg ' + ((i + 1) * 45) + 'deg').join(',') + ');">' +
              wheelSvg +
            '</div>' +
            '<div class="withdraw-wheel-center" onclick="withdrawSystem.spin()">' +
              (gameState.spinsLeft > 0 ? '抽奖<br><span style="font-size:10px;">剩' + gameState.spinsLeft + '次</span>' : '分享<br><span style="font-size:10px;">获次数</span>') +
            '</div>' +
          '</div>' +
        '</div>' +
        // 操作按钮
        '<div style="text-align:center;margin:16px 20px;">' +
          (gameState.spinsLeft > 0
            ? '<button onclick="withdrawSystem.spin()" style="border:none;background:linear-gradient(90deg,#ffeb3b,#ffc107);color:#d32f2f;font-size:18px;font-weight:900;padding:14px 60px;border-radius:30px;cursor:pointer;box-shadow:0 6px 20px rgba(255,193,7,0.5);animation:withdraw-pulse 1.5s infinite;">立即抽奖 (' + gameState.spinsLeft + '次)</button>'
            : '<button onclick="withdrawSystem.share()" style="border:none;background:linear-gradient(90deg,#ffeb3b,#ffc107);color:#d32f2f;font-size:18px;font-weight:900;padding:14px 60px;border-radius:30px;cursor:pointer;box-shadow:0 6px 20px rgba(255,193,7,0.5);animation:withdraw-pulse 1.5s infinite;">分享好友 +1次</button>'
          ) +
        '</div>' +
        // 规则说明（不暴露具体成功阈值）
        '<div style="margin:20px;background:rgba(255,255,255,0.15);border-radius:12px;padding:14px;color:#fff;">' +
          '<div style="font-size:13px;font-weight:700;margin-bottom:8px;">活动规则</div>' +
          '<div style="font-size:11px;line-height:1.8;opacity:0.9;">' +
            '1. 每次抽奖可获得随机金额，累计满' + gameState.targetAmount + '元即可提现<br>' +
            '2. 转盘次数用完后，分享链接给好友可获+1次（群聊按人数加倍）<br>' +
            '3. 单次活动进度' + (RESET_HOURS / 24) + '天后重置<br>' +
            '4. 分享越多，提现越快，加油助力吧<br>' +
            '5. 同一好友可反复分享，每次均可增加转盘次数' +
          '</div>' +
        '</div>' +
        // 成功提现记录
        '<div style="margin:0 20px;background:rgba(255,255,255,0.1);border-radius:8px;padding:10px 14px;color:rgba(255,255,255,0.8);font-size:11px;line-height:1.8;">' +
          '🔥 热门提现：' + getFakeSuccessNames() +
        '</div>' +
      '</div>';
  }

  function getPhasePrompt(phase, state) {
    const remaining = state.targetAmount - state.currentAmount;
    if (phase === 'initial') return '您是优质客户，' + state.targetAmount + '元可免费提现！';
    if (phase === 'accelerated') return '已为您加速！离提现只差' + remaining.toFixed(2) + '元！';
    if (phase === 'approaching') return '提现流程已启动！700元已准备就绪！';
    if (phase === 'near') return '审批已通过！正在放款！就差' + remaining.toFixed(2) + '元！';
    if (phase === 'very_near') return '就差' + remaining.toFixed(4) + '元！再分享一次就能提现！';
    if (phase === 'currency_change') return '获得' + state.currency + '！继续转，马上提现！';
    if (phase === 'success') return '🎉 提现成功！';
    return '继续分享，马上提现！';
  }

  function getFakeSuccessNames() {
    const names = ['用户***28', '微信用户***56', '用户***91', '张**', '李**', '用户***33', '王**', '用户***77'];
    return names.slice(0, 4).map(n => n + ' 刚刚成功提现700元').join(' · ');
  }

  function buildWheelSvg(level) {
    // 在转盘上绘制奖品文字（与实际可获得的奖品完全一致）
    // 使用 currentWheelPrizes（含可能的大奖位），与 spin 中奖一致
    const prizes = currentWheelPrizes || level.prizes;
    let html = '<svg viewBox="0 0 200 200" style="position:absolute;top:0;left:0;width:100%;height:100%;">';
    for (let i = 0; i < 8; i++) {
      const angle = (i * 45 + 22.5) * Math.PI / 180;
      const x = 100 + Math.cos(angle - Math.PI / 2) * 65;
      const y = 100 + Math.sin(angle - Math.PI / 2) * 65;
      const prize = prizes[i];
      const text = formatPrize(prize, level.currency);
      // 根据文字长度调整字号，大奖位用金色高亮
      const isBig = isBigPrize(prize);
      const fontSize = isBig ? 8 : (text.length > 6 ? 9 : (text.length > 4 ? 10 : 11));
      const fill = isBig ? '#ffeb3b' : '#fff';
      html += '<text x="' + x + '" y="' + y + '" text-anchor="middle" dominant-baseline="middle" fill="' + fill + '" font-size="' + fontSize + '" font-weight="700" transform="rotate(' + (i * 45 + 22.5) + ' ' + x + ' ' + y + ')">' + text + '</text>';
    }
    html += '</svg>';
    return html;
  }

  // ============================================================
  //  7. 抽奖逻辑
  // ============================================================
  function spin() {
    if (isSpinning) return;
    if (!gameState) gameState = loadGameState();

    if (gameState.spinsLeft <= 0) {
      showFlashMessage(getFlashMessage('need_share'));
      setTimeout(() => { openShareSelector(); }, 2000);
      return;
    }

    if (gameState.completed) {
      showFlashMessage('您已成功提现！\n活动将在' + (RESET_HOURS / 24) + '天后重置');
      return;
    }

    isSpinning = true;
    gameState.spinsLeft--;
    gameState.totalSpins++;

    // 关键：先根据当前进度决定转盘等级（determineWheelLevel 已保证安全）
    // 这样转盘上显示的奖品就是本次可能获得的奖品
    gameState.wheelLevel = determineWheelLevel(gameState);
    gameState.currency = WHEEL_LEVELS[gameState.wheelLevel].currency;
    const level = WHEEL_LEVELS[gameState.wheelLevel];

    // 关键：使用 renderWithdrawPage 时生成的 currentWheelPrizes（含可能的大奖位）
    // 如果还未生成（首次直接 spin），即时生成一次
    if (!currentWheelPrizes) currentWheelPrizes = generateActualPrizes(level);

    // 随机选指针停留位置
    const targetIdx = Math.floor(Math.random() * 8);
    const prize = currentWheelPrizes[targetIdx];
    const isBig = isBigPrize(prize);
    const rewardAmount = isBig ? 0 : (prize * level.unitValue);
    const rewardDisplay = formatPrize(prize, level.currency);

    // 旋转动画（指针指向 targetIdx）
    const wheel = document.getElementById('withdraw-wheel');
    if (wheel) {
      const currentRotation = parseFloat(wheel.dataset.rotation || '0');
      const newRotation = currentRotation + 360 * 5 + (360 - targetIdx * 45 - 22.5);
      wheel.style.transform = 'rotate(' + newRotation + 'deg)';
      wheel.dataset.rotation = newRotation;
    }

    // 延迟显示结果
    setTimeout(async () => {
      // 加速逻辑：第2次抽奖后跳到650（大奖不参与加速逻辑覆盖）
      if (!isBig && gameState.totalSpins === 2 && gameState.currentAmount < 100) {
        gameState.currentAmount = 650;
        gameState.phase = 'accelerated';
        saveGameState(gameState);
        showFlashMessage(getFlashMessage('accelerated'));
      } else if (isBig) {
        // 大奖中奖逻辑：不增加 currentAmount（避免露馅），单独执行兑奖
        gameState.lastSpinAt = Date.now();
        saveGameState(gameState);
        // 执行兑奖（代金券→神券表，实物→0元订单）
        const redeemMsg = await redeemBigPrize(prize);
        // 大奖专属闪屏
        showFlashMessage('🎉🎉🎉 恭喜中奖！\n\n本次获得：' + rewardDisplay + '\n\n' + redeemMsg);

        setTimeout(() => {
          if (gameState.spinsLeft <= 0) {
            showFlashMessage(getFlashMessage('need_share'));
            setTimeout(() => openShareSelector(), 1800);
          }
        }, 2600);
      } else {
        // 应用奖励：currentAmount += rewardAmount（转盘上显示的就是这个金额）
        gameState.currentAmount += rewardAmount;
        gameState.lastSpinAt = Date.now();

        // 检查是否满足提现成功条件
        const canSucceed = canSucceedNow(gameState);
        if (canSucceed && gameState.currentAmount >= gameState.targetAmount - 0.0001) {
          gameState.currentAmount = gameState.targetAmount;
          gameState.completed = true;
          gameState.completedAmount = gameState.targetAmount;
          gameState.phase = 'success';
          saveGameState(gameState);
          showFlashMessage(getFlashMessage('success'));
          // 转入钱包
          if (typeof addLedgerEntry === 'function' && typeof getWalletBalance === 'function' && typeof setWalletBalance === 'function') {
            const bal = getWalletBalance();
            setWalletBalance(bal + gameState.targetAmount);
            addLedgerEntry('提现·砍一刀活动', gameState.targetAmount, 'income');
          }
        } else {
          const phase = determinePhase(gameState);
          gameState.phase = phase;
          saveGameState(gameState);

          // 选择闪屏阶段
          let flashPhase = phase;
          if (level.currency !== '元') flashPhase = 'currency_change';
          else if (phase === 'very_near') flashPhase = 'very_near';
          else if (phase === 'near') flashPhase = 'near';
          else if (phase === 'approaching') flashPhase = 'approaching';

          const msg = getFlashMessage(flashPhase);
          showFlashMessage(msg + '\n\n本次获得：' + rewardDisplay);

          setTimeout(() => {
            if (gameState.spinsLeft <= 0) {
              showFlashMessage(getFlashMessage('need_share'));
              setTimeout(() => openShareSelector(), 1800);
            }
          }, 2600);
        }
      }

      // 清空本次转盘奖品，下次渲染时重新生成
      currentWheelPrizes = null;
      setTimeout(() => { renderWithdrawPage(); }, 2500);
      isSpinning = false;
    }, 4200);
  }

  // ============================================================
  //  8. 闪屏展示
  // ============================================================
  function showFlashMessage(text) {
    const existing = document.querySelector('.withdraw-flash');
    if (existing) existing.remove();

    const flash = document.createElement('div');
    flash.className = 'withdraw-flash';
    flash.innerHTML = '<div class="withdraw-flash-text">' + text.replace(/\n/g, '<br>') + '</div>';
    document.body.appendChild(flash);

    setTimeout(() => { flash.remove(); }, 2500);
  }

  // ============================================================
  //  9. 分享机制
  // ============================================================
  async function openShareSelector() {
    if (!gameState) gameState = loadGameState();
    const pid = Number(localStorage.getItem('active_me_id') || 0);
    if (!pid) { showToast('请先选择我的人设'); return; }

    // 加载单聊 + 群聊会话
    const sessions = await db.sessions.where('userId').equals(pid).toArray();
    if (!sessions.length) {
      showToast('暂无联系人，请先建立单聊或群聊');
      return;
    }

    let html = '<div style="max-height:400px;overflow-y:auto;">';
    html += '<div style="font-size:12px;color:#999;padding:8px 0;">选择要转发的好友或群聊</div>';

    for (const s of sessions) {
      let name = '未知', avatar = '', isGroup = s.isGroup === 1, memberCount = 0;
      if (isGroup) {
        const grp = await db.groups.get(s.groupId);
        name = grp?.name || '群聊';
        avatar = resolveImg(grp?.avatar);
        memberCount = await db.group_members.where('groupId').equals(s.groupId).count();
      } else {
        const char = await db.archives.get(s.charId);
        name = s.customCharName || char?.name || '未知';
        avatar = resolveImg(s.customCharAvatar || char?.avatar);
      }

      const spinsBonus = isGroup ? Math.max(1, memberCount - 1) : 1;
      html +=
        '<div onclick="withdrawSystem.doShare(' + s.id + ')" style="display:flex;align-items:center;gap:10px;padding:10px;cursor:pointer;border-bottom:1px solid #f0f0f0;">' +
          '<img src="' + avatar + '" style="width:40px;height:40px;border-radius:50%;object-fit:cover;flex-shrink:0;" />' +
          '<div style="flex:1;min-width:0;">' +
            '<div style="font-size:14px;color:#333;font-weight:600;">' + escHtml(name) + (isGroup ? ' <span style="font-size:11px;color:#999;">(' + memberCount + '人)</span>' : '') + '</div>' +
            '<div style="font-size:11px;color:#e87d5e;margin-top:2px;">转发后 +' + spinsBonus + ' 次抽奖' + (isGroup ? '（群聊按人数加倍）' : '') + '</div>' +
          '</div>' +
          '<div style="font-size:12px;color:#fff;background:#e87d5e;padding:4px 12px;border-radius:14px;font-weight:600;">发送</div>' +
        '</div>';
    }
    html += '</div>';

    showCustomHtmlAlert('分享给好友（砍一刀）', html);
  }

  async function doShare(sessionId) {
    if (!gameState) gameState = loadGameState();
    const pid = Number(localStorage.getItem('active_me_id') || 0);
    if (!pid) return;

    const sess = await db.sessions.get(sessionId);
    if (!sess) { showToast('会话不存在'); return; }

    const isGroup = sess.isGroup === 1;
    let spinsBonus = 1;
    if (isGroup) {
      const memberCount = await db.group_members.where('groupId').equals(sess.groupId).count();
      spinsBonus = Math.max(1, memberCount - 1);
    }

    // 生成分享链接
    const linkText = generateShareLink(gameState);

    // 发送消息到聊天
    const msg = {
      sessionId: sessionId,
      senderType: 'user',
      senderId: pid,
      content: JSON.stringify({
        linkText: linkText,
        targetAmount: gameState.targetAmount,
        currentAmount: gameState.currentAmount,
        totalShares: gameState.totalShares + 1
      }),
      contentType: 'withdraw_share',
      timestamp: Date.now()
    };
    msg.id = await db.messages.add(msg);

    // 如果目标会话是当前活跃会话，渲染消息
    if (typeof activeSessionId !== 'undefined' && sessionId === activeSessionId && typeof appendMessageToDOM === 'function') {
      appendMessageToDOM(msg);
    }

    // 更新会话最后消息时间
    await db.sessions.update(sessionId, { lastMessageTime: Date.now() });

    // 更新游戏状态
    gameState.totalShares++;
    gameState.spinsLeft += spinsBonus;
    gameState.shareHistory.push({ sessionId, isGroup, spinsBonus, timestamp: Date.now() });
    saveGameState(gameState);

    // 关闭选择器
    closeCustomHtmlAlert();

    showToast('分享成功！+' + spinsBonus + ' 次抽奖机会');
    showFlashMessage('✅ 分享成功！\n+' + spinsBonus + ' 次抽奖机会\n快去抽奖吧！');

    setTimeout(() => { renderWithdrawPage(); }, 2200);
  }

  function generateShareLink(state) {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const rareChars = '熵𡈙䇕㔓龘齉爩';
    const emojis = '🎉🧧💰🔥⚡🌟💎';
    let randomStr = '';
    for (let i = 0; i < 16; i++) {
      randomStr += chars[Math.floor(Math.random() * chars.length)];
    }
    const rare = rareChars[Math.floor(Math.random() * rareChars.length)];
    const emoji1 = emojis[Math.floor(Math.random() * emojis.length)];
    const emoji2 = emojis[Math.floor(Math.random() * emojis.length)];

    const remaining = (state.targetAmount - state.currentAmount).toFixed(2);
    return '【提现助力】我正在提现' + state.targetAmount + '元，就差' + remaining + '元了！帮我点一下👇' + emoji1 + emoji2 + '\nhttps://kandao.fake-tt.com/s/' + randomStr + rare + randomStr.slice(0, 8) + emoji1 + '\n戳链接帮我加速→→→已有' + state.totalShares + '人助力，还差你一刀！';
  }

  // ============================================================
  //  10. 辅助函数
  // ============================================================
  function escHtml(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function resolveImg(url) {
    if (!url) return 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" fill="#e0e0e0"/><text x="20" y="24" text-anchor="middle" fill="#999" font-size="14">?</text></svg>');
    if (url.startsWith('http') || url.startsWith('data:') || url.startsWith('blob:')) return url;
    return url;
  }

  function closeCustomHtmlAlert() {
    const overlays = document.querySelectorAll('.pwa-modal-overlay');
    if (overlays.length > 0) {
      const last = overlays[overlays.length - 1];
      last.classList.remove('show');
      setTimeout(() => last.remove(), 200);
    }
  }

  function close() {
    const overlay = document.getElementById('withdraw-overlay');
    if (overlay) overlay.classList.remove('active');
  }

  // ============================================================
  //  11. 初始化
  // ============================================================
  function init() {
    // 注入悬浮球
    setTimeout(injectFloatBall, 500);
    // 尝试多次注入（确保 shopping 窗口已加载）
    let attempts = 0;
    const interval = setInterval(() => {
      if (document.getElementById('withdraw-float-ball')) {
        clearInterval(interval);
        return;
      }
      injectFloatBall();
      attempts++;
      if (attempts > 10) clearInterval(interval);
    }, 1000);

    // 检查游戏过期
    gameState = loadGameState();
  }

  // 监听 shopping 窗口显示事件
  const observer = new MutationObserver(() => {
    const win = document.getElementById('win-shopping');
    if (win && win.style.display !== 'none') {
      if (!document.getElementById('withdraw-float-ball')) {
        injectFloatBall();
      }
    }
  });
  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
      const phone = document.getElementById('phone-container') || document.body;
      observer.observe(phone, { attributes: true, subtree: true, attributeFilter: ['style'] });
      init();
    }, 500);
  });

  // ============================================================
  //  12. 导出
  // ============================================================
  window.withdrawSystem = {
    init, open: openWithdrawPage, close, spin, share: openShareSelector,
    doShare, injectFloatBall
  };
})();
