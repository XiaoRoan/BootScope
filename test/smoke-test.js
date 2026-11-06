/* 本地冒烟测试：
 *   1) Spring Boot mock：验证命中、绕过、受保护、404 不误报
 *   2) SPA mock：所有路径返回同一个 index.html，验证基线校准不误报
 * 运行: node test/smoke-test.js
 */
'use strict';

const http = require('http');
const assert = require('assert');

global.window = global;
require('../extension/lib/dict.js');
require('../extension/lib/variants.js');
require('../extension/lib/detect.js');
require('../extension/lib/scanner.js');
require('../extension/lib/report.js');

/* ---------- 导出模块单元测试 ---------- */
(function testReport() {
  const sample = [{
    severity: 'high', hit: true, protected: false, category: 'actuator',
    name: 'Env 环境变量/配置', method: 'GET', status: 200,
    path: '/actuator/env', variant: '', bypass: false,
    url: 'http://127.0.0.1/actuator/env', contentType: 'application/json',
    evidence: '{"a":1,"b":"x,y"}', note: ''
  }, {
    severity: 'info', hit: false, protected: true, category: 'actuator',
    name: 'Beans', method: 'GET', status: 401,
    path: '/actuator/beans', variant: '', bypass: false,
    url: 'http://127.0.0.1/actuator/beans', contentType: 'application/json',
    evidence: 'HTTP 401', note: ''
  }];

  const md = window.SPB_REPORT.toMarkdown(
    { base: 'http://127.0.0.1', requests: 2, hits: 1, protected: 1, fingerprints: ['Boot'] },
    sample
  );
  assert(md.indexOf('# Spring Boot 未授权自检报告') === 0, 'Markdown 标题不正确');
  assert(md.indexOf('/actuator/env') !== -1, 'Markdown 缺少路径');
  assert(md.indexOf('受保护') !== -1, 'Markdown 缺少受保护结果');
  assert(md.indexOf('http://127.0.0.1') !== -1, 'Markdown 缺少 BaseURL');

  const csv = window.SPB_REPORT.toCsv(sample);
  assert(csv.charCodeAt(0) === 0xFEFF, 'CSV 缺少 BOM');
  assert(csv.slice(1).indexOf('"severity","result"') === 0, 'CSV 表头不正确');
  assert(csv.indexOf('"Env 环境变量/配置"') !== -1, 'CSV 缺少名称字段');

  console.log('report OK');
})();

function boot404(pathname) {
  return JSON.stringify({
    timestamp: '2026-01-01T00:00:00.000+00:00',
    status: 404,
    error: 'Not Found',
    path: pathname
  });
}

const ROUTES = {
  '/actuator': ['200', 'application/json', JSON.stringify({ _links: { self: { href: '/actuator' } } })],
  '/actuator/health': ['200', 'application/json', '{"status":"UP"}'],
  '/actuator/env': ['403', 'application/json', '{"timestamp":"2026-01-01T00:00:00.000+00:00","status":403,"error":"Forbidden","path":"/actuator/env"}'],
  '/actuator/env;.js': ['200', 'application/json', '{"activeProfiles":[],"propertySources":[{"name":"systemEnvironment","properties":{}}]}'],
  '/actuator/beans': ['403', 'application/json', '{"timestamp":"2026-01-01T00:00:00.000+00:00","status":403,"error":"Forbidden","path":"/actuator/beans"}'],
  '/actuator/%62eans': ['200', 'application/json', '{"contexts":{"application":{"beans":{"demo":{"type":"Demo","scope":"singleton"}}}}}'],
  '/actuator/heapdump': ['200', 'application/octet-stream', 'JAVA PROFILE 1.0.2\nFAKE'],
  '/actuator/jolokia': ['200', 'application/json', '{"agent":"1.6.2","protocol":"7.2","config":{},"info":{}}'],
  '/v3/api-docs': ['200', 'application/json', '{"openapi":"3.0.1","info":{"title":"x","version":"1"},"paths":{"/admin/users":{"get":{}}}}'],
  '/doc.html': ['200', 'text/html', '<html><head><title>knife4j</title></head><body>knife4j</body></html>'],
  '/druid/index.html': ['200', 'text/html', '<html><head><title>Druid Stat Index</title></head></html>'],
  '/druid/websession.html': ['200', 'text/html', '<html><body>druid Web Session</body></html>'],
  '/swagger-ui.html': ['200', 'text/html', '<html><body>Swagger UI</body></html>']
};

