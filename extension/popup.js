(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var currentOrigin = '';
  var currentHost = '';
  var currentTabId = null;
  var currentTabPath = '';
  var lastResults = [];
  var lastSummary = null;
  var candidates = [];
  var scanning = false;
  var CAND_CACHE_TTL = 5 * 60 * 1000;

  function sevLabel(s) {
    if (s === 'critical') return '严重';
    if (s === 'high') return '高危';
    if (s === 'medium') return '中危';
    return '信息';
  }

  function sevRank(f) {
    var base = { critical: 4, high: 3, medium: 2, info: 1 }[f.severity] || 0;
    return base + (f.hit ? 10 : 0);
  }

  function getScheme() {
    return $('useHttp').checked ? 'http' : 'https';
  }

  function updateSchemeHint() {
    if (currentHost) {
      $('originHint').textContent = '当前站点：' + getScheme() + '://' + currentHost +
        '（留空即使用；只填 host 时按左侧 http 勾选决定协议）';
    } else {
      $('originHint').textContent = '当前页面不是 http/https，请手动填写；只填 host 时按左侧 http 勾选决定协议';
    }
  }

  function getTabInfo() {
    return new Promise(function (resolve) {
      try {
        chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
          var t = tabs && tabs[0];
          if (!t || !t.url) return resolve(null);
          try {
            var u = new URL(t.url);
            if (u.protocol === 'http:' || u.protocol === 'https:') {
              return resolve({
                tabId: t.id,
                url: t.url,
                origin: u.origin,
                host: u.host,
                path: u.pathname
              });
            }
          } catch (e) {}
          resolve(null);
        });
      } catch (e) {
        resolve(null);
      }
    });
  }

  function updateRunState() {
    $('run').disabled = scanning;
  }

  function setScanning(on) {
    scanning = on;
    $('stop').disabled = !on;
    $('baseUrl').disabled = on;
    $('fillCurrent').disabled = on;
    $('intervalSec').disabled = on;
    $('useHttp').disabled = on;
    $('refreshCandidates').disabled = on;
    updateRunState();
  }

  function flash(btn, text) {
    var old = btn.textContent;
    btn.textContent = text || '已复制';
    setTimeout(function () { btn.textContent = old; }, 1200);
  }

  function copyText(text, btn) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        flash(btn);
      }, function () {
        fallbackCopy(text, btn);
      });
    } else {
      fallbackCopy(text, btn);
    }
  }

  function fallbackCopy(text, btn) {
    var ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (e) {}
    document.body.removeChild(ta);
    flash(btn);
  }

  /* =====================================================================
   * 自行判断 baseURL 路径
   * 来源：当前页面路径、DOM 标签属性、performance 资源、内联脚本、外部 JS
   * ===================================================================== */

  /* 这个函数会被 chrome.scripting.executeScript 序列化到页面里执行，
   * 不能引用外部变量。 */
  function collectFromPageInjected() {
    var out = { pagePath: '', hrefs: [], scripts: [], perf: [], inline: [] };
    try {
      out.pagePath = location.pathname || '';

      var attrs = [
        ['a', 'href'], ['link', 'href'], ['script', 'src'], ['form', 'action'],
        ['img', 'src'], ['iframe', 'src'], ['source', 'src'], ['video', 'src']
      ];
      for (var i = 0; i < attrs.length; i++) {
        var nodes = document.querySelectorAll(attrs[i][0] + '[' + attrs[i][1] + ']');
        for (var j = 0; j < nodes.length && out.hrefs.length < 400; j++) {
          var v = nodes[j].getAttribute(attrs[i][1]);
          if (v) out.hrefs.push(v);
        }
      }

      var scripts = document.querySelectorAll('script[src]');
      for (var k = 0; k < scripts.length && out.scripts.length < 40; k++) {
        if (scripts[k].src) out.scripts.push(scripts[k].src);
      }

      var inline = document.querySelectorAll('script:not([src])');
      var re = /["'`](\/(?![\/])[^"'`\s<>]{1,180})["'`]/g;
      for (var s = 0; s < inline.length; s++) {
        var text = (inline[s].textContent || '').slice(0, 200000);
        if (!text) continue;
        re.lastIndex = 0;
        var m;
        while ((m = re.exec(text)) !== null && out.inline.length < 500) {
          out.inline.push(m[1]);
        }
      }

      try {
        var entries = performance.getEntriesByType('resource');
        for (var e = 0; e < entries.length && out.perf.length < 400; e++) {
          if (entries[e].name) out.perf.push(entries[e].name);
        }
      } catch (err) {}
    } catch (err) {}
    return out;
  }

  var STATIC_ANY = {
    'static': 1, 'assets': 1, 'asset': 1, 'css': 1, 'js': 1, 'img': 1,
    'image': 1, 'images': 1, 'font': 1, 'fonts': 1, 'media': 1,
    'favicon.ico': 1, 'webjars': 1, 'node_modules': 1, 'src': 1,
    'public': 1, 'dist': 1, 'build': 1, '_next': 1, 'chunks': 1,
    'locales': 1, 'i18n': 1, 'polyfills': 1, 'runtime': 1, 'vendor': 1,
    'common': 1, 'main': 1
  };

  var SENSITIVE_FIRST = {
    'actuator': 1, 'swagger': 1, 'swagger-ui': 1, 'swagger-resources': 1,
    'druid': 1, 'api-docs': 1, 'openapi': 1, 'doc': 1, 'docs': 1,
    'v2': 1, 'v3': 1, 'h2-console': 1, 'jolokia': 1, 'env': 1,
    'health': 1, 'login': 1, 'logout': 1
  };

  var SOURCE_WEIGHT = { page: 2, dom: 1, perf: 3, inline: 2, js: 2 };

  function normalizePath(raw) {
    var s = String(raw || '').trim();
    if (!s) return '';

    if (/^(https?:)?\/\//i.test(s)) {
      try {
        var u = new URL(s, currentOrigin || 'http://placeholder');
        if (currentOrigin && u.origin !== currentOrigin) return '';
        s = u.pathname;
      } catch (e) {
        return '';
      }
    } else if (s.charAt(0) !== '/') {
      if (!/^[A-Za-z0-9_.-]+\//.test(s)) return '';
      s = '/' + s;
    }

    s = s.split('?')[0].split('#')[0];
    if (s.charAt(0) !== '/') return '';
    return s;
  }

  function validSegment(seg, isFirst) {
    if (!seg || seg.length > 40) return false;
    if (seg === '.' || seg === '..') return false;
    if (/[{}()\[\],;|\\<>"'`$*%\s]/.test(seg)) return false;
    if (/\.(js|mjs|css|map|png|jpe?g|gif|svg|ico|webp|bmp|woff2?|ttf|eot|otf|mp4|webm|mp3|wav|json|xml|txt)$/i.test(seg)) return false;

    var low = seg.toLowerCase();
    if (STATIC_ANY[low]) return false;
    if (isFirst && SENSITIVE_FIRST[low]) return false;
    return true;
  }

  function addPath(raw, source, map) {
    var p = normalizePath(raw);
    if (!p || p === '/') return;

    var segs = p.split('/').filter(Boolean);
    if (!segs.length) return;

    var max = Math.min(segs.length, 2);
    for (var i = 1; i <= max; i++) {
      var parts = segs.slice(0, i);
      var ok = true;
      for (var j = 0; j < parts.length; j++) {
        if (!validSegment(parts[j], j === 0)) { ok = false; break; }
      }
      if (!ok) continue;

      var cand = '/' + parts.join('/');
      var rec = map[cand] || (map[cand] = { path: cand, count: 0, score: 0, sources: {} });
      rec.count++;
      rec.score += SOURCE_WEIGHT[source] || 1;
      rec.sources[source] = (rec.sources[source] || 0) + 1;
    }
  }

  function extractFromPageData(data, map) {
    if (!data) return;
    if (data.pagePath) addPath(data.pagePath, 'page', map);
    (data.hrefs || []).forEach(function (v) { addPath(v, 'dom', map); });
    (data.perf || []).forEach(function (v) { addPath(v, 'perf', map); });
    (data.inline || []).forEach(function (v) { addPath(v, 'inline', map); });
  }

  function finalizeCandidates(map) {
    /* 当前页面路径的前缀最可能是应用上下文路径，给一个高权重 */
    var pagePrefix = {};
    var pageSegs = String(currentTabPath || '').split('/').filter(Boolean);
    for (var i = 1; i <= Math.min(pageSegs.length, 2); i++) {
      pagePrefix['/' + pageSegs.slice(0, i).join('/')] = 1;
    }

    var arr = Object.keys(map).map(function (k) { return map[k]; });
    arr.forEach(function (item) {
      if (pagePrefix[item.path]) item.score += 20;
    });

    arr.sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      if (a.path.length !== b.path.length) return a.path.length - b.path.length;
      return a.path.localeCompare(b.path);
    });
    return arr.slice(0, 30);
  }

  function sourceLabel(sources) {
    var labels = {
      page: '当前路径', dom: '页面标签', perf: '资源请求',
      inline: '内联脚本', js: 'JS文件'
    };
    return Object.keys(sources || {}).map(function (k) {
      return labels[k] || k;
    }).join(' / ');
  }

  function readCappedText(res, max) {
    if (!res.body || !res.body.getReader) {
      return res.text().then(function (t) {
        return (t || '').slice(0, max);
      }).catch(function () { return ''; });
    }

    var reader = res.body.getReader();
    var chunks = [];
    var total = 0;

    function pump() {
      if (total >= max) return Promise.resolve();
      return reader.read().then(function (step) {
        if (step.done) return;
        chunks.push(step.value);
        total += step.value.length;
        return pump();
      });
    }

    return pump()
      .then(function () { return reader.cancel().catch(function () {}); })
      .then(function () {
        var merged = new Uint8Array(total);
        var off = 0;
        chunks.forEach(function (c) { merged.set(c, off); off += c.length; });
        return new TextDecoder('utf-8', { fatal: false }).decode(merged.subarray(0, max));
      })
      .catch(function () { return ''; });
  }

  function fetchScriptText(url, timeoutMs) {
    var ctrl = new AbortController();
    var timer = setTimeout(function () {
      try { ctrl.abort(); } catch (e) {}
    }, timeoutMs);

    return fetch(url, {
      credentials: 'omit',
      cache: 'no-store',
      signal: ctrl.signal
    })
      .then(function (res) {
        if (!res.ok) return '';
        return readCappedText(res, 512 * 1024);
      })
      .catch(function () { return ''; })
      .then(function (text) {
        clearTimeout(timer);
        return text;
      });
  }

  function isSameOrigin(u) {
    if (!currentOrigin) return false;
    try {
      return new URL(u, currentOrigin).origin === currentOrigin;
    } catch (e) {
      return false;
    }
  }

  function injectCollector(tabId) {
    return new Promise(function (resolve) {
      try {
        if (typeof browser !== 'undefined' && browser.scripting && browser.scripting.executeScript) {
          browser.scripting.executeScript({
            target: { tabId: tabId },
            func: collectFromPageInjected
          }).then(function (results) {
            resolve(results);
          }).catch(function () {
            resolve(null);
          });
          return;
        }

        chrome.scripting.executeScript({
          target: { tabId: tabId },
          func: collectFromPageInjected
        }, function (results) {
          if (chrome.runtime && chrome.runtime.lastError) {
            resolve(null);
            return;
          }
          resolve(results);
        });
      } catch (e) {
        resolve(null);
      }
    });
  }

  function saveCandidateCache(items) {
    try {
      chrome.storage.local.get(['spb_candidates'], function (data) {
        var all = (data && data.spb_candidates) || {};
        all[currentOrigin] = { time: Date.now(), items: items };

        var keys = Object.keys(all);
        if (keys.length > 20) {
          keys.sort(function (a, b) { return (all[a].time || 0) - (all[b].time || 0); });
          while (keys.length > 20) delete all[keys.shift()];
        }
        chrome.storage.local.set({ spb_candidates: all });
      });
    } catch (e) {}
  }

  function doExtract(tabId) {
    return injectCollector(tabId).then(function (results) {
      var data = results && results[0] && results[0].result;
      var map = {};

      if (data) {
        extractFromPageData(data, map);
      } else if (currentTabPath) {
        addPath(currentTabPath, 'page', map);
      }

      var scriptUrls = [];
      if (data) {
        (data.scripts || []).forEach(function (u) {
          if (isSameOrigin(u)) scriptUrls.push(u);
        });
        (data.perf || []).forEach(function (u) {
          try {
            var uu = new URL(u, currentOrigin);
            if (uu.origin === currentOrigin && /\.(m?js)$/i.test(uu.pathname)) {
              scriptUrls.push(u);
            }
          } catch (e) {}
        });
      }

      var seen = {};
      var uniq = [];
      scriptUrls.forEach(function (u) {
        if (seen[u]) return;
        seen[u] = 1;
        uniq.push(u);
      });
      uniq = uniq.slice(0, 8);

      var tasks = uniq.map(function (u) {
        return fetchScriptText(u, 5000).then(function (text) {
          if (!text) return;

          var m;
          var rePath = /["'`](\/(?![\/])[^"'`\s<>]{1,180})["'`]/g;
          while ((m = rePath.exec(text)) !== null) addPath(m[1], 'js', map);

          var reBase = /(?:baseURL|baseUrl|BASE_URL|API_BASE|apiBase|VITE_[A-Z0-9_]+|REACT_APP_[A-Z0-9_]+)\s*[:=]\s*["'`]([^"'`]+)["'`]/g;
          while ((m = reBase.exec(text)) !== null) addPath(m[1], 'js', map);

          var reUrl = /https?:\/\/[^\s"'`<>]+/g;
          while ((m = reUrl.exec(text)) !== null) addPath(m[0], 'js', map);
        });
      });

      return Promise.all(tasks).then(function () {
        var items = finalizeCandidates(map);
        saveCandidateCache(items);
        return items;
      });
    });
  }

  function extractCandidates(tabId, force) {
    if (!currentOrigin || tabId == null) return Promise.resolve([]);

    if (!force) {
      return new Promise(function (resolve) {
        try {
          chrome.storage.local.get(['spb_candidates'], function (data) {
            var all = (data && data.spb_candidates) || {};
            var entry = all[currentOrigin];
            if (entry && Date.now() - entry.time < CAND_CACHE_TTL) {
              resolve(entry.items || []);
            } else {
              resolve(null);
            }
          });
        } catch (e) {
          resolve(null);
        }
      }).then(function (cached) {
        if (cached !== null) return cached;
        return doExtract(tabId);
      });
    }

    return doExtract(tabId);
  }

  function renderCandidates(items) {
    var host = $('candidateList');
    host.textContent = '';
    candidates = items || [];

    if (!candidates.length) {
      var empty = document.createElement('span');
      empty.className = 'cand-empty';
      empty.textContent = currentHost ? '未发现可用的 baseURL 路径，可手动填写' : '当前页面不是 http/https';
      host.appendChild(empty);
      return;
    }

    candidates.forEach(function (item) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cand-item';
      btn.title = '来源: ' + sourceLabel(item.sources) + ' · 出现 ' + item.count + ' 次';
      btn.appendChild(document.createTextNode(item.path));

      var cnt = document.createElement('span');
      cnt.className = 'cand-count';
      cnt.textContent = '×' + item.count;
      btn.appendChild(cnt);

      btn.addEventListener('click', function () {
        if (scanning) return;
        if (!currentHost) {
          alert('当前页面不是 http/https，无法确定 host');
          return;
        }
        $('baseUrl').value = getScheme() + '://' + currentHost + item.path;
      });

      host.appendChild(btn);
    });
  }

  function loadCandidates(force) {
    var host = $('candidateList');
    host.textContent = '';

    var loading = document.createElement('span');
    loading.className = 'cand-empty';
    loading.textContent = currentHost ? '正在提取…' : '当前页面不是 http/https';
    host.appendChild(loading);

    if (!currentHost) return;

    extractCandidates(currentTabId, !!force).then(function (items) {
      renderCandidates(items);
    }).catch(function () {
      renderCandidates([]);
    });
  }

  /* ===================================================================== */

  function renderFinding(f) {
    var box = document.createElement('div');
    box.className = 'finding sev-' + f.severity + (f.protected ? ' protected' : '');

    var head = document.createElement('div');
    head.className = 'f-head';

    var badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = f.hit ? sevLabel(f.severity) : (f.protected ? '受保护' : '信息');

    var name = document.createElement('span');
    name.className = 'f-name';
    name.textContent = f.name + (f.bypass ? ' · 绕过命中' : '');

    head.appendChild(badge);
    head.appendChild(name);

    var meta = document.createElement('div');
    meta.className = 'f-meta';
    meta.textContent = String(f.status || 'ERR') + ' · ' + (f.variant || f.path) +
      (f.dangerous ? ' · 仅只读探测' : '');

    var actions = document.createElement('div');
    actions.className = 'f-actions';

    var openBtn = document.createElement('button');
    openBtn.type = 'button';
    openBtn.textContent = '打开';
    openBtn.addEventListener('click', function () {
      if (!/^https?:\/\//i.test(f.url)) return;
      try { chrome.tabs.create({ url: f.url }); } catch (e) {}
    });

    var copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.textContent = '复制URL';
    copyBtn.addEventListener('click', function () {
      copyText(f.url, copyBtn);
    });

    actions.appendChild(openBtn);
    actions.appendChild(copyBtn);

    box.appendChild(head);
    box.appendChild(meta);

    if (f.evidence) {
      var ev = document.createElement('pre');
      ev.className = 'f-evidence';
      ev.textContent = f.evidence;
      box.appendChild(ev);
    }

    box.appendChild(actions);
    return box;
  }

  function renderResults() {
    var host = $('results');
    host.textContent = '';

    var showProtected = $('showProtected').checked;
    var list = lastResults.filter(function (f) {
      return f.hit || (showProtected && f.protected);
    });

    list.sort(function (a, b) {
      var d = sevRank(b) - sevRank(a);
      if (d !== 0) return d;
      return String(a.path).localeCompare(String(b.path));
    });

    if (!list.length) {
      var p = document.createElement('div');
      p.className = 'empty';
      p.textContent = lastResults.length
        ? '没有未授权命中（可勾选“显示受保护”查看 401/403）'
        : '暂无结果';
      host.appendChild(p);
      return;
    }

    for (var i = 0; i < list.length; i++) host.appendChild(renderFinding(list[i]));
  }

  function renderSummary(summary) {
    if (!summary) return;
    lastSummary = summary;

    var parts = [];
    parts.push('BaseURL: ' + summary.base);
    parts.push('请求 ' + summary.requests);
    parts.push('命中 ' + summary.hits);
    parts.push('受保护 ' + summary.protected);
    if (summary.errors) parts.push('错误 ' + summary.errors);
    $('progress').textContent = parts.join(' · ');

    $('fingerprint').textContent = summary.fingerprints && summary.fingerprints.length
      ? '指纹: ' + summary.fingerprints.join(' / ')
      : '';
  }

  function updateResultButtons() {
    var has = lastResults.length > 0;
    $('copy').disabled = !has;
    $('exportMd').disabled = !has;
    $('exportCsv').disabled = !has;
  }

  function reportFileName(ext) {
    var host = currentHost || 'target';
    var d = new Date();
    function pad(n) { return (n < 10 ? '0' : '') + n; }
    var stamp = d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' +
      pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
    return 'spb-' + host.replace(/[^A-Za-z0-9.-]+/g, '_') + '-' + stamp + '.' + ext;
  }

  function downloadFile(name, text, mime) {
    try {
      var blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      setTimeout(function () {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 1000);
    } catch (e) {
      alert('导出失败：' + (e && e.message ? e.message : e));
    }
  }

  function saveState(base, summary) {
    try {
      chrome.storage.local.set({
        spb_last: {
          time: Date.now(),
          base: base || '',
          summary: summary || null,
          results: lastResults.slice(0, 500)
        }
      });
    } catch (e) {}
  }

  function renderHistory(arr) {
    var dl = $('baseHistory');
    if (!dl) return;
    dl.textContent = '';
    (arr || []).forEach(function (v) {
      var o = document.createElement('option');
      o.value = v;
      dl.appendChild(o);
    });
  }

  function loadHistory() {
    try {
      chrome.storage.local.get(['spb_history'], function (data) {
        renderHistory((data && data.spb_history) || []);
      });
    } catch (e) {}
  }

  function saveHistory(base) {
    if (!base) return;
    try {
      chrome.storage.local.get(['spb_history'], function (data) {
        var arr = Array.isArray(data && data.spb_history) ? data.spb_history.slice() : [];
        arr = arr.filter(function (x) { return x !== base; });
        arr.unshift(base);
        arr = arr.slice(0, 10);
        chrome.storage.local.set({ spb_history: arr });
        renderHistory(arr);
      });
    } catch (e) {}
  }

  function restoreState() {
    try {
      chrome.storage.local.get(['spb_last'], function (data) {
        var s = data && data.spb_last;
        if (!s || !s.results) return;
        lastResults = s.results || [];
        renderResults();
        if (s.summary) renderSummary(s.summary);
        else if (s.time) $('progress').textContent = '上次扫描: ' + new Date(s.time).toLocaleString();
        updateResultButtons();
      });
    } catch (e) {}
  }

  function clearState() {
    lastResults = [];
    lastSummary = null;
    $('results').textContent = '';
    $('progress').textContent = '';
    $('fingerprint').textContent = '';
    updateResultButtons();
    try { chrome.storage.local.remove('spb_last'); } catch (e) {}
  }

  function startScan() {
    if (scanning) return;

    var input = $('baseUrl').value.trim();
    if (!input && !currentOrigin) {
      alert('请填写 BaseURL，或先在 http/https 页面打开插件');
      return;
    }

    var intervalSec = Number($('intervalSec').value);
    if (!isFinite(intervalSec) || intervalSec < 0) intervalSec = 0;
    if (intervalSec > 30) intervalSec = 30;

    lastResults = [];
    lastSummary = null;
    $('results').textContent = '';
    $('progress').textContent = '准备中…';
    $('fingerprint').textContent = '';
    updateResultButtons();
    setScanning(true);

    window.SPB.scan({
      baseUrl: input,
      fallbackOrigin: currentOrigin,
      scheme: getScheme(),
      useBypass: $('useBypass').checked,
      intervalMs: Math.round(intervalSec * 1000)
    }, {
      onProgress: function (st) {
        $('progress').textContent = '请求 ' + st.done + '/' + st.total +
          ' · 命中 ' + st.hits + ' · 受保护 ' + st.protected +
          ' · 实际 ' + st.requests;
      },
      onFinding: function (f) {
        lastResults.push(f);
        renderResults();
        updateResultButtons();
      }
    }).then(function (out) {
      renderSummary(out.summary);
      saveState(out.summary.base, out.summary);
      saveHistory(out.summary.base);
      updateResultButtons();
    }).catch(function (e) {
      $('progress').textContent = '出错：' + ((e && e.message) ? e.message : e);
    }).then(function () {
      setScanning(false);
    });
  }

  function init() {
    getTabInfo().then(function (info) {
      if (info) {
        currentOrigin = info.origin;
        currentHost = info.host;
        currentTabId = info.tabId;
        currentTabPath = info.path;
      }
      updateSchemeHint();
      loadCandidates(false);
    });

    $('fillCurrent').addEventListener('click', function () {
      if (currentHost) $('baseUrl').value = getScheme() + '://' + currentHost;
    });

    $('useHttp').addEventListener('change', function () {
      var v = $('baseUrl').value.trim();
      if (/^[a-z][a-z0-9+.-]*:\/\//i.test(v)) {
        $('baseUrl').value = v.replace(/^[a-z][a-z0-9+.-]*:\/\//i, getScheme() + '://');
      }
      updateSchemeHint();
    });

    $('refreshCandidates').addEventListener('click', function () {
      loadCandidates(true);
    });

    $('showProtected').addEventListener('change', renderResults);
    $('run').addEventListener('click', startScan);

    $('stop').addEventListener('click', function () {
      window.SPB.stop();
      $('progress').textContent = '正在停止…';
    });

    $('copy').addEventListener('click', function () {
      copyText(JSON.stringify(lastResults, null, 2), $('copy'));
    });

    $('exportMd').addEventListener('click', function () {
      if (!window.SPB_REPORT) return;
      downloadFile(
        reportFileName('md'),
        window.SPB_REPORT.toMarkdown(lastSummary, lastResults),
        'text/markdown;charset=utf-8'
      );
    });

    $('exportCsv').addEventListener('click', function () {
      if (!window.SPB_REPORT) return;
      downloadFile(
        reportFileName('csv'),
        window.SPB_REPORT.toCsv(lastResults),
        'text/csv;charset=utf-8'
      );
    });

    $('clear').addEventListener('click', clearState);

    updateRunState();
    restoreState();
    loadHistory();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
