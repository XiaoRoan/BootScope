/* 结果导出：Markdown / CSV
 * 纯函数，便于在 Node 里测试。
 */
(function () {
  'use strict';

  function sevLabel(s) {
    if (s === 'critical') return '严重';
    if (s === 'high') return '高危';
    if (s === 'medium') return '中危';
    return '信息';
  }

  function resultLabel(f) {
    if (f.hit) return '命中';
    if (f.protected) return '受保护';
    return '信息';
  }

  function methodOf(f) {
    if (f.method) return f.method;
    var m = String(f.name || '').match(/^(GET|HEAD|OPTIONS|POST|PUT|DELETE|PATCH|TRACE)\s/);
    return m ? m[1] : 'GET';
  }

  function csvCell(v) {
    var s = (v === null || v === undefined) ? '' : String(v);
    s = s.replace(/\r?\n/g, ' ').replace(/"/g, '""');
    return '"' + s + '"';
  }

  function mdCell(v) {
    var s = (v === null || v === undefined) ? '' : String(v);
    return s.replace(/\r?\n/g, ' ').replace(/\|/g, '\\|');
  }

  function toCsv(results) {
    var head = [
      'severity', 'result', 'category', 'name', 'method', 'status',
      'path', 'variant', 'bypass', 'url', 'content_type', 'evidence', 'note'
    ];
    var lines = [head.map(csvCell).join(',')];

    (results || []).forEach(function (f) {
      lines.push([
        f.severity,
        resultLabel(f),
        f.category,
        f.name,
        methodOf(f),
        f.status,
        f.path,
        f.variant,
        f.bypass ? 'yes' : '',
        f.url,
        f.contentType,
        f.evidence,
        f.note
      ].map(csvCell).join(','));
    });

    /* BOM 让 Excel 正确识别 UTF-8 中文 */
    return '﻿' + lines.join('\r\n');
  }

  function toMarkdown(summary, results) {
    var md = [];
    md.push('# Spring Boot 未授权自检报告');
    md.push('');
    md.push('- 生成时间: ' + new Date().toLocaleString());

    if (summary) {
      md.push('- BaseURL: `' + (summary.base || '') + '`');
      md.push('- 请求数: ' + (summary.requests || 0));
      md.push('- 命中: ' + (summary.hits || 0) + '，受保护: ' + (summary.protected || 0));
      if (summary.fingerprints && summary.fingerprints.length) {
        md.push('- 指纹: ' + summary.fingerprints.join(' / '));
      }
    }

    md.push('');
    md.push('| 级别 | 结果 | 类别 | 方法 | 状态 | 路径 | 证据 |');
    md.push('|---|---|---|---|---|---|---|');

    (results || []).forEach(function (f) {
      md.push('| ' + sevLabel(f.severity) +
        ' | ' + resultLabel(f) +
        ' | ' + mdCell(f.category) +
        ' | ' + mdCell(methodOf(f)) +
        ' | ' + (f.status || '') +
        ' | `' + mdCell(f.variant || f.path) + '`' +
        ' | ' + mdCell((f.evidence || '').slice(0, 180)) + ' |');
    });

    md.push('');
    md.push('> 仅用于授权测试。401/403/405 不等于未授权；业务接口的 200 响应需人工确认是否为公开接口。');
    return md.join('\n');
  }

  window.SPB_REPORT = {
    toCsv: toCsv,
    toMarkdown: toMarkdown
  };
})();
