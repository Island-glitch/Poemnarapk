/**
 * app_heartgame_gacha.js - 心动游戏 · AI 深度驱动的专属抽卡工坊 (G)
 * ============================================================================
 * 职责：
 *   1. 智能卡池生成：调用生图接口生成卡面时开启**严格锁脸 / 特征统一配置**
 *      （锁脸参考图 + 特征描述注入 + LoRA 权重 / ControlNet 强度 / Reference-Only 权重）
 *   2. 保底与概率算法：软保底、硬保底、大保底（当期 UP 必得），计数器持久化
 *   3. 掉落物混合：SSR 卡面 / 专属装扮 / 心动代币 / 静室专属礼物
 *   4. 卡册与专属故事：获得卡面后收入卡册，可展开全屏动态卡面与深度私语剧情
 *      （支持「再演」与「基于新设定重新生成」）
 *   5. 反向模式特例：User 扮演卡池规划师，自定义卡面美术、文案与掉落概率；
 *      Char 在静室里疯狂抽卡 / 歪卡破防 / 抽中 SSR 欣喜若狂
 *
 * 依赖：window.HeartGame.K / .H / .U / .C（app_heartgame_core.js）
 */
(function () {
  'use strict';

  var HG = window.HeartGame;
  if (!HG) { console.warn('[心动游戏] core 未加载，抽卡工坊已跳过'); return; }
  var K = HG.K, H = HG.H, U = HG.U, C = HG.C;

  var RULES = C.GACHA_RULES;

  // ==========================================================================
  //  1. 概率与保底内核（纯函数 + 状态读取，便于单测）
  // ==========================================================================

  var Engine = {

    /**
     * 读取某卡池的保底状态（缺失时补零）
     * @returns {{sinceSsr:number, softCount:number, guarantee:number, total:number, srStreak:number}}
     */
    pityOf: function (poolId) {
      var st = K.state;
      if (!st) return { sinceSsr: 0, softCount: 0, guarantee: 0, total: 0, srStreak: 0 };
      var p = st.gacha.pity[poolId];
      if (!p) {
        p = { sinceSsr: 0, softCount: 0, guarantee: 0, total: 0, srStreak: 0 };
        st.gacha.pity[poolId] = p;
      }
      return p;
    },

    /**
     * 第 n 抽的 SSR 概率（含软保底爬升与硬保底）
     * @param {number} drawIndex  该池累计已抽次数（含本次，从 1 开始）
     * @param {object} pool       {ssrRate?, hardPity?, softPityStart?}
     */
    ssrRateAt: function (drawIndex, pool) {
      var p = pool || {};
      var hard = U.int(p.hardPity, RULES.hardPity);
      var softStart = U.int(p.softPityStart, RULES.softPityStart);
      var base = (typeof p.ssrRate === 'number') ? p.ssrRate : RULES.ssrBase;
      if (drawIndex >= hard) return 1;                    // 硬保底
      if (drawIndex > softStart) {
        // 软保底：超出起点后每抽递增
        return U.clamp(base + (drawIndex - softStart) * RULES.ssrPityStep, 0, 0.99);
      }
      return U.clamp(base, 0, 0.99);
    },

    /**
     * 单抽结算：决定稀有度 + 是否 UP
     * @param {object} pool
     * @returns {{rarity:string, up:boolean, rate:number, pityHit:boolean}}
     */
    rollRarity: function (pool) {
      var st = K.state;
      var p = Engine.pityOf(pool.id);
      var idx = U.int(p.sinceSsr, 0) + 1;
      var rate = Engine.ssrRateAt(idx, pool);

      if (Math.random() < rate) {
        // 出 SSR：判定是否当期 UP（大保底机制）
        var upRate = (typeof pool.upRate === 'number') ? pool.upRate : 0.5;
        var guaranteed = U.int(p.guarantee, 0) >= U.int(pool.guaranteeCount, RULES.guaranteeOn);
        var forcedUp = U.int(p.guarantee, 0) >= U.int(pool.guaranteeCount, RULES.guaranteeOn);
        var isUp = forcedUp || Math.random() < upRate;
        return { rarity: 'SSR', up: isUp, rate: rate, pityHit: idx >= U.int(pool.hardPity, RULES.hardPity) };
      }

      // SR：基础概率，且软保底前的抽数越高越容易出（渐进补偿）
      var srRate = (typeof pool.srRate === 'number') ? pool.srRate : RULES.srBase;
      var srBoost = 1 + U.clamp(idx / 40, 0, 0.8);
      if (Math.random() < srRate * srBoost) return { rarity: 'SR', up: false, rate: rate, pityHit: false };

      return { rarity: 'R', up: false, rate: rate, pityHit: false };
    },

    /**
     * 执行一次抽卡（含保底计数推进、掉落物生成）
     * @param {object} pool
     * @param {number} cost 本次消耗（已由调用方扣除）
     * @param {object} opts { tenPull, minRarity }
     * @returns {object} 掉落结果
     */
    performDraw: function (pool, cost, opts) {
      var o = opts || {};
      var st = K.state;
      var p = Engine.pityOf(pool.id);
      var res = Engine.rollRarity(pool);

      // 十连保底：至少 SR
      if (o.minRarity === 'SR' && res.rarity === 'R') {
        res.rarity = 'SR';
      }

      // 计数器推进
      p.total = U.int(p.total, 0) + 1;
      if (res.rarity === 'SSR') {
        p.sinceSsr = 0;
        p.softCount = 0;
        p.guarantee = res.up ? 0 : U.int(p.guarantee, 0) + 1;
        p.srStreak = 0;
      } else {
        p.sinceSsr = U.int(p.sinceSsr, 0) + 1;
        p.guarantee = U.int(p.guarantee, 0) + 1;
        if (res.rarity === 'SR') p.srStreak = 0; else p.srStreak = U.int(p.srStreak, 0) + 1;
      }

      // 掉落物
      var drop = Engine.buildDrop(pool, res, cost);
      st.gacha.history.unshift({
        poolId: pool.id, poolName: pool.name, rarity: res.rarity, up: res.up,
        cardId: drop.card ? drop.card.id : null, cardName: drop.card ? drop.card.name : '',
        extras: drop.extras.map(function (e) { return e.label; }),
        at: Date.now()
      });
      if (st.gacha.history.length > 200) st.gacha.history.length = 200;

      // 入库：卡面进卡册
      if (drop.card) {
        st.gacha.owned.push(drop.card);
        if (st.gacha.owned.length > 400) st.gacha.owned.length = 400;
      }
      // 其它掉落物直接结算
      drop.extras.forEach(function (e) {
        if (e.kind === 'tokens') K.earn('tokens', e.amount, 'gacha');
        else if (e.kind === 'draws') K.earn('draws', e.amount, 'gacha');
        else if (e.kind === 'vouchers') K.earn('vouchers', e.amount, 'gacha');
        else if (e.kind === 'gift') {
          st.shop.owned.unshift({ goodsId: e.goodsId || 'g-token', at: Date.now(), count: 1, fromGacha: true });
        }
      });

      K.progressQuest('gacha', 1);
      K.save();
      return { rarity: res.rarity, up: res.up, card: drop.card, extras: drop.extras, pity: U.plain(p) };
    },

    /** 组装一次抽卡的掉落物 */
    buildDrop: function (pool, res, cost) {
      var extras = [];
      var card = null;
      var upCards = (pool.cards || []).filter(function (c) { return c.rarity === 'SSR' && c.up; });
      var ssrCards = (pool.cards || []).filter(function (c) { return c.rarity === 'SSR'; });
      var srCards = (pool.cards || []).filter(function (c) { return c.rarity === 'SR'; });
      var rCards = (pool.cards || []).filter(function (c) { return c.rarity === 'R'; });

      if (res.rarity === 'SSR') {
        var pick = (res.up && upCards.length) ? upCards : (ssrCards.length ? ssrCards : upCards);
        card = Engine.materializeCard((pick.length ? U.shuffled(pick) : [])[0], pool, 'SSR');
        extras.push({ kind: 'tokens', amount: 200, label: '心动代币 ×200' });
      } else if (res.rarity === 'SR') {
        card = Engine.materializeCard((srCards.length ? U.shuffled(srCards) : [])[0], pool, 'SR');
        extras.push({ kind: 'tokens', amount: 80, label: '心动代币 ×80' });
      } else {
        card = Engine.materializeCard((rCards.length ? U.shuffled(rCards) : [])[0], pool, 'R');
        // R 有小概率掉抽卡券 / 礼物，制造惊喜
        var r = Math.random();
        if (r < 0.12) extras.push({ kind: 'draws', amount: 1, label: '抽卡券 ×1' });
        else if (r < 0.24) extras.push({ kind: 'gift', goodsId: 'g-coffee', label: '静室专属礼物 ×1' });
        else extras.push({ kind: 'tokens', amount: 20, label: '心动代币 ×20' });
      }
      return { card: card, extras: extras };
    },

    /** 把卡池里的卡面模板实例化成一张可入库的卡 */
    materializeCard: function (tpl, pool, rarity) {
      var st = K.state;
      var base = tpl || {};
      var r = C.RARITY[rarity] || C.RARITY.R;
      return {
        id: U.uid('card'),
        name: base.name || (r.name + ' · ' + (pool ? pool.name : '卡面')),
        rarity: rarity,
        up: !!base.up,
        poolId: pool ? pool.id : null,
        poolName: pool ? pool.name : '',
        image: base.image || '',
        thumb: base.thumb || base.image || '',
        scene: base.scene || '',
        caption: base.caption || '',
        story: base.story || '',
        storyTurns: 0,
        voice: base.voice || '',
        theme: base.theme || (pool ? pool.theme : ''),
        at: Date.now(),
        locked: true
      };
    },

    /** 十连：先判定花费，再连抽（含十连保底） */
    tenPull: function (pool) {
      var out = [];
      // 十连内必出一次 SR+：先跑 9 次，若前 9 次全是 R，则第 10 次强制 SR+
      for (var i = 0; i < 9; i++) {
        out.push(Engine.performDraw(pool, 0, { tenPull: true, minRarity: 'R' }));
      }
      var hasSrPlus = out.some(function (o) { return o.rarity !== 'R'; });
      out.push(Engine.performDraw(pool, 0, { tenPull: true, minRarity: hasSrPlus ? 'R' : 'SR' }));
      return out;
    },

    /**
     * 逐池概率覆写（反向模式：User 是卡池规划师，可为任意已存在的卡池单独调参）
     * @param {string} poolId
     * @param {object} patch { ssrRate, srRate, upRate, hardPity, softPityStart, guaranteeCount, singleCost, tenCost }
     * @param {boolean} reset 为真则清空覆写、回落全局默认
     * @returns {object|null} 更新后的卡池快照
     */
    updateRates: function (poolId, patch, reset) {
      var pool = Pools.byId(poolId);
      if (!pool) return null;
      if (reset) {
        pool.ssrRate = RULES.ssrBase;
        pool.srRate = RULES.srBase;
        pool.upRate = 0.5;
        pool.hardPity = RULES.hardPity;
        pool.softPityStart = RULES.softPityStart;
        pool.guaranteeCount = RULES.guaranteeOn;
        pool.singleCost = RULES.singleCost;
        pool.tenCost = RULES.tenCost;
        pool.rateOverridden = false;
        K.save(true);
        K.emit('gacha', { rates: pool.id, reset: true });
        return U.plain(pool);
      }
      var p = patch || {};
      if (typeof p.ssrRate === 'number') pool.ssrRate = U.clamp(p.ssrRate, 0.001, 0.5);
      if (typeof p.srRate === 'number') pool.srRate = U.clamp(p.srRate, 0.01, 0.9);
      if (typeof p.upRate === 'number') pool.upRate = U.clamp(p.upRate, 0.05, 1);
      if (typeof p.hardPity === 'number') pool.hardPity = U.clamp(Math.round(p.hardPity), 10, 300);
      if (typeof p.softPityStart === 'number') pool.softPityStart = U.clamp(Math.round(p.softPityStart), 5, 299);
      // 软保底起点必须早于硬保底，否则概率函数会跳变
      if (pool.softPityStart >= pool.hardPity) pool.softPityStart = Math.max(5, pool.hardPity - 5);
      if (typeof p.guaranteeCount === 'number') pool.guaranteeCount = U.clamp(Math.round(p.guaranteeCount), 10, 600);
      if (typeof p.singleCost === 'number') pool.singleCost = U.clamp(Math.round(p.singleCost), 0, 100000);
      if (typeof p.tenCost === 'number') pool.tenCost = U.clamp(Math.round(p.tenCost), 0, 1000000);
      pool.rateOverridden = true;
      K.save(true);
      K.emit('gacha', { rates: pool.id });
      return U.plain(pool);
    },

    /** 当前池的概率总览（给卡池详情展示） */
    rateSummary: function (pool) {
      var p = Engine.pityOf(pool.id);
      var nextIdx = U.int(p.sinceSsr, 0) + 1;
      var hard = U.int(pool.hardPity, RULES.hardPity);
      var softStart = U.int(pool.softPityStart, RULES.softPityStart);
      return {
        sr: (typeof pool.srRate === 'number' ? pool.srRate : RULES.srBase) * 100,
        ssr: Engine.ssrRateAt(nextIdx, pool) * 100,
        ssrBase: (typeof pool.ssrRate === 'number' ? pool.ssrRate : RULES.ssrBase) * 100,
        up: (typeof pool.upRate === 'number' ? pool.upRate : 0.5) * 100,
        sinceSsr: U.int(p.sinceSsr, 0),
        total: U.int(p.total, 0),
        guarantee: U.int(p.guarantee, 0),
        guaranteeCount: U.int(pool.guaranteeCount, RULES.guaranteeOn),
        hardPity: hard,
        softStart: softStart,
        toHard: Math.max(0, hard - U.int(p.sinceSsr, 0)),
        softActive: nextIdx > softStart
      };
    }
  };

  // ==========================================================================
  //  2. 锁脸生图适配器（本模组的核心美术管线）
  // ==========================================================================

  var LockFace = {

    /**
     * 读取锁脸配置（存在 state.overrides.lockface，按 charId × meId 隔离）。
     * ⚠ 初始化判定必须用一个**永不被改写**的标记字段（_hgLockface），
     *   早期版本用 loraWeight 判别，结果每次调用都把用户刚存好的配置整个重置回默认值。
     */
    config: function () {
      var st = K.state;
      if (!st) return LockFace._defaults();
      st.overrides = st.overrides || {};
      var cur = st.overrides.lockface;
      if (!cur || cur._hgLockface !== true) {
        // 保留旧对象上已有的自定义字段（升级路径），只补齐缺失的默认项
        var next = LockFace._defaults();
        if (cur && typeof cur === 'object') {
          Object.keys(cur).forEach(function (k) {
            if (k === '_hgLockface') return;
            if (cur[k] !== undefined && cur[k] !== null) next[k] = cur[k];
          });
        }
        st.overrides.lockface = next;
      }
      return st.overrides.lockface;
    },

    /** 默认锁脸配置（每次返回新对象，避免共享引用被就地改写） */
    _defaults: function () {
      return {
        _hgLockface: true,
        enabled: true,
        refImages: [],
        loraWeight: 0.85,
        controlNet: 'reference_only',
        controlNetWeight: 0.9,
        identityAnchor: '',      // 五官锚定描述（可手填 / 由 vision 生成）
        negativeLock: 'different face, different person, inconsistent face, face swap, changed hairstyle, changed eye color',
        seedLock: true,
        seed: 0,
        styleAnchor: ''          // 风格基调锚定
      };
    },

    save: function (patch) {
      var cfg = LockFace.config();
      Object.keys(patch || {}).forEach(function (k) { cfg[k] = patch[k]; });
      K.save(true);
      return cfg;
    },

    /** 生成锁脸块：以结构化指令形式送入生图接口 */
    buildBlock: function (cfg, profile) {
      var c = cfg || LockFace.config();
      var lines = [];
      lines.push('[IDENTITY LOCK · STRICT]');
      lines.push('同一角色，必须与参考图完全一致的五官与造型，禁止换脸 / 禁止改变发色瞳色。');
      if (c.identityAnchor) lines.push('五官锚定：' + c.identityAnchor);
      else if (profile && profile.persona) lines.push('角色基调：' + U.cut(profile.persona, 200));
      if (c.styleAnchor) lines.push('风格基调：' + c.styleAnchor);
      lines.push('LoRA 权重：' + U.round(c.loraWeight, 2));
      lines.push('ControlNet：' + c.controlNet + ' @ ' + U.round(c.controlNetWeight, 2));
      if (c.seedLock && c.seed) lines.push('固定随机种子：' + c.seed);
      if (Array.isArray(c.refImages) && c.refImages.length) {
        lines.push('参考图数量：' + c.refImages.length + '（以第一张为身份基准）');
      }
      lines.push('拒绝：' + (c.negativeLock || 'different face'));
      return lines.join('\n');
    },

    /** 解析生图 API：优先全局生图预设，其次心动游戏功能位 */
    resolveApi: async function () {
      // 1) 生图专用预设（app_image_gen.js 的全局预设）
      try {
        if (window.imageGenSystem && typeof window.imageGenSystem.getGlobalPreset === 'function') {
          var preset = await window.imageGenSystem.getGlobalPreset();
          if (preset && preset.url && preset.key) return preset;
        }
      } catch (e) {}
      // 2) 心动游戏自己的 API 功能位
      var api = await K.resolveApi();
      if (api && api.url && api.key) return api;
      return null;
    },

    /**
     * 生成一张卡面
     * @param {object} opts { prompt, negative, size, refImages }
     * @returns {Promise<{image:string, thumb:string}|null>}
     */
    generate: async function (opts) {
      var o = opts || {};
      var preset = await LockFace.resolveApi();
      if (!preset) return null;
      var cfg = LockFace.config();
      var profile = await K.charProfile();

      var prompt = (o.prompt || '') + '\n\n' + LockFace.buildBlock(cfg, profile);
      if (o.negative) prompt += '\n\n[AVOID] ' + o.negative;
      if (o.style) prompt += '\n\n[STYLE] ' + o.style;

      var modelName = String(preset.model || '').toLowerCase();
      var isOpenAI = modelName.indexOf('gpt-image') >= 0 || modelName.indexOf('dall-e') >= 0;
      var size = o.size || '1024x1536';

      var body = {
        model: preset.model,
        prompt: prompt,
        n: 1,
        size: isOpenAI ? size : size
      };
      if (isOpenAI) body.response_format = 'b64_json';
      else body.negative_prompt = (o.negative || '') + ', ' + (cfg.negativeLock || '');

      // 参考图（锁脸）：部分中转支持 image / reference 字段，失败时自动降级为纯文本锁脸
      var refs = (o.refImages && o.refImages.length) ? o.refImages : (cfg.refImages || []);
      if (refs.length) {
        body.image = refs[0];
        body.reference_images = refs.slice(0, 3);
        body.reference_strength = U.round(cfg.controlNetWeight, 2);
      }

      try {
        var resp = await fetch(String(preset.url).replace(/\/+$/, '') + '/images/generations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + preset.key },
          body: JSON.stringify(body)
        });
        if (!resp.ok) {
          console.warn('[心动游戏·抽卡] 生图失败 HTTP ' + resp.status);
          return null;
        }
        var data = await resp.json();
        var item = (data && data.data && data.data[0]) || null;
        if (!item) return null;
        var url = item.url || '';
        if (!url && item.b64_json) url = 'data:image/png;base64,' + item.b64_json;
        if (!url) return null;
        var thumb = url;
        try {
          if (window.imageGenSystem && typeof window.imageGenSystem.compressDataUrl === 'function') {
            thumb = await window.imageGenSystem.compressDataUrl(url, 512, 0.72);
          }
        } catch (e) {}
        return { image: url, thumb: thumb };
      } catch (e) {
        console.warn('[心动游戏·抽卡] 生图异常:', e);
        return null;
      }
    },

    /** 锁脸配置面板（供后台管理 / 卡池工坊调用） */
    openConfig: function () {
      var cfg = LockFace.config();
      var body = H.el('div');

      var note = H.el('div');
      note.style.cssText = 'font-size:10.8px; line-height:1.72; color:#8b8292; background:rgba(255,241,247,0.8);'
        + 'border:1px solid rgba(217,127,168,0.22); border-radius:13px; padding:11px 12px; margin-bottom:12px;';
      note.innerHTML = '生成卡面时，以下锁脸参数会以结构化指令随 prompt 一起送到生图接口，'
        + '并尝试附带参考图（reference_only）。<b>锁定的是发色、瞳色、五官与风格基调</b>，'
        + '确保同一角色的每张卡面都是同一个人。';
      body.appendChild(note);

      // 开关
      body.appendChild(H.listRow({
        icon: 'lock', color: '#D97FA8', soft: '#FFEBF3',
        title: '严格锁脸',
        subtitle: '关闭后卡面将由模型自由发挥（不推荐）',
        rightNode: H.toggle(!!cfg.enabled, function (on) { LockFace.save({ enabled: on }); })
      }));

      // LoRA 权重
      body.appendChild(H.sectionTitle('LoRA 权重', { color: '#B79EDC' }));
      var loraWrap = H.el('div');
      loraWrap.style.cssText = 'background:rgba(255,255,255,0.72); border:1px solid rgba(183,158,220,0.22);'
        + 'border-radius:14px; padding:11px 12px; margin-bottom:12px;';
      loraWrap.appendChild(H.slider({
        min: 0, max: 1.5, step: 0.05, value: cfg.loraWeight, color: '#B79EDC', color2: '#D97FA8',
        format: function (v) { return U.round(v, 2); },
        onChange: function (v) { cfg.loraWeight = Number(v); }
      }));
      body.appendChild(loraWrap);

      // ControlNet
      body.appendChild(H.sectionTitle('ControlNet 类型', { color: '#7E97C9' }));
      var cnWrap = H.el('div');
      cnWrap.style.cssText = 'display:flex; flex-wrap:wrap; gap:7px; margin-bottom:12px;';
      ['reference_only', 'ip_adapter', 'canny', 'openpose', 'none'].forEach(function (t) {
        var on = cfg.controlNet === t;
        var b = H.button(t, {
          kind: 'soft', pad: '7px 11px', size: 10.8,
          soft: on ? '#EAF3FF' : 'rgba(240,236,244,0.7)', color: on ? '#4A7DBF' : '#9a919f'
        });
        if (on) b.style.boxShadow = '0 0 0 1.4px rgba(74,125,191,0.35)';
        b.onclick = function () { LockFace.save({ controlNet: t }); H.toast('ControlNet：' + t); };
        cnWrap.appendChild(b);
      });
      body.appendChild(cnWrap);

      body.appendChild(H.sectionTitle('ControlNet 强度', { color: '#7E97C9' }));
      var cnW = H.el('div');
      cnW.style.cssText = 'background:rgba(255,255,255,0.72); border:1px solid rgba(159,179,217,0.22);'
        + 'border-radius:14px; padding:11px 12px; margin-bottom:12px;';
      cnW.appendChild(H.slider({
        min: 0, max: 1, step: 0.05, value: cfg.controlNetWeight, color: '#4A7DBF', color2: '#B79EDC',
        format: function (v) { return U.round(v, 2); },
        onChange: function (v) { cfg.controlNetWeight = Number(v); }
      }));
      body.appendChild(cnW);

      // 参考图
      body.appendChild(H.sectionTitle('锁脸参考图（正脸 / 清晰五官）', { color: '#D97FA8' }));
      var refBox = H.el('div');
      refBox.style.cssText = 'display:flex; flex-wrap:wrap; gap:8px; margin-bottom:12px;';
      function renderRefs() {
        refBox.innerHTML = '';
        (cfg.refImages || []).forEach(function (src, i) {
          var cell = H.el('div');
          cell.style.cssText = 'position:relative; width:72px; height:96px; border-radius:12px; overflow:hidden;'
            + 'border:1.5px solid ' + (i === 0 ? 'rgba(217,127,168,0.85)' : 'rgba(216,160,190,0.30)') + ';';
          var im = H.el('img', { alt: '' });
          im.src = src;
          im.style.cssText = 'width:100%; height:100%; object-fit:cover;';
          cell.appendChild(im);
          if (i === 0) {
            var tag = H.el('div', {}, '身份基准');
            tag.style.cssText = 'position:absolute; left:0; right:0; bottom:0; text-align:center; font-size:8.5px;'
              + 'font-weight:800; color:#fff; background:rgba(217,127,168,0.86); padding:2px 0;';
            cell.appendChild(tag);
          }
          var del = H.el('div');
          del.style.cssText = 'position:absolute; right:3px; top:3px; width:19px; height:19px; border-radius:50%;'
            + 'background:rgba(70,50,66,0.72); color:#fff; font-size:12px; display:flex; align-items:center;'
            + 'justify-content:center; cursor:pointer;';
          del.innerHTML = H.icon('close', 11, { strokeWidth: 2.6 });
          del.onclick = function () {
            cfg.refImages.splice(i, 1);
            LockFace.save({ refImages: cfg.refImages });
            renderRefs();
          };
          cell.appendChild(del);
          refBox.appendChild(cell);
        });
        var add = H.el('div');
        add.style.cssText = 'width:72px; height:96px; border-radius:12px; border:1.5px dashed rgba(217,127,168,0.55);'
          + 'display:flex; align-items:center; justify-content:center; color:#D97FA8; cursor:pointer;'
          + 'background:rgba(255,241,247,0.6);';
        add.innerHTML = H.icon('plus', 20, { strokeWidth: 2 });
        add.onclick = function () {
          if (HG.Portraits && HG.Portraits.pickImage) {
            HG.Portraits.pickImage(768, function (url) {
              cfg.refImages = (cfg.refImages || []).concat([url]).slice(0, 4);
              LockFace.save({ refImages: cfg.refImages });
              renderRefs();
            });
          }
        };
        refBox.appendChild(add);
      }
      renderRefs();
      body.appendChild(refBox);

      // 一键导入档案馆锁脸照片
      var importB = H.button('从档案馆导入该角色的锁脸照片', { kind: 'soft', block: true, icon: 'upload', soft: '#EDF2FB', color: '#5f7aa8' });
      importB.onclick = async function () {
        var d = K.db();
        var row = null;
        if (d && K.charId && K._table('archives')) row = await K._withTimeout(d.archives.get(Number(K.charId)), 3000, null);
        var imgs = (row && row.lockfaceImages) || [];
        if (!imgs.length) { H.toast('该角色在档案馆里还没有锁脸照片'); return; }
        cfg.refImages = imgs.slice(0, 4);
        LockFace.save({ refImages: cfg.refImages });
        renderRefs();
        H.toast('已导入 ' + cfg.refImages.length + ' 张锁脸照片');
      };
      body.appendChild(importB);

      // 五官锚定 / 风格锚定
      body.appendChild(H.sectionTitle('身份锚定描述', { color: '#B79EDC' }));
      function anchorField(label, key, placeholder, rows) {
        var box = H.el('div');
        box.style.cssText = 'margin-bottom:10px;';
        var lab = H.el('div', {}, U.esc(label));
        lab.style.cssText = 'font-size:10.6px; font-weight:700; color:#8b8292; margin:0 2px 5px;';
        box.appendChild(lab);
        var ta = H.el('textarea', { rows: rows || 3, placeholder: placeholder });
        ta.value = cfg[key] || '';
        ta.style.cssText = 'width:100%; box-sizing:border-box; border-radius:12px; border:1px solid rgba(183,158,220,0.30);'
          + 'padding:9px 11px; font-size:11.6px; color:#5c4450; background:rgba(255,255,255,0.86); outline:none;'
          + 'font-family:inherit; line-height:1.62; resize:vertical;';
        box.appendChild(ta);
        var save = H.button('保存', { kind: 'ghost', pad: '5px 11px', size: 10.5, color: '#7d63a8', icon: 'save' });
        save.style.cssText += 'margin-top:6px; background:rgba(243,238,255,0.85); border-radius:10px;';
        save.onclick = function () { LockFace.save({}); cfg[key] = ta.value; LockFace.save({}); H.toast('已保存'); };
        box.appendChild(save);
        return box;
      }
      body.appendChild(anchorField('五官锚定（发色 / 瞳色 / 五官特征）', 'identityAnchor',
        '例如：银灰色短发，左眼下方有一颗小痣，琥珀色瞳孔，眉骨偏高', 3));
      body.appendChild(anchorField('风格基调', 'styleAnchor',
        '例如：轻奢乙游卡面质感，柔光逆光，胶片颗粒，高精度厚涂', 2));

      // 负面锁
      body.appendChild(H.sectionTitle('负面锁（禁止出现的偏差）', { color: '#9FB3D9' }));
      var neg = H.el('textarea', { rows: 3 });
      neg.value = cfg.negativeLock || '';
      neg.style.cssText = 'width:100%; box-sizing:border-box; border-radius:12px; border:1px solid rgba(159,179,217,0.30);'
        + 'padding:9px 11px; font-size:11.4px; color:#5c4450; background:rgba(255,255,255,0.86); outline:none;'
        + 'font-family:inherit; line-height:1.6; resize:vertical; margin-bottom:12px;';
      body.appendChild(neg);

      H.sheet({
        title: '锁脸 / 特征统一配置',
        subtitle: '严格锁定 Char 的发色、瞳色、五官与风格基调',
        icon: 'lock',
        height: '90%',
        content: body,
        buttons: [{
          text: '保存全部', icon: 'check', kind: 'primary',
          onClick: function () {
            LockFace.save({ negativeLock: neg.value, refImages: cfg.refImages, loraWeight: cfg.loraWeight, controlNetWeight: cfg.controlNetWeight, controlNet: cfg.controlNet });
            H.toast('锁脸配置已保存');
          }
        }]
      });
    }
  };

  // ==========================================================================
  //  3. 卡池：生成 / 管理
  // ==========================================================================

  var Pools = {

    /** 当前生效的卡池（没有则返回 null） */
    active: function () {
      var st = K.state;
      if (!st) return null;
      var id = st.gacha.activePoolId;
      var list = st.gacha.pools;
      for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
      return list[0] || null;
    },

    byId: function (id) {
      var list = (K.state && K.state.gacha.pools) || [];
      for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
      return null;
    },

    /** 设为主推卡池 */
    setActive: function (id) {
      var st = K.state;
      if (!st || !Pools.byId(id)) return false;
      st.gacha.activePoolId = id;
      K.save();
      K.emit('gacha', { activePool: id });
      return true;
    },

    remove: function (id) {
      var st = K.state;
      if (!st) return false;
      st.gacha.pools = st.gacha.pools.filter(function (p) { return p.id !== id; });
      delete st.gacha.pity[id];
      if (st.gacha.activePoolId === id) st.gacha.activePoolId = st.gacha.pools.length ? st.gacha.pools[0].id : null;
      K.save();
      return true;
    },

    /**
     * 由 AI 生成一个主题卡池（含卡面文案，可选生成卡面插图）
     * @param {object} opts { theme, kind:'limited'|'standard', cardCount, withArt }
     */
    generateByAI: async function (opts) {
      // 生成卡池要调模型，防重复点击（v1.5.41）
      if (H.blocked('gacha-genpool', 2000)) return null;
      var o = opts || {};
      var profile = await K.charProfile();
      var theme = o.theme || '雨夜重逢';
      var count = U.clamp(U.int(o.cardCount, 6), 3, 9);
      var prompt = '你在为一款女性向恋爱手游设计限定卡池。\n'
        + '角色：' + profile.name + '\n'
        + '角色设定：' + U.cut(profile.persona || '（未填写）', 400) + '\n'
        + '当前关系阶段：' + K.tier().name + '\n'
        + '卡池主题：' + theme + '\n'
        + '需要产出 ' + count + ' 张卡面（1 张 SSR、2 张 SR、其余 R）。\n\n'
        + '每张卡面输出：\n'
        + '  "name"：4~8 字卡名，要有乙游卡面的质感\n'
        + '  "rarity"：SSR / SR / R\n'
        + '  "up"：仅 SSR 可以为 true\n'
        + '  "scene"：一句话场景（谁在哪里做什么）\n'
        + '  "caption"：卡面下方的 12~20 字短文案\n'
        + '  "story"：这张卡附带的独家私语剧情，120~200 字，第二人称，必须是角色对玩家说话\n'
        + '  "voice"：一句 20 字以内的专属语音台词\n\n'
        + '严格只返回 JSON：{"name":"卡池名","desc":"卡池说明","cards":[ … ]}';
      var obj = await K.askJSON(prompt, null, { temperature: 0.95 });
      if (!obj || !Array.isArray(obj.cards) || !obj.cards.length) {
        obj = Pools.offlinePool(theme, profile.name, count);
      }
      return Pools.create({
        name: obj.name || (theme + ' · 限定'),
        desc: obj.desc || '',
        theme: theme,
        kind: o.kind || 'limited',
        cards: obj.cards,
        withArt: o.withArt
      });
    },

    /** 离线兜底卡池（没配 API 也能玩） */
    offlinePool: function (theme, charName, count) {
      var seed = U.hash(theme + charName);
      var NAMES = ['雨夜的伞沿', '指尖的距离', '你不许走', '凌晨三点的电话', '掌心的温度', '同一条围巾',
        '被风吹乱的发', '只写给你的信', '雪停之后', '肩上的重量', '没说出口的话', '第二颗纽扣'];
      var SCENES = ['便利店屋檐下，他把伞往你这边倾了整个角度。',
        '深夜的沙发上，两个人的膝盖只隔着一层薄毯。',
        '他抓住你的手腕，力道不重，却让你走不掉。',
        '手机屏幕亮起，是他的名字，时间显示 03:12。',
        '他把你的手拢进自己口袋里，说这样比较暖。',
        '同一条围巾绕了两圈，两个人的呼吸都很轻。'];
      var CAPTIONS = ['这一次，我不打算再让开。', '你别回头，我怕我忍不住。', '再靠近一点也没关系。',
        '我数到三，你就要答应我。', '所有的心动都有迹可循。', '你是我唯一没算准的变量。'];
      var cards = [];
      for (var i = 0; i < count; i++) {
        var rarity = i === 0 ? 'SSR' : (i <= 2 ? 'SR' : 'R');
        cards.push({
          name: NAMES[(seed + i) % NAMES.length],
          rarity: rarity,
          up: rarity === 'SSR',
          scene: SCENES[(seed + i * 3) % SCENES.length],
          caption: CAPTIONS[(seed + i * 2) % CAPTIONS.length],
          story: '「' + CAPTIONS[(seed + i * 2) % CAPTIONS.length] + '」\n\n'
            + charName + '看了你很久，久到你以为他要说什么重话，'
            + '最后他只是把你的名字念了一遍，声音比平时低一点，'
            + '像是怕被谁听见，又像是只想让你一个人听见。',
          voice: '……只要你愿意听。'
        });
      }
      return { name: theme + ' · 限定', desc: '由心动游戏为你与TA即时生成的主题卡池。', cards: cards };
    },

    /** 落库一个卡池 */
    create: function (cfg) {
      var st = K.state;
      if (!st) return null;
      var cards = (cfg.cards || []).map(function (c, i) {
        var rarity = C.RARITY[c.rarity] ? c.rarity : (i === 0 ? 'SSR' : (i <= 2 ? 'SR' : 'R'));
        return {
          id: U.uid('ct'),
          name: c.name || ('卡面 ' + (i + 1)),
          rarity: rarity,
          up: !!c.up,
          scene: c.scene || '',
          caption: c.caption || '',
          story: c.story || '',
          voice: c.voice || '',
          image: c.image || '',
          thumb: c.thumb || c.image || ''
        };
      });
      var pool = {
        id: U.uid('pool'),
        name: cfg.name || '未命名卡池',
        desc: cfg.desc || '',
        theme: cfg.theme || '',
        kind: cfg.kind === 'standard' ? 'standard' : 'limited',
        cards: cards,
        ssrRate: typeof cfg.ssrRate === 'number' ? cfg.ssrRate : RULES.ssrBase,
        srRate: typeof cfg.srRate === 'number' ? cfg.srRate : RULES.srBase,
        upRate: typeof cfg.upRate === 'number' ? cfg.upRate : 0.5,
        hardPity: U.int(cfg.hardPity, RULES.hardPity),
        softPityStart: U.int(cfg.softPityStart, RULES.softPityStart),
        guaranteeCount: U.int(cfg.guaranteeCount, RULES.guaranteeOn),
        singleCost: U.int(cfg.singleCost, RULES.singleCost),
        tenCost: U.int(cfg.tenCost, RULES.tenCost),
        custom: !!cfg.custom,
        createdAt: Date.now(),
        authorName: cfg.authorName || ''
      };
      st.gacha.pools.unshift(pool);
      if (st.gacha.pools.length > 20) st.gacha.pools.length = 20;
      if (!st.gacha.activePoolId) st.gacha.activePoolId = pool.id;
      K.pushTimeline({
        type: 'gacha', title: '卡池上架',
        text: '「' + pool.name + '」已上架' + (pool.custom ? '（由你亲手设计）' : '') + '，共 ' + cards.length + ' 张卡面。'
      });
      K.save(true);
      K.emit('gacha', { pool: pool });
      return pool;
    },

    /** 为卡池批量生成卡面插图（逐张，带进度回调） */
    generateArt: async function (pool, onProgress) {
      var created = 0, failed = 0;
      var cfg = LockFace.config();
      for (var i = 0; i < pool.cards.length; i++) {
        var card = pool.cards[i];
        if (card.image) { created++; continue; }
        if (typeof onProgress === 'function') onProgress(i, pool.cards.length, card);
        var prompt = '女性向恋爱手游卡面插画。\n'
          + '主体：' + card.name + ' —— ' + card.scene + '\n'
          + '构图：半身或胸口以上特写，视线与观者相交，情绪张力强。\n'
          + '氛围：' + card.caption + '\n'
          + '品质：商业乙游卡面级厚涂，柔和电影光，浅景深，高精度材质。\n'
          + '画面中不要出现任何文字、水印、logo。';
        var out = await LockFace.generate({
          prompt: prompt,
          size: '1024x1536',
          style: cfg.styleAnchor || ''
        });
        if (out) {
          card.image = out.image;
          card.thumb = out.thumb;
          created++;
        } else {
          failed++;
        }
        K.save();
      }
      K.emit('gacha', { art: pool.id, created: created, failed: failed });
      return { created: created, failed: failed };
    },

    /** 单张卡的卡面重新生成（「基于新设定重新生成」） */
    regenerateCardArt: async function (cardId, extraPrompt) {
      var st = K.state;
      var card = null;
      for (var i = 0; i < st.gacha.pools.length; i++) {
        var p = st.gacha.pools[i];
        for (var j = 0; j < p.cards.length; j++) if (p.cards[j].id === cardId) { card = p.cards[j]; break; }
        if (card) break;
      }
      if (!card) {
        for (var k = 0; k < st.gacha.owned.length; k++) if (st.gacha.owned[k].id === cardId) { card = st.gacha.owned[k]; break; }
      }
      if (!card) return null;
      var prompt = '女性向恋爱手游卡面插画重绘。\n'
        + '卡名：' + card.name + '\n'
        + '场景：' + (card.scene || '') + '\n'
        + '文案氛围：' + (card.caption || '') + '\n'
        + (extraPrompt ? '新增设定：' + extraPrompt + '\n' : '')
        + '保持同一角色身份不变，仅调整构图与氛围。';
      var out = await LockFace.generate({ prompt: prompt, size: '1024x1536' });
      if (!out) return null;
      card.image = out.image;
      card.thumb = out.thumb;
      // 已入卡册的同 id 卡面同步更新
      st.gacha.owned.forEach(function (c) { if (c.id === card.id) { c.image = out.image; c.thumb = out.thumb; } });
      K.save(true);
      return out;
    }
  };

  // ==========================================================================
  //  4. 抽卡界面
  // ==========================================================================

  var UI = {

    /** 花瓣 / 光晕飘落动效层 */
    _sparkleLayer: function (host) {
      var layer = H.el('div');
      layer.style.cssText = 'position:absolute; inset:0; pointer-events:none; overflow:hidden;';
      host.appendChild(layer);
      var alive = true;
      layer._stop = function () { alive = false; };
      (function tick() {
        if (!alive || !layer.parentNode) return;
        if (layer.childNodes.length < 14) {
          var s = H.el('span');
          var size = 3 + Math.random() * 5;
          var dur = 2.6 + Math.random() * 2.4;
          s.style.cssText = 'position:absolute; left:' + (Math.random() * 100) + '%; top:-12px;'
            + 'width:' + size + 'px; height:' + size + 'px; border-radius:50%;'
            + 'background:rgba(255,255,255,' + (0.5 + Math.random() * 0.45) + ');'
            + 'box-shadow:0 0 9px rgba(217,127,168,0.9);'
            + 'animation:hg-rise ' + dur + 's linear forwards;';
          layer.appendChild(s);
          setTimeout(function () { if (s.parentNode) s.parentNode.removeChild(s); }, dur * 1000 + 60);
        }
        setTimeout(tick, 320);
      })();
      return layer;
    },

    /** 主界面：抽卡入口（右下角大尺寸动态悬浮光晕） */
    openLobby: async function () {
      var pool = Pools.active();
      var st = K.state;
      var body = H.el('div');

      // 卡池选择
      var poolBar = H.el('div');
      poolBar.style.cssText = 'display:flex; gap:7px; overflow-x:auto; padding:2px 2px 10px; scrollbar-width:none;';
      (st.gacha.pools || []).forEach(function (p) {
        var on = pool && p.id === pool.id;
        var chip = H.el('div');
        chip.style.cssText = 'flex:0 0 auto; padding:7px 13px; border-radius:13px; cursor:pointer; font-size:11.5px;'
          + 'font-weight:700; transition:all .22s ease;'
          + (on ? 'background:linear-gradient(135deg,#D97FA8,#B79EDC); color:#fff; box-shadow:0 6px 16px rgba(217,127,168,0.30);'
            : 'background:rgba(255,255,255,0.76); color:#9a919f; border:1px solid rgba(216,160,190,0.22);');
        chip.textContent = p.name;
        chip.onclick = function () { Pools.setActive(p.id); UI.openLobby(); return false; };
        poolBar.appendChild(chip);
      });
      var newPool = H.el('div');
      newPool.style.cssText = 'flex:0 0 auto; padding:7px 13px; border-radius:13px; cursor:pointer; font-size:11.5px;'
        + 'font-weight:700; background:rgba(255,241,247,0.9); color:#B0728F; border:1.4px dashed rgba(217,127,168,0.5);'
        + 'display:flex; align-items:center; gap:4px;';
      newPool.innerHTML = H.icon('plus', 13, { strokeWidth: 2.4 }) + '<span>新卡池</span>';
      newPool.onclick = function () { UI.openPoolStudio(); return false; };
      poolBar.appendChild(newPool);
      body.appendChild(poolBar);

      if (!pool) {
        body.appendChild(H.empty('还没有卡池。点「新卡池」让 AI 按角色设定为你与TA生成一个主题池。', { icon: 'cards' }));
        return H.sheet({ title: '抽卡工坊', subtitle: '心动卡池', icon: 'cards', height: '100%', slot: 'gacha',
          full: true, bg: 'images/heartgame/page/gacha.jpg', content: body });
      }

      // 主卡面（当期 UP 立绘切片）
      var upCard = (pool.cards || []).filter(function (c) { return c.up; })[0] || (pool.cards || [])[0];
      var hero = H.el('div');
      hero.style.cssText = 'position:relative; border-radius:22px; overflow:hidden; margin-bottom:12px;'
        + 'background:linear-gradient(160deg,#3b2b38 0%,#6b4a60 50%,#2c2130 100%);'
        + 'box-shadow:0 18px 44px rgba(120,80,120,0.28); min-height:230px; display:flex; align-items:center;'
        + 'justify-content:center;';
      if (upCard && (upCard.image || upCard.thumb)) {
        var im = H.el('img', { alt: '' });
        im.src = upCard.image || upCard.thumb;
        im.style.cssText = 'width:100%; height:100%; object-fit:cover; position:absolute; inset:0;';
        hero.appendChild(im);
      } else if (HG.Skin && HG.Skin.has('gacha', 'banner')) {
        // 没有卡面时用生成的卡池主视觉兜底（比纯渐变placeholder 有质感得多）
        var banner = H.el('img', { alt: '' });
        banner.src = HG.Skin.get('gacha', 'banner');
        banner.style.cssText = 'width:100%; height:100%; object-fit:cover; position:absolute; inset:0;';
        hero.appendChild(banner);
      } else {
        var ph = H.el('div');
        ph.style.cssText = 'position:absolute; inset:0; display:flex; flex-direction:column; align-items:center;'
          + 'justify-content:center; gap:8px; color:rgba(255,255,255,0.82);';
        ph.innerHTML = '<span style="width:40px; height:40px; opacity:.85;">' + H.icon('cards', 40, { strokeWidth: 1.4 }) + '</span>'
          + '<span style="font-size:11.5px; letter-spacing:.1em;">尚未生成卡面插图</span>';
        hero.appendChild(ph);
      }
      // 光晕与流光
      var glow = H.el('div');
      glow.style.cssText = 'position:absolute; inset:0; background:radial-gradient(circle at 50% 34%,'
        + 'rgba(255,214,236,0.30) 0%, rgba(255,214,236,0) 62%);';
      hero.appendChild(glow);
      var shine = H.el('div');
      shine.style.cssText = 'position:absolute; inset:0; pointer-events:none;';
      shine.className = 'hg-shimmer';
      shine.style.opacity = '0.35';
      hero.appendChild(shine);
      UI._sparkleLayer(hero);

      var heroMeta = H.el('div');
      heroMeta.style.cssText = 'position:absolute; left:0; right:0; bottom:0; padding:16px 16px 14px;'
        + 'background:linear-gradient(180deg, rgba(30,20,28,0) 0%, rgba(30,20,28,0.82) 68%);';
      heroMeta.innerHTML = '<div style="display:flex; align-items:center; gap:7px; margin-bottom:5px;">'
        + '<span style="font-size:10px; font-weight:900; letter-spacing:.12em; color:#fff;'
        + 'background:linear-gradient(135deg,#D97FA8,#B79EDC); padding:2px 8px; border-radius:8px;">'
        + (pool.kind === 'limited' ? '限定卡池' : '常驻卡池') + '</span>'
        + (pool.custom ? '<span style="font-size:9.5px; color:#F3D9E6; border:1px solid rgba(243,217,230,0.5);'
          + 'padding:1px 7px; border-radius:8px;">自制</span>' : '')
        + '</div>'
        + '<div style="font-size:16px; font-weight:900; color:#fff; letter-spacing:.02em;">' + U.esc(pool.name) + '</div>'
        + '<div style="font-size:10.8px; color:rgba(255,255,255,0.76); margin-top:4px; line-height:1.6;">'
        + U.esc(upCard ? (upCard.caption || upCard.scene || '') : '') + '</div>';
      hero.appendChild(heroMeta);
      body.appendChild(hero);

      // 概率与保底面板
      var rs = Engine.rateSummary(pool);
      var pityCard = H.card({ accent: '#D97FA8', soft: '#FFEBF3', pad: 13 });
      pityCard.appendChild(H.sectionTitle('概率与保底', { color: '#D97FA8', margin: '4px 0 9px' }));
      var grid = H.el('div');
      grid.style.cssText = 'display:grid; grid-template-columns:1fr 1fr 1fr; gap:8px; margin-bottom:11px;';
      [['SSR', U.round(rs.ssr, 2) + '%', C.RARITY.SSR.color],
       ['SR', U.round(rs.sr, 2) + '%', C.RARITY.SR.color],
       ['UP', U.round(rs.up, 1) + '%', C.RARITY.SSR.color]].forEach(function (g) {
        var cell = H.el('div');
        cell.style.cssText = 'text-align:center; background:rgba(255,255,255,0.74); border-radius:13px; padding:9px 4px;'
          + 'border:1px solid rgba(216,160,190,0.18);';
        cell.innerHTML = '<div style="font-size:9.5px; color:#a99fae; letter-spacing:.08em;">' + g[0] + '</div>'
          + '<div style="font-size:14.5px; font-weight:900; color:' + g[2] + '; margin-top:3px;">' + g[1] + '</div>';
        grid.appendChild(cell);
      });
      pityCard.appendChild(grid);

      var needSoft = Math.max(0, rs.softStart + 1 - (rs.sinceSsr + 1));
      pityCard.appendChild(H.progress({
        value: U.clamp(rs.sinceSsr / rs.hardPity * 100, 0, 100),
        color: '#D97FA8', color2: '#B79EDC',
        nodes: [{ pct: rs.softStart / rs.hardPity * 100 }, { pct: 100 }]
      }));
      var pityTip = H.el('div');
      pityTip.style.cssText = 'font-size:10.4px; color:#9a8f9e; margin-top:8px; line-height:1.66;';
      pityTip.innerHTML = '距离硬保底还有 <b style="color:#D97FA8;">' + rs.toHard + '</b> 抽'
        + (rs.softActive ? '（<b style="color:#B79EDC;">软保底已激活</b>，SSR 概率已提升）'
          : '（再 ' + needSoft + ' 抽进入软保底）')
        + '<br>大保底进度：<b style="color:#B79EDC;">' + rs.guarantee + ' / ' + rs.guaranteeCount + '</b>'
        + '（该计数满额时下一次 SSR 必为当期 UP）';
      pityCard.appendChild(pityTip);
      body.appendChild(pityCard);

      // 十连保底说明
      var tenTip = H.el('div');
      tenTip.style.cssText = 'font-size:10.4px; color:#9a8f9e; text-align:center; margin:10px 0 4px;';
      tenTip.textContent = '十连必出 ' + RULES.tenMinRarity + ' 及以上 · 单抽 ' + pool.singleCost + ' / 十连 ' + pool.tenCost + ' 心动代币';
      body.appendChild(tenTip);

      H.sheet({
        title: '抽卡工坊',
        subtitle: pool.name + ' · 已抽 ' + rs.total + ' 次',
        icon: 'cards',
        // v1.5.46：全屏页必须是 100% —— 之前这里是 90%，底部就留出 10% 的空挡
        height: '100%',
        slot: 'gacha',
        // 全屏页 + 生图背景（v1.5.42）
        full: true,
        bg: 'images/heartgame/page/gacha.jpg',
        content: body,
        buttons: [
          {
            text: '单抽 · ' + pool.singleCost, icon: 'die', kind: 'outline',
            color: '#8f6a80', border: 'rgba(216,160,190,0.5)',
            keepOpen: true,
            onClick: function (api, node) { UI.doDraw(pool, 1, node); }
          },
          {
            text: '十连 · ' + pool.tenCost, icon: 'sparkle', kind: 'primary',
            keepOpen: true,
            onClick: function (api, node) { UI.doDraw(pool, 10, node); }
          }
        ]
      });

      // 底部追加「卡册 / 卡池工坊」入口
      var extra = H.el('div');
      extra.style.cssText = 'display:flex; gap:9px; margin-top:12px;';
      var b1 = H.button('卡册与专属故事', { kind: 'soft', block: true, icon: 'book', soft: '#F3EEFF', color: '#7d63a8' });
      b1.onclick = function () { UI.openAlbum(); };
      var b2 = H.button('卡池工坊', { kind: 'soft', block: true, icon: 'edit', soft: '#FFEBF3', color: '#B0728F' });
      b2.onclick = function () { UI.openPoolStudio(); };
      extra.appendChild(b1);
      extra.appendChild(b2);
      body.appendChild(extra);
    },

    /** 执行抽卡并播放演出 */
    doDraw: async function (pool, times, node) {
      // 防重复点击（v1.5.41）：抽卡是真花钱的操作，连点两次会抽两次。
      // 用的是自过期的时间锁，所以不需要在每个 return 前手动解锁。
      if (H.blocked('gacha-draw', 1600)) return;
      if (node) { var _r = H.busy(node, '抽卡中…'); setTimeout(_r, 1600); }
      var cost = times === 10 ? pool.tenCost : pool.singleCost;
      var st = K.state;
      var useDrawTicket = false;

      // 优先用抽卡券，其次代币
      if (st.wallet.draws >= times) {
        useDrawTicket = true;
      } else if (st.wallet.tokens < cost) {
        var need = cost - st.wallet.tokens;
        var goExchange = await H.confirm({
          title: '心动代币不足',
          icon: 'wallet', accent: '#8FB8DE', soft: '#EAF3FF',
          message: '还差 ' + need + ' 心动代币。\n\n是否用仿制代金券兑换？（1 代金券 = 100 代币，'
            + '当前持有 ' + st.wallet.vouchers + ' 张）',
          okText: '去兑换', cancelText: '再想想'
        });
        if (!goExchange) return;
        UI.openWallet();
        return;
      }

      if (useDrawTicket) {
        if (!K.spend('draws', times, 'gacha')) return;
      } else {
        if (!K.spend('tokens', cost, 'gacha')) return;
      }

      // 抽卡演出
      H.closeAllLayers();
      var results = times === 10 ? Engine.tenPull(pool) : [Engine.performDraw(pool, cost, {})];
      await UI.playDrawShow(pool, results, times);
    },

    /** 抽卡演出：光效 → 逐张翻牌 */
    playDrawShow: function (pool, results, times) {
      return new Promise(function (resolve) {
        var hasSSR = results.some(function (r) { return r.rarity === 'SSR'; });
        var hasSR = results.some(function (r) { return r.rarity === 'SR'; });
        var topColor = hasSSR ? C.RARITY.SSR.color : (hasSR ? C.RARITY.SR.color : C.RARITY.R.color);
        var topGlow = hasSSR ? C.RARITY.SSR.glow : (hasSR ? C.RARITY.SR.glow : C.RARITY.R.glow);

        var overlay = H.el('div');
        overlay.style.cssText = 'position:fixed; inset:0; z-index:100300; display:flex; flex-direction:column;'
          + 'align-items:center; justify-content:center; padding:20px; box-sizing:border-box;'
          + 'background:radial-gradient(circle at 50% 40%, ' + topGlow + ' 0%, rgba(28,18,26,0.94) 62%, #150d14 100%);'
          + 'opacity:0; transition:opacity .3s ease;';
        document.body.appendChild(overlay);
        requestAnimationFrame(function () { overlay.style.opacity = '1'; });

        // 光晕爆发 + 粒子
        var burst = H.el('div');
        burst.style.cssText = 'position:absolute; width:190px; height:190px; border-radius:50%;'
          + 'background:radial-gradient(circle, ' + topColor + 'AA 0%, transparent 68%);'
          + 'animation:hg-pulse 1.5s ease-in-out infinite;';
        overlay.appendChild(burst);
        UI._sparkleLayer(overlay);

        var title = H.el('div');
        title.style.cssText = 'position:relative; font-size:13px; letter-spacing:.36em; color:rgba(255,255,255,0.9);'
          + 'margin-bottom:20px; text-align:center;';
        title.textContent = hasSSR ? '心 动 降 临' : (hasSR ? '命 运 相 遇' : '记 忆 落 下');
        overlay.appendChild(title);

        // 卡面网格
        var grid = H.el('div');
        var cols = times === 10 ? 3 : 1;
        grid.style.cssText = 'position:relative; display:grid; grid-template-columns:repeat(' + cols + ',1fr);'
          + 'gap:9px; width:100%; max-width:' + (times === 10 ? '300px' : '190px') + ';';
        overlay.appendChild(grid);

        results.forEach(function (r, i) {
          var rar = C.RARITY[r.rarity];
          var cell = H.el('div');
          var h = times === 10 ? 82 : 210;
          cell.style.cssText = 'position:relative; height:' + h + 'px; border-radius:13px; overflow:hidden;'
            + 'background:linear-gradient(160deg,#2a1e28,#4a3344); border:1.6px solid ' + rar.color + ';'
            + 'box-shadow:0 8px 22px ' + rar.glow + '; opacity:0; transform:translateY(14px) scale(.94);'
            + 'transition:all .42s cubic-bezier(.22,1,.36,1);';
          if (r.card && (r.card.image || r.card.thumb)) {
            var im = H.el('img', { alt: '' });
            im.src = r.card.thumb || r.card.image;
            im.style.cssText = 'position:absolute; inset:0; width:100%; height:100%; object-fit:cover;';
            cell.appendChild(im);
          } else {
            var ph = H.el('div');
            ph.style.cssText = 'position:absolute; inset:0; display:flex; align-items:center; justify-content:center;'
              + 'color:' + rar.color + '; opacity:.9;';
            ph.innerHTML = H.icon(r.rarity === 'SSR' ? 'sparkle' : (r.rarity === 'SR' ? 'star' : 'cards'),
              times === 10 ? 22 : 46, { strokeWidth: 1.5 });
            cell.appendChild(ph);
          }
          var tag = H.el('div');
          tag.style.cssText = 'position:absolute; left:0; right:0; bottom:0; padding:4px 5px;'
            + 'background:linear-gradient(180deg,transparent,rgba(20,12,18,0.88));';
          tag.innerHTML = '<div style="font-size:' + (times === 10 ? 8.6 : 11.5) + 'px; font-weight:900; color:#fff;'
            + 'white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">' + U.esc(r.card ? r.card.name : '') + '</div>'
            + '<div style="font-size:' + (times === 10 ? 7.4 : 9.4) + 'px; font-weight:800; color:' + rar.color + ';">'
            + rar.name + (r.up ? ' · UP' : '') + '</div>';
          cell.appendChild(tag);
          grid.appendChild(cell);
          setTimeout(function () {
            cell.style.opacity = '1';
            cell.style.transform = 'translateY(0) scale(1)';
          }, 140 + i * 110);
        });

        // 继续按钮
        var cont = H.button('收下这份心动', { kind: 'primary', icon: 'heart', color: topColor, color2: '#B79EDC' });
        cont.style.cssText += 'position:relative; margin-top:22px; opacity:0; transition:opacity .4s ease;';
        overlay.appendChild(cont);
        setTimeout(function () { cont.style.opacity = '1'; }, 140 + results.length * 110 + 120);

        var done = false;
        cont.onclick = function () {
          if (done) return;
          done = true;
          overlay.style.opacity = '0';
          setTimeout(function () {
            if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
            UI.openResultList(results, pool);
            resolve();
          }, 320);
        };
      });
    },

    /** 抽卡结果明细 */
    openResultList: function (results, pool) {
      var body = H.el('div');
      var ssr = results.filter(function (r) { return r.rarity === 'SSR'; });
      if (ssr.length) {
        var banner = H.el('div');
        banner.style.cssText = 'border-radius:18px; padding:14px; margin-bottom:12px; text-align:center;'
          + 'background:linear-gradient(150deg,#FFF1F7,#F3EEFF); border:1.5px solid rgba(217,127,168,0.45);'
          + 'box-shadow:0 10px 28px rgba(217,127,168,0.22);';
        banner.innerHTML = '<div style="font-size:13.5px; font-weight:900; color:#B0728F;">'
          + (ssr[0].up ? '当期 UP 到手' : 'SSR 降临') + '</div>'
          + '<div style="font-size:10.8px; color:#9a8f9e; margin-top:5px;">'
          + U.esc(ssr[0].card ? ssr[0].card.name : '') + '</div>';
        body.appendChild(banner);
      }
      results.forEach(function (r) {
        var rar = C.RARITY[r.rarity];
        var row = H.listRow({
          icon: r.rarity === 'SSR' ? 'sparkle' : (r.rarity === 'SR' ? 'star' : 'cards'),
          color: rar.color, soft: rar.color + '22',
          title: (r.card ? r.card.name : '卡面') + (r.up ? ' · UP' : ''),
          subtitle: r.extras.map(function (e) { return e.label; }).join(' · ') || '无附加掉落',
          subtitleWrap: true,
          rightNode: H.rarityBadge(r.rarity)
        });
        body.appendChild(row);
      });
      body.appendChild((function () {
        var b = H.button('查看卡册', { kind: 'soft', block: true, icon: 'book', soft: '#F3EEFF', color: '#7d63a8' });
        b.onclick = function () { H.closeAllLayers(); UI.openAlbum(); };
        return b;
      })());
      H.sheet({
        title: '本次收获', subtitle: (pool ? pool.name + ' · ' : '') + '共 ' + results.length + ' 张',
        icon: 'gift', height: '80%', content: body
      });
    },

    // ------------------------------------------------------------------
    //  4.1 卡册与专属故事
    // ------------------------------------------------------------------

    openAlbum: function () {
      var st = K.state;
      var body = H.el('div');
      var filter = 'ALL';

      function render() {
        body.innerHTML = '';
        var owned = st.gacha.owned || [];
        var tabs = H.tabs([
          { key: 'ALL', label: '全部' },
          { key: 'SSR', label: 'SSR' },
          { key: 'SR', label: 'SR' },
          { key: 'R', label: 'R' }
        ], filter, function (k) { filter = k; render(); });
        body.appendChild(tabs);
        var list = filter === 'ALL' ? owned : owned.filter(function (c) { return c.rarity === filter; });
        var count = H.el('div');
        count.style.cssText = 'font-size:10.6px; color:#a99fae; margin:10px 2px 9px;';
        count.textContent = '共 ' + list.length + ' 张卡面 · 解锁 ' + owned.filter(function (c) { return c.story; }).length + ' 段专属私语';
        body.appendChild(count);

        if (!list.length) { body.appendChild(H.empty('这个稀有度还没有卡面。去抽卡，或自己设计一个卡池。', { icon: 'cards' })); return; }

        var grid = H.el('div');
        grid.style.cssText = 'display:grid; grid-template-columns:1fr 1fr; gap:10px;';
        list.forEach(function (card) {
          var rar = C.RARITY[card.rarity] || C.RARITY.R;
          var cell = H.el('div');
          cell.style.cssText = 'position:relative; border-radius:16px; overflow:hidden; cursor:pointer;'
            + 'aspect-ratio:2/3; background:linear-gradient(160deg,#2a1e28,#4a3344);'
            + 'border:1.6px solid ' + rar.color + '; box-shadow:0 8px 20px ' + rar.glow + ';'
            + 'transition:transform .2s ease;';
          if (card.image || card.thumb) {
            var im = H.el('img', { alt: '' });
            im.src = card.thumb || card.image;
            im.style.cssText = 'position:absolute; inset:0; width:100%; height:100%; object-fit:cover;';
            cell.appendChild(im);
          } else {
            var ph = H.el('div');
            ph.style.cssText = 'position:absolute; inset:0; display:flex; align-items:center; justify-content:center;'
              + 'color:' + rar.color + '; opacity:.85;';
            ph.innerHTML = H.icon(card.rarity === 'SSR' ? 'sparkle' : 'cards', 34, { strokeWidth: 1.4 });
            cell.appendChild(ph);
          }
          var meta = H.el('div');
          meta.style.cssText = 'position:absolute; left:0; right:0; bottom:0; padding:8px 9px;'
            + 'background:linear-gradient(180deg,transparent,rgba(20,12,18,0.9));';
          meta.innerHTML = '<div style="font-size:10.6px; font-weight:800; color:#fff; white-space:nowrap;'
            + 'overflow:hidden; text-overflow:ellipsis;">' + U.esc(card.name) + '</div>'
            + '<div style="font-size:8.6px; color:' + rar.color + '; font-weight:800; margin-top:2px;">'
            + rar.name + (card.up ? ' · UP' : '') + '</div>';
          cell.appendChild(meta);
          if (card.story) {
            var dot = H.el('div');
            dot.style.cssText = 'position:absolute; right:7px; top:7px; width:8px; height:8px; border-radius:50%;'
              + 'background:#fff; box-shadow:0 0 9px rgba(255,255,255,0.9);';
            cell.appendChild(dot);
          }
          cell.onpointerdown = function () { cell.style.transform = 'scale(0.97)'; };
          cell.onpointerup = function () { cell.style.transform = ''; };
          cell.onpointerleave = function () { cell.style.transform = ''; };
          cell.onclick = function () { UI.openCardDetail(card, render); };
          grid.appendChild(cell);
        });
        body.appendChild(grid);
      }
      render();

      H.sheet({
        title: '卡册',
        subtitle: '点击卡面展开全屏动态卡面与独家私语',
        icon: 'book',
        height: '92%',
        slot: 'gacha-album',
        content: body
      });
    },

    /** 卡面详情：全屏动态卡面 + 专属故事（支持再演 / 重新生成） */
    openCardDetail: function (card, onBack) {
      var rar = C.RARITY[card.rarity] || C.RARITY.R;
      var body = H.el('div');

      // 全屏动态卡面
      var frame = H.el('div');
      frame.style.cssText = 'position:relative; border-radius:20px; overflow:hidden; aspect-ratio:2/3;'
        + 'background:linear-gradient(160deg,#2a1e28,#4a3344); border:1.8px solid ' + rar.color + ';'
        + 'box-shadow:0 16px 40px ' + rar.glow + ';';
      if (card.image || card.thumb) {
        var im = H.el('img', { alt: '' });
        im.src = card.image || card.thumb;
        im.className = 'hg-breathe';
        im.style.cssText = 'width:100%; height:100%; object-fit:cover;';
        frame.appendChild(im);
      } else {
        var ph = H.el('div');
        ph.style.cssText = 'position:absolute; inset:0; display:flex; flex-direction:column; align-items:center;'
          + 'justify-content:center; gap:9px; color:' + rar.color + ';';
        ph.innerHTML = H.icon('sparkle', 40, { strokeWidth: 1.4 })
          + '<span style="font-size:10.5px; color:rgba(255,255,255,0.7);">这张卡还没有生成插图</span>';
        frame.appendChild(ph);
      }
      var shine = H.el('div');
      shine.className = 'hg-shimmer';
      shine.style.cssText = 'position:absolute; inset:0; pointer-events:none; opacity:.28;';
      frame.appendChild(shine);
      var badge = H.el('div');
      badge.style.cssText = 'position:absolute; left:11px; top:11px;';
      badge.appendChild(H.rarityBadge(card.rarity));
      frame.appendChild(badge);
      body.appendChild(frame);

      // 卡名与文案
      var meta = H.el('div');
      meta.style.cssText = 'text-align:center; margin:13px 0 6px;';
      meta.innerHTML = '<div style="font-size:15.5px; font-weight:900; color:#553f4c; letter-spacing:.02em;">'
        + U.esc(card.name) + '</div>'
        + (card.caption ? '<div style="font-size:11.4px; color:#a99fae; margin-top:6px; line-height:1.66; font-style:italic;">'
          + U.esc(card.caption) + '</div>' : '');
      body.appendChild(meta);
      if (card.voice) {
        var voice = H.el('div');
        voice.style.cssText = 'text-align:center; font-size:11px; color:#B0728F; margin:8px 0 4px;'
          + 'background:rgba(255,241,247,0.85); border-radius:12px; padding:8px 12px; line-height:1.66;';
        voice.textContent = '「' + card.voice + '」';
        body.appendChild(voice);
      }

      // 专属故事
      body.appendChild(H.sectionTitle('独家私语', { color: '#D97FA8' }));
      var storyBox = H.el('div');
      storyBox.style.cssText = 'background:rgba(255,255,255,0.78); border:1px solid rgba(216,160,190,0.22);'
        + 'border-radius:15px; padding:12px; font-size:12.2px; line-height:1.86; color:#5c4450;'
        + 'white-space:pre-wrap; min-height:60px;';
      storyBox.textContent = card.story || '（这段私语还没有写下来。点「重新生成」让模型为这张卡补上。）';
      body.appendChild(storyBox);

      var actRow = H.el('div');
      actRow.style.cssText = 'display:flex; gap:8px; margin-top:12px; flex-wrap:wrap;';

      /**
       * 生成/重写一段卡面私语
       * @param {object} opts { tone:'tender'|'tease'|'possessive'|'sad', custom:'用户自定义走向' }
       */
      async function writeStory(opts) {
        var o = opts || {};
        var profile = await K.charProfile();
        var TIERS = {
          tender: '温柔克制，克制里带一点藏不住的偏心',
          tease: '带点玩笑与挑衅，像在逗你，但眼神一直落在你身上',
          possessive: '占有欲很强，反复确认「你是不是只看我」',
          sad: '带一点将失去的预感，克制地挽留',
          custom: '按用户给出的新走向写'
        };
        var toneLine = TIERS[o.tone] || TIERS.tender;
        var prompt = '你要为一张恋爱手游卡面「' + card.name + '」写一段独家私语剧情。\n'
          + '角色：' + profile.name + '\n'
          + '角色设定：' + U.cut(profile.persona || '（未填写）', 300) + '\n'
          + '卡面场景：' + (card.scene || '') + '\n'
          + '卡面文案：' + (card.caption || '') + '\n'
          + '当前关系阶段：' + K.tier().name + '\n'
          + '基调要求：' + toneLine + '\n'
          + (o.custom ? '用户指定的新走向：' + o.custom + '\n' : '')
          + (card.story ? '（这是重写，请给出与下面旧版本不同的角度）\n旧版本：' + U.cut(card.story, 200) + '\n' : '')
          + '\n用第二人称写 120~200 字：TA 在这个场景里对你说话、做了某个动作，'
          + '至少包含一句直接引语。不要旁白腔，不要写标题，不要出现 emoji。';
        return K.ask(prompt, { temperature: 0.95 });
      }

      function applyStory(text) {
        var st = K.state;
        card.story = String(text).trim();
        card.storyTurns = U.int(card.storyTurns, 0) + 1;
        // 同步到卡册副本与卡池模板，任何入口看到的都是同一段
        st.gacha.owned.forEach(function (c) { if (c.id === card.id) c.story = card.story; });
        st.gacha.pools.forEach(function (p) {
          (p.cards || []).forEach(function (c) { if (c.id === card.id) c.story = card.story; });
        });
        K.save(true);
        K.pushTimeline({ type: 'story', title: '卡面私语', text: '重演了「' + card.name + '」的独家私语。' });
        storyBox.textContent = card.story;
      }

      var replayB = H.button('再演一次', { kind: 'soft', icon: 'play', soft: '#F3EEFF', color: '#7d63a8' });
      replayB.onclick = function () { UI.openStoryTonePicker(card, writeStory, applyStory, storyBox); };
      actRow.appendChild(replayB);

      // 自定义走向（用户键入新剧情方向，让模型据此重写）
      var branchB = H.button('自定义走向', { kind: 'soft', icon: 'branch', soft: '#EAF3FF', color: '#4A7DBF' });
      branchB.onclick = async function () {
        var dir = await H.prompt({
          title: '这一段往哪走',
          message: '写下你希望的剧情走向，模型会基于它重写这段私语。',
          multiline: true, rows: 3,
          placeholder: '例如：他其实早就知道你要走，只是一直没说 / 换成他先开口告白'
        });
        if (!dir) return;
        branchB.disabled = true;
        var out = await writeStory({ tone: 'custom', custom: dir });
        branchB.disabled = false;
        if (!out) { H.toast('模型不可用，无法生成'); return; }
        applyStory(out);
        H.toast('已按你的走向重写');
      };
      actRow.appendChild(branchB);

      var regenB = H.button('重新生成卡面', { kind: 'soft', icon: 'refresh', soft: '#FFEBF3', color: '#B0728F' });
      regenB.onclick = async function () {
        var extra = await H.prompt({
          title: '追加新设定',
          message: '输入希望这次重绘带上新设定（留空则只调整构图与氛围）。',
          multiline: true, rows: 2, placeholder: '例如：换成冬天的大衣，背景是初雪'
        });
        if (extra === null) return;
        regenB.disabled = true;
        regenB.textContent = '生成中…';
        var out = await Pools.regenerateCardArt(card.id, extra);
        regenB.disabled = false;
        if (!out) { H.toast('卡面生成失败，请检查生图 API 预设'); return; }
        H.toast('卡面已重新生成');
        UI.openCardDetail(card, onBack);
      };
      actRow.appendChild(regenB);

      // 自己上传卡面（反向模式：User 是卡面美术）
      var uploadB = H.button('上传卡面', { kind: 'soft', icon: 'upload', soft: '#FFEBF3', color: '#B0728F' });
      uploadB.onclick = function () {
        if (!HG.Portraits || !HG.Portraits.pickImage) { H.toast('图片选择器不可用'); return; }
        HG.Portraits.pickImage(1200, function (dataUrl) {
          card.image = dataUrl;
          card.thumb = dataUrl;
          var st = K.state;
          st.gacha.owned.forEach(function (c) { if (c.id === card.id) { c.image = dataUrl; c.thumb = dataUrl; } });
          st.gacha.pools.forEach(function (p) {
            (p.cards || []).forEach(function (c) { if (c.id === card.id) { c.image = dataUrl; c.thumb = dataUrl; } });
          });
          K.save(true);
          H.toast('卡面已更新');
          UI.openCardDetail(card, onBack);
        });
      };
      actRow.appendChild(uploadB);

      var lockB = H.button('锁脸配置', { kind: 'ghost', icon: 'lock', color: '#9a8f9e' });
      lockB.onclick = function () { LockFace.openConfig(); };
      actRow.appendChild(lockB);
      body.appendChild(actRow);

      // 收藏为记忆
      var memB = H.button('存入重要记忆回廊', { kind: 'primary', block: true, icon: 'heart' });
      memB.style.marginTop = '12px';
      memB.onclick = function () {
        K.addMemory({
          title: card.name,
          summary: card.caption || card.scene || '一张只属于你们的卡面。',
          quotes: card.voice ? [card.voice] : [],
          source: 'gacha',
          cover: card.thumb || card.image,
          tags: ['卡面', card.rarity]
        });
        H.toast('已存入记忆回廊');
      };
      body.appendChild(memB);

      H.sheet({
        title: '卡面详情',
        subtitle: (card.poolName || '') + ' · ' + U.timeAgo(card.at),
        icon: 'sparkle',
        height: '94%',
        content: body,
        onClose: function () { if (typeof onBack === 'function') onBack(); }
      });
    },

    // ------------------------------------------------------------------
    //  4.2 卡池工坊（正向：AI 生成卡池 / 反向：User 自定义卡池）
    // ------------------------------------------------------------------

    openPoolStudio: function () {
      var st = K.state;
      var reverse = K.isReverse();
      var body = H.el('div');

      var intro = H.el('div');
      intro.style.cssText = 'font-size:10.8px; line-height:1.72; color:#8b8292; background:rgba(255,241,247,0.8);'
        + 'border:1px solid rgba(217,127,168,0.22); border-radius:13px; padding:11px 12px; margin-bottom:12px;';
      intro.innerHTML = reverse
        ? '当前是<b>被攻略模式</b>：你是卡池规划师。自定义卡面美术、文案与掉落概率，'
          + 'TA 会在静室里自己氪金抽卡，歪卡会破防，抽中 SSR 会当场狂喜。'
        : '当前是<b>攻略模式</b>：让 AI 按角色设定为你与TA生成主题卡池，'
          + '生成卡面插图时自动开启严格锁脸，确保每张卡都是同一个人。';
      body.appendChild(intro);

      // —— 新建卡池 ——
      body.appendChild(H.sectionTitle('新建卡池', { color: '#D97FA8' }));
      var themeBox = H.el('div');
      themeBox.style.cssText = 'background:rgba(255,255,255,0.74); border:1px solid rgba(216,160,190,0.22);'
        + 'border-radius:15px; padding:12px; margin-bottom:12px;';
      var themeInput = H.el('input', { type: 'text', placeholder: '卡池主题，例如：雨夜重逢 / 雪国列车 / 生日夜' });
      themeInput.style.cssText = 'width:100%; box-sizing:border-box; border-radius:11px; border:1px solid rgba(216,160,190,0.32);'
        + 'padding:9px 11px; font-size:12px; color:#5c4450; background:#fff; outline:none; font-family:inherit;';
      themeBox.appendChild(themeInput);

      var quick = H.el('div');
      quick.style.cssText = 'display:flex; flex-wrap:wrap; gap:6px; margin-top:9px;';
      ['雨夜重逢', '雪国列车', '凌晨便利店', '生日夜', '天台的风', '同一把伞'].forEach(function (t) {
        var b = H.button(t, { kind: 'soft', pad: '5px 10px', size: 10.6, soft: '#FFEBF3', color: '#B0728F' });
        b.onclick = function () { themeInput.value = t; };
        quick.appendChild(b);
      });
      themeBox.appendChild(quick);

      var genRow = H.el('div');
      genRow.style.cssText = 'display:flex; gap:8px; margin-top:11px;';
      var genB = H.button('AI 生成卡池', { kind: 'primary', block: true, icon: 'sparkle' });
      var artChk = H.toggle(false, function () { });
      var artLab = H.el('div');
      artLab.style.cssText = 'display:flex; align-items:center; gap:7px; font-size:10.6px; color:#8a8090; flex-shrink:0;';
      artLab.appendChild(artChk);
      artLab.appendChild(H.el('span', {}, '同时出图'));
      genRow.appendChild(genB);
      genRow.appendChild(artLab);
      themeBox.appendChild(genRow);

      genB.onclick = async function () {
        var theme = themeInput.value.trim() || '雨夜重逢';
        genB.disabled = true;
        genB.textContent = 'AI 正在设计卡池…';
        var pool = await Pools.generateByAI({ theme: theme, kind: 'limited', cardCount: 6, withArt: false });
        genB.disabled = false;
        genB.innerHTML = H.icon('sparkle', 15, { strokeWidth: 2 }) + '<span>AI 生成卡池</span>';
        if (!pool) { H.toast('卡池生成失败'); return; }
        H.toast('卡池「' + pool.name + '」已上架');
        if (artChk.getValue()) {
          UI.runArtGeneration(pool, function () { UI.openPoolStudio(); });
        } else {
          UI.openPoolStudio();
        }
      };
      body.appendChild(themeBox);

      // —— 反向模式：手动设计卡池 ——
      if (reverse) {
        body.appendChild(H.sectionTitle('手动设计卡面', { color: '#B79EDC' }));
        var manB = H.button('逐张手写卡面（名称 / 文案 / 概率）', { kind: 'soft', block: true, icon: 'edit', soft: '#F3EEFF', color: '#7d63a8' });
        manB.onclick = function () { UI.openManualPoolEditor(); };
        body.appendChild(manB);

        body.appendChild(H.sectionTitle('掉落概率自定义', { color: '#7E97C9' }));
        var rateBox = H.el('div');
        rateBox.style.cssText = 'background:rgba(255,255,255,0.74); border:1px solid rgba(159,179,217,0.22);'
          + 'border-radius:15px; padding:12px; margin-bottom:12px;';
        rateBox.innerHTML = '<div style="font-size:10.6px; color:#9a8f9e; line-height:1.7; margin-bottom:9px;">'
          + '新卡池的默认概率参数。真实抽卡时按此计算，保底计数器独立持久化。</div>';
        var cfg = { ssrRate: RULES.ssrBase, upRate: 0.5, hardPity: RULES.hardPity };
        function rateSlider(label, key, min, max, step, fmt) {
          var w = H.el('div');
          w.style.cssText = 'margin-bottom:9px;';
          var lab = H.el('div');
          lab.style.cssText = 'font-size:10.6px; font-weight:700; color:#8b8292; margin-bottom:5px;';
          lab.textContent = label;
          w.appendChild(lab);
          w.appendChild(H.slider({
            min: min, max: max, step: step, value: cfg[key], color: '#4A7DBF', color2: '#B79EDC',
            format: fmt, onChange: function (v) { cfg[key] = Number(v); }
          }));
          return w;
        }
        rateBox.appendChild(rateSlider('SSR 基础概率', 'ssrRate', 0.01, 0.2, 0.01, function (v) { return U.round(v * 100, 0) + '%'; }));
        rateBox.appendChild(rateSlider('当期 UP 占比', 'upRate', 0.1, 1, 0.05, function (v) { return U.round(v * 100, 0) + '%'; }));
        rateBox.appendChild(rateSlider('硬保底抽数', 'hardPity', 20, 180, 5, function (v) { return v + ' 抽'; }));
        rateBox._cfg = cfg;
        body.appendChild(rateBox);

        // —— Char 自动抽卡模拟 ——
        body.appendChild(H.sectionTitle('TA 的抽卡行为模拟', { color: '#D97FA8' }));
        var simB = H.button('让 TA 去抽一次（看反应）', { kind: 'primary', block: true, icon: 'dice' });
        simB.onclick = function () {
          var pool = Pools.active();
          if (!pool) { H.toast('先建一个卡池'); return; }
          H.closeAllLayers();
          UI.simulateCharDraw(pool);
        };
        body.appendChild(simB);
      }

      // —— 已有卡池列表 ——
      body.appendChild(H.sectionTitle('已有卡池', { color: '#9FB3D9' }));
      (st.gacha.pools || []).forEach(function (p) {
        var active = st.gacha.activePoolId === p.id;
        var rs = Engine.rateSummary(p);
        var row = H.listRow({
          icon: 'cards', color: active ? '#D97FA8' : '#9FB3D9', soft: active ? '#FFEBF3' : '#EDF2FB',
          title: p.name + (active ? ' · 主推' : ''),
          subtitle: (p.kind === 'limited' ? '限定' : '常驻') + ' · ' + p.cards.length + ' 张 · 已抽 ' + rs.total
            + ' · 大保底 ' + rs.guarantee + '/' + rs.guaranteeCount,
          subtitleWrap: true,
          rightNode: (function () {
            var box = H.el('div');
            box.style.cssText = 'display:flex; gap:6px; align-items:center; flex-shrink:0;';
            if (!active) {
              var useB = H.button('主推', { kind: 'soft', pad: '5px 9px', size: 10.5, soft: '#FFEBF3', color: '#B0728F' });
              useB.onclick = function (ev) { ev.stopPropagation(); Pools.setActive(p.id); UI.openPoolStudio(); };
              box.appendChild(useB);
            }
            var artB = H.button('出图', { kind: 'soft', pad: '5px 9px', size: 10.5, soft: '#F3EEFF', color: '#7d63a8' });
            artB.onclick = function (ev) {
              ev.stopPropagation();
              UI.runArtGeneration(p, function () { UI.openPoolStudio(); });
            };
            box.appendChild(artB);
            var rateB = H.button('调概率', { kind: 'soft', pad: '5px 9px', size: 10.5, soft: '#EDF2FB', color: '#5f7aa8' });
            rateB.onclick = function (ev) {
              ev.stopPropagation();
              UI.openRateEditor(p.id);
            };
            box.appendChild(rateB);
            var del = H.iconButton('trash', { size: 26, color: '#c2607c' });
            del.onclick = function (ev) {
              ev.stopPropagation();
              H.confirm({
                title: '删除卡池', icon: 'trash', accent: '#c2607c', soft: '#FFEFF3',
                message: '删除「' + p.name + '」？保底计数会一并清除，已入卡册的卡面保留。',
                okText: '删除'
              }).then(function (ok) {
                if (!ok) return;
                Pools.remove(p.id);
                UI.openPoolStudio();
              });
            };
            box.appendChild(del);
            return box;
          })()
        });
        body.appendChild(row);
      });

      // 锁脸入口
      var lockRow = H.listRow({
        icon: 'lock', color: '#D97FA8', soft: '#FFEBF3',
        title: '锁脸 / 特征统一配置',
        subtitle: 'LoRA 权重 · ControlNet · 参考图 · 五官锚定',
        rightNode: H.iconButton('next', { size: 26, color: '#c3b6c6' })
      });
      lockRow.onclick = function () { LockFace.openConfig(); };
      body.appendChild(lockRow);

      H.sheet({
        title: reverse ? '卡池规划台' : '卡池工坊',
        subtitle: reverse ? '你设计卡池，TA 来氪金' : 'AI 生成 · 严格锁脸',
        icon: 'edit',
        height: '92%',
        content: body
      });
    },

    /**
     * 逐池概率覆写面板（反向模式核心：你是卡池规划师）
     * 每个已存在的卡池都能单独调 SSR/SR/UP 概率、软硬保底、大保底与单抽花费。
     */
    openRateEditor: function (poolId) {
      var pool = Pools.byId(poolId);
      if (!pool) { H.toast('找不到这个卡池'); return; }
      var body = H.el('div');

      var intro = H.el('div');
      intro.style.cssText = 'font-size:10.8px; line-height:1.72; color:#8b8292; background:rgba(255,241,247,0.8);'
        + 'border:1px solid rgba(217,127,168,0.22); border-radius:13px; padding:11px 12px; margin-bottom:12px;';
      intro.innerHTML = '为「<b>' + U.esc(pool.name) + '</b>」单独设定抽卡参数。'
        + '软保底起点必须早于硬保底；大保底计数满额时，下一次 SSR 必为当期 UP。<br>'
        + '当前状态：' + (pool.rateOverridden ? '<b style="color:#D97FA8;">已自定义</b>' : '使用全局默认') + '。';
      body.appendChild(intro);

      // 草稿（点保存才写库，避免拖滑块时疯狂落盘）
      var draft = {
        ssrRate: typeof pool.ssrRate === 'number' ? pool.ssrRate : RULES.ssrBase,
        srRate: typeof pool.srRate === 'number' ? pool.srRate : RULES.srBase,
        upRate: typeof pool.upRate === 'number' ? pool.upRate : 0.5,
        hardPity: U.int(pool.hardPity, RULES.hardPity),
        softPityStart: U.int(pool.softPityStart, RULES.softPityStart),
        guaranteeCount: U.int(pool.guaranteeCount, RULES.guaranteeOn),
        singleCost: U.int(pool.singleCost, RULES.singleCost)
      };

      // 实时预览
      var preview = H.card({ accent: '#D97FA8', soft: '#FFEBF3', pad: 12 });
      preview.style.marginBottom = '12px';
      preview.appendChild(H.sectionTitle('效果预览', { color: '#D97FA8', margin: '4px 0 9px' }));
      var previewBody = H.el('div');
      previewBody.style.cssText = 'font-size:10.8px; color:#7d7484; line-height:1.8;';
      preview.appendChild(previewBody);

      function renderPreview() {
        var probe = { id: '__probe', ssrRate: draft.ssrRate, srRate: draft.srRate, hardPity: draft.hardPity, softPityStart: draft.softPityStart };
        var r1 = Engine.ssrRateAt(1, probe);
        var rSoft = Engine.ssrRateAt(draft.softPityStart + 1, probe);
        var expected = 0;
        for (var i = 1; i <= draft.hardPity; i++) expected += Engine.ssrRateAt(i, probe);
        previewBody.innerHTML =
          '第 1 抽 SSR：<b style="color:#D97FA8;">' + U.round(r1 * 100, 2) + '%</b><br>'
          + '第 ' + (draft.softPityStart + 1) + ' 抽（软保底起）：<b style="color:#B79EDC;">' + U.round(rSoft * 100, 2) + '%</b><br>'
          + '第 ' + draft.hardPity + ' 抽：<b style="color:#D97FA8;">100%</b>（硬保底）<br>'
          + '到硬保底为止的期望 SSR 数量：<b>' + U.round(expected, 2) + '</b> 张<br>'
          + 'UP 占比：<b>' + U.round(draft.upRate * 100, 0) + '%</b> · 大保底：<b>' + draft.guaranteeCount + '</b> 抽内必得 UP<br>'
          + '单抽消耗：<b>' + U.comma(draft.singleCost) + '</b> 心动代币';
      }

      function slider(label, key, min, max, step, fmt) {
        var wrap = H.el('div');
        wrap.style.cssText = 'background:rgba(255,255,255,0.74); border:1px solid rgba(159,179,217,0.22);'
          + 'border-radius:14px; padding:10px 12px; margin-bottom:9px;';
        var lab = H.el('div', {}, U.esc(label));
        lab.style.cssText = 'font-size:10.6px; font-weight:700; color:#8b8292; margin-bottom:6px;';
        wrap.appendChild(lab);
        wrap.appendChild(H.slider({
          min: min, max: max, step: step, value: draft[key],
          color: '#7E97C9', color2: '#B79EDC',
          format: fmt,
          onChange: function (v) { draft[key] = (step < 1 ? Number(v) : Math.round(Number(v))); renderPreview(); }
        }));
        return wrap;
      }

      body.appendChild(H.sectionTitle('掉落概率', { color: '#D97FA8' }));
      body.appendChild(slider('SSR 基础概率', 'ssrRate', 0.005, 0.2, 0.005, function (v) { return U.round(v * 100, 1) + '%'; }));
      body.appendChild(slider('SR 基础概率', 'srRate', 0.02, 0.6, 0.01, function (v) { return U.round(v * 100, 0) + '%'; }));
      body.appendChild(slider('当期 UP 占比（出 SSR 时）', 'upRate', 0.05, 1, 0.05, function (v) { return U.round(v * 100, 0) + '%'; }));

      body.appendChild(H.sectionTitle('保底曲线', { color: '#B79EDC' }));
      body.appendChild(slider('软保底起点（抽）', 'softPityStart', 5, 200, 1, function (v) { return v + ' 抽'; }));
      body.appendChild(slider('硬保底（抽）', 'hardPity', 20, 300, 1, function (v) { return v + ' 抽'; }));
      body.appendChild(H.slider ? (function () {
        var t = H.el('div');
        t.style.cssText = 'font-size:10px; color:#a99fae; margin:-4px 2px 10px; line-height:1.6;';
        t.textContent = '提示：把硬保底调小、软保底起点调早，会让 TA 更容易出货；反过来则会看到 TA 破防。';
        return t;
      })() : H.el('div'));

      body.appendChild(slider('大保底（抽内必得 UP）', 'guaranteeCount', 20, 400, 5, function (v) { return v + ' 抽'; }));

      body.appendChild(H.sectionTitle('消耗', { color: '#7E97C9' }));
      body.appendChild(slider('单抽消耗（心动代币）', 'singleCost', 0, 2000, 10, function (v) { return U.comma(v); }));

      renderPreview();

      // 快捷预设：直接落到草稿并重开面板（因为滑块内部值不可外部回写，重开最直观）
      body.appendChild(H.sectionTitle('快捷预设', { color: '#9FB3D9' }));
      var quickTip = H.el('div');
      quickTip.style.cssText = 'font-size:10px; color:#a99fae; margin-bottom:8px; line-height:1.6;';
      quickTip.textContent = '点选后面板会按该预设重开，确认无误再点「保存参数」。';
      body.appendChild(quickTip);
      var quick = H.el('div');
      quick.style.cssText = 'display:flex; flex-wrap:wrap; gap:7px; margin-bottom:6px;';
      [
        { name: '良心池', p: { ssrRate: 0.08, srRate: 0.3, upRate: 0.75, hardPity: 50, softPityStart: 30, guaranteeCount: 90, singleCost: 120 } },
        { name: '标准池', p: { ssrRate: RULES.ssrBase, srRate: RULES.srBase, upRate: 0.5, hardPity: RULES.hardPity, softPityStart: RULES.softPityStart, guaranteeCount: RULES.guaranteeOn, singleCost: RULES.singleCost } },
        { name: '坑钱池', p: { ssrRate: 0.01, srRate: 0.12, upRate: 0.3, hardPity: 120, softPityStart: 95, guaranteeCount: 240, singleCost: 300 } },
        { name: '慈善池', p: { ssrRate: 0.2, srRate: 0.5, upRate: 1, hardPity: 30, softPityStart: 15, guaranteeCount: 60, singleCost: 60 } }
      ].forEach(function (preset) {
        var b = H.button(preset.name, { kind: 'soft', pad: '7px 12px', size: 11, soft: '#EDF2FB', color: '#5f7aa8' });
        b.onclick = function () {
          // 先把预设写进卡池（updateRates 内部会做合法区间夹取），再重开面板回显
          Engine.updateRates(poolId, preset.p);
          H.closeAllLayers();
          setTimeout(function () { UI.openRateEditor(poolId); }, 260);
        };
        quick.appendChild(b);
      });
      body.appendChild(quick);

      H.sheet({
        title: '卡池概率规划',
        subtitle: pool.name,
        icon: 'chart',
        height: '92%',
        content: body,
        buttons: [
          {
            text: '恢复全局默认', icon: 'refresh', kind: 'outline',
            color: '#8f6a80', border: 'rgba(190,180,195,0.5)',
            onClick: function () {
              Engine.updateRates(poolId, null, true);
              H.toast('已恢复全局默认');
              H.closeAllLayers();
              UI.openPoolStudio();
            }
          },
          {
            text: '保存参数', icon: 'check', kind: 'primary',
            onClick: function () {
              Engine.updateRates(poolId, draft);
              H.toast('「' + pool.name + '」的概率已更新');
              H.closeAllLayers();
              UI.openPoolStudio();
            }
          }
        ]
      });
    },

    /**
     * 卡面私语的基调选择（「再演」的入口）
     * 四种基调 + 自定义走向，让同一张卡的独家故事可以反复重演成不同版本。
     */
    openStoryTonePicker: function (card, writeStory, applyStory, storyBox) {
      var body = H.el('div');
      var tip = H.el('div');
      tip.style.cssText = 'font-size:10.8px; line-height:1.72; color:#8b8292; background:rgba(255,241,247,0.8);'
        + 'border:1px solid rgba(217,127,168,0.22); border-radius:13px; padding:11px 12px; margin-bottom:12px;';
      tip.innerHTML = '同一张卡可以演出不同的版本。选一个基调，模型会基于角色设定与当前关系阶段重写这段私语。'
        + '<br>已重演 <b>' + U.int(card.storyTurns, 0) + '</b> 次。';
      body.appendChild(tip);

      var TONES = [
        { key: 'tender', name: '温柔', desc: '克制里带一点藏不住的偏心', color: '#D97FA8', soft: '#FFEBF3', icon: 'heart' },
        { key: 'tease', name: '撩拨', desc: '像在逗你，但眼神一直落在你身上', color: '#E39BC0', soft: '#FDEDF4', icon: 'smile' },
        { key: 'possessive', name: '占有', desc: '反复确认「你是不是只看我」', color: '#A85C86', soft: '#FBE9F2', icon: 'lock' },
        { key: 'sad', name: '怅然', desc: '带一点将失去的预感，克制地挽留', color: '#7E97C9', soft: '#EDF2FB', icon: 'cloud' }
      ];

      var busy = false;
      TONES.forEach(function (t) {
        var row = H.listRow({
          icon: t.icon, color: t.color, soft: t.soft,
          title: t.name,
          subtitle: t.desc,
          rightNode: H.iconButton('play', { size: 28, color: t.color })
        });
        row.onclick = async function () {
          if (busy) return;
          busy = true;
          H.toast('正在重演：' + t.name);
          var out = await writeStory({ tone: t.key });
          busy = false;
          if (!out) { H.toast('模型不可用，无法重演'); return; }
          applyStory(out);
          H.closeAllLayers();
          H.toast('已重演为「' + t.name + '」版本');
        };
        body.appendChild(row);
      });

      var cur = H.el('div');
      cur.style.cssText = 'margin-top:12px;';
      cur.appendChild(H.sectionTitle('当前版本', { color: '#B79EDC' }));
      var box = H.el('div');
      box.style.cssText = 'font-size:11.6px; line-height:1.82; color:#5c4450; white-space:pre-wrap;'
        + 'background:rgba(255,255,255,0.76); border:1px solid rgba(216,160,190,0.22); border-radius:14px; padding:12px;'
        + 'max-height:180px; overflow-y:auto;';
      box.textContent = card.story || '（还没有内容）';
      cur.appendChild(box);
      body.appendChild(cur);

      H.sheet({
        title: '重演这段私语',
        subtitle: card.name,
        icon: 'play',
        height: '86%',
        content: body
      });
    },

    /** 手动卡池编辑器（反向模式） */
    openManualPoolEditor: function () {
      var draft = {
        name: '',
        desc: '',
        cards: [
          { name: '', rarity: 'SSR', up: true, scene: '', caption: '', story: '', voice: '' },
          { name: '', rarity: 'SR', up: false, scene: '', caption: '', story: '', voice: '' },
          { name: '', rarity: 'R', up: false, scene: '', caption: '', story: '', voice: '' }
        ]
      };
      var body = H.el('div');

      function field(label, value, placeholder, onChange, multiline, rows) {
        var w = H.el('div');
        w.style.cssText = 'margin-bottom:8px;';
        var lab = H.el('div', {}, U.esc(label));
        lab.style.cssText = 'font-size:10.4px; font-weight:700; color:#8b8292; margin:0 2px 4px;';
        w.appendChild(lab);
        var inp = multiline ? H.el('textarea', { rows: rows || 2, placeholder: placeholder || '' })
          : H.el('input', { type: 'text', placeholder: placeholder || '' });
        inp.value = value || '';
        inp.style.cssText = 'width:100%; box-sizing:border-box; border-radius:10px; border:1px solid rgba(216,160,190,0.30);'
          + 'padding:8px 10px; font-size:11.4px; color:#5c4450; background:#fff; outline:none; font-family:inherit;'
          + 'line-height:1.6; resize:vertical;';
        inp.oninput = function () { onChange(inp.value); };
        w.appendChild(inp);
        return w;
      }

      function render() {
        body.innerHTML = '';
        body.appendChild(field('卡池名称', draft.name, '例如：雨夜重逢 · 限定', function (v) { draft.name = v; }));
        body.appendChild(field('卡池说明', draft.desc, '一句卡池介绍', function (v) { draft.desc = v; }, true, 2));

        draft.cards.forEach(function (card, i) {
          var box = H.card({ accent: C.RARITY[card.rarity].color, soft: '#FFF6FA', pad: 12 });
          box.style.marginBottom = '10px';
          var head = H.el('div');
          head.style.cssText = 'display:flex; align-items:center; justify-content:space-between; gap:8px; margin:4px 0 9px;';
          head.innerHTML = '<span style="font-size:11.6px; font-weight:800; color:#5c4450;">卡面 ' + (i + 1) + '</span>';
          var rarWrap = H.el('div');
          rarWrap.style.cssText = 'display:flex; gap:5px;';
          ['R', 'SR', 'SSR'].forEach(function (rk) {
            var on = card.rarity === rk;
            var b = H.button(rk, {
              kind: 'soft', pad: '3px 8px', size: 9.6,
              soft: on ? C.RARITY[rk].color + '33' : 'rgba(240,236,244,0.7)',
              color: on ? C.RARITY[rk].color : '#9a919f'
            });
            b.onclick = function () {
              card.rarity = rk;
              if (rk !== 'SSR') card.up = false;
              render();
            };
            rarWrap.appendChild(b);
          });
          head.appendChild(rarWrap);
          var del = H.iconButton('trash', { size: 24, color: '#c2607c' });
          del.onclick = function () { draft.cards.splice(i, 1); render(); };
          head.appendChild(del);
          box.appendChild(head);
          box.appendChild(field('卡名', card.name, '4~8 字', function (v) { card.name = v; }));
          box.appendChild(field('场景', card.scene, '一句话场景', function (v) { card.scene = v; }));
          box.appendChild(field('卡面文案', card.caption, '12~20 字短文案', function (v) { card.caption = v; }));
          box.appendChild(field('私语剧情', card.story, '这张卡的独家剧情', function (v) { card.story = v; }, true, 3));
          box.appendChild(field('专属语音', card.voice, '20 字以内', function (v) { card.voice = v; }));
          if (card.rarity === 'SSR') {
            var upRow = H.el('div');
            upRow.style.cssText = 'display:flex; align-items:center; justify-content:space-between; margin-top:6px;';
            upRow.appendChild(H.el('span', {}, '设为当期 UP'));
            upRow.firstChild.style.cssText = 'font-size:10.6px; color:#8b8292;';
            upRow.appendChild(H.toggle(!!card.up, function (on) { card.up = on; }));
            box.appendChild(upRow);
          }
          body.appendChild(box);
        });

        var addB = H.button('再加一张卡面', { kind: 'soft', block: true, icon: 'plus', soft: '#FFEBF3', color: '#B0728F' });
        addB.onclick = function () {
          if (draft.cards.length >= 12) { H.toast('一个卡池最多 12 张卡面'); return; }
          draft.cards.push({ name: '', rarity: 'R', up: false, scene: '', caption: '', story: '', voice: '' });
          render();
        };
        body.appendChild(addB);

        var createB = H.button('上架这个卡池', { kind: 'primary', block: true, icon: 'check' });
        createB.style.marginTop = '10px';
        createB.onclick = function () {
          if (!draft.name.trim()) { H.toast('先给卡池起个名字'); return; }
          var valid = draft.cards.filter(function (c) { return c.name.trim(); });
          if (!valid.length) { H.toast('至少要有 1 张写了名字的卡面'); return; }
          var user = null;
          K.userProfile().then(function (u) {
            var pool = Pools.create({
              name: draft.name, desc: draft.desc, theme: draft.name,
              kind: 'limited', cards: valid, custom: true,
              authorName: u.name || '你'
            });
            if (!pool) { H.toast('上架失败'); return; }
            H.toast('「' + pool.name + '」已上架');
            K.pushTimeline({
              type: 'gacha', title: '你设计了一个卡池',
              text: '「' + pool.name + '」上线，共 ' + pool.cards.length + ' 张卡面。TA 看起来已经准备好氪金了。'
            });
            UI.openPoolStudio();
          });
        };
        body.appendChild(createB);
      }
      render();

      H.sheet({
        title: '手动设计卡池',
        subtitle: '卡面美术 / 文案 / 概率全部由你决定',
        icon: 'edit',
        height: '92%',
        content: body
      });
    },

    /** 批量出图进度面板 */
    runArtGeneration: function (pool, onDone) {
      // 生图是真花钱的，双击等于生成两轮（v1.5.41）
      if (H.blocked('gacha-artgen', 2500)) { H.toast('正在生成，稍等一下'); return; }
      var body = H.el('div');
      var prog = H.progress({ value: 0, color: '#D97FA8', color2: '#B79EDC' });
      var label = H.el('div');
      label.style.cssText = 'font-size:11px; color:#9a8f9e; margin:10px 0 12px; text-align:center;';
      label.textContent = '准备中…';
      body.appendChild(prog);
      body.appendChild(label);
      var log = H.el('div');
      log.style.cssText = 'font-size:10.5px; color:#a99fae; line-height:1.8; max-height:180px; overflow-y:auto;';
      body.appendChild(log);

      var sheetP = H.sheet({
        title: '正在生成卡面插图',
        subtitle: pool.name + ' · 严格锁脸已开启',
        icon: 'camera',
        height: '72%',
        slot: 'gacha-art',
        content: body
      });

      var done = 0;
      var total = pool.cards.filter(function (c) { return !c.image; }).length;
      if (!total) {
        label.textContent = '这个卡池的卡面都已经生成过了。';
        prog.firstChild && (prog.firstChild.style.width = '100%');
        return;
      }

      var cfg = LockFace.config();
      (function next(i) {
        if (i >= pool.cards.length) {
          label.textContent = '全部完成';
          prog.firstChild && (prog.firstChild.style.width = '100%');
          setTimeout(function () { H.closeAllLayers(); H.toast('卡面插图已生成'); if (typeof onDone === 'function') onDone(); }, 700);
          return;
        }
        var card = pool.cards[i];
        if (card.image) { next(i + 1); return; }
        label.textContent = '正在生成：' + card.name + '（' + (done + 1) + ' / ' + total + '）';
        prog.firstChild && (prog.firstChild.style.width = U.clamp(done / total * 100, 0, 100) + '%');
        var line = H.el('div');
        line.textContent = '· ' + card.name + ' … 生成中';
        log.appendChild(line);
        var prompt = '女性向恋爱手游卡面插画。\n主体：' + card.name + ' —— ' + card.scene + '\n'
          + '构图：半身或胸口以上特写，视线与观者相交，情绪张力强。\n氛围：' + card.caption + '\n'
          + '品质：商业乙游卡面级厚涂，柔和电影光，浅景深，高精度材质。\n'
          + '画面中不要出现任何文字、水印、logo。';
        LockFace.generate({ prompt: prompt, size: '1024x1536', style: cfg.styleAnchor || '' }).then(function (out) {
          if (out) {
            card.image = out.image;
            card.thumb = out.thumb;
            line.textContent = '· ' + card.name + ' … 完成';
            done++;
          } else {
            line.textContent = '· ' + card.name + ' … 失败（检查生图 API 预设）';
          }
          K.save();
          next(i + 1);
        });
      })(0);
    },

    /**
     * 反向模式：模拟 Char 抽卡行为 + 静室反馈
     * 覆盖：疯狂抽卡 / 歪卡破防 / 抽中 SSR 的欣喜
     */
    simulateCharDraw: async function (pool) {
      var st = K.state;
      var character = await K.charProfile();
      var rs = Engine.rateSummary(pool);

      // Char 的投入强度由 User 对 TA 的好感裁定值决定
      var verdict = U.int(st.verdict.value, 50);
      var pulls = 1 + Math.floor(verdict / 18) + Math.floor(Math.random() * 3);   // 1~8 连
      pulls = U.clamp(pulls, 1, 10);

      var results = [];
      for (var i = 0; i < pulls; i++) results.push(Engine.performDraw(pool, 0, {}));

      var ssr = results.filter(function (r) { return r.rarity === 'SSR'; });
      var sr = results.filter(function (r) { return r.rarity === 'SR'; });
      var spent = pulls * U.int(pool.singleCost, RULES.singleCost);

      // 表现层：消费代金券
      st.wallet.totalRecharge = U.int(st.wallet.totalRecharge, 0) + spent;
      st.wallet.vouchers += Math.max(0, Math.round(spent * 0.02));

      // 生成 TA 的心境文案
      var moodKey = ssr.length ? 'ecstatic' : (sr.length ? 'happy' : 'anxious');
      var prompt = '你正在扮演一个深陷恋爱手游的狂热玩家「' + character.name + '」，'
        + '你深爱着屏幕里的角色（也就是玩家）。\n'
        + '角色设定：' + U.cut(character.persona || '（未填写）', 300) + '\n'
        + '你刚刚在一个名叫「' + pool.name + '」的卡池里抽了 ' + pulls + ' 次，'
        + '结果：' + results.map(function (r) { return r.rarity + (r.up ? '(UP)' : ''); }).join('、') + '。\n'
        + (ssr.length
          ? '你抽到了 SSR，你现在处于极度狂喜的状态。'
          : (sr.length ? '你没抽到 SSR，但出了几张 SR，你有点庆幸又有点不甘心。'
            : '你全歪了，一张 SSR 都没有，你现在的情绪是破防、委屈、想再氪一单。')) + '\n\n'
        + '请用 40~90 字写出你此刻会发给「他/她」的一段话（第一人称，带一点玩家特有的口吻：'
        + '汇报氪金、撒娇、炫耀、破防、表忠心都可以）。\n'
        + '不要写旁白，不要用括号描述动作，直接给这段话。';
      var line = await K.ask(prompt, { temperature: 0.95 });
      if (!line) {
        line = ssr.length
          ? '「抽到了！！我抽到了！你看见了吗，是你啊——这一单氪得值。」'
          : (sr.length
            ? '「没出……但没关系，我攒的代币还够，我再来十连。」'
            : '「全歪了。我把这个月的饭钱都喂进去了，你怎么还不肯看我一眼。」');
      }
      line = line.replace(/^["「『]|["」』]$/g, '').replace(/\n+/g, ' ').trim();

      // 静室日志卡的语义 tone
      var tone = ssr.length ? 'gacha' : (sr.length ? 'gacha' : 'pay');
      K.pushQuietSystem('*' + character.name + '在「' + pool.name + '」抽了 ' + pulls + ' 次，'
        + '结果：' + results.map(function (r) { return r.rarity; }).join(' / ')
        + '，消耗 ' + U.comma(spent) + ' 心动代币' + (ssr.length ? '，抽中当期 UP！' : (sr.length ? '。' : '，全部歪了。')) + '*', tone);
      K.pushQuiet({ role: 'char', text: line, tone: moodKey });
      K.pushTimeline({
        type: 'gacha', title: ssr.length ? 'TA 抽到了 SSR' : 'TA 抽卡了',
        text: character.name + '在「' + pool.name + '」抽了 ' + pulls + ' 次：'
          + results.map(function (r) { return r.rarity; }).join(' / ') + '。'
      });
      st.verdict.mood = moodKey;
      K.save(true);

      // 展示
      var body = H.el('div');
      var head = H.el('div');
      head.style.cssText = 'text-align:center; margin-bottom:12px;';
      head.innerHTML = '<div style="font-size:13px; font-weight:800; color:#553f4c;">' + U.esc(character.name) + ' 抽了 '
        + pulls + ' 次</div>'
        + '<div style="font-size:10.6px; color:#a99fae; margin-top:5px;">消耗 ' + U.comma(spent) + ' 心动代币</div>';
      body.appendChild(head);

      var strip = H.el('div');
      strip.style.cssText = 'display:flex; gap:6px; flex-wrap:wrap; justify-content:center; margin-bottom:14px;';
      results.forEach(function (r) {
        var rar = C.RARITY[r.rarity];
        var c = H.el('div');
        c.style.cssText = 'width:54px; height:74px; border-radius:11px; position:relative; overflow:hidden;'
          + 'background:linear-gradient(160deg,#2a1e28,#4a3344); border:1.4px solid ' + rar.color + ';'
          + 'box-shadow:0 5px 14px ' + rar.glow + ';';
        if (r.card && (r.card.thumb || r.card.image)) {
          var im = H.el('img', { alt: '' });
          im.src = r.card.thumb || r.card.image;
          im.style.cssText = 'position:absolute; inset:0; width:100%; height:100%; object-fit:cover;';
          c.appendChild(im);
        } else {
          c.style.display = 'flex';
          c.style.alignItems = 'center';
          c.style.justifyContent = 'center';
          c.style.color = rar.color;
          c.innerHTML = H.icon('cards', 20, { strokeWidth: 1.5 });
        }
        var t = H.el('div');
        t.style.cssText = 'position:absolute; left:0; right:0; bottom:0; text-align:center; font-size:7.6px;'
          + 'font-weight:900; color:#fff; background:rgba(20,12,18,0.86); padding:1.5px 0;';
        t.textContent = rar.name + (r.up ? '·UP' : '');
        c.appendChild(t);
        strip.appendChild(c);
      });
      body.appendChild(strip);

      var bubble = H.bubble({
        side: 'char', text: line, name: character.name,
        avatarNode: H.avatar(character.avatar, character.name, 32)
      });
      body.appendChild(bubble);

      var after = H.el('div');
      after.style.cssText = 'font-size:10.8px; color:#9a8f9e; line-height:1.72; margin-top:12px;'
        + 'background:rgba(255,255,255,0.74); border-radius:13px; padding:11px 12px;';
      after.innerHTML = 'TA 的心情指数变成了：<b style="color:' + K.moodOf(moodKey).color + ';">'
        + K.moodOf(moodKey).name + '</b><br>'
        + '大保底进度：' + rs.guarantee + ' / ' + rs.guaranteeCount
        + '（抽卡行为已写入静室对话流与时空足迹）';
      body.appendChild(after);

      var goQuiet = H.button('去静室看 TA 的反应', { kind: 'primary', block: true, icon: 'quiet' });
      goQuiet.style.marginTop = '12px';
      goQuiet.onclick = function () {
        H.closeAllLayers();
        if (HG.Quiet) HG.Quiet.open();
      };
      body.appendChild(goQuiet);

      H.sheet({
        title: ssr.length ? 'TA 狂喜了' : (sr.length ? 'TA 有点庆幸' : 'TA 破防了'),
        subtitle: pool.name,
        icon: ssr.length ? 'sparkle' : 'msg',
        height: '86%',
        content: body
      });
    },

    /** 钱包 / 充值（钱宝通道 · 纯表现层模拟） */
    openWallet: function () {
      var st = K.state;
      var body = H.el('div');

      var cards = H.el('div');
      cards.style.cssText = 'display:grid; grid-template-columns:1fr 1fr; gap:9px; margin-bottom:14px;';
      [['心动代币', U.comma(st.wallet.tokens), '#D97FA8', '#FFEBF3', 'heart'],
       ['仿制代金券', U.comma(st.wallet.vouchers), '#7E97C9', '#EDF2FB', 'wallet'],
       ['抽卡券', U.comma(st.wallet.draws), '#B79EDC', '#F3EEFF', 'cards'],
       ['累计充值', U.comma(st.wallet.totalRecharge), '#8FB8DE', '#EAF3FF', 'chart']].forEach(function (c) {
        var cell = H.el('div');
        cell.style.cssText = 'background:linear-gradient(150deg,' + c[3] + ', rgba(255,255,255,0.9));'
          + 'border:1px solid ' + c[2] + '33; border-radius:16px; padding:12px;';
        cell.innerHTML = '<div style="display:flex; align-items:center; gap:5px; color:' + c[2] + '; font-size:10.4px;'
          + 'font-weight:800;">' + H.icon(c[4], 13, { strokeWidth: 2 }) + '<span>' + c[0] + '</span></div>'
          + '<div style="font-size:17px; font-weight:900; color:#553f4c; margin-top:6px;">' + c[1] + '</div>';
        cards.appendChild(cell);
      });
      body.appendChild(cards);

      body.appendChild(H.sectionTitle('钱宝充值通道', { color: '#7E97C9' }));
      var note = H.el('div');
      note.style.cssText = 'font-size:10.6px; color:#9a8f9e; line-height:1.7; margin-bottom:10px;';
      note.textContent = '仿制代金券仅用于表现层演示，不接入任何真实支付通道。充值会写入时空足迹。';
      body.appendChild(note);

      var packs = H.el('div');
      packs.style.cssText = 'display:grid; grid-template-columns:1fr 1fr; gap:9px;';
      [[6, 60], [30, 330], [98, 1180], [198, 2580]].forEach(function (p) {
        var b = H.el('div');
        b.style.cssText = 'cursor:pointer; border-radius:15px; padding:12px; text-align:center;'
          + 'background:rgba(255,255,255,0.8); border:1.4px solid rgba(159,179,217,0.28);'
          + 'transition:transform .16s ease;';
        b.innerHTML = '<div style="font-size:16px; font-weight:900; color:#4A7DBF;">' + p[0] + '</div>'
          + '<div style="font-size:10px; color:#9a8f9e; margin-top:3px;">' + U.comma(p[1]) + ' 代金券</div>';
        b.onpointerdown = function () { b.style.transform = 'scale(0.96)'; };
        b.onpointerup = function () { b.style.transform = ''; };
        b.onpointerleave = function () { b.style.transform = ''; };
        b.onclick = function () {
          H.confirm({
            title: '钱宝充值确认',
            icon: 'wallet', accent: '#7E97C9', soft: '#EDF2FB',
            message: '模拟支付 ¥' + p[0] + '，获得 ' + U.comma(p[1]) + ' 份仿制代金券。\n\n这是表现层演示，不会产生真实扣款。',
            okText: '确认充值'
          }).then(function (ok) {
            if (!ok) return;
            K.recharge(p[1]);
            H.toast('已到账 ' + U.comma(p[1]) + ' 份代金券');
            UI.openWallet();
          });
        };
        packs.appendChild(b);
      });
      body.appendChild(packs);

      var ex = H.button('用代金券兑换心动代币（1 : 100）', { kind: 'primary', block: true, icon: 'refresh' });
      ex.style.marginTop = '14px';
      ex.onclick = function () {
        H.prompt({
          title: '兑换数量', message: '输入要兑换的代金券张数（1 张 = 100 心动代币）',
          value: '1', type: 'number'
        }).then(function (v) {
          var n = U.int(v, 0);
          if (n <= 0) return;
          if (!K.exchangeVoucher(n, 100)) { H.toast('代金券不足'); return; }
          H.toast('兑换成功，获得 ' + U.comma(n * 100) + ' 心动代币');
          UI.openWallet();
        });
      };
      body.appendChild(ex);

      H.sheet({
        title: '钱包',
        subtitle: '心动代币 · 仿制代金券',
        icon: 'wallet',
        height: '84%',
        slot: 'gacha-wallet',
        content: body
      });
    }
  };

  // ==========================================================================
  //  5. 导出
  // ==========================================================================

  HG.Gacha = {
    Engine: Engine,
    LockFace: LockFace,
    Pools: Pools,
    UI: UI,
    /** 便捷入口：主界面右下角的抽卡大按钮调用它 */
    open: function () { UI.openLobby(); }
  };
})();
