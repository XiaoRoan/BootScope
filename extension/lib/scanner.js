/* Spring Boot 未授权自检 - 扫描引擎
 * 运行在扩展页面（popup）里，用 fetch 直接请求目标。
 * 默认只读 GET、不带 Cookie，用来判断“未授权可访问”。
 */
(function () {
  'use strict';

  var DEFAULTS = {
    concurrency: 5,
    timeoutMs: 8000,
    budget: 1000,
    variantLimit: 30,
    encodingLimit: 16,
    intervalMs: 1000,
    scheme: ''
  };

  var stopped = false;
  var controllers = new Set();
  var requestCount = 0;
  var activeCfg = null;
  var hooks = {};
  var progressState = { done: 0, total: 0, hits: 0, protected: 0, requests: 0 };

  function sleep(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  function emitProgress() {
    progressState.requests = requestCount;
    if (hooks.onProgress) {
      try { hooks.onProgress(Object.assign({}, progressState)); } catch (e) {}
    }
  }

  /* 返回 { base, allowHttpFallback }
   * scheme: 'http' | 'https' | ''，来自弹窗的 http 勾选框，优先级最高。
   * - 留空：使用当前标签页的 host/端口，协议按 scheme 或当前页面
   * - 只填 host：协议按 scheme；没有 scheme 时若与当前标签页同 host，沿用其协议
   * - 显式写了协议：仍以 scheme 为准；没有 scheme 时用输入里的协议
   * allowHttpFallback 为 true 表示当前是按 https 发起，网络层失败时可以试 http。 */
  function normBase(input, fallbackOrigin, scheme) {
    var s = (input || '').trim();
    var opt = (scheme === 'http' || scheme === 'https') ? scheme : '';
    var chosen = '';

    if (!s) {
      if (!fallbackOrigin) throw new Error('请填写 BaseURL，或先在 http/https 页面打开插件');
      var fo;
      try { fo = new URL(fallbackOrigin); } catch (e) { throw new Error('当前页面地址不合法'); }
      chosen = opt || (fo.protocol === 'http:' ? 'http' : 'https');
      /* 留空只取 host:port，不把当前页面路径带进去 */
      s = fo.host;
    } else {
      var m = s.match(/^([a-z][a-z0-9+.-]*):\/\//i);
      if (m) {
        var inputScheme = m[1].toLowerCase() === 'http' ? 'http' : 'https';
        chosen = opt || inputScheme;
        s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
      } else {
        var matchedHost = false;
        if (fallbackOrigin) {
          try {
            var fo2 = new URL(fallbackOrigin);
            var probe = new URL('http://' + s);
            if (probe.hostname === fo2.hostname && (!probe.port || probe.port === fo2.port)) {
              /* 用户只写了 host 时，沿用当前站点的端口 */
              if (!probe.port) probe.host = fo2.host;
              s = probe.href.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
              chosen = opt || (fo2.protocol === 'http:' ? 'http' : 'https');
              matchedHost = true;
            }
          } catch (e) {}
        }
        if (!matchedHost) chosen = opt || 'https';
      }
    }

    var u;
    try { u = new URL(chosen + '://' + s); } catch (e) { throw new Error('BaseURL 格式不正确'); }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('仅支持 http/https');

    var path = u.pathname || '/';
    if (path === '/') path = '';
    path = path.replace(/\/+$/, '');

    /* 弹窗显式给了 scheme（http 勾选框）就以它为准，不再自动回落；
     * 只有程序化调用、没给 scheme 时才保留 https → http 的兜底。 */
    return { base: u.origin + path, allowHttpFallback: !opt && chosen === 'https' };
  }

  function join(base, suffix) {
    if (!suffix) return base;
    if (suffix.charAt(0) !== '/') suffix = '/' + suffix;
    return base + suffix;
  }

  function abortAll() {
    controllers.forEach(function (c) {
      try { c.abort(); } catch (e) {}
    });
    controllers.clear();
  }

  function maxBytesFor(entry) {
    if (entry.sig === 'heapdump') return 64;
    if (entry.sig === 'logfile') return 8192;
    return 131072;
  }

  function readCapped(res, maxBytes) {
    if (!res.body || !res.body.getReader) {
      return Promise.resolve({ text: '', bytes: new Uint8Array(0) });
    }

    var reader = res.body.getReader();
    var chunks = [];
    var total = 0;

    function pump() {
      if (total >= maxBytes) return Promise.resolve();
      return reader.read().then(function (step) {
        if (step.done) return;
        chunks.push(step.value);
        total += step.value.length;
        return pump();
      });
    }

    return pump()
      .then(function () {
        return reader.cancel().catch(function () {});
      })
      .then(function () {
        var merged = new Uint8Array(total);
        var off = 0;
        chunks.forEach(function (c) {
          merged.set(c, off);
          off += c.length;
        });
        var slice = merged.subarray(0, Math.min(maxBytes, merged.length));
        return {
          text: new TextDecoder('utf-8', { fatal: false }).decode(slice),
          bytes: slice
        };
      })
      .catch(function () {
        return { text: '', bytes: new Uint8Array(0) };
      });
  }

  function fetchProbe(url, maxBytes) {
    if (stopped) {
      return Promise.resolve({ ok: false, status: 0, skipped: true, error: '已停止' });
    }
    if (requestCount >= activeCfg.budget) {
      return Promise.resolve({ ok: false, status: 0, skipped: true, error: '已达请求上限' });
    }

    requestCount++;
    var ctrl = new AbortController();
    controllers.add(ctrl);
    var timer = setTimeout(function () {
      try { ctrl.abort(); } catch (e) {}
    }, activeCfg.timeoutMs);

    return fetch(url, {
      method: 'GET',
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'follow',
      headers: { 'Accept': '*/*' },
      signal: ctrl.signal
    })
      .then(function (res) {
        var ct = res.headers.get('content-type') || '';
        return readCapped(res, maxBytes).then(function (body) {
          return {
            ok: true,
            status: res.status,
            ct: ct,
            text: body.text,
            bytes: body.bytes,
            finalUrl: res.url,
            redirected: res.redirected,
            xAppContext: res.headers.get('x-application-context') || '',
            server: res.headers.get('server') || ''
          };
        });
      })
      .catch(function (e) {
        var msg;
        if (e && e.name === 'AbortError') msg = stopped ? '已停止' : '请求超时';
        else msg = String((e && e.message) || e);
        return { ok: false, status: 0, error: msg };
      })
      .then(function (out) {
        clearTimeout(timer);
        controllers.delete(ctrl);
        return out;
      });
  }

  function runPool(items, worker, concurrency) {
    var idx = 0;
    var workers = [];
    var n = Math.max(1, concurrency || 1);

    for (var i = 0; i < n; i++) {
      workers.push((async function loop() {
        while (true) {
          if (stopped) return;
          var cur = idx++;
          if (cur >= items.length) return;
          await worker(items[cur], cur);
        }
      })());
    }

    return Promise.all(workers);
  }

  function makeFinding(entry, url, res, a, bypass, variant) {
    return {
      hit: !!a.hit,
      protected: !!a.protected,
      severity: a.hit ? entry.severity : 'info',
      category: entry.category,
      name: entry.name,
      sig: entry.sig,
      path: entry.path,
      variant: variant || '',
      bypass: !!bypass,
      url: url,
      status: (res && res.status) || 0,
      contentType: (res && res.ct) || '',
      evidence: a.evidence || '',
      dangerous: !!entry.dangerous,
      note: entry.dangerous ? '状态变更端点，仅做只读探测' : ''
    };
  }

  async function scan(opts, h) {
    hooks = h || {};
    activeCfg = Object.assign({}, DEFAULTS, opts || {});
    /* 设置了间隔就严格串行，保证“跑完一个路径再等 X 秒” */
    if (activeCfg.intervalMs > 0) activeCfg.concurrency = 1;
    stopped = false;
    requestCount = 0;
    progressState = { done: 0, total: 0, hits: 0, protected: 0, requests: 0 };

    var findings = [];
    var fingerprints = new Set();
    var protectedCount = 0;
    var errorCount = 0;

    function emit(f) {
      findings.push(f);
      if (f.hit) progressState.hits++;
      if (f.protected) protectedCount++;
      emitProgress();
      if (hooks.onFinding) {
        try { hooks.onFinding(f); } catch (e) {}
      }
    }

    try {
      var baseInfo = normBase(activeCfg.baseUrl, activeCfg.fallbackOrigin, activeCfg.scheme);
      var base = baseInfo.base;
      var dict = window.SPB_DICT || [];
      if (!dict.length) throw new Error('路径字典为空');

      /* 1. 基线：随机不存在路径，用于识别 SPA 回退与软 404 */
      var rand = Math.random().toString(36).slice(2, 10);
      var baselinePath = '/__spb_' + rand + '__';
      var baselineRes = await fetchProbe(join(base, baselinePath), 65536);

      /* 只填了 host 且默认走了 https：连不上时自动回落 http */
      if (!baselineRes.ok && baselineRes.status === 0 && baseInfo.allowHttpFallback &&
          /^https:\/\//.test(base) && !stopped) {
        var httpBase = 'http://' + base.slice('https://'.length);
        var httpRes = await fetchProbe(join(httpBase, baselinePath), 65536);
        if (httpRes.ok) {
          base = httpBase;
          baselineRes = httpRes;
        }
      }

      if (!baselineRes.ok && baselineRes.status === 0) {
        if (stopped) throw new Error('已停止');
        throw new Error('目标不可达：' + (baselineRes.error || '请求失败'));
      }

      var baseline = {
        status: baselineRes.ok ? baselineRes.status : 0,
        ct: baselineRes.ok ? baselineRes.ct : '',
        hash: baselineRes.ok ? window.SPB_DETECT.textHash(baselineRes.text) : '',
        path: baselinePath,
        text: baselineRes.ok ? (baselineRes.text || '').slice(0, 65536) : ''
      };
      if (baselineRes.ok) {
        if (baselineRes.xAppContext) fingerprints.add('X-Application-Context: ' + baselineRes.xAppContext);
        if (window.SPB_DETECT.looksLikeBootError(baselineRes.text, baselineRes.status)) fingerprints.add('Spring Boot 错误 JSON');
        if ((baselineRes.text || '').indexOf('Whitelabel Error Page') !== -1) fingerprints.add('Whitelabel Error Page');
      }

      /* 2. 逐路径 fuzz：直连 +（关键路径失败时）绕过变体
       * 每个路径处理完后，按用户设置的 intervalMs 等待再跑下一个 */
      progressState.total = dict.length;
      emitProgress();

      await runPool(dict, async function (entry) {
        if (stopped) return;

        var url = join(base, entry.path);
        var res = await fetchProbe(url, maxBytesFor(entry));
        progressState.done++;

        if (res.ok && res.xAppContext) fingerprints.add('X-Application-Context: ' + res.xAppContext);
        if (res.skipped) {
          emitProgress();
          return;
        }

        var a = window.SPB_DETECT.analyze(entry, res, baseline);
        if (a.fingerprint) fingerprints.add('Spring Boot 错误页');

        if (a.hit) {
          emit(makeFinding(entry, url, res, a, false, ''));
        } else if (a.protected) {
          emit(makeFinding(entry, url, res, a, false, ''));
        } else if (!res.ok) {
          errorCount++;
        }

        /* 直连失败时跑变体：
         * - 关键路径：完整绕过 + URL 编码 / 双重编码
         * - 其他 Actuator 路径：URL 编码 / 双重编码子集 */
        var variants = [];
        if (activeCfg.useBypass && !a.hit &&
            (a.protected || !res.ok || res.status === 404 || res.status === 400 || res.status === 500)) {
          if (entry.key) {
            variants = window.SPB_VARIANTS.gen(entry.path).slice(0, activeCfg.variantLimit);
          } else if (entry.category === 'actuator' && window.SPB_VARIANTS.genEncoding) {
            variants = window.SPB_VARIANTS.genEncoding(entry.path).slice(0, activeCfg.encodingLimit);
          }
          progressState.total += variants.length;
        }
        emitProgress();

        for (var i = 0; i < variants.length; i++) {
          if (stopped) return;

          var v = variants[i];
          var vUrl = join(base, v.path);
          var res2 = await fetchProbe(vUrl, maxBytesFor(entry));
          progressState.done++;

          if (res2.skipped) {
            emitProgress();
            continue;
          }

          var a2 = window.SPB_DETECT.analyze(entry, res2, baseline);
          if (a2.hit) {
            emit(makeFinding(entry, vUrl, res2, a2, true, v.label));
          } else if (a2.fingerprint) {
            fingerprints.add('Spring Boot 错误页');
          } else if (!res2.ok) {
            errorCount++;
          }

          emitProgress();
        }

        /* 每个路径 fuzz 完，按用户设置的间隔等待 */
        if (!stopped && activeCfg.intervalMs > 0) await sleep(activeCfg.intervalMs);
      }, activeCfg.concurrency);

      var summary = {
        base: base,
        requests: requestCount,
        hits: findings.filter(function (f) { return f.hit; }).length,
        protected: protectedCount,
        errors: errorCount,
        fingerprints: Array.from(fingerprints)
      };

      emitProgress();
      if (hooks.onDone) {
        try { hooks.onDone(summary); } catch (e) {}
      }
      return { findings: findings, summary: summary };
    } finally {
      activeCfg = null;
      hooks = {};
    }
  }

  function stop() {
    stopped = true;
    abortAll();
  }

  window.SPB = { scan: scan, stop: stop };
})();
