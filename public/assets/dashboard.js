
(function () {
  "use strict";

  var DIST = [1, 3, 5];
  var nodes = [], edges = [], groups = [];
  var history = {};
  var agg = [];
  var selectedId = null;
  var totalLength = 0;
  var running = true, timer = null;
var SETTINGS_KEY = "pipe-settings";
var ALLOWED_MS = [1000, 2000, 3000, 5000, 10000, 30000];
var settings = loadSettings();
  var envTemp = -4.6;

  var SVG_W = 940, SVG_H = 720;
  var PAD_X = 88, PAD_Y = 46, PAD_R = 44;
  var AVAIL_W = SVG_W - PAD_X - PAD_R;
  var TRUNK_Y = SVG_H / 2;
  var HALF_H  = SVG_H / 2 - PAD_Y;
  var BLEND   = 0.68;

  var T_MIN = -10, T_MAX = 35, F_MIN = 0, F_MAX = 2;

  /* ---------- 配色（单一监控主题） ---------- */
  var PAL = {
    temp: "#ffb454", flow: "#5ec8ff", abn: "#ff5c7a", heat: "#ff8a3d",
    grid: "rgba(255,255,255,.045)", gridLast: "rgba(255,255,255,.09)",
    tick: "#4a5567", axis: "rgba(255,255,255,.09)",
    thr: "rgba(255,92,122,.55)", thrText: "rgba(255,140,160,.8)",
    badText: "#ff8fa3", muteText: "#5a6577"
  };
  function pal() { return PAL; }

  function r2(v) { return Math.round(v * 100) / 100; }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function pad2(n) { return ("0" + n).slice(-2); }
  /* 判定与电伴热参数（依据《加热硬件基础》）：
     环境 -6~27 ℃，正常流速区间按管径 D<250 0.6-0.9 / 250<D<500 0.9-1.4 / 500<D<1000 0.9-1.6 m/s，
     低于阈值即判异常并自动开启低功率加热（自限温电伴热带），恢复正常后关闭。 */
  /* 防冻自动加热策略：< 1 ℃ 持续 3 min 自动开启；> 3 ℃ 持续 3 min 自动关闭；
     关闭后 30 min 内不再自动开启；单次自动加热 10 ~ 180 min；云端指令可指定 10 ~ 180 min。
     演示口径：1 次刷新（2 s）= 1 模拟分钟。 */
  var T_START = 1, T_STOP = 3, HOLD_ON_MIN = 3, HOLD_OFF_MIN = 3, REARM_MIN = 30;
  var HEAT_MIN_MIN = 10, HEAT_MAX_MIN = 180, TICK_MIN = 1;
  var CLOUD_MIN_LO = 10, CLOUD_MIN_HI = 180, CLOUD_MIN_DEF = 60;
  var T_ON = 1, FLOW_HYST = 0.06, HEAT_W = 25;
  var simMin = 0, cloudMin = CLOUD_MIN_DEF;

  function bandOf(dn) {
    if (dn < 250) return { lo: 0.6, hi: 0.9 };
    if (dn < 500) return { lo: 0.9, hi: 1.4 };
    return { lo: 0.9, hi: 1.6 };
  }
  function computeStatus(n) {
    return (n.temp < T_ON || n.flow < bandOf(n.dn).lo) ? "abnormal" : "normal";
  }
  function mmss(ms) {
    var s = Math.max(0, Math.floor(ms / 1000));
    return pad2(Math.floor(s / 60)) + ":" + pad2(s % 60);
  }
  function heatReasonOf(n) {
    var b = bandOf(n.dn), rs = [];
    if (n.temp < T_START) rs.push("温度 " + n.temp.toFixed(1) + " ℃ ＜ " + T_START + " ℃ 持续 " + n.coldMin + " min");
    if (n.flow < b.lo) rs.push("流速 " + n.flow.toFixed(2) + " ＜ " + b.lo.toFixed(2) + " m/s 持续 " + n.lowFlowMin + " min");
    return rs.join(" · ");
  }
  function heatOn(n, src, reason, minutes) {
    n.heat = true; n.heatSrc = src; n.heatSince = Date.now();
    n.heatStartMin = simMin; n.heatReason = reason;
    n.heatLimitMin = minutes || 0;
    n.heatUntilMin = n.heatLimitMin ? simMin + n.heatLimitMin : 0;
    n.warmMin = 0;
  }
  function heatOff(n, reason) {
    if (n.heatSrc === "local") n.lastOffMin = simMin;
    n.heat = false; n.heatSince = 0; n.heatReason = reason || "";
    n.heatUntilMin = 0; n.heatLimitMin = 0;
    n.coldMin = 0; n.warmMin = 0; n.lowFlowMin = 0; n.okFlowMin = 0;
  }
  /* 每个 tick 推进一次：云端指令优先，其次本地防冻策略 */
  function stepHeat(n) {
    var fb = bandOf(n.dn);
    if (n.temp < T_START) n.coldMin += TICK_MIN; else n.coldMin = 0;
    if (n.temp > T_STOP) n.warmMin += TICK_MIN; else n.warmMin = 0;
    if (n.flow < fb.lo) n.lowFlowMin += TICK_MIN; else n.lowFlowMin = 0;
    if (n.flow >= fb.lo + FLOW_HYST) n.okFlowMin += TICK_MIN; else n.okFlowMin = 0;

    if (n.cloudCmd !== null && n.cloudCmd !== undefined) {
      n.heatSrc = "cloud";
      if (n.cloudCmd === false) {
        if (n.heat) heatOff(n, "云端指令 · 关闭加热");
        return;
      }
      if (!n.heat) heatOn(n, "cloud", "云端指令 · 开启低功率加热", n.heatLimitMin || cloudMin);
      if (simMin >= n.heatUntilMin) {
        n.cloudCmd = null; heatOff(n, "云端时长 " + n.heatLimitMin + " min 到期 · 自动停止");
        n.heatSrc = "local"; n.lastOffMin = simMin;
      }
      return;
    }

    n.heatSrc = "local";
    if (n.heat) {
      var elapsed = simMin - n.heatStartMin;
      if (elapsed >= HEAT_MAX_MIN) { heatOff(n, "达到最长加热 " + HEAT_MAX_MIN + " min · 自动停止"); return; }
      if (elapsed >= HEAT_MIN_MIN && n.warmMin >= HOLD_OFF_MIN && n.okFlowMin >= HOLD_OFF_MIN) {
        heatOff(n, "温度 ＞ " + T_STOP + " ℃ 且流速恢复 · 持续 " + HOLD_OFF_MIN + " min · 自动停止");
        return;
      }
    } else if ((n.coldMin >= HOLD_ON_MIN || n.lowFlowMin >= HOLD_ON_MIN) && (simMin - n.lastOffMin) >= REARM_MIN) {
      heatOn(n, "local", heatReasonOf(n), HEAT_MAX_MIN);
    }
  }
  function fmtTime(ts) {
    var d = new Date(ts);
    return pad2(d.getHours()) + ":" + pad2(d.getMinutes()) + ":" + pad2(d.getSeconds());
  }
  function posStr(n) { return "[" + n.x.toFixed(1) + ", " + n.y.toFixed(1) + "]"; }
  function nodeById(id) {
    for (var i = 0; i < nodes.length; i++) if (nodes[i].id === id) return nodes[i];
    return null;
  }
  function randKm() { return DIST[Math.floor(Math.random() * DIST.length)]; }

  /* ---------- 布局核心：距离比例 + 等间距 混合 ---------- */
  function blendAxis(dists, avail, alpha) {
    var n = dists.length, out = [];
    if (n < 2) return [avail / 2];
    var span = (dists[n - 1] - dists[0]) || 1;
    var eq = avail / (n - 1);
    out[0] = 0;
    for (var i = 1; i < n; i++) {
      var prop = (dists[i] - dists[i - 1]) / span * avail;
      out.push(out[i - 1] + (1 - alpha) * eq + alpha * prop);
    }
    return out;
  }

  /* ---------- 节点数据 ---------- */
  function makeNodeData(id, x, y, dn) {
    dn = dn || 200;
    var b = bandOf(dn), abn = Math.random() < 0.05, temp, flow;
    if (abn) {
      if (Math.random() < 0.6) {
        temp = -(Math.random() * 6 + 0.4);
        flow = clamp(b.lo + (Math.random() - 0.5) * 0.25, b.lo * 0.5, b.hi);
      } else {
        temp = 2 + Math.random() * 9;
        flow = b.lo * (0.12 + Math.random() * 0.55);
      }
    } else {
      temp = 2 + Math.random() * 22;
      flow = b.lo + 0.06 + Math.random() * (b.hi - b.lo - 0.06);
    }
    var o = {
      id: id, x: x, y: y, dn: dn,
      temp: r2(temp), flow: r2(flow), time: Date.now(), lx: 0, ly: 0,
      heat: false, heatSrc: "local", heatSince: 0, heatReason: "", cloudCmd: null,
      heatStartMin: 0, heatUntilMin: 0, heatLimitMin: 0, coldMin: 0, warmMin: 0,
      lowFlowMin: 0, okFlowMin: 0, lastOffMin: -REARM_MIN
    };
    o.status = computeStatus(o);
    stepHeat(o);
    return o;
  }

  /* ---------- 构建：节点基础信息来自后端 MySQL ---------- */
  function edgeKmOf(n) { return n.edgeKm == null ? 0 : n.edgeKm; }

  function buildGroups() {
    groups = [];
    var byId = {}, childrenOf = {};
    for (var i = 0; i < nodes.length; i++) byId[nodes[i].id] = nodes[i];
    for (var e = 0; e < edges.length; e++) {
      var ed = edges[e];
      if (!childrenOf[ed.a]) childrenOf[ed.a] = [];
      childrenOf[ed.a].push(ed.b);
    }
    function kidsOf(id, kind) {
      var arr = childrenOf[id] || [], out = [];
      for (var k = 0; k < arr.length; k++) {
        var c = byId[arr[k]];
        if (c && (!kind || c.kind === kind)) out.push(c);
      }
      out.sort(function (a, b) { return a.x - b.x || a.y - b.y; });
      return out;
    }
    function collect(head, kind) {
      var chain = [], cur = head, total = 0, guard = 0;
      while (cur && guard++ < 64) {
        chain.push({ node: cur, km: edgeKmOf(cur) });
        total += edgeKmOf(cur);
        var kids = kidsOf(cur.id, kind);
        cur = kids.length ? kids[0] : null;
      }
      return { chain: chain, kmTotal: total };
    }

    for (var a = 0; a < nodes.length; a++) {
      var n = nodes[a];
      if (n.kind !== "branch") continue;
      var p = byId[n.parent];
      if (!p || p.kind !== "trunk") continue;
      var c = collect(n, "branch");
      groups.push({ base: p, dir: n.dir || (n.y < 0 ? -1 : 1), chain: c.chain, kmTotal: c.kmTotal });
    }

    var seenBase = {};
    for (var b = 0; b < nodes.length; b++) {
      var l = nodes[b];
      if (l.kind !== "lateral") continue;
      var lp = byId[l.parent];
      if (!lp || seenBase[lp.id]) continue;
      seenBase[lp.id] = true;
      lp.lb = "left";
      var c2 = collect(l, "lateral");
      for (var h = 0; h < c2.chain.length; h++) c2.chain[h].node.h = true;
      groups.push({ base: lp, dir: 0, chain: c2.chain, kmTotal: c2.kmTotal, horizontal: true });
    }
  }

  async function loadTopology() {
    nodes = []; edges = []; groups = []; history = {}; agg = [];
    var list = [];
    try {
      var res = await fetch("/api/nodes", { credentials: "same-origin", headers: { "Accept": "application/json" } });
      if (res.status === 401) { location.replace("/login"); return "unauth"; }
      if (res.ok) list = ((await res.json()).nodes || []);
    } catch (err) {
      return "offline";
    }
    if (!list.length) return "empty";

    list.sort(function (a, b) { return (a.seq || 0) - (b.seq || 0); });
    for (var i = 0; i < list.length; i++) {
      var r = list[i];
      var nd = makeNodeData(r.id, Number(r.x) || 0, Number(r.y) || 0, Number(r.dn_mm) || 200);
      nd.seq = r.seq;
      nd.label = r.label;
      nd.kind = r.branch_kind || "trunk";
      nd.dir = Number(r.branch_dir) || 0;
      nd.parent = r.parent_id;
      nd.edgeKm = r.edge_km == null ? null : Number(r.edge_km);
      nd.area = r.area;
      nd.owner = r.owner;
      nd.sn = r.device_sn;
      nodes.push(nd);
    }

    var ids = {};
    for (var j = 0; j < nodes.length; j++) ids[nodes[j].id] = true;
    for (var k = 0; k < list.length; k++) {
      var r2 = list[k];
      if (!r2.parent_id || !ids[r2.parent_id] || !ids[r2.id]) continue;
      edges.push({ a: r2.parent_id, b: r2.id, km: r2.edge_km == null ? 0 : Number(r2.edge_km) });
    }

    totalLength = 0;
    for (var e = 0; e < edges.length; e++) totalLength += edges[e].km * 1000;

    for (var q = 0; q < nodes.length; q++) {
      var nn = nodes[q];
      history[nn.id] = [];
      for (var h2 = 0; h2 < 30; h2++) {
        history[nn.id].push({ t: Date.now() - (30 - h2) * 2000, temp: nn.temp, flow: nn.flow, status: nn.status, heat: nn.heat });
      }
    }

    var sumT = 0, sumF = 0, ab = 0, ht = 0;
    for (var z = 0; z < nodes.length; z++) {
      sumT += nodes[z].temp; sumF += nodes[z].flow;
      if (nodes[z].status === "abnormal") ab++;
      if (nodes[z].heat) ht++;
    }
    var bT = sumT / nodes.length, bF = sumF / nodes.length;
    for (var a2 = 0; a2 < 30; a2++) {
      agg.push({ avgT: bT + (Math.random() - 0.5) * 1.6, avgF: bF + (Math.random() - 0.5) * 0.1, abn: ab, heat: ht });
    }

    buildGroups();
    selectedId = nodes[0].id;
    layoutNetwork();
    return "ok";
  }

  /* ---------- 计算画布坐标 ---------- */
  function layoutNetwork() {
    var trunk = [];
    for (var i = 0; i < nodes.length; i++) if (Math.abs(nodes[i].y) < 0.5) trunk.push(nodes[i]);
    trunk.sort(function (a, b) { return a.x - b.x; });

    var ds = trunk.map(function (n) { return n.x; });
    var px = blendAxis(ds, AVAIL_W, BLEND);
    for (var t = 0; t < trunk.length; t++) {
      trunk[t].lx = PAD_X + px[t];
      trunk[t].ly = TRUNK_Y;
    }

    var sideMax = { "1": 0, "-1": 0 };
    for (var g = 0; g < groups.length; g++) {
      var gr = groups[g];
      if (gr.horizontal) continue;
      if (gr.kmTotal > sideMax[gr.dir]) sideMax[gr.dir] = gr.kmTotal;
    }

    for (var g2 = 0; g2 < groups.length; g2++) {
      var gp = groups[g2];
      var cum = [0], acc = 0;
      for (var k = 0; k < gp.chain.length; k++) { acc += gp.chain[k].km * 1000; cum.push(acc); }

      if (gp.horizontal) {
        var extH = Math.min(164, 44 + gp.kmTotal * 26);
        var hp = blendAxis(cum, extH, BLEND);
        for (var m = 0; m < gp.chain.length; m++) {
          gp.chain[m].node.lx = gp.base.lx + hp[m + 1];
          gp.chain[m].node.ly = gp.base.ly;
        }
      } else {
        var ratio = sideMax[gp.dir] ? gp.kmTotal / sideMax[gp.dir] : 1;
        var ext = HALF_H * Math.max(0.6, ratio);
        var vp = blendAxis(cum, ext, BLEND);
        for (var m2 = 0; m2 < gp.chain.length; m2++) {
          gp.chain[m2].node.lx = gp.base.lx;
          gp.chain[m2].node.ly = gp.base.ly - gp.dir * vp[m2 + 1];
        }
      }
    }

    var maxLx = 0, minLx = Infinity;
    for (var z = 0; z < nodes.length; z++) {
      if (nodes[z].lx > maxLx) maxLx = nodes[z].lx;
      if (nodes[z].lx < minLx) minLx = nodes[z].lx;
    }
    var overflow = maxLx - (SVG_W - 34);
    if (overflow > 0) {
      var f = (SVG_W - 34 - minLx) / (maxLx - minLx);
      for (var z2 = 0; z2 < nodes.length; z2++) nodes[z2].lx = minLx + (nodes[z2].lx - minLx) * f;
    }
  }

  /* ---------- 模拟数据刷新 ---------- */
  function tick() {
    simMin += TICK_MIN;
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i], b = bandOf(n.dn);
      var low = n.temp < T_ON || n.flow < b.lo;
      if (low) {
        if (n.temp < T_ON && !n.heat) n.temp = r2(clamp(n.temp + (Math.random() - 0.58) * 0.9, -9, T_ON - 0.05));
        if (n.flow < b.lo) n.flow = r2(clamp(n.flow + (Math.random() - 0.58) * 0.07, 0.02, b.lo - 0.01));

      } else {
        var target = 7 + Math.random() * 5;
        n.temp = r2(clamp(n.temp + (target - n.temp) * 0.06 + (Math.random() - 0.5) * 0.55, 2.4, 30));
        var fMid = (b.lo + b.hi) / 2;
        n.flow = r2(clamp(n.flow + (fMid - n.flow) * 0.09 + (Math.random() - 0.5) * 0.08, b.lo + 0.02, b.hi - 0.02));
        if (Math.random() < 0.012) {
          if (Math.random() < 0.55) n.temp = r2(-(Math.random() * 5 + 0.3));
          else n.flow = r2(b.lo * (0.15 + Math.random() * 0.55));
        }
      }
      if (n.heat) {
        n.temp = r2(clamp(n.temp + 0.45 + Math.random() * 0.5, -9, 18));
        n.flow = r2(clamp(n.flow + 0.03 + Math.random() * 0.05, 0.02, b.hi + 0.05));
      }
      n.status = computeStatus(n);
      stepHeat(n);
      n.time = Date.now();
      history[n.id].push({ t: n.time, temp: n.temp, flow: n.flow, status: n.status, heat: n.heat });
      if (history[n.id].length > 40) history[n.id].shift();
    }
    envTemp = r2(clamp(envTemp + (Math.random() - 0.5) * 0.35, -6, 4));
    var rsT = 0, rsF = 0, rsN = 0;
    for (var ri = 0; ri < nodes.length; ri++) {
      var rr = rateOf(nodes[ri]);
      if (rr) { rsT += rr.tRate; rsF += rr.fRate; rsN++; }
    }
    if (rsN) {
      rateAgg.push({ t: Math.round(rsT / rsN * 100) / 100, f: Math.round(rsF / rsN * 1000) / 1000 });
      if (rateAgg.length > 40) rateAgg.shift();
    }
    pushAgg();
    renderAll();
  }

  function pushAgg() {
    if (!nodes.length) return;
    var sT = 0, sF = 0, ab = 0, ht = 0;
    for (var i = 0; i < nodes.length; i++) {
      sT += nodes[i].temp; sF += nodes[i].flow;
      if (nodes[i].status === "abnormal") ab++;
      if (nodes[i].heat) ht++;
    }
    agg.push({ avgT: sT / nodes.length, avgF: sF / nodes.length, abn: ab, heat: ht });
    if (agg.length > 40) agg.shift();
  }

  /* ---------- 绘制管网 ---------- */
  function renderNetwork() {
    var svg = document.getElementById("net");
    var parts = [];

    parts.push(
      '<defs>' +
        '<pattern id="dots" width="26" height="26" patternUnits="userSpaceOnUse">' +
          '<circle cx="1" cy="1" r="0.85" fill="rgba(255,255,255,.055)"/>' +
        '</pattern>' +
        '<filter id="glow" x="-40%" y="-40%" width="180%" height="180%">' +
          '<feGaussianBlur stdDeviation="2.4" result="b"/>' +
          '<feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>' +
        '</filter>' +
      '</defs>'
    );
    parts.push('<rect class="netdots" x="0" y="0" width="' + SVG_W + '" height="' + SVG_H + '" fill="url(#dots)"/>');

    for (var e = 0; e < edges.length; e++) {
      var ed = edges[e], a = nodeById(ed.a), b = nodeById(ed.b);
      var x1 = a.lx, y1 = a.ly, x2 = b.lx, y2 = b.ly;
      var seg = 'x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '"';
      parts.push('<line class="pipe-base" ' + seg + '/>');
      parts.push('<line class="pipe-core" ' + seg + '/>');
      parts.push('<line class="pipe-flow" ' + seg + '/>');

      var mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
      var vertical = Math.abs(y2 - y1) > Math.abs(x2 - x1);
      if (vertical) {
        var vOff = (e % 2 === 0) ? -9 : -22;
        parts.push('<text class="seg-label" x="' + (mx + vOff) + '" y="' + (my + 3) + '" text-anchor="end">' + ed.km + ' km</text>');
      } else {
        var hOff = (e % 2 === 0) ? -10 : -23;
        parts.push('<text class="seg-label" x="' + mx + '" y="' + (my + hOff) + '" text-anchor="middle">' + ed.km + ' km</text>');
      }
    }

    for (var j = 0; j < nodes.length; j++) {
      var nd = nodes[j];
      var isTrunk = Math.abs(nd.y) < 0.5;
      var isAbn = nd.status === "abnormal";
      var isHeat = !!nd.heat;
      var col = isAbn ? "#ff5c7a" : "#3ddc97";
      var g = '<g class="node ' + nd.status + (isHeat ? " heating" : "") + '" data-id="' + nd.id + '">';
      g += '<title>' + nd.id + ' · [' + nd.x.toFixed(0) + ', ' + nd.y.toFixed(0) + '] m · ' +
           nd.temp.toFixed(1) + ' °C · ' + nd.flow.toFixed(2) + ' m/s · DN' + nd.dn + ' · ' +
           (isHeat ? '加热中' : '未加热') + '</title>';
      g += '<circle class="halo" cx="' + nd.lx + '" cy="' + nd.ly + '" r="9.8"/>';
      if (isAbn) g += '<circle class="abnglow" cx="' + nd.lx + '" cy="' + nd.ly + '" r="24"/>';
      if (nd.id === selectedId) g += '<circle class="selglow" cx="' + nd.lx + '" cy="' + nd.ly + '" r="19"/>';
      if (isHeat) g += '<circle class="heatring" cx="' + nd.lx + '" cy="' + nd.ly + '" r="8.4"/>';
      g += '<circle class="nring" cx="' + nd.lx + '" cy="' + nd.ly + '" r="5"/>';
      g += '<circle class="ndot" cx="' + nd.lx + '" cy="' + nd.ly + '" r="1.8"/>';
      if (nd.id === selectedId) {
        g += '<circle class="selring" cx="' + nd.lx + '" cy="' + nd.ly + '" r="9.4"/>';
      }
      g += '</g>';
      parts.push(g);

      var lx, ly, anchor;
      if (isTrunk || nd.h) { lx = nd.lx; ly = nd.ly + 18; anchor = "middle"; }
      else if (nd.lb === "left") { lx = nd.lx - 10; ly = nd.ly + 3; anchor = "end"; }
      else { lx = nd.lx + 10; ly = nd.ly + 3; anchor = "start"; }
      parts.push('<text class="nlabel' + (isAbn ? " abn" : "") + '" x="' + lx + '" y="' + ly + '" text-anchor="' + anchor + '">' + nd.id + '</text>');
    }

    var first = nodes[0], lastLx = -1, last = null;
    for (var t2 = 0; t2 < nodes.length; t2++) {
      var q = nodes[t2];
      if (Math.abs(q.y) < 0.5 && q.lx > lastLx) { lastLx = q.lx; last = q; }
    }
    parts.push('<text class="endlabel" x="' + (first.lx - 12) + '" y="' + (TRUNK_Y - 12) + '" text-anchor="end">起点</text>');
    if (last) parts.push('<text class="endlabel" x="' + (last.lx + 13) + '" y="' + (TRUNK_Y - 12) + '" text-anchor="start">终点</text>');

    svg.innerHTML = parts.join("");
    var gs = svg.querySelectorAll(".node");
    for (var c = 0; c < gs.length; c++) {
      gs[c].addEventListener("click", function () { selectNode(this.getAttribute("data-id")); });
    }
  }

  /* ---------- 统计 ---------- */
  function renderStats() {
    var total = nodes.length, normal = 0, abnormal = 0, sumT = 0, sumF = 0, trunkN = 0, heatN = 0;
    var minT = Infinity, maxT = -Infinity, minF = Infinity, maxF = -Infinity;
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (n.status === "normal") normal++; else abnormal++;
      if (n.heat) heatN++;
      if (Math.abs(n.y) < 0.5) trunkN++;
      sumT += n.temp; sumF += n.flow;
      if (n.temp < minT) minT = n.temp;
      if (n.temp > maxT) maxT = n.temp;
      if (n.flow < minF) minF = n.flow;
      if (n.flow > maxF) maxF = n.flow;
    }

    document.getElementById("stTotal").textContent = total;
    document.getElementById("stNormal").textContent = normal;
    document.getElementById("stAbnormal").textContent = abnormal;
    document.getElementById("stAlive").textContent = total + " / " + total;
    document.getElementById("stNormalPct").textContent = total ? (normal / total * 100).toFixed(0) + "%" : "—";
    document.getElementById("stNormalBar").style.width = (total ? normal / total * 100 : 0) + "%";

    var avgT = total ? sumT / total : 0, avgF = total ? sumF / total : 0;
    document.getElementById("stTemp").innerHTML = total ? avgT.toFixed(1) + '<small>°C</small>' : "—";
    document.getElementById("stFlow").innerHTML = total ? avgF.toFixed(2) + '<small>m/s</small>' : "—";
    document.getElementById("stTempRange").textContent = total ? minT.toFixed(1) + " ~ " + maxT.toFixed(1) + " °C" : "—";
    document.getElementById("stFlowRange").textContent = total ? minF.toFixed(2) + " ~ " + maxF.toFixed(2) + " m/s" : "—";
    document.getElementById("stMixTrunk").style.width = (total ? trunkN / total * 100 : 50) + "%";
    document.getElementById("stMixBranch").style.width = (total ? (total - trunkN) / total * 100 : 50) + "%";
    document.getElementById("stMixText").textContent = "主干 " + trunkN + " · 分支 " + (total - trunkN);

    document.getElementById("stHeat").textContent = heatN;
    document.getElementById("stHeatFoot").textContent = heatN ? (HEAT_W + " W/m × " + heatN) : ("低功率 " + HEAT_W + " W/m");
    drawSpark("spHeat", agg.map(function (d) { return d.heat; }), pal().heat);
    drawSpark("spTemp", agg.map(function (d) { return d.avgT; }), pal().temp);
    drawSpark("spFlow", agg.map(function (d) { return d.avgF; }), pal().flow);
    drawSpark("spAbn", agg.map(function (d) { return d.abn; }), pal().abn);
  }

  /* ---------- 详情 ---------- */
  function renderDetail() {
    var n = nodeById(selectedId);
    if (!n) return;
    var ok = n.status === "normal";
    var bd = bandOf(n.dn);

    document.getElementById("dId").textContent = n.id;
    document.getElementById("dPos").textContent = posStr(n);
    document.getElementById("dDn").textContent = "DN " + n.dn;
    document.getElementById("dTime").textContent = fmtTime(n.time);

    document.getElementById("dTemp").innerHTML = n.temp.toFixed(1) + '<i>°C</i>';
    document.getElementById("dFlow").innerHTML = n.flow.toFixed(2) + '<i>m/s</i>';

    var tb = document.getElementById("dTempBar"), fb = document.getElementById("dFlowBar");
    tb.style.width = clamp((n.temp - T_MIN) / (T_MAX - T_MIN), 0, 1) * 100 + "%";
    fb.style.width = clamp((n.flow - F_MIN) / (F_MAX - F_MIN), 0, 1) * 100 + "%";
    tb.style.background = n.temp < T_ON
      ? "linear-gradient(90deg,rgba(255,92,122,.5),#ff5c7a)"
      : "linear-gradient(90deg,rgba(255,180,84,.5),#ffb454)";
    fb.style.background = n.flow < bd.lo
      ? "linear-gradient(90deg,rgba(255,92,122,.5),#ff5c7a)"
      : "linear-gradient(90deg,rgba(94,200,255,.5),#5ec8ff)";
    document.getElementById("dFlowTick").style.left = (bd.lo / F_MAX * 100) + "%";

    document.getElementById("dTempThr").textContent = "阈值 " + T_ON.toFixed(0) + " ℃";
    document.getElementById("dFlowThr").textContent = "阈值 " + bd.lo.toFixed(2) + " m/s";
    document.getElementById("dTempState").textContent = n.temp < T_ON ? "低于下限" : "正常区间";
    document.getElementById("dTempState").style.color = n.temp < T_ON ? pal().badText : pal().muteText;
    document.getElementById("dFlowState").textContent = n.flow < bd.lo ? "低于下限" : "正常区间";
    document.getElementById("dFlowState").style.color = n.flow < bd.lo ? pal().badText : pal().muteText;

    var chip = document.getElementById("detailStatus");
    chip.className = "chip " + (ok ? "ok" : "bad");
    chip.innerHTML = "<i></i>" + (ok ? "正常" : "异常");

    /* --- 电伴热状态 --- */
    var box = document.getElementById("heatBox");
    if (box) box.classList.toggle("on", !!n.heat);
    document.getElementById("dHeatState").innerHTML = "<i></i>" + (n.heat ? "加热中" : "待机");
    document.getElementById("dHeatReason").textContent = n.heat
      ? (n.heatReason || "云端指令") : (heatReasonOf(n) || "温度与流速均正常");
    document.getElementById("dHeatPower").textContent = n.heat ? "低功率 " + HEAT_W + " W/m" : "0 W/m";
    document.getElementById("dHeatSrc").textContent = (n.cloudCmd !== null && n.cloudCmd !== undefined)
      ? "云端指令" : (n.heat ? "本地自动" : "—");
    document.getElementById("dHeatDur").textContent = n.heat
      ? (Math.max(0, simMin - n.heatStartMin) + " / " + (n.heatLimitMin || HEAT_MAX_MIN) + " min") : "—";
    var dNote = document.getElementById("dCmdNote");
    if (n.cloudCmd === null) dNote.textContent = "本地自动 · ＜" + T_START + " ℃ 或流速偏低 持续 " + HOLD_ON_MIN + " min 开启 · 间隔 " + REARM_MIN + " min";
    else if (n.cloudCmd) dNote.textContent = "云端开启 · 到期自动停止 · 本地阈值暂停";
    else dNote.textContent = "云端关闭 · 本地阈值暂停 · 恢复本地后接管";
    var dBar = document.getElementById("cmdBar");
    if (dBar) {
      var ratio = (n.cloudCmd === true && n.heatLimitMin)
        ? Math.max(0, (n.heatUntilMin - simMin) / n.heatLimitMin) : 0;
      dBar.style.width = (ratio * 100).toFixed(1) + "%";
    }
    var dOut = document.getElementById("cmdMinOut");
    if (dOut) dOut.textContent = (n.cloudCmd === true && n.heatLimitMin ? n.heatLimitMin : cloudMin) + " min";
    var dRem = document.getElementById("cmdRemain");
    if (dRem) {
      if (n.cloudCmd === true && n.heatLimitMin) {
        dRem.textContent = "递减中 · 剩余 " + Math.max(0, n.heatUntilMin - simMin) + " / " + n.heatLimitMin + " min";
      } else if (n.cloudCmd === false) {
        dRem.textContent = "云端已关闭 · 恢复本地阈值控制";
      } else {
        dRem.textContent = "可调范围 " + CLOUD_MIN_LO + " ~ " + CLOUD_MIN_HI + " min";
      }
    }
    var cmds = document.querySelectorAll("#heatBox .mini");
    for (var c = 0; c < cmds.length; c++) {
      var kc = cmds[c].getAttribute("data-cmd");
      var act = (kc === "auto" && n.cloudCmd === null) ||
                (kc === "on" && n.cloudCmd === true) ||
                (kc === "off" && n.cloudCmd === false);
      if (act) cmds[c].classList.add("act"); else cmds[c].classList.remove("act");
    }

    var h = history[n.id] || [];
    document.getElementById("tTempNow").textContent = n.temp.toFixed(1) + "°C";
    document.getElementById("tFlowNow").textContent = n.flow.toFixed(2) + "m/s";
    document.getElementById("tTempTh").textContent = "阈值 " + T_ON.toFixed(0) + " ℃";
    document.getElementById("tFlowTh").textContent = "阈值 " + bd.lo.toFixed(2) + " · 区间 " + bd.lo.toFixed(2) + "–" + bd.hi.toFixed(2);

    drawChart("chartTemp", h.map(function (x) { return x.temp; }),
      { color: pal().temp, threshold: T_ON, label: T_ON.toFixed(0), min: T_MIN, max: T_MAX, dec: 0, div: 3 });
    drawChart("chartFlow", h.map(function (x) { return x.flow; }),
      { color: pal().flow, threshold: bd.lo, label: bd.lo.toFixed(2), min: F_MIN, max: F_MAX, dec: 1, div: 4 });
  }

  /* ---------- 表格 ---------- */
  function renderTable() {
    var body = document.getElementById("tblBody");
    var rows = nodes.slice().sort(function (a, b) { return (a.seq || 0) - (b.seq || 0); });
    var html = "", heatN = 0;
    for (var i = 0; i < rows.length; i++) {
      var n = rows[i], abn = n.status === "abnormal", hot = !!n.heat;
      if (hot) heatN++;
      html += '<tr class="' + (abn ? "abn " : "") + (hot ? "hot " : "") + (n.id === selectedId ? "sel" : "") + '" data-id="' + n.id + '">' +
        '<td class="mono strong">' + n.id + '</td>' +
        '<td class="mono">' + fmtTime(n.time) + '</td>' +
        '<td class="num mono">DN ' + n.dn + '</td>' +
        '<td class="mono">' + posStr(n) + '</td>' +
        '<td class="num mono">' + n.temp.toFixed(1) + '</td>' +
        '<td class="num mono">' + n.flow.toFixed(2) + '</td>' +
        '<td><span class="hb ' + (hot ? "on" : "") + '"><i></i>' + (hot ? "加热中" : "待机") +
          (hot && n.heatSrc === "cloud" ? '<em>云</em>' : '') +
          (!hot && n.cloudCmd === false ? '<em>云·禁</em>' : '') + '</span></td>' +
        '<td><span class="st ' + (abn ? "bad" : "ok") + '"><i></i>' + (abn ? "异常" : "正常") + '</span></td>' +
        '</tr>';
    }
    body.innerHTML = html;
    var trs = body.querySelectorAll("tr");
    for (var k = 0; k < trs.length; k++) {
      trs[k].addEventListener("click", function () { selectNode(this.getAttribute("data-id")); });
    }
    document.getElementById("tblHint").textContent =
      "共 " + nodes.length + " 个节点 · 加热 " + heatN + " · " + secText(settings.uploadMs) + " 刷新 · 流速阈值按管径 0.6 / 0.9 / 0.9";
  }

  /* ---------- 平滑曲线 ---------- */
  function smooth(ctx, pts) {
    if (pts.length < 3) {
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (var q = 1; q < pts.length; q++) ctx.lineTo(pts[q][0], pts[q][1]);
      return;
    }
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (var i = 0; i < pts.length - 1; i++) {
      var p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
      var t = 0.18;
      var c1x = p1[0] + (p2[0] - p0[0]) * t, c1y = p1[1] + (p2[1] - p0[1]) * t;
      var c2x = p2[0] - (p3[0] - p1[0]) * t, c2y = p2[1] - (p3[1] - p1[1]) * t;
      ctx.bezierCurveTo(c1x, c1y, c2x, c2y, p2[0], p2[1]);
    }
  }

  /* ---------- 迷你曲线 ---------- */
  function drawSpark(id, values, color) {
    var cv = document.getElementById(id);
    if (!cv) return;
    var w = cv.clientWidth, h = cv.clientHeight || 26;
    if (!w) return;
    var dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    var ctx = cv.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (!values.length) return;

    var min = Math.min.apply(null, values), max = Math.max.apply(null, values);
    if (max - min < 1e-6) { max = min + 1; }
    var padT = 4, padB = 3;
    var xFor = function (i) { return values.length === 1 ? w / 2 : (i / (values.length - 1)) * w; };
    var yFor = function (v) { return padT + (h - padT - padB) * (1 - (v - min) / (max - min)); };

    ctx.beginPath();
    ctx.moveTo(xFor(0), h);
    for (var i = 0; i < values.length; i++) ctx.lineTo(xFor(i), yFor(values[i]));
    ctx.lineTo(xFor(values.length - 1), h);
    ctx.closePath();
    var g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, color + "44");
    g.addColorStop(1, color + "00");
    ctx.fillStyle = g; ctx.fill();

    ctx.beginPath();
    smooth(ctx, values.map(function (v, i) { return [xFor(i), yFor(v)]; }));
    ctx.strokeStyle = color; ctx.lineWidth = 1.3; ctx.lineJoin = "round"; ctx.lineCap = "round";
    ctx.stroke();

    var lx = xFor(values.length - 1), ly = yFor(values[values.length - 1]);
    ctx.beginPath(); ctx.arc(lx, ly, 1.9, 0, Math.PI * 2);
    ctx.fillStyle = color; ctx.fill();
  }

  /* ---------- 趋势图 ---------- */
  function drawChart(id, series, o) {
    var canvas = document.getElementById(id);
    if (!canvas) return;
    var w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    var dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    var ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    var padL = 30, padR = 8, padT = 10, padB = 14;
    var plotW = w - padL - padR, plotH = h - padT - padB;
    var min = o.min, max = o.max;
    var yFor = function (v) { return padT + plotH * (1 - (v - min) / (max - min)); };

    ctx.font = "9px ui-monospace, Consolas, monospace";
    ctx.textAlign = "right";
    var div = o.div || 3;
    for (var i = 0; i <= div; i++) {
      var y = padT + plotH * (i / div);
      ctx.beginPath();
      ctx.moveTo(padL, y + 0.5); ctx.lineTo(padL + plotW, y + 0.5);
      ctx.strokeStyle = i === div ? pal().gridLast : pal().grid;
      ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = pal().tick;
      var val = max - (max - min) * (i / div);
      var clash = o.threshold != null && Math.abs(val - o.threshold) < (max - min) / div * 0.45;
      if (!clash) ctx.fillText(val.toFixed(o.dec), padL - 7, y + 3);
    }

    if (o.threshold != null) {
      var ty = yFor(o.threshold);
      if (ty >= padT - 1 && ty <= padT + plotH + 1) {
        ctx.save();
        ctx.strokeStyle = pal().thr;
        ctx.setLineDash([3, 4]); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(padL, ty); ctx.lineTo(padL + plotW, ty); ctx.stroke();
        ctx.restore();
        ctx.fillStyle = pal().thrText;
        ctx.textAlign = "left";
        ctx.fillText(o.label, padL + 4, ty - 3.5);
      }
    }

    var n = series.length;
    if (n > 1) {
      var xFor = function (k) { return padL + plotW * (k / (n - 1)); };
      var pts = series.map(function (v, k) { return [xFor(k), yFor(v)]; });

      ctx.beginPath();
      ctx.moveTo(pts[0][0], padT + plotH);
      pts.forEach(function (p) { ctx.lineTo(p[0], p[1]); });
      ctx.lineTo(pts[n - 1][0], padT + plotH);
      ctx.closePath();
      var g2 = ctx.createLinearGradient(0, padT, 0, padT + plotH);
      g2.addColorStop(0, o.color + "2b");
      g2.addColorStop(1, o.color + "00");
      ctx.fillStyle = g2; ctx.fill();

      ctx.beginPath();
      smooth(ctx, pts);
      ctx.strokeStyle = o.color; ctx.lineWidth = 1.6;
      ctx.lineJoin = "round"; ctx.lineCap = "round";
      ctx.shadowColor = o.color + "66"; ctx.shadowBlur = 6;
      ctx.stroke();
      ctx.shadowBlur = 0;

      var lp = pts[n - 1];
      ctx.beginPath(); ctx.arc(lp[0], lp[1], 4.2, 0, Math.PI * 2);
      ctx.fillStyle = o.color + "33"; ctx.fill();
      ctx.beginPath(); ctx.arc(lp[0], lp[1], 2.1, 0, Math.PI * 2);
      ctx.fillStyle = o.color; ctx.fill();
    }

    ctx.strokeStyle = pal().axis;
    ctx.beginPath(); ctx.moveTo(padL + 0.5, padT); ctx.lineTo(padL + 0.5, padT + plotH); ctx.stroke();
  }

  /* ---------- 变化速率分析 ---------- */
  var RATE_WIN = 5;
  var rateAgg = [];

  function setTxt(id, v) {
    var e = document.getElementById(id);
    if (e) e.textContent = v;
  }

  function rateOf(n) {
    var h = history[n.id];
    if (!h || h.length < 3) return null;
    var k = Math.min(RATE_WIN, h.length - 1);
    var a = h[h.length - 1 - k], b = h[h.length - 1];
    var dT = b.temp - a.temp, dF = b.flow - a.flow;
    return {
      k: k, dT: dT, dF: dF,
      tRate: Math.round(dT / k * 100) / 100,
      fRate: Math.round(dF / k * 1000) / 1000
    };
  }

  function rateState(n, rt) {
    if (n.heat && rt.tRate > 0.05) return { k: "warm", t: "回温中" };
    if (rt.tRate > 0.05) return { k: "up", t: "升温" };
    if (rt.tRate < -0.05) return { k: "down", t: "降温" };
    return { k: "flat", t: "平稳" };
  }

  function sign(v, dec) {
    return (v > 0 ? "+" : "") + v.toFixed(dec);
  }

  function dirCls(v) { return v > 0 ? "up" : v < 0 ? "down" : ""; }

  function renderRates() {
    var body = document.getElementById("rateBody");
    if (!body) return;
    var rows = [], i, sumT = 0, sumF = 0, hotSum = 0, hotN = 0;
    var upId = "—", upV = 0, downId = "—", downV = 0;
    for (i = 0; i < nodes.length; i++) {
      var rt = rateOf(nodes[i]);
      if (rt) rows.push({ n: nodes[i], rt: rt });
    }
    rows.sort(function (a, b) { return Math.abs(b.rt.tRate) - Math.abs(a.rt.tRate); });
    var html2 = "";
    for (i = 0; i < rows.length; i++) {
      var o = rows[i], n = o.n, r = o.rt, st = rateState(n, r);
      sumT += r.tRate; sumF += r.fRate;
      if (n.heat && simMin - (n.heatStartMin || 0) >= RATE_WIN) { hotSum += r.tRate; hotN++; }
      if (r.tRate > upV) { upV = r.tRate; upId = n.id; }
      if (r.tRate < downV) { downV = r.tRate; downId = n.id; }
      html2 += '<tr class="' + (n.status === "abnormal" ? "abn " : "") + (n.heat ? "hot " : "") + (n.id === selectedId ? "sel" : "") + '" data-id="' + n.id + '">' +
        '<td class="mono strong">' + n.id + '</td>' +
        '<td class="num mono">' + n.temp.toFixed(1) + '</td>' +
        '<td class="num mono ' + dirCls(r.dT) + '">' + sign(r.dT, 2) + '</td>' +
        '<td class="num mono ' + dirCls(r.tRate) + '"><b>' + sign(r.tRate, 2) + '</b></td>' +
        '<td class="num mono">' + n.flow.toFixed(2) + '</td>' +
        '<td class="num mono ' + dirCls(r.dF) + '">' + sign(r.dF, 3) + '</td>' +
        '<td class="num mono ' + dirCls(r.fRate) + '">' + sign(r.fRate, 3) + '</td>' +
        '<td><span class="rt ' + st.k + '">' + st.t + '</span></td>' +
        '</tr>';
    }
    body.innerHTML = html2;
    var trs = body.querySelectorAll("tr");
    for (i = 0; i < trs.length; i++) {
      trs[i].addEventListener("click", function () { selectNode(this.getAttribute("data-id")); });
    }
    var cnt = rows.length || 1;
    setTxt("rTempRate", sign(sumT / cnt, 2));
    setTxt("rFlowRate", sign(sumF / cnt, 3));
    setTxt("rWarm", hotN ? sign(hotSum / hotN, 2) : "—");
    var rw = document.getElementById("rWarm");
    if (rw) rw.className = hotN ? "" : "dim";
    setTxt("rUp", upId === "—" ? "—" : upId + "  " + sign(upV, 2));
    setTxt("rDown", downId === "—" ? "—" : downId + "  " + sign(downV, 2));
    setTxt("rateHint", "最近 " + RATE_WIN + " 次采样（≈" + RATE_WIN + " 模拟分钟）· 温度 ℃/min · 流速 (m/s)/min · 共 " + rows.length + " 个节点");
    if (rateAgg.length > 1) {
      var mt = 0.2, mf = 0.005;
      for (i = 0; i < rateAgg.length; i++) {
        mt = Math.max(mt, Math.abs(rateAgg[i].t));
        mf = Math.max(mf, Math.abs(rateAgg[i].f));
      }
      mt = Math.ceil(mt * 10) / 10;
      mf = Math.ceil(mf * 1000) / 1000;
      drawChart("chartTempRate", rateAgg.map(function (x) { return x.t; }),
        { color: pal().temp, min: -mt, max: mt, dec: 2, div: 2 });
      drawChart("chartFlowRate", rateAgg.map(function (x) { return x.f; }),
        { color: pal().flow, min: -mf, max: mf, dec: 3, div: 2 });
    }
  }

  /* ---------- 悬浮提示 ---------- */
  function initTip() {
    var svg = document.getElementById("net");
    var tip = document.getElementById("tip");
    function hide() { tip.classList.remove("on"); }
    svg.addEventListener("mousemove", function (ev) {
      var g = ev.target && ev.target.closest ? ev.target.closest("g.node") : null;
      if (!g) { hide(); return; }
      var nd = nodeById(g.getAttribute("data-id"));
      if (!nd) { hide(); return; }
      var isAbn = nd.status === "abnormal";
      var col = isAbn ? "#ff5c7a" : "#3ddc97";
      tip.innerHTML =
        '<div class="t-id"><i style="background:' + col + '"></i>' + nd.id +
          '<span style="margin-left:auto;font-weight:400;color:' + col + '">' +
          (isAbn ? "异常" : "正常") + '</span></div>' +
        '<div class="t-row"><span>温度</span><b>' + nd.temp.toFixed(1) + ' °C</b></div>' +
        '<div class="t-row"><span>流速</span><b>' + nd.flow.toFixed(2) + ' m/s</b></div>' +
        '<div class="t-row"><span>管径</span><b>DN ' + nd.dn + '</b></div>' +
        '<div class="t-row"><span>加热</span><b style="color:' + (nd.heat ? "#ffb382" : "#8c98ab") + '">' +
          (nd.heat ? (nd.heatSrc === "cloud" ? "加热中 · 云端" : "加热中 · 本地") : "待机") + '</b></div>';
      tip.style.left = ev.clientX + "px";
      tip.style.top = ev.clientY + "px";
      tip.classList.add("on");
    });
    svg.addEventListener("mouseleave", hide);
    window.addEventListener("scroll", hide, { passive: true });
    svg.addEventListener("click", hide);
  }

  /* ---------- 交互 ---------- */
  function selectNode(id) {
    if (!nodeById(id)) return;
    selectedId = id;
    renderNetwork();
    renderDetail();
    renderTable();
  }

  function renderAll() {
    renderStats();
    renderNetwork();
    renderDetail();
    renderTable();
    renderRates();
    document.getElementById("pipeHint").textContent =
      edges.length + " 段 · " + (totalLength / 1000).toFixed(0) + " km · " + groups.length + " 分支";
    document.getElementById("liveTs").textContent = fmtTime(Date.now());
    var ev = document.getElementById("envT");
    if (ev) ev.textContent = envTemp.toFixed(1) + " ℃";
  }

  /* ---------- 设置 ---------- */
  function loadSettings() {
    var s = { uploadMs: 2000 };
    try {
      var raw = window.localStorage.getItem(SETTINGS_KEY);
      if (raw) {
        var o = JSON.parse(raw);
        if (o && ALLOWED_MS.indexOf(Number(o.uploadMs)) >= 0) s.uploadMs = Number(o.uploadMs);
      }
    } catch (e) { /* 忽略损坏的本地设置 */ }
    return s;
  }
  function saveSettings() {
    try { window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) { /* 隐私模式忽略 */ }
  }
  function secText(ms) { return (ms % 1000 === 0 ? ms / 1000 : (ms / 1000).toFixed(1)) + "s"; }
  function freqHintText(ms) {
    var per = Math.round(60000 / ms);
    var span = Math.round(40 * ms / 1000);
    return "当前 " + secText(ms) + "：每分钟约 " + per + " 次上报 · 趋势曲线保留最近 40 个点（约 " + span + " 秒）· 演示为加速回放，1 次刷新 = 1 模拟分钟";
  }
  function markFreq(ms) {
    var btns = document.querySelectorAll("#freqSeg button");
    for (var i = 0; i < btns.length; i++) {
      btns[i].classList.toggle("on", Number(btns[i].getAttribute("data-ms")) === ms);
    }
    var h = document.getElementById("freqHint");
    if (h) h.textContent = freqHintText(ms);
  }
  function openSettings() {
    markFreq(settings.uploadMs);
    var m = document.getElementById("setModal");
    m.hidden = false;
    document.body.style.overflow = "hidden";
  }
  function closeSettings() {
    var m = document.getElementById("setModal");
    if (m) m.hidden = true;
    document.body.style.overflow = "";
  }
  function initSettings() {
    var seg = document.getElementById("freqSeg");
    if (seg) {
      seg.addEventListener("click", function (ev) {
        var b = ev.target.closest("button[data-ms]");
        if (!b) return;
        markFreq(Number(b.getAttribute("data-ms")));
      });
    }
    var open = document.getElementById("setBtn");
    if (open) open.addEventListener("click", openSettings);
    var close = document.getElementById("setClose");
    if (close) close.addEventListener("click", closeSettings);
    var cancel = document.getElementById("setCancel");
    if (cancel) cancel.addEventListener("click", closeSettings);
    var bg = document.querySelector("#setModal .modal-bg");
    if (bg) bg.addEventListener("click", closeSettings);
    document.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape") closeSettings();
    });
    var save = document.getElementById("setSave");
    if (save) save.addEventListener("click", function () {
      var on = document.querySelector("#freqSeg button.on");
      settings.uploadMs = on ? Number(on.getAttribute("data-ms")) : settings.uploadMs;
      saveSettings();
      fetch("/api/settings", {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uploadMs: settings.uploadMs })
      }).catch(function () { /* 无后端时静默失败 */ });
      if (running) startTimer();
      renderTable();
      closeSettings();
    });
  }

  function syncSettingsFromServer() {
    fetch("/api/settings", { credentials: "same-origin" }).then(function (r) {
      return r.ok ? r.json() : null;
    }).then(function (d) {
      if (!d || !d.settings) return;
      var ms = Number(d.settings.uploadMs);
      if (ALLOWED_MS.indexOf(ms) < 0 || ms === settings.uploadMs) return;
      settings.uploadMs = ms;
      saveSettings();
      if (running) startTimer();
      renderTable();
    }).catch(function () { /* 离线或接口不可用时沿用本地设置 */ });
  }

  function startTimer() {
    if (timer) clearInterval(timer);
    timer = setInterval(tick, settings.uploadMs);
  }

  function init() {
    initSettings();
    syncSettingsFromServer();
    document.getElementById("regenBtn").addEventListener("click", function () {
      loadTopology().then(function (st) { if (st === "ok") renderAll(); });
    });
    document.getElementById("pauseBtn").addEventListener("click", function () {
      running = !running;
      var live = document.getElementById("liveTag");
      var txt = document.getElementById("pauseText");
      if (running) {
        startTimer(); txt.textContent = "暂停";
        live.classList.remove("paused");
        document.getElementById("liveText").textContent = "实时采集中";
      } else {
        if (timer) clearInterval(timer);
        txt.textContent = "继续";
        live.classList.add("paused");
        document.getElementById("liveText").textContent = "已暂停";
      }
    });
    var rng = document.getElementById("cmdMin");
    if (rng) {
      cloudMin = parseInt(rng.value, 10) || CLOUD_MIN_DEF;
      rng.addEventListener("input", function () {
        cloudMin = parseInt(this.value, 10) || CLOUD_MIN_DEF;
        var o = document.getElementById("cmdMinOut");
        if (o && !(nodeById(selectedId) || {}).heat) o.textContent = cloudMin + " min";
        var r = document.getElementById("cmdRemain");
        if (r) r.textContent = "已选 " + cloudMin + " min · 范围 " + CLOUD_MIN_LO + " ~ " + CLOUD_MIN_HI;
      });
    }
    var cmds = document.querySelectorAll("#heatBox .mini");
    for (var i = 0; i < cmds.length; i++) {
      cmds[i].addEventListener("click", function () {
        var n = nodeById(selectedId);
        if (!n) return;
        var c = this.getAttribute("data-cmd");
        if (c === "auto") {
          n.cloudCmd = null; n.heatUntilMin = 0; n.heatLimitMin = 0;
        } else {
          n.cloudCmd = (c === "on");
          n.heatLimitMin = (c === "on") ? cloudMin : 0;
          n.heatUntilMin = (c === "on") ? simMin + cloudMin : 0;
        }
        stepHeat(n);
        renderAll();
      });
    }
    window.addEventListener("resize", function () {
      renderDetail();
      renderStats();
    });
    initUser();
    initTip();
    loadTopology().then(function (st) {
      if (st === "unauth") return;
      if (st !== "ok") {
        showSysBar(st === "empty"
          ? "数据库中没有节点数据，请先执行 npm run seed 写入节点基础信息"
          : "无法读取节点信息（后端或 MySQL 未就绪）");
        return;
      }
      renderAll();
      startTimer();
    });
  }


  /* ---------- 登录用户 ---------- */
  function showSysBar(msg) {
    var bar = document.getElementById("sysBar");
    if (!bar) return;
    bar.textContent = msg;
    bar.hidden = false;
  }

  function initUser() {
    fetch("/api/auth/me", { credentials: "same-origin" }).then(function (r) {
      if (r.status === 401) { location.replace("/login"); return null; }
      return r.json();
    }).then(function (j) {
      if (!j || !j.admin) return;
      var who = document.getElementById("who");
      document.getElementById("whoName").textContent = j.admin.username;
      if (j.admin.mustChangePwd) document.getElementById("whoName").title = "请修改初始密码";
      who.hidden = false;
    }).catch(function () { /* 离线预览时静默 */ });

    var btn = document.getElementById("logoutBtn");
    if (btn) btn.addEventListener("click", function () {
      btn.disabled = true;
      fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" })
        .catch(function () {})
        .then(function () { location.replace("/login"); });
    });
  }

  init();
})();
