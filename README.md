# BootScope

![安全工具](https://img.shields.io/badge/%E5%AE%89%E5%85%A8%E5%B7%A5%E5%85%B7-red) ![路径变异](https://img.shields.io/badge/%E8%B7%AF%E5%BE%84%E5%8F%98%E5%BC%82-orange) ![Spring Boot](https://img.shields.io/badge/Spring%20Boot-brightgreen)

一个面向 **Spring Boot路径泄露/绕过的漏洞验证** 的浏览器扩展。

> 仅用于你拥有授权或明确许可的目标。默认只读 GET、不带 Cookie。

## 核心亮点

- **67 条框架路径**：覆盖 Actuator 2.x/3.x、Actuator 1.x、api-docs、Swagger UI、doc/knife4j、Druid
- **绕过 + URL 编码**：13 条关键路径最多 30 个变体；其余 Actuator 路径最多 16 个编码/双重编码变体
- **低误报**：自动识别 SPA 回退、软 404、全站统一 401/403
- **自行判断 baseURL 路径**：从页面、资源请求、内联脚本、同源 JS 里提取上下文路径，点击直接填入
- **结果可留档**：一键导出 Markdown 报告或 CSV（Excel 中文兼容）
- **加载即用**：无需构建、无需后端，Chrome / Edge / Firefox 通用

## 功能概览

### 1. 路径查找

覆盖 Actuator 2.x/3.x、Actuator 1.x、api-docs、Swagger UI、doc/knife4j、Druid

### 2. 自行判断 baseURL 路径

打开弹窗时，插件会从以下来源提取可能的上下文路径：

- 当前页面路径
- DOM 标签：a、link、script、form、img、iframe、source、video
- performance 里的 XHR / fetch / JS 资源
- 内联脚本
- 最多 8 个同源 JS 文件（每个 512KB）

结果按来源加权、当前页面路径优先，按 origin 缓存 5 分钟。点击某个路径会直接填入：

http(s)://当前host:端口/路径

### 3. BaseURL 与协议

- 留空：使用当前标签页的 **host + 端口**（不继承当前页面路径）
- 只填 host / host:port：与当前标签页同 host 时沿用其端口
- 应用部署在上下文路径下：填 host/app，或直接点候选列表
- http 勾选框：默认不勾选 = https://；勾选后强制 http://，会覆盖输入里的协议

### 4. 执行节奏

- 「每个路径 fuzz 后间隔」可选，单位秒，支持小数（如 0.3）
- 填 1：每个路径（含该路径的变体）跑完等 1 秒；留空或 0 = 不限速
- 间隔 > 0 时自动改为串行执行
- 请求预算上限 1000

### 6. 基线校准

先请求一个随机不存在路径，再对比候选响应：

- **SPA 回退**：响应完全一致 → 丢弃
- **软 404**：200 且模板回显路径，替换路径后一致 → 丢弃
- **全站统一 401/403**：与基线一致 → 不当作“接口存在”
- **错误页**：4xx/5xx 只用于识别 Spring Boot 指纹，不参与命中

### 7. 结果与导出

- 默认只展示命中；勾选「显示受保护」可查看 401/403、跳登录、405
- 支持复制 JSON、打开命中 URL
- **导出 MD**：报告头 + 明细表，适合 SRC / 内部报告
- **导出 CSV**：带 BOM，Excel 打开中文不乱码
- 导出文件默认包含受保护结果（即使界面未勾选显示）

## 安装

### Chrome / Edge

1. 打开 chrome://extensions/
2. 打开右上角「开发者模式」
3. 点「加载已解压的扩展程序」，选择本项目的 extension/ 目录

### Firefox（临时）

1. 打开 about:debugging#/runtime/this-firefox
2. 点「临时载入附加组件」，选择 extension/manifest.json
3. 关闭 Firefox 后失效

## 免责声明

本工具仅用于合法的安全测试、漏洞验证、自查和教学研究，严禁用于任何未经授权的破坏行为。

1. 授权要求
使用本工具前，你必须获得目标系统所有者的明确授权，并严格遵守授权范围、时间窗口和测试边界。未获得授权而对任何系统进行探测，可能违反《中华人民共和国网络安全法》《中华人民共和国刑法》等法律法规，并可能承担相应的民事、行政或刑事责任。
2. 使用责任
使用者应自行判断其行为是否合法合规，并对使用本工具产生的一切后果负责。作者不参与、不授权、不支持任何未经授权的测试行为，也不对使用者的行为承担任何连带责任。
