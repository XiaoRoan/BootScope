/* Spring Boot 未授权自检 - 探测路径字典
 * 字段说明:
 *   category : actuator | api-docs | swagger | doc | druid
 *   path     : 以 / 开头，拼在 BaseURL 后面
 *   name     : 结果里显示的名字
 *   severity : critical | high | medium | info
 *   sig      : 响应指纹标识，对应 detect.js 里的 SIG
 *   key      : 直连失败时是否对该路径跑绕过变体
 *   dangerous: 状态变更端点，只做只读探测，不发送 POST
 */
(function () {
  'use strict';

  var DICT = [];

  function add(category, path, name, severity, sig, opts) {
    opts = opts || {};
    DICT.push({
      category: category,
      path: path,
      name: name,
      severity: severity,
      sig: sig,
      key: !!opts.key,
      dangerous: !!opts.dangerous,
      note: opts.note || ''
    });
  }

  /* ===================== Actuator 2.x / 3.x ===================== */
  add('actuator', '/actuator', 'Actuator 索引', 'high', 'actuator_index', { key: true });
  add('actuator', '/actuator/health', 'Health', 'info', 'health');
  add('actuator', '/actuator/info', 'Info', 'info', 'info');
  add('actuator', '/actuator/env', 'Env 环境变量/配置', 'critical', 'env', { key: true });
  add('actuator', '/actuator/configprops', 'Configprops 配置项', 'critical', 'configprops', { key: true });
  add('actuator', '/actuator/beans', 'Beans', 'high', 'beans');
  add('actuator', '/actuator/mappings', 'Mappings 全量路由', 'high', 'mappings', { key: true });
  add('actuator', '/actuator/metrics', 'Metrics', 'medium', 'metrics');
  add('actuator', '/actuator/loggers', 'Loggers 日志级别', 'high', 'loggers');
  add('actuator', '/actuator/threaddump', 'Threaddump 线程栈', 'high', 'threaddump');
  add('actuator', '/actuator/heapdump', 'Heapdump 内存快照', 'critical', 'heapdump', { key: true });
  add('actuator', '/actuator/httptrace', 'Httptrace 请求记录', 'high', 'httptrace');
  add('actuator', '/actuator/sessions', 'Sessions 会话', 'high', 'sessions');
  add('actuator', '/actuator/auditevents', 'Auditevents 审计事件', 'medium', 'auditevents');
  add('actuator', '/actuator/caches', 'Caches 缓存', 'medium', 'caches');
  add('actuator', '/actuator/scheduledtasks', 'Scheduledtasks 定时任务', 'medium', 'scheduledtasks');
  add('actuator', '/actuator/flyway', 'Flyway 迁移', 'medium', 'flyway');
  add('actuator', '/actuator/liquibase', 'Liquibase 迁移', 'medium', 'liquibase');
  add('actuator', '/actuator/jolokia', 'Jolokia MBean', 'critical', 'jolokia', { key: true });
  add('actuator', '/actuator/gateway/routes', 'Gateway 路由', 'critical', 'gateway_routes');
  add('actuator', '/actuator/logfile', 'Logfile 日志文件', 'critical', 'logfile');
  add('actuator', '/actuator/prometheus', 'Prometheus 指标', 'medium', 'prometheus');
  add('actuator', '/actuator/startup', 'Startup 启动记录', 'medium', 'startup');
  add('actuator', '/actuator/shutdown', 'Shutdown 停机（仅只读探测）', 'high', 'shutdown', { dangerous: true });

  /* ================= Actuator 1.x（无 /actuator 前缀） ================= */
  add('actuator', '/env', 'Env 1.x', 'critical', 'env', { key: true });
  add('actuator', '/heapdump', 'Heapdump 1.x', 'critical', 'heapdump', { key: true });
  add('actuator', '/mappings', 'Mappings 1.x', 'high', 'mappings');
  add('actuator', '/jolokia', 'Jolokia 1.x', 'critical', 'jolokia');
  add('actuator', '/trace', 'Trace 1.x', 'high', 'httptrace');
  add('actuator', '/dump', 'Dump 1.x 线程栈', 'high', 'threaddump');
  add('actuator', '/beans', 'Beans 1.x', 'high', 'beans');
  add('actuator', '/configprops', 'Configprops 1.x', 'critical', 'configprops');
  add('actuator', '/loggers', 'Loggers 1.x', 'high', 'loggers');
  add('actuator', '/metrics', 'Metrics 1.x', 'medium', 'metrics');
  add('actuator', '/health', 'Health 1.x', 'info', 'health');
  add('actuator', '/info', 'Info 1.x', 'info', 'info');
  add('actuator', '/autoconfig', 'Autoconfig 1.x', 'medium', 'autoconfig');

  /* ===================== Swagger / OpenAPI 文档 ===================== */
  add('api-docs', '/v2/api-docs', 'Swagger 2 文档', 'high', 'swagger2', { key: true });
  add('api-docs', '/v3/api-docs', 'OpenAPI 3 文档', 'high', 'openapi3', { key: true });
  add('api-docs', '/v3/api-docs.yaml', 'OpenAPI 3 YAML', 'high', 'openapi_yaml');
  add('api-docs', '/v3/api-docs/swagger-config', 'Swagger 配置', 'medium', 'swagger_config');
  add('api-docs', '/api-docs', 'api-docs', 'high', 'swagger_any');
  add('api-docs', '/apidocs', 'apidocs', 'high', 'swagger_any');
  add('api-docs', '/openapi.json', 'openapi.json', 'high', 'swagger_any');
  add('api-docs', '/openapi.yaml', 'openapi.yaml', 'high', 'openapi_yaml');
  add('api-docs', '/swagger.json', 'swagger.json', 'high', 'swagger_any');
  add('api-docs', '/v2/api-docs-ext', 'knife4j 扩展文档', 'high', 'knife4j_ext');

  add('swagger', '/swagger-ui.html', 'Swagger UI', 'medium', 'swagger_ui', { key: true });
  add('swagger', '/swagger-ui/index.html', 'Swagger UI (springdoc)', 'medium', 'swagger_ui');
  add('swagger', '/swagger-resources', 'Swagger Resources', 'medium', 'swagger_resources');
  add('swagger', '/swagger-resources/configuration/ui', 'Swagger UI 配置', 'info', 'swagger_config');
  add('swagger', '/swagger-resources/configuration/security', 'Swagger 安全配置', 'info', 'swagger_config');

  add('doc', '/doc.html', 'knife4j 文档页', 'high', 'knife4j', { key: true });
  add('doc', '/doc', 'doc', 'info', 'doc_page');
  add('doc', '/docs', 'docs', 'info', 'doc_page');
  add('doc', '/docs/index.html', 'docs/index.html', 'info', 'doc_page');
  add('doc', '/knife4j', 'knife4j 入口', 'medium', 'knife4j');

  /* ===================== Druid 监控 ===================== */
  add('druid', '/druid/index.html', 'Druid 监控首页', 'high', 'druid_index', { key: true });
  add('druid', '/druid/login.html', 'Druid 登录页', 'medium', 'druid_login');
  add('druid', '/druid/websession.html', 'Druid 会话', 'critical', 'druid_websession');
  add('druid', '/druid/sql.html', 'Druid SQL 监控', 'critical', 'druid_sql');
  add('druid', '/druid/api.html', 'Druid API', 'high', 'druid_api');
  add('druid', '/druid/spring.html', 'Druid Spring 监控', 'medium', 'druid_spring');
  add('druid', '/druid/sqlwall.html', 'Druid SQL 防火墙', 'medium', 'druid_sqlwall');
  add('druid', '/druid/basic.json', 'Druid 基础信息 JSON', 'high', 'druid_json');
  add('druid', '/druid/websession.json', 'Druid 会话 JSON', 'critical', 'druid_json');
  add('druid', '/druid/sql.json', 'Druid SQL JSON', 'critical', 'druid_json');

  window.SPB_DICT = DICT;
})();