function makeBootServer() {
  return http.createServer((req, res) => {
    const url = req.url.split('?')[0];
    const hit = ROUTES[url];

    res.setHeader('Connection', 'close');

    if (hit) {
      res.writeHead(Number(hit[0]), { 'content-type': hit[1] });
      res.end(hit[2]);
      return;
    }

    /* 模拟真实 Spring Boot 404：错误 JSON 的 path 会回显请求路径 */
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(boot404(url));
  });
}

function makeSpaServer() {
  const html = '<!doctype html><html><head><title>My App</title></head><body><div id="app"></div></body></html>';
  return http.createServer((req, res) => {
    res.setHeader('Connection', 'close');
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(html);
  });
}

/* 软 404：200 + 模板回显请求路径 */
function makeSoft404Server() {
  return http.createServer((req, res) => {
    const url = req.url.split('?')[0];
    res.setHeader('Connection', 'close');
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><html><head><title>Not Found</title></head><body>' +
      '<h1>页面不存在</h1><p>Path: ' + url + '</p></body></html>');
  });
}

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

function close(server) {
  return new Promise((resolve) => {
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
    server.close(() => resolve());
  });
}

function runScan(port) {
  return window.SPB.scan({
    baseUrl: 'http://127.0.0.1:' + port,
    useBypass: true,
    concurrency: 4,
    budget: 800,
    timeoutMs: 3000,
    intervalMs: 0,
    variantLimit: 16
  }, {
    onProgress: () => {},
    onFinding: () => {}
  });
}

