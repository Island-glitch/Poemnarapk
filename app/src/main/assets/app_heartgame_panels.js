/**
 * app_heartgame_panels.js - 心动游戏 · 四大业务面板 (P)
 * ============================================================================
 * 覆盖：
 *   1. 每日 / 周常任务：阶梯宝箱进度条（20/50/75/100 阶段奖励）
 *      + 基础任务（签到 / 在线挂机时长 / 送礼 / 剧情推进）
 *      + 动态衍生任务（攻略模式：Char 抛出专属委托；反向模式：User 发布任务台）
 *   2. 商业与养成商店：双轨货币（心动代币 + 仿制代金券）
 *      · 攻略模式：分类展示服饰 / 饰品 / 消耗品，购买后赠送给 Char
 *      · 反向模式：私享杂货商，User 上架自制道具 / 手写信物 / 亲密特权，等 Char 自动采购
 *   3. 阶梯式牵绊系统：六阶好感（相识→终局契约）+ 晋阶任务 + 特权解锁
 *      + 时空足迹（自动时间轴）+ 重要记忆回廊（卡片式回忆）
 *
 * 依赖：window.HeartGame.K / .H / .U / .C（app_heartgame_core.js）
 */
(function () {
  'use strict';

  var HG = window.HeartGame;
  if (!HG) { console.warn('[心动游戏] core 未加载，业务面板已跳过'); return; }
  var K = HG.K, H = HG.H, U = HG.U, C = HG.C;

  // ==========================================================================
  //  1. 阶梯宝箱进度条（常驻）
  // ==========================================================================

  var Chest = {
    /** 建成一条带 20/50/75/100 节点的阶梯宝箱进度条 */
    build: function (onChanged) {
      var wrap = H.el('div', { class: 'hg-chest' });
      wrap.style.cssText = 'border-radius:18px; padding:12px 13px 11px; box-sizing:border-box;'
        + 'background:linear-gradient(150deg, rgba(255,255,255,0.90), rgba(255,246,250,0.78));'
        + 'border:1px solid rgba(216,160,190,0.26); box-shadow:0 8px 22px rgba(150,120,150,0.10);';

      var pct = K.questCompletion();
      var head = H.el('div');
      head.style.cssText = 'display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:9px;';
      var left = H.el('div');
      left.style.cssText = 'display:flex; align-items:center; gap:6px; min-width:0;';
      left.innerHTML = '<span style="width:22px; height:22px; border-radius:9px; display:inline-flex; align-items:center;'
        + 'justify-content:center; background:#FFEBF3; color:#D97FA8;">' + H.icon('gift', 13, { strokeWidth: 2 }) + '</span>'
        + '<span style="font-size:12.2px; font-weight:800; color:#5c4450;">阶梯宝箱</span>';
      head.appendChild(left);
      var right = H.el('div');
      right.style.cssText = 'font-size:11px; font-weight:900; color:#D97FA8;';
      right.textContent = U.round(pct, 0) + '%';
      head.appendChild(right);
      wrap.appendChild(head);

      var bar = H.progress({
        value: pct, height: 10, color: '#D97FA8', color2: '#B79EDC',
        nodes: C.CHEST_NODES.map(function (n) { return { pct: n.pct }; })
      });
      wrap.appendChild(bar);

      // 节点标签与领取
      var row = H.el('div');
      row.style.cssText = 'display:flex; gap:5px; margin-top:9px;';
      var ready = K.chestReady();
      C.CHEST_NODES.forEach(function (n) {
        var reached = pct >= n.pct;
        var claimed = !!(K.state.quests.chest.claimed[n.pct + '_' + K.state.quests.chest.cycle]);
        var canGet = ready.some(function (r) { return r.pct === n.pct; });
        var cell = H.el('div');
        cell.style.cssText = 'flex:1; text-align:center; border-radius:11px; padding:7px 3px; cursor:'
          + (canGet ? 'pointer' : 'default') + '; transition:all .22s ease;'
          + (canGet
            ? 'background:linear-gradient(150deg,#FFEBF3,#F3EEFF); border:1.4px solid rgba(217,127,168,0.55);'
              + 'box-shadow:0 6px 16px rgba(217,127,168,0.22);'
            : (reached && claimed
              ? 'background:rgba(240,236,244,0.6); border:1px solid rgba(190,180,195,0.2); opacity:.7;'
              : 'background:rgba(255,255,255,0.6); border:1px solid rgba(190,180,195,0.2);'));
        cell.innerHTML = '<div style="font-size:10px; font-weight:900; color:'
          + (canGet ? '#D97FA8' : (reached ? '#a99fae' : '#c3b6c6')) + ';">' + n.pct + '%</div>'
          + '<div style="font-size:8.6px; color:#a99fae; margin-top:2px; line-height:1.4;">'
          + (claimed ? '已领取' : (canGet ? '可领取' : U.cut(n.label, 8))) + '</div>';
        if (canGet) {
          cell.onclick = function () {
            if (!K.claimChest(n.pct)) { H.toast('领取失败'); return; }
            H.toast('已领取：' + n.label);
            H.floatText(n.label, { host: wrap, x: '50%', y: '30%', color: '#D97FA8' });
            if (typeof onChanged === 'function') onChanged();
          };
        }
        row.appendChild(cell);
      });
      wrap.appendChild(row);

      if (ready.length) {
        var hint = H.el('div');
        hint.style.cssText = 'font-size:10.2px; color:#D97FA8; text-align:center; margin-top:8px; font-weight:700;';
        hint.textContent = '有 ' + ready.length + ' 个阶段奖励可以领取';
        wrap.appendChild(hint);
      }
      return wrap;
    }
  };

  // ==========================================================================
  //  2. 任务面板
  // ==========================================================================

  var Tasks = {

    /**
     * 入口。
     * v1.5.35：优先走页面化路由（装配层注册后，「每日任务」是 #heartgame-mount 内的
     * 独立页面而不是底部抽屉）——点入口就是换页，天然不会叠层。
     * 没有页面宿主时回落到抽屉，保证单测/降级路径依然可用。
     */
    open: function () {
      if (H.present('tasks')) return;
      H.sheet(Tasks.build());
    },

    /** 面板内容（独立页面与抽屉共用同一份配置，避免两套 UI 走样） */
    build: function () {
      var st = K.state;
      K.rollQuests();
      var body = H.el('div');
      var reverse = K.isReverse();

      // 宝箱
      body.appendChild(H.sectionTitle('阶段奖励', { color: '#D97FA8' }));
      body.appendChild(Chest.build(function () { H.closeAllLayers(); Tasks.open(); }));

      // 基础任务
      body.appendChild(H.sectionTitle('每日 / 周常', { color: '#7E97C9' }));
      var scopes = [
        { key: 'daily', name: '今日' },
        { key: 'weekly', name: '本周' }
      ];
      scopes.forEach(function (sc) {
        var list = C.BASE_QUESTS.filter(function (q) { return q.scope === sc.key; });
        var sub = H.el('div');
        sub.appendChild(H.sectionTitle(sc.name, { color: '#9FB3D9', margin: '8px 0 7px' }));
        list.forEach(function (q) {
          var rec = st.quests.base[q.key] || { progress: 0, done: false, claimed: false };
          var pct = U.clamp(U.int(rec.progress, 0) / (U.int(q.target, 1) || 1) * 100, 0, 100);
          var cell = H.el('div');
          cell.style.cssText = 'border-radius:15px; padding:11px 12px; margin-bottom:8px;'
            + 'background:' + (rec.claimed ? 'rgba(240,236,244,0.55)' : 'rgba(255,255,255,0.76)') + ';'
            + 'border:1px solid ' + (rec.done && !rec.claimed ? 'rgba(217,127,168,0.45)' : 'rgba(190,180,195,0.2)') + ';';
          var top = H.el('div');
          top.style.cssText = 'display:flex; align-items:center; justify-content:space-between; gap:8px;';
          top.innerHTML = '<div style="min-width:0;"><div style="font-size:12.2px; font-weight:800; color:#5c4450;">'
            + U.esc(q.name) + '</div>'
            + '<div style="font-size:10px; color:#a99fae; margin-top:2px;">' + U.esc(q.desc) + '</div></div>';
          var act = H.el('div');
          act.style.cssText = 'flex-shrink:0;';
          if (rec.claimed) {
            act.appendChild(H.chip('已领取', { color: '#a99fae', soft: 'rgba(240,236,244,0.9)' }));
          } else if (rec.done) {
            var claimB = H.button('领取 +' + q.reward, { kind: 'primary', pad: '5px 10px', size: 10.4 });
            claimB.onclick = function () {
              if (!K.claimQuest(q.key)) { H.toast('领取失败'); return; }
              H.toast('已领取 ' + q.reward + ' 心动代币');
              H.closeAllLayers();
              Tasks.open();
            };
            act.appendChild(claimB);
          } else {
            act.appendChild(H.chip(U.int(rec.progress, 0) + '/' + q.target, { color: '#7E97C9', soft: '#EDF2FB' }));
          }
          top.appendChild(act);
          cell.appendChild(top);
          var pb = H.progress({
            value: pct, height: 6,
            color: rec.done ? '#D97FA8' : '#7E97C9', color2: '#B79EDC'
          });
          pb.style.marginTop = '9px';
          cell.appendChild(pb);
          sub.appendChild(cell);
        });
        body.appendChild(sub);
      });

      // 动态衍生任务
      if (reverse) {
        body.appendChild(Tasks.buildReverseBoard());
      } else {
        body.appendChild(Tasks.buildDynamicList());
      }

      return {
        title: '任务',
        subtitle: reverse ? '你会收到 TA 的游戏行为汇报' : '完成委托，推进心动',
        icon: 'task',
        height: '92%',
        slot: 'tasks',
        content: body,
        buttons: [{
          text: reverse ? '发布新任务' : '让 TA 派一个委托',
          icon: 'plus', kind: 'primary', keepOpen: true,
          onClick: function (api, node) { reverse ? Tasks.openPublishForm(node) : Tasks.requestDynamic(node); }
        }]
      };
    },

    /** 攻略模式：Char 抛出的专属日常委托 */
    buildDynamicList: function () {
      var st = K.state;
      var wrap = H.el('div');
      wrap.appendChild(H.sectionTitle('TA 的专属委托', { color: '#B79EDC' }));
      if (!st.quests.dynamic.length) {
        wrap.appendChild(H.empty('TA 还没有派委托。点下面的按钮，让 TA 根据当前剧情与好感阶段说一个。', { icon: 'msg' }));
      }
      st.quests.dynamic.forEach(function (q) {
        var pct = U.clamp(U.int(q.progress, 0) / (U.int(q.target, 1) || 1) * 100, 0, 100);
        var cell = H.el('div');
        cell.style.cssText = 'border-radius:15px; padding:11px 12px; margin-bottom:8px;'
          + 'background:linear-gradient(150deg,rgba(255,246,250,0.9),rgba(243,238,255,0.7));'
          + 'border:1px solid rgba(183,158,220,0.28);';
        var top = H.el('div');
        top.style.cssText = 'display:flex; align-items:flex-start; justify-content:space-between; gap:8px;';
        top.innerHTML = '<div style="min-width:0; flex:1;">'
          + '<div style="font-size:12.2px; font-weight:800; color:#5c4450; line-height:1.55;">' + U.esc(q.name) + '</div>'
          + '<div style="font-size:10.2px; color:#8b8292; margin-top:4px; line-height:1.65;">' + U.esc(q.desc) + '</div>'
          + '</div>';
        var acts = H.el('div');
        acts.style.cssText = 'display:flex; flex-direction:column; gap:5px; flex-shrink:0;';
        var stepB = H.button(q.done ? '已完成' : '完成 +1', {
          kind: q.done ? 'soft' : 'primary', pad: '5px 9px', size: 10.2,
          soft: '#F3EEFF', color: '#7d63a8', disabled: q.done
        });
        if (!q.done) {
          stepB.onclick = function () {
            K.progressQuest(q.key, 1);
            H.toast('委托进度 +1');
            H.closeAllLayers();
            Tasks.open();
          };
        }
        acts.appendChild(stepB);
        var del = H.iconButton('trash', { size: 24, color: '#c2607c' });
        del.onclick = function () { K.removeDynamicQuest(q.key, 'char'); H.closeAllLayers(); Tasks.open(); };
        acts.appendChild(del);
        top.appendChild(acts);
        cell.appendChild(top);
        cell.appendChild((function () {
          var pb = H.progress({ value: pct, height: 6, color: '#B79EDC', color2: '#D97FA8' });
          pb.style.marginTop = '9px';
          return pb;
        })());
        wrap.appendChild(cell);
      });
      return wrap;
    },

    /** 反向模式：User 任务发布台 */
    buildReverseBoard: function () {
      var st = K.state;
      var wrap = H.el('div');
      wrap.appendChild(H.sectionTitle('任务发布台', { color: '#D97FA8' }));
      var tip = H.el('div');
      tip.style.cssText = 'font-size:10.4px; color:#9a8f9e; line-height:1.7; margin-bottom:9px;';
      tip.textContent = '你发布任务，TA 会去「完成」，并在静室里向你汇报。结算时你可以给予 TA 虚拟奖励。';
      wrap.appendChild(tip);

      if (!st.quests.reverse.length) {
        wrap.appendChild(H.empty('还没有发布任何任务。', { icon: 'target' }));
      }
      st.quests.reverse.forEach(function (q) {
        var cell = H.el('div');
        cell.style.cssText = 'border-radius:15px; padding:11px 12px; margin-bottom:8px;'
          + 'background:' + (q.done ? 'rgba(240,236,244,0.6)' : 'rgba(255,255,255,0.78)') + ';'
          + 'border:1px solid ' + (q.done ? 'rgba(190,180,195,0.2)' : 'rgba(217,127,168,0.3)') + ';';
        var top = H.el('div');
        top.style.cssText = 'display:flex; align-items:flex-start; justify-content:space-between; gap:8px;';
        top.innerHTML = '<div style="min-width:0; flex:1;">'
          + '<div style="font-size:12.2px; font-weight:800; color:#5c4450;">' + U.esc(q.name) + '</div>'
          + '<div style="font-size:10.2px; color:#8b8292; margin-top:4px; line-height:1.65;">' + U.esc(q.desc) + '</div>'
          + (q.result ? '<div style="font-size:10.4px; color:#7d63a8; margin-top:6px; font-style:italic; line-height:1.6;">'
            + U.esc(q.result) + '</div>' : '')
          + '</div>';
        var acts = H.el('div');
        acts.style.cssText = 'display:flex; flex-direction:column; gap:5px; flex-shrink:0;';
        if (!q.done) {
          var settleB = H.button('让 TA 完成', { kind: 'primary', pad: '5px 9px', size: 10.2 });
          settleB.onclick = function () { Tasks.settleReverse(q); };
          acts.appendChild(settleB);
        } else {
          acts.appendChild(H.chip('已结算', { color: '#7d63a8', soft: '#F3EEFF' }));
        }
        var del = H.iconButton('trash', { size: 24, color: '#c2607c' });
        del.onclick = function () { K.removeDynamicQuest(q.key, 'user'); H.closeAllLayers(); Tasks.open(); };
        acts.appendChild(del);
        top.appendChild(acts);
        cell.appendChild(top);
        wrap.appendChild(cell);
      });
      return wrap;
    },

    /** 反向模式：结算 TA 完成的任务（由 LLM 演出 TA 的汇报） */
    settleReverse: async function (q) {
      var profile = await K.charProfile();
      var user = await K.userProfile();
      var st = K.state;
      var prompt = HG.Quiet.Prompt.buildSystem(profile, user, st) + '\n\n'
        + '事件：' + user.name + ' 给你发布了一个任务：「' + q.name + '」——' + q.desc + '\n'
        + '你现在要去完成它，并回来向 Ta 汇报。\n'
        + '要求：第一人称，60~120 字，要具体说你怎么做的，并带一点邀功的语气。不要旁白。';
      var api = await K.resolveApi();
      var out = null;
      if (api && typeof window.fwCallLLM === 'function') {
        try { out = await window.fwCallLLM(api, [{ role: 'system', content: prompt }], { temperature: 0.95 }); } catch (e) { out = null; }
      }
      if (!out) out = '「' + q.name + '」我做完了。[SPLIT]过程我录下来了一小段，等你有空我放给你看——你要是没空，我就自己多看几遍。';
      var text = String(out).split(/\[SPLIT\]|【SPLIT】/i).map(function (s) { return s.trim(); }).join('');
      K.settleReverseQuest(q.key, { result: text, verdictDelta: 4 });
      K.pushQuietSystem('*你把任务「' + q.name + '」交给 TA，TA 完成了*', 'quest');
      K.pushQuiet({ role: 'char', text: text, tone: 'quest' });
      H.closeAllLayers();
      Tasks.open();
    },

    /** 反向模式：发布任务 */
    openPublishForm: function () {
      var body = H.el('div');
      var nameInput = H.el('input', { type: 'text', placeholder: '任务名，例如：为你录一段晚安语音' });
      nameInput.style.cssText = 'width:100%; box-sizing:border-box; border-radius:12px; border:1px solid rgba(216,160,190,0.32);'
        + 'padding:10px 12px; font-size:12px; color:#5c4450; background:#fff; outline:none; font-family:inherit; margin-bottom:9px;';
      body.appendChild(nameInput);
      var descInput = H.el('textarea', { rows: 3, placeholder: '任务说明：TA 需要做什么，做到什么程度算完成' });
      descInput.style.cssText = 'width:100%; box-sizing:border-box; border-radius:12px; border:1px solid rgba(216,160,190,0.32);'
        + 'padding:10px 12px; font-size:12px; color:#5c4450; background:#fff; outline:none; font-family:inherit;'
        + 'line-height:1.66; resize:vertical; margin-bottom:9px;';
      body.appendChild(descInput);

      var rewardWrap = H.el('div');
      rewardWrap.style.cssText = 'background:rgba(255,255,255,0.76); border:1px solid rgba(216,160,190,0.22);'
        + 'border-radius:14px; padding:11px 12px; margin-bottom:9px;';
      rewardWrap.appendChild(H.sectionTitle('虚拟奖励（结算时给予 TA 的好感加成）', { color: '#D97FA8', margin: '0 0 8px' }));
      var rewardVal = { verdict: 4, tokens: 80 };
      rewardWrap.appendChild(H.slider({
        min: 1, max: 15, step: 1, value: rewardVal.verdict, color: '#D97FA8', color2: '#B79EDC',
        format: function (v) { return '好感+' + v; },
        onChange: function (v) { rewardVal.verdict = Number(v); }
      }));
      body.appendChild(rewardWrap);

      var quick = H.el('div');
      quick.style.cssText = 'display:flex; flex-wrap:wrap; gap:6px; margin-bottom:9px;';
      ['为你录一段晚安语音', '把你写进日记里', '连续七天第一个跟你说早安', '把你设成手机壁纸'].forEach(function (t) {
        var b = H.button(t, { kind: 'soft', pad: '5px 10px', size: 10.4, soft: '#FFEBF3', color: '#B0728F' });
        b.onclick = function () { nameInput.value = t; if (!descInput.value) descInput.value = t + '，做到让我满意为止。'; };
        quick.appendChild(b);
      });
      body.appendChild(quick);

      H.sheet({
        title: '发布任务',
        subtitle: '由 TA 去完成',
        icon: 'target',
        height: '76%',
        content: body,
        buttons: [{
          text: '发布', icon: 'send', kind: 'primary',
          onClick: function () {
            var name = nameInput.value.trim();
            if (!name) { H.toast('先给任务起个名字'); return false; }
            K.addDynamicQuest({
              name: name,
              desc: descInput.value.trim() || name,
              target: 1, reward: rewardVal.tokens, side: 'user'
            });
            K.pushTimeline({ type: 'quest', title: '你发布了任务', text: '「' + name + '」已交给 TA。' });
            H.toast('任务已发布');
            H.closeAllLayers();
            Tasks.open();
          }
        }]
      });
    },

    /** 攻略模式：让 Char 派一个动态委托 */
    requestDynamic: async function (node) {
      // 要调模型，防重复点击（v1.5.41）
      if (H.blocked('quest-dynamic', 2000)) { H.toast('正在让 TA 想，稍等一下'); return; }
      if (node) { var _r = H.busy(node, 'TA 正在想…'); setTimeout(_r, 2000); }
      var profile = await K.charProfile();
      var user = await K.userProfile();
      var st = K.state;
      var arc = HG.Story && HG.Story.Arc ? HG.Story.Arc.active() : null;
      var recent = (st.bond.timeline || []).slice(0, 5).map(function (t) { return '· ' + t.title + '：' + t.text; }).join('\n');
      var prompt = HG.Quiet.Prompt.buildSystem(profile, user, st) + '\n\n'
        + '现在你要给 ' + user.name + ' 派一个**只属于你们两人的日常委托**。\n'
        + (arc ? '当前主线篇章：' + arc.title + '（' + U.cut(arc.synopsis || '', 60) + '）\n' : '')
        + (recent ? '最近的足迹：\n' + recent + '\n' : '')
        + '要求：委托必须具体、可执行、有画面感（例如「为他挑一条领带」「在静室听他弹奏钢琴」），'
        + '并且要符合当前关系阶段该有的分寸。\n'
        + '严格只返回 JSON：\n'
        + '{"name":"委托名（6~12 字）","desc":"委托说明（20~50 字）","target":1,"reward":80}';
      var obj = await K.askJSON(prompt, null, { temperature: 0.95 });
      if (!obj || !obj.name) {
        var FB = [
          { name: '替他挑一条领带', desc: '去商店挑一条你一眼就觉得「是他的」的领带。', target: 1, reward: 90 },
          { name: '在静室听他弹琴', desc: '今晚去静室，让他给你弹一段只弹给你听的曲子。', target: 1, reward: 110 },
          { name: '记住他的一个习惯', desc: '记住一个他自己都没说过的小习惯，下次不经意提起来。', target: 1, reward: 100 }
        ];
        obj = FB[Math.floor(Math.random() * FB.length)];
      }
      var q = K.addDynamicQuest({
        name: obj.name,
        desc: obj.desc || '',
        target: U.int(obj.target, 1),
        reward: U.int(obj.reward, 80),
        side: 'char'
      });
      K.pushTimeline({ type: 'quest', title: 'TA 派了委托', text: '「' + obj.name + '」——' + (obj.desc || '') });
      K.pushQuietSystem('*' + profile.name + '给你派了一个新的委托：【' + obj.name + '】*', 'quest');
      H.toast('TA 派了新委托：' + obj.name);
      H.closeAllLayers();
      Tasks.open();
    }
  };

  // ==========================================================================
  //  3. 商店（双轨）
  // ==========================================================================

  var Shop = {

    /** 入口：优先页面化路由（见 Tasks.open 的说明） */
    open: function (category) {
      if (H.present('shop', category || 'all')) return;
      H.sheet(Shop.build(category));
    },

    /** 面板内容（独立页面与抽屉共用） */
    build: function (category) {
      var st = K.state;
      var reverse = K.isReverse();
      var body = H.el('div');
      var cat = category || 'all';

      // 钱包条
      var wallet = H.el('div');
      wallet.style.cssText = 'display:flex; gap:8px; margin-bottom:12px;';
      [['心动代币', U.comma(st.wallet.tokens), '#D97FA8', '#FFEBF3', 'heart'],
       ['代金券', U.comma(st.wallet.vouchers), '#7E97C9', '#EDF2FB', 'wallet']].forEach(function (c) {
        var cell = H.el('div');
        cell.style.cssText = 'flex:1; border-radius:14px; padding:10px 11px; background:linear-gradient(150deg,'
          + c[3] + ', rgba(255,255,255,0.85)); border:1px solid ' + c[2] + '33; cursor:pointer;';
        cell.innerHTML = '<div style="display:flex; align-items:center; gap:5px; font-size:10px; font-weight:800; color:'
          + c[2] + ';">' + H.icon(c[4], 12, { strokeWidth: 2 }) + '<span>' + c[0] + '</span></div>'
          + '<div style="font-size:15px; font-weight:900; color:#553f4c; margin-top:5px;">' + c[1] + '</div>';
        cell.onclick = function () { if (HG.Gacha) HG.Gacha.UI.openWallet(); };
        wallet.appendChild(cell);
      });
      body.appendChild(wallet);

      var intro = H.el('div');
      intro.style.cssText = 'font-size:10.6px; line-height:1.72; color:#8b8292; background:rgba(255,241,247,0.8);'
        + 'border:1px solid rgba(217,127,168,0.22); border-radius:13px; padding:10px 12px; margin-bottom:11px;';
      intro.innerHTML = reverse
        ? '当前是<b>私享杂货商</b>模式：你上架自制道具、手写信物、亲密特权并定价，'
          + 'TA 会定期「采购」回送给你，并在静室里汇报。'
        : '用<b>心动代币</b>购买礼物，再去静室或牵绊里送给 TA，触发专属受赠演出。';
      body.appendChild(intro);

      // 分类
      var catBar = H.el('div');
      catBar.style.cssText = 'display:flex; gap:6px; overflow-x:auto; padding-bottom:10px; scrollbar-width:none;';
      [{ key: 'all', name: '全部' }].concat(C.SHOP_CATEGORIES).forEach(function (c) {
        var on = cat === c.key;
        var chip = H.el('div');
        chip.style.cssText = 'flex:0 0 auto; padding:6px 12px; border-radius:12px; cursor:pointer; font-size:11px;'
          + 'font-weight:700; white-space:nowrap; transition:all .22s ease;'
          + (on ? 'background:linear-gradient(135deg,#D97FA8,#B79EDC); color:#fff;'
            : 'background:rgba(255,255,255,0.72); color:#9a919f; border:1px solid rgba(190,180,195,0.22);');
        chip.textContent = c.name;
        chip.onclick = function () { H.closeAllLayers(); Shop.open(c.key); };
        catBar.appendChild(chip);
      });
      body.appendChild(catBar);

      // 反向模式：我的货架
      if (reverse) {
        body.appendChild(H.sectionTitle('我的货架', { color: '#D97FA8' }));
        if (!st.shop.listed.length) {
          body.appendChild(H.empty('货架是空的。上架一件你亲手做的东西，定个价。', { icon: 'shop' }));
        }
        st.shop.listed.forEach(function (g) {
          var row = H.listRow({
            icon: g.icon || 'gift', color: '#D97FA8', soft: '#FFEBF3',
            title: g.name,
            subtitle: U.comma(g.price) + ' 心动代币 · ' + U.esc(g.desc || ''),
            subtitleWrap: true,
            rightNode: (function () {
              var box = H.el('div');
              box.style.cssText = 'display:flex; gap:6px; align-items:center; flex-shrink:0;';
              var del = H.iconButton('trash', { size: 26, color: '#c2607c' });
              del.onclick = function (ev) {
                ev.stopPropagation();
                K.unlistGoods(g.id);
                H.closeAllLayers();
                Shop.open(cat);
              };
              box.appendChild(del);
              return box;
            })()
          });
          body.appendChild(row);
        });

        // Char 采购记录
        if (st.shop.purchases.length) {
          body.appendChild(H.sectionTitle('TA 的采购记录', { color: '#B79EDC' }));
          st.shop.purchases.slice(0, 8).forEach(function (p) {
            body.appendChild(H.systemLog({ text: p.line + '（' + U.comma(p.price) + ' 心动代币）', tone: 'gift' }));
          });
        }

        // 触发一次自动采购
        var triggerB = H.button('让 TA 来逛一次（触发采购）', { kind: 'primary', block: true, icon: 'shop' });
        triggerB.onclick = function () {
          var rec = K.charAutoPurchase();
          if (!rec) { H.toast('先上架至少一件商品'); return; }
          Shop.playPurchase(rec);
        };
        body.appendChild(triggerB);
      }

      // 商品列表
      var all = K.catalog();
      var list = cat === 'all' ? all : all.filter(function (g) { return g.category === cat; });
      body.appendChild(H.sectionTitle(reverse ? '可回赠的礼物（TA 会挑）' : '礼物橱窗', { color: '#7E97C9' }));
      list.forEach(function (g) {
        var c = C.SHOP_CATEGORIES.filter(function (x) { return x.key === g.category; })[0] || C.SHOP_CATEGORIES[1];
        var cell = H.el('div');
        cell.style.cssText = 'display:flex; align-items:center; gap:11px; padding:11px 12px; border-radius:15px;'
          + 'background:rgba(255,255,255,0.76); border:1px solid rgba(190,180,195,0.2); margin-bottom:8px;';
        var ic = H.el('span');
        ic.style.cssText = 'width:40px; height:40px; border-radius:13px; flex-shrink:0; display:flex; align-items:center;'
          + 'justify-content:center; color:' + c.color + '; background:' + c.soft + ';';
        ic.innerHTML = H.icon(g.icon || 'gift', 19, { strokeWidth: 1.8 });
        cell.appendChild(ic);
        var mid = H.el('div');
        mid.style.cssText = 'flex:1; min-width:0;';
        mid.innerHTML = '<div style="font-size:12.2px; font-weight:800; color:#5c4450;">' + U.esc(g.name) + '</div>'
          + '<div style="font-size:10.2px; color:#a99fae; margin-top:3px; line-height:1.6;">' + U.esc(g.desc || '') + '</div>'
          + '<div style="font-size:10.4px; font-weight:900; color:#D97FA8; margin-top:5px;">'
          + U.comma(g.price) + ' 心动代币</div>';
        cell.appendChild(mid);
        var buy = H.button('购买', { kind: 'soft', pad: '6px 12px', size: 10.8, soft: '#FFEBF3', color: '#B0728F' });
        buy.onclick = function () { Shop.buy(g); };
        cell.appendChild(buy);
        body.appendChild(cell);
      });

      return {
        title: reverse ? '私享杂货商' : '心动商店',
        subtitle: reverse ? '你上架 · TA 采购' : '为 TA 挑一件礼物',
        icon: 'shop',
        height: '92%',
        slot: 'shop',
        content: body,
        buttons: reverse ? [{
          text: '上架新商品', icon: 'plus', kind: 'primary', keepOpen: true,
          onClick: function () { Shop.openListingForm(); }
        }] : [
          // 攻略模式：可以生成商品、也可以管理（用户 2026-09-11 要求）
          {
            text: 'AI 上新', icon: 'sparkle', kind: 'primary', keepOpen: true,
            onClick: function (api, node) { Shop.generateGoods(node); }
          },
          {
            text: '管理商品', icon: 'edit', kind: 'soft', soft: '#EDF2FB', color: '#5f7aa8', keepOpen: true,
            onClick: function () { Shop.openGoodsManager(); }
          }
        ]
      };
    },

    /**
     * 让 AI 按角色设定与当前关系阶段生成一批商品（攻略模式）
     * 生成结果进「自定义商品」，可以在「管理商品」里改价 / 改文案 / 删除。
     */
    generateGoods: async function (node) {
      if (H.blocked('shop-gen', 2500)) { H.toast('正在上新，稍等一下'); return; }
      if (node) { var _r = H.busy(node, '正在上新…'); setTimeout(_r, 2500); }
      var profile = await K.charProfile();
      var user = await K.userProfile();
      var prompt = '你在为一款女性向恋爱游戏的「心动商店」设计商品。\n'
        + '角色：' + profile.name + '\n'
        + '角色设定：' + U.cut(profile.persona || '（未填写）', 400) + '\n'
        + '玩家：' + user.name + (user.persona ? ' —— ' + U.cut(user.persona, 200) : '') + '\n'
        + '当前关系阶段：' + K.tier().name + '（好感 ' + U.comma(K.state.affinity) + '）\n'
        + '玩家已经买过：' + (K.state.shop.owned || []).slice(0, 8).map(function (o) {
          var g = K.findGoods(o.goodsId); return g ? g.name : '';
        }).filter(Boolean).join('、') || '（还没有）' + '\n\n'
        + '请设计 3 件**只属于你们两人**的商品：它应该像 TA 会准备给你的东西，'
        + '或者你会想买来送给 TA 的东西。要具体、有画面感、价格合理。\n'
        + K.goodsFormatSpec()
        + 'category 取值含义：wear=服饰 accessory=饰品 consumable=消耗品 letter=手写信物 privilege=亲密特权。\n'
        + 'icon 取 gift / heart / cards / book / clock / wallet / star 之一。';
      var raw = await K.ask(prompt, { temperature: 0.95 });
      if (raw === null) {
        H.toast('没能调用到模型：' + (K._lastAskError || '未知原因'));
        return;
      }
      var arr = K.parseGoods(raw);
      if (!arr.length) {
        H.toast(K.outputMode() === 'tag'
          ? '这次没生成出来，再试一次（或在后台切回 JSON 方案）'
          : '这次没生成出来，再试一次（或在后台切到文字标签方案）');
        return;
      }
      var n = 0;
      arr.slice(0, 5).forEach(function (g) {
        if (!g || !g.name) return;
        K.addGoods({
          name: g.name, desc: g.desc, price: g.price,
          category: g.category, icon: g.icon, from: 'ai'
        });
        n++;
      });
      H.toast(n ? ('上新了 ' + n + ' 件商品') : '这次没生成出来，再试一次');
      if (n) Shop.open();
    },

    /** 商品管理：自己加的可改可删，内置的只能隐藏/恢复 */
    openGoodsManager: function () {
      var body = H.el('div');
      var rerender = function () { Shop.openGoodsManager(); };

      body.appendChild(H.sectionTitle('自定义商品', { color: '#D97FA8' }));
      var mine = K.customGoods();
      if (!mine.length) {
        body.appendChild(H.empty('还没有自定义商品。点「AI 上新」让模型按你们的关系设计几件。', { icon: 'shop' }));
      }
      mine.forEach(function (g) {
        var row = H.listRow({
          icon: g.icon || 'gift',
          color: '#D97FA8', soft: '#FFEBF3',
          title: g.name,
          subtitle: U.comma(g.price) + ' 心动代币 · ' + U.esc(g.desc || '') +
            ' · ' + (g.from === 'char' ? 'TA 上架' : (g.from === 'ai' ? 'AI 生成' : '手动新增')),
          subtitleWrap: true,
          rightNode: (function () {
            var box = H.el('div');
            box.style.cssText = 'display:flex; gap:6px; align-items:center; flex-shrink:0;';
            var editB = H.iconButton('edit', { size: 26, color: '#B79EDC', title: '编辑' });
            editB.onclick = function (ev) {
              ev.stopPropagation();
              H.prompt({ title: '商品名', value: g.name }).then(function (name) {
                if (name === null) return;
                H.prompt({ title: '一句话说明', value: g.desc || '' }).then(function (desc) {
                  if (desc === null) return;
                  H.prompt({ title: '售价（心动代币）', value: String(g.price) }).then(function (price) {
                    if (price === null) return;
                    K.updateGoods(g.id, { name: name, desc: desc, price: price });
                    H.toast('已保存');
                    rerender();
                  });
                });
              });
            };
            box.appendChild(editB);
            var delB = H.iconButton('trash', { size: 26, color: '#c2607c' });
            delB.onclick = function (ev) {
              ev.stopPropagation();
              K.removeGoods(g.id);
              H.toast('已下架');
              rerender();
            };
            box.appendChild(delB);
            return box;
          })()
        });
        row.onclick = null;
        body.appendChild(row);
      });

      body.appendChild(H.sectionTitle('内置商品（可隐藏）', { color: '#7E97C9' }));
      K.builtinGoods().forEach(function (g) {
        var hidden = K.isGoodsHidden(g.id);
        var row = H.listRow({
          icon: g.icon || 'gift',
          color: hidden ? '#b3aab8' : '#7E97C9',
          soft: hidden ? 'rgba(240,236,244,0.9)' : '#EDF2FB',
          title: g.name + (hidden ? '（已隐藏）' : ''),
          subtitle: U.comma(g.price) + ' 心动代币',
          rightNode: (function () {
            var b = H.button(hidden ? '恢复' : '隐藏', {
              kind: 'soft', pad: '5px 10px', size: 10.5,
              soft: hidden ? '#FFEBF3' : 'rgba(240,236,244,0.9)',
              color: hidden ? '#B0728F' : '#9a919f'
            });
            b.onclick = function (ev) {
              ev.stopPropagation();
              K.hideGoods(g.id, !hidden);
              rerender();
            };
            return b;
          })()
        });
        row.onclick = null;
        body.appendChild(row);
      });

      H.sheet({
        title: '管理商品',
        subtitle: '自定义的可改可删，内置的只能隐藏',
        icon: 'edit',
        height: '90%',
        slot: 'shop-manage',
        content: body
      });
    },

    /** 购买（攻略模式） */
    buy: async function (g) {
      var res = K.buyGoods(g.id, { gift: false });
      if (!res.ok) {
        var go = await H.confirm({
          title: '心动代币不足',
          icon: 'wallet', accent: '#8FB8DE', soft: '#EAF3FF',
          message: res.msg + '\n\n是否去钱包兑换或充值？',
          okText: '去钱包', cancelText: '再想想'
        });
        if (go && HG.Gacha) HG.Gacha.UI.openWallet();
        return;
      }
      H.toast('已购买「' + g.name + '」，可在静室送出');
      // 直接询问是否立刻赠送
      var now = await H.confirm({
        title: '现在就送给 TA？',
        icon: 'gift', accent: '#D97FA8', soft: '#FFEBF3',
        message: '「' + g.name + '」已经在你背包里了。\n要现在送给 TA 吗？',
        okText: '现在就送', cancelText: '先收着'
      });
      if (now) {
        H.closeAllLayers();
        await HG.Quiet.Gift.give(g);
      } else {
        H.closeAllLayers();
        Shop.open();
      }
    },

    /** 上架表单（反向模式） */
    openListingForm: function () {
      var body = H.el('div');
      var draft = { name: '', desc: '', price: 120, category: 'letter', icon: 'gift' };

      function field(label, placeholder, multiline, rows, onChange) {
        var w = H.el('div');
        w.style.cssText = 'margin-bottom:10px;';
        var lab = H.el('div', {}, U.esc(label));
        lab.style.cssText = 'font-size:10.6px; font-weight:700; color:#8b8292; margin:0 2px 5px;';
        w.appendChild(lab);
        var inp = multiline ? H.el('textarea', { rows: rows || 3, placeholder: placeholder })
          : H.el('input', { type: 'text', placeholder: placeholder });
        inp.style.cssText = 'width:100%; box-sizing:border-box; border-radius:12px; border:1px solid rgba(216,160,190,0.32);'
          + 'padding:9px 11px; font-size:11.8px; color:#5c4450; background:#fff; outline:none; font-family:inherit;'
          + 'line-height:1.66; resize:vertical;';
        inp.oninput = function () { onChange(inp.value); };
        w.appendChild(inp);
        return w;
      }

      body.appendChild(field('商品名称', '例如：一封写得不太好的手写信', false, 0, function (v) { draft.name = v; }));
      body.appendChild(field('商品说明', 'TA 收到之后会看到这段描述', true, 3, function (v) { draft.desc = v; }));

      body.appendChild(H.sectionTitle('分类', { color: '#B79EDC' }));
      var catWrap = H.el('div');
      catWrap.style.cssText = 'display:flex; flex-wrap:wrap; gap:6px; margin-bottom:12px;';
      C.SHOP_CATEGORIES.forEach(function (c) {
        var on = draft.category === c.key;
        var b = H.button(c.name, {
          kind: 'soft', pad: '6px 11px', size: 10.8,
          soft: on ? c.soft : 'rgba(240,236,244,0.7)', color: on ? c.color : '#9a919f'
        });
        if (on) b.style.boxShadow = '0 0 0 1.4px ' + c.color + '55';
        b.onclick = function () { draft.category = c.key; H.closeAllLayers(); Shop.openListingForm(); };
        catWrap.appendChild(b);
      });
      body.appendChild(catWrap);

      body.appendChild(H.sectionTitle('售价', { color: '#7E97C9' }));
      var priceWrap = H.el('div');
      priceWrap.style.cssText = 'background:rgba(255,255,255,0.76); border:1px solid rgba(159,179,217,0.22);'
        + 'border-radius:14px; padding:11px 12px; margin-bottom:12px;';
      priceWrap.appendChild(H.slider({
        min: 20, max: 1200, step: 10, value: draft.price, color: '#4A7DBF', color2: '#B79EDC',
        format: function (v) { return U.comma(v); },
        onChange: function (v) { draft.price = Number(v); }
      }));
      priceWrap.appendChild((function () {
        var tip = H.el('div');
        tip.style.cssText = 'font-size:10px; color:#a99fae; margin-top:8px; line-height:1.6;';
        tip.textContent = '定价越高，TA 越可能犹豫；但好感越高，TA 越舍得花钱。';
        return tip;
      })());
      body.appendChild(priceWrap);

      H.sheet({
        title: '上架新商品',
        subtitle: '你亲手做的东西，由 TA 来买',
        icon: 'shop',
        height: '80%',
        content: body,
        buttons: [{
          text: '上架', icon: 'check', kind: 'primary',
          onClick: function () {
            if (!draft.name.trim()) { H.toast('先给商品起个名字'); return false; }
            K.listGoods({
              name: draft.name, desc: draft.desc, price: draft.price,
              category: draft.category, icon: draft.icon
            });
            H.toast('已上架：' + draft.name);
            H.closeAllLayers();
            Shop.open();
          }
        }]
      });
    },

    /** TA 采购的受赠演出 */
    playPurchase: function (rec) {
      var body = H.el('div');
      var hero = H.el('div');
      hero.style.cssText = 'text-align:center; padding:14px 0 8px;';
      hero.innerHTML = '<div style="width:76px; height:76px; margin:0 auto 12px; border-radius:25px; display:flex;'
        + 'align-items:center; justify-content:center; color:#D97FA8; background:#FFEBF3;'
        + 'box-shadow:0 10px 26px rgba(217,127,168,0.28); animation:hg-pulse 2s ease-in-out infinite;">'
        + H.icon('shop', 34, { strokeWidth: 1.6 }) + '</div>'
        + '<div style="font-size:14.5px; font-weight:900; color:#553f4c;">TA 采购了你的商品</div>';
      body.appendChild(hero);
      body.appendChild(H.systemLog({ text: rec.line + '（' + U.comma(rec.price) + ' 心动代币）', tone: 'gift' }));
      body.appendChild(H.systemLog({ text: '平台抽成已计入你的代金券余额。', tone: 'pay' }));
      H.sheet({
        title: '采购通知', subtitle: rec.name, icon: 'shop', height: '64%', content: body,
        buttons: [{ text: '去静室看看', icon: 'quiet', kind: 'primary', onClick: function () { H.closeAllLayers(); HG.Quiet.open(); } }]
      });
    }
  };

  // ==========================================================================
  //  4. 牵绊（阶梯好感 + 时空足迹 + 重要记忆回廊）
  // ==========================================================================

  var Bond = {

    /** 入口：优先页面化路由（见 Tasks.open 的说明） */
    open: function (tab) {
      if (H.present('bond', tab || 'ladder')) return;
      H.sheet(Bond.build(tab));
    },

    /** 面板内容（独立页面与抽屉共用） */
    build: function (tab) {
      var st = K.state;
      var body = H.el('div');
      var cur = tab || 'ladder';

      var tabs = H.tabs([
        { key: 'ladder', label: '阶梯', icon: 'bond' },
        { key: 'timeline', label: '时空足迹', icon: 'clock' },
        { key: 'memory', label: '记忆回廊', icon: 'book' },
        { key: 'rights', label: '特权与称号', icon: 'key' }
      ], cur, function (k) { Bond.open(k); });
      body.appendChild(tabs);
      body.appendChild(H.divider({ margin: '12px 0' }));

      if (cur === 'ladder') Bond.renderLadder(body);
      else if (cur === 'timeline') Bond.renderTimeline(body);
      else if (cur === 'memory') Bond.renderMemories(body);
      else Bond.renderRights(body);

      return {
        title: '牵绊',
        subtitle: '阶梯好感 · 足迹 · 记忆',
        icon: 'bond',
        height: '92%',
        slot: 'bond',
        content: body
      };
    },

    /** 阶梯面板 */
    renderLadder: function (body) {
      var st = K.state;
      var tier = K.tier();
      var idx = K.tierIndex();

      // 当前阶段大卡
      var hero = H.el('div');
      hero.style.cssText = 'position:relative; border-radius:20px; overflow:hidden; padding:16px; box-sizing:border-box;'
        + 'background:linear-gradient(150deg,' + tier.color + '26, rgba(255,255,255,0.92) 70%);'
        + 'border:1.6px solid ' + tier.color + '55; box-shadow:0 12px 30px ' + tier.glow + ';';
      var glow = H.el('div');
      glow.style.cssText = 'position:absolute; right:-30px; top:-30px; width:120px; height:120px; border-radius:50%;'
        + 'background:radial-gradient(circle,' + tier.color + '44 0%, transparent 70%);';
      hero.appendChild(glow);
      var heroBody = H.el('div');
      heroBody.style.cssText = 'position:relative;';
      heroBody.innerHTML = '<div style="font-size:10px; letter-spacing:.22em; color:' + tier.color + '; font-weight:900;">'
        + 'STAGE ' + (idx + 1) + ' / ' + C.AFFINITY_TIERS.length + '</div>'
        + '<div style="font-size:20px; font-weight:900; color:#553f4c; margin-top:6px; letter-spacing:.04em;">'
        + tier.name + '</div>'
        + '<div style="font-size:11px; color:#8b8292; margin-top:7px; line-height:1.7;">' + tier.desc + '</div>';
      hero.appendChild(heroBody);
      body.appendChild(hero);

      // 经验条
      var pct = K.tierProgress();
      var barCard = H.card({ accent: tier.color, soft: '#FFF1F7', pad: 13 });
      barCard.style.marginTop = '12px';
      barCard.appendChild(H.sectionTitle('经验槽', { color: tier.color, margin: '4px 0 10px' }));
      barCard.appendChild(H.progress({
        value: pct, height: 10, color: tier.color, color2: '#B79EDC', glow: tier.glow
      }));
      var nums = H.el('div');
      nums.style.cssText = 'display:flex; justify-content:space-between; font-size:10.6px; color:#a99fae; margin-top:8px;';
      nums.innerHTML = '<span>' + U.comma(st.affinity) + ' / ' + U.comma(tier.max) + '</span>'
        + '<span>' + (idx >= C.AFFINITY_TIERS.length - 1
          ? '已至终局'
          : ('距「' + C.AFFINITY_TIERS[idx + 1].name + '」还需 ' + U.comma(K.toNextTier()))) + '</span>';
      barCard.appendChild(nums);

      if (K.isGated()) {
        var gateTip = H.el('div');
        gateTip.style.cssText = 'margin-top:10px; padding:10px 11px; border-radius:13px; font-size:10.8px; line-height:1.7;'
          + 'background:rgba(255,241,247,0.9); border:1.3px solid rgba(217,127,168,0.4); color:#B0728F;';
        gateTip.textContent = '经验槽已满。完成一次晋阶任务，才能推开下一阶梯的门。';
        barCard.appendChild(gateTip);
        var gateB = H.button('进行晋阶任务', { kind: 'primary', block: true, icon: 'key' });
        gateB.style.marginTop = '9px';
        gateB.onclick = async function () {
          var prompt = '当前关系阶段「' + tier.name + '」的经验槽已满，需要一次「晋阶任务」推进关系。\n'
            + '请设计一个简短有力、只属于你们两人的晋阶任务（20~40 字），要求是具体动作或一次坦白。'
            + '直接输出任务描述。';
          var task = await K.ask(prompt, { temperature: 0.95 });
          if (!task) task = '当面把「我在意你」这四个字说清楚，不许用玩笑带过。';
          var ok = await H.confirm({
            title: '晋阶任务', icon: 'key', accent: '#B79EDC', soft: '#F3EEFF',
            message: String(task).trim() + '\n\n完成它，关系会推进到下一阶梯。', okText: '我完成了'
          });
          if (!ok) return;
          K.completeGate(tier.key);
          H.closeAllLayers();
          Bond.open('ladder');
        };
        barCard.appendChild(gateB);
      }
      body.appendChild(barCard);

      // 阶梯总览
      body.appendChild(H.sectionTitle('六阶阶梯', { color: '#B79EDC' }));
      C.AFFINITY_TIERS.forEach(function (t, i) {
        var reached = i <= idx;
        var isCur = i === idx;
        var cell = H.el('div');
        cell.style.cssText = 'display:flex; align-items:center; gap:10px; padding:10px 12px; border-radius:14px;'
          + 'margin-bottom:7px; transition:all .22s ease;'
          + (isCur ? 'background:linear-gradient(135deg,' + t.color + '22, rgba(255,255,255,0.9));'
            + 'border:1.4px solid ' + t.color + '66;'
            : (reached ? 'background:rgba(255,255,255,0.7); border:1px solid ' + t.color + '33;'
              : 'background:rgba(248,246,250,0.6); border:1px solid rgba(200,192,205,0.22); opacity:.72;'));
        var dot = H.el('span');
        dot.style.cssText = 'width:26px; height:26px; border-radius:50%; flex-shrink:0; display:flex; align-items:center;'
          + 'justify-content:center; font-size:10.5px; font-weight:900;'
          + (reached ? 'background:' + t.color + '; color:#fff; box-shadow:0 4px 12px ' + t.glow + ';'
            : 'background:rgba(240,236,244,0.9); color:#b3aab8;');
        dot.textContent = String(i + 1);
        cell.appendChild(dot);
        var mid = H.el('div');
        mid.style.cssText = 'flex:1; min-width:0;';
        mid.innerHTML = '<div style="font-size:12.2px; font-weight:800; color:' + (reached ? '#5c4450' : '#a99fae') + ';">'
          + t.name + (isCur ? ' · 当前' : '') + '</div>'
          + '<div style="font-size:10px; color:#a99fae; margin-top:2px; line-height:1.6;">'
          + U.comma(t.min) + ' ~ ' + U.comma(t.max) + '</div>';
        cell.appendChild(mid);
        if (st.gateDone[t.key]) cell.appendChild(H.chip('已晋阶', { color: t.color, soft: t.color + '22' }));
        body.appendChild(cell);
      });

      // 好感流水
      var log = st.bond.affinityLog || [];
      body.appendChild(H.sectionTitle('好感流水', { color: '#9FB3D9' }));
      if (!log.length) body.appendChild(H.empty('还没有好感变动记录。', { icon: 'chart' }));
      log.slice(0, 14).forEach(function (r) {
        var row = H.el('div');
        row.style.cssText = 'display:flex; align-items:center; gap:9px; padding:8px 11px; border-radius:12px;'
          + 'background:rgba(255,255,255,0.68); margin-bottom:6px;';
        row.innerHTML = '<span style="font-size:11.6px; font-weight:900; color:'
          + (r.d > 0 ? '#D97FA8' : '#7E97C9') + '; min-width:38px;">' + (r.d > 0 ? '+' : '') + r.d + '</span>'
          + '<span style="flex:1; font-size:10.6px; color:#7d7484; min-width:0; overflow:hidden; text-overflow:ellipsis;'
          + 'white-space:nowrap;">' + U.esc(r.r || '未知来源') + '</span>'
          + '<span style="font-size:9.6px; color:#bcb2be; flex-shrink:0;">' + U.timeAgo(r.t) + '</span>';
        body.appendChild(row);
      });
    },

    /** 时空足迹 */
    renderTimeline: function (body) {
      var st = K.state;
      var IconOf = {
        meet: 'heart', gift: 'gift', gacha: 'cards', pay: 'wallet', quest: 'task',
        story: 'book', mode: 'branch', tier: 'key', save: 'save', load: 'refresh',
        rewind: 'branch', shop: 'shop', verdict: 'target', chest: 'gift', recharge: 'wallet',
        buy: 'shop', memory: 'book', system: 'info'
      };
      var rows = st.bond.timeline || [];

      var head = H.card({ accent: '#7E97C9', soft: '#EDF2FB', pad: 12 });
      head.appendChild(H.sectionTitle('统计', { color: '#7E97C9', margin: '4px 0 9px' }));
      var grid = H.el('div');
      grid.style.cssText = 'display:grid; grid-template-columns:1fr 1fr 1fr; gap:8px;';
      [['足迹', rows.length], ['赠礼', U.int(st.bond.giftsGiven, 0)],
       ['戳戳', U.int(st.stats.touches, 0)], ['抽卡', (st.gacha.history || []).length],
       ['记忆', (st.bond.memories || []).length], ['章节', K.storyChapterCount()]].forEach(function (g) {
        var cell = H.el('div');
        cell.style.cssText = 'text-align:center; background:rgba(255,255,255,0.72); border-radius:12px; padding:9px 4px;';
        cell.innerHTML = '<div style="font-size:15px; font-weight:900; color:#4A7DBF;">' + g[1] + '</div>'
          + '<div style="font-size:9.4px; color:#a99fae; margin-top:3px;">' + g[0] + '</div>';
        grid.appendChild(cell);
      });
      head.appendChild(grid);
      if (st.bond.firstMeetAt) {
        var fm = H.el('div');
        fm.style.cssText = 'font-size:10.4px; color:#a99fae; text-align:center; margin-top:10px;';
        fm.textContent = '初遇：' + U.timeFull(st.bond.firstMeetAt);
        head.appendChild(fm);
      }
      body.appendChild(head);

      body.appendChild(H.sectionTitle('重要事件时间轴', { color: '#D97FA8' }));
      if (!rows.length) { body.appendChild(H.empty('还没有记录到任何事件。', { icon: 'clock' })); return; }

      var rail = H.el('div');
      rail.style.cssText = 'position:relative; padding-left:24px;';
      var line = H.el('div');
      line.style.cssText = 'position:absolute; left:8px; top:6px; bottom:6px; width:2px;'
        + 'background:linear-gradient(180deg,#D97FA8,#7E97C9); border-radius:2px; opacity:.3;';
      rail.appendChild(line);
      rows.slice(0, 60).forEach(function (r) {
        var node = H.el('div');
        node.style.cssText = 'position:relative; margin-bottom:11px;';
        var dot = H.el('span');
        dot.style.cssText = 'position:absolute; left:-20px; top:2px; width:17px; height:17px; border-radius:50%;'
          + 'background:linear-gradient(135deg,#FFEBF3,#EDF2FB); border:1.5px solid rgba(217,127,168,0.5);'
          + 'display:flex; align-items:center; justify-content:center; color:#B0728F;';
        dot.innerHTML = H.icon(IconOf[r.type] || 'info', 9, { strokeWidth: 2.4 });
        node.appendChild(dot);
        var content = H.el('div');
        content.style.cssText = 'background:rgba(255,255,255,0.72); border:1px solid rgba(190,180,195,0.2);'
          + 'border-radius:13px; padding:9px 11px;';
        content.innerHTML = '<div style="display:flex; align-items:baseline; justify-content:space-between; gap:8px;">'
          + '<span style="font-size:11.6px; font-weight:800; color:#5c4450;">' + U.esc(r.title || '') + '</span>'
          + '<span style="font-size:9.4px; color:#bcb2be; flex-shrink:0;">' + U.timeAgo(r.at) + '</span>'
          + '</div>'
          + (r.text ? '<div style="font-size:10.6px; color:#8b8292; margin-top:4px; line-height:1.68;">'
            + U.esc(r.text) + '</div>' : '');
        node.appendChild(content);
        rail.appendChild(node);
      });
      body.appendChild(rail);
    },

    /** 重要记忆回廊 */
    renderMemories: function (body) {
      var st = K.state;
      var rows = st.bond.memories || [];

      var addB = H.button('新增一条记忆', { kind: 'soft', block: true, icon: 'plus', soft: '#FFEBF3', color: '#B0728F' });
      addB.onclick = function () {
        H.prompt({
          title: '新增记忆', message: '写下你想留住的这一刻。', multiline: true, rows: 3,
          placeholder: '例如：那天他在雨里把伞整个倾向我这边。'
        }).then(function (text) {
          if (!text) return;
          K.addMemory({ title: U.cut(text, 14), summary: text, source: 'manual', tags: ['手记'] });
          H.toast('已存入记忆回廊');
          H.closeAllLayers();
          Bond.open('memory');
        });
      };
      body.appendChild(addB);
      body.appendChild(H.divider({ margin: '12px 0' }));

      if (!rows.length) { body.appendChild(H.empty('记忆回廊还是空的。剧情、卡面、静室里的高光时刻都可以收进来。', { icon: 'book' })); return; }

      var grid = H.el('div');
      grid.style.cssText = 'display:grid; grid-template-columns:1fr 1fr; gap:10px;';
      rows.forEach(function (m) {
        var cell = H.el('div');
        cell.style.cssText = 'position:relative; border-radius:16px; overflow:hidden; cursor:pointer;'
          + 'background:linear-gradient(150deg,rgba(255,255,255,0.95),rgba(246,242,251,0.9));'
          + 'border:1px solid rgba(216,160,190,0.26); box-shadow:0 8px 20px rgba(150,120,150,0.10);';
        if (m.cover) {
          var im = H.el('img', { alt: '' });
          im.src = m.cover;
          im.style.cssText = 'width:100%; height:92px; object-fit:cover; display:block;';
          cell.appendChild(im);
        } else {
          var ph = H.el('div');
          ph.style.cssText = 'height:92px; display:flex; align-items:center; justify-content:center;'
            + 'background:linear-gradient(150deg,#FFEBF3,#EDF2FB); color:#D97FA8;';
          ph.innerHTML = H.icon('heart', 28, { strokeWidth: 1.5 });
          cell.appendChild(ph);
        }
        var txt = H.el('div');
        txt.style.cssText = 'padding:9px 10px 11px;';
        txt.innerHTML = '<div style="font-size:11.4px; font-weight:800; color:#5c4450; line-height:1.5;'
          + 'display:-webkit-box; -webkit-line-clamp:1; -webkit-box-orient:vertical; overflow:hidden;">'
          + U.esc(m.title) + '</div>'
          + '<div style="font-size:9.8px; color:#a99fae; margin-top:4px; line-height:1.6;'
          + 'display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; overflow:hidden;">'
          + U.esc(m.summary) + '</div>'
          + '<div style="font-size:9px; color:#c3b6c6; margin-top:6px;">' + U.timeAgo(m.at) + '</div>';
        cell.appendChild(txt);
        cell.onclick = function () { Bond.openMemoryDetail(m); };
        grid.appendChild(cell);
      });
      body.appendChild(grid);
    },

    openMemoryDetail: function (m) {
      var body = H.el('div');
      if (m.cover) {
        var im = H.el('img', { alt: '' });
        im.src = m.cover;
        im.style.cssText = 'width:100%; border-radius:16px; object-fit:cover; max-height:280px; margin-bottom:12px;';
        body.appendChild(im);
      }
      body.appendChild(H.sectionTitle(m.title, { color: '#D97FA8' }));
      var txt = H.el('div');
      txt.style.cssText = 'font-size:12.4px; line-height:1.9; color:#5c4450; white-space:pre-wrap;'
        + 'background:rgba(255,255,255,0.76); border-radius:15px; padding:13px;';
      txt.textContent = m.summary || '';
      body.appendChild(txt);

      if (m.quotes && m.quotes.length) {
        body.appendChild(H.sectionTitle('高光对话', { color: '#B79EDC' }));
        m.quotes.forEach(function (q) {
          var qb = H.el('div');
          qb.style.cssText = 'font-size:11.6px; line-height:1.8; color:#6d6472; font-style:italic;'
            + 'padding:10px 12px; border-left:3px solid #B79EDC; background:rgba(243,238,255,0.7);'
            + 'border-radius:0 12px 12px 0; margin-bottom:8px; white-space:pre-wrap;';
          qb.textContent = q;
          body.appendChild(qb);
        });
      }

      var meta = H.el('div');
      meta.style.cssText = 'font-size:10px; color:#bcb2be; text-align:center; margin-top:10px;';
      meta.textContent = '来源：' + (m.source || '未知') + ' · ' + U.timeFull(m.at)
        + (m.tags && m.tags.length ? ' · ' + m.tags.join(' / ') : '');
      body.appendChild(meta);

      var del = H.button('删除这条记忆', { kind: 'danger', block: true, icon: 'trash' });
      del.style.marginTop = '12px';
      del.onclick = function () {
        H.confirm({
          title: '删除记忆', icon: 'trash', accent: '#c2607c', soft: '#FFEFF3',
          message: '确定删除「' + m.title + '」？', okText: '删除'
        }).then(function (ok) {
          if (!ok) return;
          K.removeMemory(m.id);
          H.toast('已删除');
          H.closeAllLayers();
          Bond.open('memory');
        });
      };
      body.appendChild(del);

      H.sheet({
        title: '记忆详情', subtitle: U.timeAgo(m.at), icon: 'book', height: '86%', content: body
      });
    },

    /** 阶梯特权与称号 */
    renderRights: function (body) {
      var st = K.state;
      var idx = K.tierIndex();
      var TIER_RIGHTS = {
        acquaint: ['可查看 TA 的基础档案', '看板可触发「头发 / 脸颊」热区'],
        probe: ['解锁「脖颈」热区与试探类台词', '每日任务上限 +1'],
        waver: ['解锁静室场景「雨夜窗边」', '可送出「手写信物」类礼物'],
        yearn: ['解锁全部 7 处热区与专属语音', '静室场景全解锁', '可开启专属卡池'],
        obsess: ['解锁「亲密特权」类礼物', '可指定 TA 的日程与心情'],
        covenant: ['终局契约 · 全部特权', '卡池概率提升（SSR +1%）', '解锁「只属于你们两人」的私语记录']
      };
      body.appendChild(H.sectionTitle('当前阶梯特权', { color: '#D97FA8' }));
      var tier = K.tier();
      var cur = H.card({ accent: tier.color, soft: '#FFF1F7', pad: 13 });
      (TIER_RIGHTS[tier.key] || []).forEach(function (r) {
        var row = H.el('div');
        row.style.cssText = 'display:flex; align-items:flex-start; gap:8px; margin:7px 0; font-size:11.6px;'
          + 'color:#5c4450; line-height:1.66;';
        row.innerHTML = '<span style="flex-shrink:0; width:17px; height:17px; border-radius:50%; background:'
          + tier.color + '22; color:' + tier.color + '; display:flex; align-items:center; justify-content:center;'
          + 'margin-top:1px;">' + H.icon('check', 10, { strokeWidth: 2.6 }) + '</span><span>' + U.esc(r) + '</span>';
        cur.appendChild(row);
      });
      body.appendChild(cur);

      body.appendChild(H.sectionTitle('尚未解锁', { color: '#9FB3D9' }));
      C.AFFINITY_TIERS.forEach(function (t, i) {
        if (i <= idx) return;
        var locked = H.card({ accent: '#9FB3D9', soft: '#EDF2FB', pad: 12 });
        locked.style.opacity = '.76';
        locked.appendChild(H.sectionTitle(t.name + ' · 未解锁', { color: '#9FB3D9', margin: '4px 0 8px' }));
        (TIER_RIGHTS[t.key] || []).forEach(function (r) {
          var row = H.el('div');
          row.style.cssText = 'display:flex; align-items:flex-start; gap:8px; margin:6px 0; font-size:11px;'
            + 'color:#8b8292; line-height:1.64;';
          row.innerHTML = '<span style="flex-shrink:0; width:17px; height:17px; border-radius:50%; background:'
            + 'rgba(159,179,217,0.18); color:#9FB3D9; display:flex; align-items:center; justify-content:center;'
            + 'margin-top:1px;">' + H.icon('lock', 9, { strokeWidth: 2.4 }) + '</span><span>' + U.esc(r) + '</span>';
          locked.appendChild(row);
        });
        body.appendChild(locked);
      });

      // 称号
      body.appendChild(H.sectionTitle('称号', { color: '#B79EDC' }));
      var titles = [
        { name: '初识者', need: 0 },
        { name: '试探的人', need: 1000 },
        { name: '让他动摇', need: 2500 },
        { name: '被眷恋', need: 4500 },
        { name: '他的执念', need: 7000 },
        { name: '终身契约者', need: 10000 }
      ];
      var wrap = H.el('div');
      wrap.style.cssText = 'display:flex; flex-wrap:wrap; gap:7px;';
      titles.forEach(function (t) {
        var on = U.int(st.peakAffinity, 0) >= t.need;
        var c = H.chip(t.name, {
          color: on ? '#B0728F' : '#b3aab8',
          soft: on ? '#FFEBF3' : 'rgba(240,236,244,0.9)'
        });
        wrap.appendChild(c);
      });
      body.appendChild(wrap);
    }
  };

  // ==========================================================================
  //  5. 导出
  // ==========================================================================

  HG.Panels = {
    Chest: Chest,
    Tasks: Tasks,
    Shop: Shop,
    Bond: Bond,

    /**
     * 页面化视图注册表（v1.5.35）：
     * 装配层的看板视图路由按 App.view 到这里取「这一页该怎么画」。
     * 每个 builder 返回与 H.sheet 同形的配置（title / subtitle / icon / content / buttons），
     * 装配层把它渲染成 #heartgame-mount 内的独立页面。
     */
    pages: {
      tasks: function () { return Tasks.build(); },
      shop: function (arg) { return Shop.build(arg || 'all'); },
      bond: function (arg) { return Bond.build(arg || 'ladder'); }
    },

    openTasks: function () { Tasks.open(); },
    openShop: function () { Shop.open(); },
    openBond: function (tab) { Bond.open(tab); }
  };
})();
