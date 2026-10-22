# dsh-relay-isolation

[English](#english) | [中文](#中文)

---

## English

A DeepSeek Harness bundle that provisions **a separate `DSH_HOME`** for a
third-party model relay (AgentRouter), so relay traffic never runs inside your
main Harness profile.

### Why a separate home, not just a separate profile

A profile only separates **plugin composition**. Sessions, storages, and
`.credentials.yaml` live in `DSH_HOME` and are shared by every profile that uses
the same home — so a relay profile in `~/.dsh` still lists your main
conversations and can read every key you stored. This plugin creates a sibling
home instead:

```
~/.dsh            main Harness: official models, your keys, your sessions
~/.dsh-relay      relay home: one profile, one key, its own sessions
```

The isolated home holds **only** `AGENTROUTER_API_KEY`; other credentials are
never copied.

### Install

```sh
dsh plugin --profile <your-profile> add dsh-relay-isolation
```

### Use

The bundle registers one agent tool, `relay_isolation`:

| action | what it does |
| --- | --- |
| `status` | reports whether the isolated home exists, whether its profile is configured, whether the relay route is installed, whether a key is present |
| `setup` | creates or refreshes it; idempotent |
| `remove` | deletes it, including the sessions stored there; requires `force: true` |

Ask your agent: *"create an isolated relay environment"* — it calls
`relay_isolation` with `action: "setup"`. On Windows a double-click launcher is
written to the Desktop; elsewhere `~/.dsh-relay/launch.sh` is written and made
executable.

The launcher installs `dsh-llm-agentrouter` into the isolated profile on first
start, then boots `dsh` with `--port 0` and opens its own UI.

### What it generates

```
~/.dsh-relay/
  .credentials.yaml            only AGENTROUTER_API_KEY
  launch.cmd | launch.sh
  profiles/relay/
    package.json               bundles: dsh-base, dsh-web-app, dsh-llm-agentrouter
    cordis.yml
    cordis.patch.yml           default model + relay route with silent retry
    pnpm-workspace.yaml
```

The relay route and its request compatibility (client `User-Agent`, direct
transport for the domestic endpoint, tool-schema repair) come from
[`dsh-llm-agentrouter`](https://github.com/aqiu817/dsh-llm-agentrouter). This
plugin configures it; it does not reimplement it.

### Limits

- It cannot isolate the **running** host: `DSH_HOME` is fixed when a process
  starts. Isolation applies to the environment it provisions.
- The generated profile is `relay`; the generated home is
  `$(dirname $DSH_HOME)/.dsh-<suffix>`.
- Installing the relay package needs network access on first launch.
- `remove` deletes that home, including its sessions. It refuses to run without
  `force: true`, and refuses to delete `DSH_HOME` itself.

---

## 中文

一个 DeepSeek Harness bundle，给第三方模型中转站（AgentRouter）**单独开一个
`DSH_HOME`**，让中转站流量不进入主 Harness profile。

### 为什么必须是独立 home，而不是独立 profile

profile 只隔离**插件组合**。会话、存储、`.credentials.yaml` 都在 `DSH_HOME`
里，同一个 home 下的所有 profile 共用——所以 `~/.dsh` 里再建一个 relay profile，
它照样列出你的主会话，也读得到你存的每个密钥。本插件建的是**兄弟目录**：

```
~/.dsh            主 Harness：官方模型、你的密钥、你的会话
~/.dsh-relay      中转站环境：一个 profile、一个密钥、自己的会话
```

隔离环境里**只**有 `AGENTROUTER_API_KEY`，其他凭据一律不复制。

### 安装

```sh
dsh plugin --profile <你的 profile> add dsh-relay-isolation
```

### 使用

装好后会注册一个 agent 工具 `relay_isolation`：

| action | 作用 |
| --- | --- |
| `status` | 报告隔离环境是否存在、profile 是否已配置、中转站路由是否装好、有没有密钥 |
| `setup` | 创建或刷新（幂等） |
| `remove` | 删除，**连同里面的会话**；必须带 `force: true` |

直接对 agent 说「建一个中转站隔离环境」即可；Windows 上会在桌面写一个双击启动器，
其他平台写到 `~/.dsh-relay/launch.sh` 并加可执行位。

启动器首次运行会把 `dsh-llm-agentrouter` 装进隔离 profile，然后用 `--port 0`
起一个自己的界面。

### 边界

- 它**无法隔离正在运行的宿主**：`DSH_HOME` 在进程启动时固定，隔离对新建的环境生效；
- 中转站路由与请求兼容（`User-Agent`、国内端点直连、工具 schema 修补）来自
  [`dsh-llm-agentrouter`](https://github.com/aqiu817/dsh-llm-agentrouter)，本插件只做配置；
- 首次启动需要联网安装该路由包；
- `remove` 会删掉整个 home（含会话），无 `force: true` 时拒绝执行，也拒绝删 `DSH_HOME`。

---

MIT