(async () => {
  let boot = null;
  let spa = null;
  let soft = null;

  try {
    /* ---------- 1. Spring Boot ---------- */
    boot = makeBootServer();
    const port1 = await listen(boot);
    const out1 = await runScan(port1);

    const hits = out1.findings.filter((f) => f.hit);
    const sigs = hits.map((f) => f.sig);

    console.log('requests:', out1.summary.requests);
    console.log('hits:', hits.length, sigs.join(','));
    console.log('protected:', out1.summary.protected);
    console.log('fingerprints:', out1.summary.fingerprints.join(' | '));

    assert(hits.every((f) => f.status === 200), '命中必须来自 200 响应');
    assert(!hits.some((f) => f.sig === 'druid_sql' || f.sig === 'druid_login'), '404 错误页不应误报 Druid 子页');
    assert(hits.some((f) => f.sig === 'actuator_index'), 'actuator index 未命中');
    assert(hits.some((f) => f.sig === 'health'), 'health 未命中');
    assert(hits.some((f) => f.sig === 'env' && f.bypass), 'env 绕过未命中');
    assert(hits.some((f) => f.sig === 'beans' && f.bypass), '非关键 actuator 路径的 URL 编码绕过未命中');
    assert(hits.some((f) => f.sig === 'heapdump'), 'heapdump 未命中');
    assert(hits.some((f) => f.sig === 'jolokia'), 'jolokia 未命中');
    assert(hits.some((f) => f.sig === 'openapi3'), 'openapi3 未命中');
    assert(hits.some((f) => f.sig === 'knife4j'), 'knife4j 未命中');
    assert(hits.some((f) => f.sig === 'druid_index'), 'druid index 未命中');
    assert(out1.findings.some((f) => f.protected && f.sig === 'env'), 'env 直连 403 未记录为受保护');
    assert(out1.summary.fingerprints.length > 0, '未识别到 Spring Boot 指纹');

    await close(boot);
    boot = null;

    /* ---------- 2. SPA 回退 ---------- */
    spa = makeSpaServer();
    const port2 = await listen(spa);
    const out2 = await runScan(port2);
    const spaHits = out2.findings.filter((f) => f.hit);

    console.log('spa requests:', out2.summary.requests);
    console.log('spa hits:', spaHits.length);
    assert.strictEqual(spaHits.length, 0, 'SPA 回退不应有命中');

    await close(spa);
    spa = null;

    /* ---------- 3. 软 404（200 且回显路径） ---------- */
    soft = makeSoft404Server();
    const port3 = await listen(soft);
    const out3 = await runScan(port3);
    const softHits = out3.findings.filter((f) => f.hit);

    console.log('soft404 requests:', out3.summary.requests);
    console.log('soft404 hits:', softHits.length);
    assert.strictEqual(softHits.length, 0, '软 404 不应有命中');

    await close(soft);
    soft = null;

    /* ---------- 4. 间隔设置：intervalMs > 0 时应串行 ---------- */
    boot = makeBootServer();
    const port4 = await listen(boot);

    const originalDict = window.SPB_DICT;
    window.SPB_DICT = originalDict.slice(0, 3);

    const t0 = Date.now();
    const out4 = await window.SPB.scan({
      baseUrl: 'http://127.0.0.1:' + port4,
      useBypass: false,
      concurrency: 5,
      budget: 100,
      timeoutMs: 3000,
      intervalMs: 400
    }, {
      onProgress: () => {},
      onFinding: () => {}
    });
    const elapsed = Date.now() - t0;
    window.SPB_DICT = originalDict;

    console.log('interval elapsed:', elapsed, 'ms, requests:', out4.summary.requests);
    assert.strictEqual(out4.summary.requests, 4, '间隔测试请求数应为 4（基线 + 3 路径）');
    assert(elapsed >= 1100, '设置间隔后应串行等待每个路径');

    await close(boot);
    boot = null;

    /* ---------- 5. 只填 host：https 连不上自动回落 http ---------- */
    boot = makeBootServer();
    const port5 = await listen(boot);

    const out5 = await window.SPB.scan({
      baseUrl: '127.0.0.1:' + port5,
      useBypass: false,
      concurrency: 4,
      budget: 200,
      timeoutMs: 3000,
      intervalMs: 0,
      variantLimit: 0
    }, {
      onProgress: () => {},
      onFinding: () => {}
    });

    console.log('scheme fallback base:', out5.summary.base);
    assert(out5.summary.base.indexOf('http://127.0.0.1:' + port5) === 0, '应自动回落到 http');
    assert(out5.findings.some((f) => f.hit && f.sig === 'actuator_index'), '回落 http 后应能命中');

    await close(boot);
    boot = null;

    /* ---------- 6. 只填 host：沿用当前标签页的协议和端口 ---------- */
    boot = makeBootServer();
    const port6 = await listen(boot);

    const out6 = await window.SPB.scan({
      baseUrl: '127.0.0.1',
      fallbackOrigin: 'http://127.0.0.1:' + port6,
      useBypass: false,
      concurrency: 4,
      budget: 200,
      timeoutMs: 3000,
      intervalMs: 0,
      variantLimit: 0
    }, {
      onProgress: () => {},
      onFinding: () => {}
    });

    console.log('tab origin base:', out6.summary.base);
    assert.strictEqual(out6.summary.base, 'http://127.0.0.1:' + port6, '应沿用当前标签页的协议和端口');
    assert(out6.findings.some((f) => f.hit && f.sig === 'actuator_index'), '沿用标签页 origin 后应能命中');

    await close(boot);
    boot = null;

    /* ---------- 7. 弹窗 http 勾选：覆盖输入里的 https ---------- */
    boot = makeBootServer();
    const port7 = await listen(boot);

    const out7 = await window.SPB.scan({
      baseUrl: 'https://127.0.0.1:' + port7,
      scheme: 'http',
      useBypass: false,
      concurrency: 4,
      budget: 200,
      timeoutMs: 3000,
      intervalMs: 0,
      variantLimit: 0
    }, {
      onProgress: () => {},
      onFinding: () => {}
    });

    console.log('scheme override base:', out7.summary.base);
    assert.strictEqual(out7.summary.base, 'http://127.0.0.1:' + port7, '勾选 http 后应覆盖输入的 https');
    assert(out7.findings.some((f) => f.hit && f.sig === 'actuator_index'), '覆盖为 http 后应能命中');

    await close(boot);
    boot = null;

    /* ---------- 8. BaseURL 留空：只取 host，不继承当前页面路径 ---------- */
    boot = makeBootServer();
    const port8 = await listen(boot);

    const out8 = await window.SPB.scan({
      baseUrl: '',
      fallbackOrigin: 'http://127.0.0.1:' + port8 + '/bauuu/page',
      scheme: 'http',
      useBypass: false,
      concurrency: 4,
      budget: 200,
      timeoutMs: 3000,
      intervalMs: 0,
      variantLimit: 0
    }, {
      onProgress: () => {},
      onFinding: () => {}
    });

    console.log('blank base:', out8.summary.base);
    assert.strictEqual(out8.summary.base, 'http://127.0.0.1:' + port8, '留空应只取 host，不带页面路径');
    assert(out8.findings.some((f) => f.hit && f.sig === 'actuator_index'), '留空取 host 后应能命中');

    await close(boot);
    boot = null;

    console.log('\nOK');
    process.exitCode = 0;
  } catch (e) {
    console.error('FAIL:', (e && e.stack) || e);
    process.exitCode = 1;
  } finally {
    if (boot) await close(boot);
    if (spa) await close(spa);
    if (soft) await close(soft);
  }
})();
