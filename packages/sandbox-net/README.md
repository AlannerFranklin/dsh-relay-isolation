# dsh-sandbox-net

[English](#english) | [中文](#中文)

## English

A DeepSeek Harness bundle that gives a **sandboxed** agent network egress.

The Windows sandbox hands shell commands a token without network capability, so
`curl` inside a sandboxed profile cannot reach anything — that is the sandbox
working as designed. Host plugins, however, run in the host process. This bundle
registers one tool, `fetch_url`, which performs the request there, bounded by an
explicit host allowlist. The write boundary is untouched: the sandbox still
confines the agent to its workspace.

It is provider- and model-agnostic: install it in any profile that runs under a
sandbox.

### Install

```sh
dsh plugin --profile <profile> add dsh-sandbox-net
```

Restart the host. The tool appears as `fetch_url`.

### Configuration

```yaml
- id: sandbox-net
  name: dsh-sandbox-net
  config:
    allowedHosts: ['registry.npmjs.org', 'api.github.com']   # replaces the default list
    allowAll: false                                          # true disables the allowlist
    maxBytes: 60000
    timeoutMs: 20000
```

Defaults cover the npm registry, GitHub, jsDelivr, unpkg, PyPI, crates.io and
Hugging Face.

### Limits

- GET only, HTTPS only, one URL per call.
- The response is truncated at `maxBytes` (60 KB by default).
- `allowAll: true` turns the tool into an open proxy for the sandboxed agent —
  only use it when the sandbox has no other sensitive reach.

## 中文

给**沙箱内**的智能体一条出网通道。

Windows 沙箱交给命令的是没有网络能力的令牌，所以沙箱 profile 里的 `curl` 什么都连不上
——这是沙箱按设计工作。而宿主插件跑在宿主进程里。本 bundle 注册一个工具 `fetch_url`，
请求在宿主发出，目标主机受白名单约束。**写入边界不变**：沙箱仍然把 agent 锁在它的工作区。

它与模型、提供商无关，装在任何一个跑在沙箱下的 profile 里都能用。

### 安装

```sh
dsh plugin --profile <profile> add dsh-sandbox-net
```

重启宿主后，工具以 `fetch_url` 出现。

### 配置

```yaml
- id: sandbox-net
  name: dsh-sandbox-net
  config:
    allowedHosts: ['registry.npmjs.org', 'api.github.com']   # 替换默认列表
    allowAll: false                                          # true 表示不设白名单
    maxBytes: 60000
    timeoutMs: 20000
```

默认放行 npm registry、GitHub、jsDelivr、unpkg、PyPI、crates.io、Hugging Face。

### 边界

- 只支持 GET、只支持 HTTPS、一次一个 URL；
- 响应按 `maxBytes` 截断（默认 60 KB）；
- `allowAll: true` 等于给沙箱里的 agent 开了一个开放代理，只有当这个沙箱没有其他敏感触达时才用。

---

MIT
