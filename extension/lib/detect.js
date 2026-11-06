/* 响应指纹识别
 * 输入: 字典条目 entry + 请求结果 res + 基线 baseline
 * 输出: { hit, protected, fingerprint, kind, evidence, severity? }
 */
(function () {
  'use strict';

  function parseJson(text) {
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch (e) {
      return null;
    }
  }

  function has(o, k) {
    return !!o && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k);
  }

  function hasStr(text, s) {
    return typeof text === 'string' && text.indexOf(s) !== -1;
  }

  function isHtml(ct) {
    return /text\/html|application\/xhtml/i.test(ct || '');
  }

  function isText(ct) {
    return /text\/plain|application\/octet-stream|application\/yaml|text\/yaml/i.test(ct || '');
  }

  function bytesStart(bytes, s) {
    if (!bytes || !bytes.length) return false;
    var n = Math.min(bytes.length, s.length);
    if (n === 0) return false;
    for (var i = 0; i < n; i++) {
      if (bytes[i] !== s.charCodeAt(i)) return false;
    }
    return true;
  }

  function bytesPreview(bytes) {
    if (!bytes) return '';
    var out = '';
    for (var i = 0; i < Math.min(bytes.length, 16); i++) {
      out += ('0' + bytes[i].toString(16)).slice(-2) + ' ';
    }
    return out.trim();
  }

  /* FNV-1a，用于基线对比 */
  function textHash(s) {
    var h = 0x811c9dc5;
    s = s || '';
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return h.toString(16);
  }

  function looksLikeBootError(text, status) {
    if (!text || status < 400) return false;
    return /"timestamp"\s*:/.test(text) && /"status"\s*:/.test(text) && /"path"\s*:/.test(text);
  }

  function preview(text) {
    if (!text) return '';
    return text.replace(/\s+/g, ' ').trim().slice(0, 180);
  }

  function pathOf(url) {
    try { return new URL(url).pathname; } catch (e) { return ''; }
  }

  /* 软 404：有些站点对所有路径返回 200，并把请求路径回显在页面里。
   * 做法：把基线响应里的随机路径和候选响应里的路径都替换成占位符，
   * 若两份内容完全一致，说明是同一个模板，丢弃。 */
  function isSoft404(text, baselineText, res, baseline) {
    if (!text || !baselineText || !baseline) return false;
    var bp = baseline.path || '';
    if (!bp || baselineText.indexOf(bp) === -1) return false;

    var cp = pathOf((res && res.finalUrl) || '');
    if (!cp || cp === bp) return false;

    var a = baselineText.split(bp).join('\u0000');
    var b = text.split(cp).join('\u0000');
    return a === b;
  }

  var SIG = {
    /* ---------- Actuator ---------- */
    actuator_index: function (r, t) {
      return has(parseJson(t), '_links');
    },
    health: function (r, t) {
      var j = parseJson(t);
      return has(j, 'status') && !looksLikeBootError(t, r.status);
    },
    info: function (r, t) {
      if (r.status !== 200) return false;
      var j = parseJson(t);
      if (!j || typeof j !== 'object' || Array.isArray(j)) return false;
      var keys = Object.keys(j);
      return keys.length === 0 ||
        has(j, 'git') || has(j, 'build') || has(j, 'app') ||
        has(j, 'artifact') || has(j, 'version');
    },
    env: function (r, t) {
      return hasStr(t, '"propertySources"') ||
        (hasStr(t, '"profiles"') && hasStr(t, '"systemProperties"'));
    },
    configprops: function (r, t) {
      return (hasStr(t, '"contexts"') && (hasStr(t, '"properties"') || hasStr(t, '"prefix"'))) ||
        /"spring\.[a-z]/.test(t);
    },
    beans: function (r, t) {
      return hasStr(t, '"beans"') && (hasStr(t, '"type"') || hasStr(t, '"scope"'));
    },
    mappings: function (r, t) {
      return (hasStr(t, '"contexts"') && (hasStr(t, '"mappings"') || hasStr(t, '"dispatcherServlets"'))) ||
        (hasStr(t, '"bean"') && hasStr(t, '"method"') && hasStr(t, '"patterns"'));
    },
    metrics: function (r, t) {
      var j = parseJson(t);
      return (has(j, 'names') && Array.isArray(j.names)) ||
        hasStr(t, '"counter.') || hasStr(t, '"gauge.') ||
        (hasStr(t, '"measurements"') && hasStr(t, '"name"'));
    },
    loggers: function (r, t) {
      return hasStr(t, '"loggers"') && hasStr(t, '"levels"');
    },
    threaddump: function (r, t) {
      return hasStr(t, '"threadName"') && (hasStr(t, '"threadState"') || hasStr(t, '"stackTrace"'));
    },
    heapdump: function (r, t) {
      return bytesStart(r.bytes, 'JAVA PROFILE') || hasStr(t, 'JAVA PROFILE');
    },
    httptrace: function (r, t) {
      var j = parseJson(t);
      return hasStr(t, '"traces"') ||
        (Array.isArray(j) && hasStr(t, '"timestamp"') && hasStr(t, '"path"'));
    },
    sessions: function (r, t) {
      return hasStr(t, '"sessions"');
    },
    auditevents: function (r, t) {
      return hasStr(t, '"events"') || hasStr(t, '"principal"');
    },
    caches: function (r, t) {
      return hasStr(t, '"cacheManagers"') || hasStr(t, '"caches"');
    },
    scheduledtasks: function (r, t) {
      return hasStr(t, '"cron"') || hasStr(t, '"fixedDelay"') || hasStr(t, '"fixedRate"');
    },
    flyway: function (r, t) {
      return hasStr(t, '"flywayBeans"') || (hasStr(t, '"contexts"') && hasStr(t, '"flyway"'));
    },
    liquibase: function (r, t) {
      return hasStr(t, '"liquibaseBeans"') || (hasStr(t, '"contexts"') && hasStr(t, '"liquibase"'));
    },
    jolokia: function (r, t) {
      var j = parseJson(t);
      return has(j, 'agent') || has(j, 'protocol') || has(j, 'value');
    },
    gateway_routes: function (r, t) {
      var j = parseJson(t);
      if (has(j, 'routes')) return true;
      return Array.isArray(j) && j.length > 0 && (has(j[0], 'route_id') || has(j[0], 'uri'));
    },
    logfile: function (r, t) {
      return r.status === 200 && isText(r.ct) && !isHtml(r.ct) && t.length > 0;
    },
    prometheus: function (r, t) {
      return /# (HELP|TYPE) /.test(t) && (hasStr(t, 'jvm_') || hasStr(t, 'process_'));
    },
    startup: function (r, t) {
      return hasStr(t, '"timeline"') || hasStr(t, '"springBootVersion"');
    },
    shutdown: function (r, t) {
      return r.status === 405;
    },
    autoconfig: function (r, t) {
      return hasStr(t, '"positiveMatches"') || hasStr(t, '"negativeMatches"');
    },

    /* ---------- Swagger / OpenAPI ---------- */
    swagger2: function (r, t) {
      return hasStr(t, '"swagger"') && hasStr(t, '"paths"');
    },
    openapi3: function (r, t) {
      return hasStr(t, '"openapi"') && hasStr(t, '"paths"');
    },
    openapi_yaml: function (r, t) {
      return /(^|\n)\s*openapi\s*:/.test(t);
    },
    swagger_config: function (r, t) {
      return hasStr(t, '"configUrl"') || hasStr(t, '"swagger-config"') || hasStr(t, '"validatorUrl"');
    },
    swagger_any: function (r, t) {
      return hasStr(t, '"swagger"') || hasStr(t, '"openapi"');
    },
    knife4j_ext: function (r, t) {
      return hasStr(t, '"swagger"') || hasStr(t, '"openapi"');
    },
    swagger_ui: function (r, t) {
      return isHtml(r.ct) &&
        /swagger-ui-bundle|swagger-ui\.css|SwaggerUIBundle|Swagger UI/i.test(t);
    },
    swagger_resources: function (r, t) {
      return hasStr(t, '"swaggerVersion"') || (hasStr(t, '"name"') && hasStr(t, '"url"'));
    },
    knife4j: function (r, t) {
      return isHtml(r.ct) && /knife4j/i.test(t);
    },
    doc_page: function (r, t) {
      return isHtml(r.ct) && r.status === 200 &&
        (hasStr(t, 'swagger') || hasStr(t, 'openapi') || hasStr(t, 'api-docs') ||
          /<title>[^<]*(文档|API|Doc)/i.test(t));
    },

    /* ---------- Druid ---------- */
    druid_index: function (r, t) {
      return isHtml(r.ct) && /Druid Stat Index|StatViewServlet|Druid 监控/i.test(t);
    },
    druid_login: function (r, t) {
      return isHtml(r.ct) && /druid/i.test(t) && /login|password|用户名|密码/i.test(t);
    },
    druid_websession: function (r, t) {
      return isHtml(r.ct) && /druid/i.test(t) && /websession|Web Session|会话/i.test(t);
    },
    druid_sql: function (r, t) {
      return isHtml(r.ct) && /druid/i.test(t) && /sql/i.test(t);
    },
    druid_api: function (r, t) {
      return isHtml(r.ct) && /druid/i.test(t) && /api/i.test(t);
    },
    druid_spring: function (r, t) {
      return isHtml(r.ct) && /druid/i.test(t) && /spring/i.test(t);
    },
    druid_sqlwall: function (r, t) {
      return isHtml(r.ct) && /druid/i.test(t) && /wall/i.test(t);
    },
    druid_json: function (r, t) {
      return hasStr(t, '"ResultCode"');
    }
  };

  function analyze(entry, res, baseline) {
    if (!res || !res.ok) {
      return { hit: false, kind: 'error', evidence: res && res.error ? res.error : '请求失败' };
    }

    var text = res.text || '';
    var status = res.status;

    /* 基线先行：SPA 回退 / 软 404 / 全站统一 401·403，
     * 这些响应与“不存在的路径”完全一致，不能算作接口存在。 */
    if (baseline && baseline.hash && status === baseline.status && textHash(text) === baseline.hash) {
      return { hit: false, kind: 'baseline', evidence: '与不存在路径的响应一致（疑似 SPA 回退或全站统一拦截）' };
    }
    if (baseline && status === baseline.status && isSoft404(text, baseline.text, res, baseline)) {
      return { hit: false, kind: 'soft-404', evidence: '与基线模板一致（疑似软 404）' };
    }

    /* 跳转到登录：判定为受保护 */
    if (res.redirected) {
      var u = String(res.finalUrl || '').toLowerCase();
      if (/(login|signin|sign_in|sso|cas|auth)/.test(u)) {
        return {
          hit: false, exists: true, protected: true, kind: 'redirect-login',
          evidence: '跳转到登录页：' + res.finalUrl
        };
      }
    }

    /* 401/403：接口存在但受保护（与基线不同才会走到这里） */
    if (status === 401 || status === 403) {
      return {
        hit: false, exists: true, protected: true, kind: 'http-' + status,
        evidence: 'HTTP ' + status + '（接口存在但受保护）'
      };
    }

    /* shutdown 只读探测：405 说明端点存在，且只接受 POST */
    if (entry.sig === 'shutdown' && status === 405) {
      return {
        hit: false, exists: true, protected: true, kind: 'method-not-allowed',
        evidence: 'HTTP 405（端点存在，仅支持 POST，已跳过）'
      };
    }

    /* 错误页只用于识别框架，绝不参与指纹命中：
     * Spring Boot 404 JSON 的 "path" 字段会包含请求路径，
     * Tomcat/Whitelabel 错误页也会回显 URI，容易造成 Druid/knife4j 误报。 */
    var bootError = looksLikeBootError(text, status) || hasStr(text, 'Whitelabel Error Page');
    if (status >= 400) {
      if (bootError) {
        return { hit: false, kind: 'boot-fingerprint', fingerprint: true, evidence: 'Spring Boot 错误页特征' };
      }
      return { hit: false, kind: 'http-' + status, evidence: preview(text) };
    }

    /* 只对 200/206 做指纹匹配 */
    if (status !== 200 && status !== 206) {
      return { hit: false, kind: 'http-' + status, evidence: preview(text) };
    }

    var fn = SIG[entry.sig];
    var matched = false;
    if (fn) {
      try {
        matched = !!fn(res, text);
      } catch (e) {
        matched = false;
      }
    }

    if (matched) {
      var ev = preview(text);
      if (!ev && res.bytes && res.bytes.length) ev = '二进制响应，前 16 字节：' + bytesPreview(res.bytes);
      return { hit: true, kind: entry.sig, evidence: ev };
    }

    return { hit: false, kind: 'no-match', evidence: preview(text) };
  }

  window.SPB_DETECT = {
    analyze: analyze,
    textHash: textHash,
    parseJson: parseJson,
    isHtml: isHtml,
    looksLikeBootError: looksLikeBootError
  };
})();
