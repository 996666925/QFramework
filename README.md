# QFramework.ts

QFramework v1.0 的 **TypeScript / LayaAir 适配版**，由 [QFramework(C#)](https://github.com/liangxiegame/QFramework) 重构而来。

一套极简的 **MVC + 分层架构** 框架，核心目标是：**用一个统一的架构约束，把「数据」「逻辑」「表现」彻底分开**。

```
表现层  Controller（Laya.Script）    —— 只做「发命令 / 查数据 / 收事件」
   ↓ 命令 / ↑ 查询 / ↕ 事件
架构层  Architecture                 —— 注册与分发的中枢
   ├─ System    领域逻辑（可互相调用、可注册事件）
   ├─ Model     数据（只读查询，用命令改）
   ├─ Utility   基础设施（存储、网络、配置、价格表……）
   ├─ Command   写操作（唯一能改 Model 的地方）
   └─ Query     读操作（只读，不产生副作用）
```

## 目录

- [快速开始](#快速开始)
- [在 LayaAir 中使用](#在-layaair-中使用)
- [核心概念](#核心概念)
- [模块清单](#模块清单)
- [完整文档](#完整文档)
- [开发命令](#开发命令)
- [测试](#测试)

---

## 快速开始

### 安装

```bash
bun add qframework-laya
# 或 npm install qframework-laya
```

### TS 配置

本库的类型声明引用了 LayaAir 的全局 `Laya` 命名空间。若你的项目**尚未引入 LayaAir 类型**且未开启 `skipLibCheck`，`tsc` 会报 `Cannot find name 'Laya'`。

在 `tsconfig.json` 中开启即可（Vite / Next 等主流模板默认已开启）：

```json
{
  "compilerOptions": {
    "skipLibCheck": true
  }
}
```

### 1. 定义 Architecture

```ts
import { Architecture } from 'qframework-laya';

class CounterApp extends Architecture<CounterApp> {
  protected init(): void {
    this.registerModel(new CounterModel());
    this.registerSystem(new CounterSystem());
    this.registerUtility(new StorageUtility());
  }
}
```

### 2. 定义 Model（数据）

```ts
import { AbstractModel, BindableProperty } from 'qframework-laya';

class CounterModel extends AbstractModel {
  readonly count = new BindableProperty<number>(0);

  protected onInit(): void {
    this.count.value = 0;
  }
}
```

### 3. 定义 Command（唯一的写入口）

```ts
import { AbstractCommand } from 'qframework-laya';

class IncreaseCountCommand extends AbstractCommand {
  protected onExecute(): void {
    const model = this.getModel(CounterModel)!;
    model.count.value++;
    this.sendEvent(new CountChangedEvent(model.count.value));
  }
}
```

### 4. 定义 Query（只读）

```ts
import { AbstractQuery } from 'qframework-laya';

class GetCountQuery extends AbstractQuery<number> {
  protected onDo(): number {
    return this.getModel(CounterModel)!.count.value;
  }
}
```

### 5. 使用

```ts
// 首次访问 Interface 时才执行 init，之后保持单例
CounterApp.Interface.sendCommand(new IncreaseCountCommand());
const count = CounterApp.Interface.sendQuery(new GetCountQuery());
```

---

## 在 LayaAir 中使用

`AbstractController` 继承自 `Laya.Script`，因此可以直接挂到 Laya 节点上，拥有 `onAwake / onEnable / onStart / onUpdate / onDestroy` 等完整生命周期。

```ts
import { AbstractController, BindableProperty, unRegisterWhenNodeDestroyed } from 'qframework-laya';

class HudController extends AbstractController {
  // 重写后，onAwake 阶段会自动完成架构绑定
  protected getArchitectureClass() {
    return CounterApp;
  }

  // 架构就绪后回调，在这里注册事件 / 绑定数据
  protected onInit(): void {
    const model = this.getModel(CounterModel)!;

    // 数据绑定，并绑定到节点生命周期：节点销毁时自动解绑
    unRegisterWhenNodeDestroyed(
      model.count.registerWithInitValue((v) => this.updateLabel(v)),
      this.node,
    );

    this.registerEvent(CountChangedEvent, () => this.playEffect());
  }

  private updateLabel(count: number): void {
    // this.node / this.owner 都是所属的 Laya 节点
  }

  onClickAddButton(): void {
    this.sendCommand(new IncreaseCountCommand());
  }

  onDestroy(): void {
    // 可以照常重写 Laya 生命周期
  }
}
```

### Laya 适配要点

| 能力 | API |
|---|---|
| Controller 即 Laya 脚本 | `AbstractController extends Laya.Script` |
| 所属节点 | `this.node`（等价于 `Laya.Component.owner`） |
| 架构绑定 | 重写 `getArchitectureClass()`，或手动 `setArchitecture(...)` |
| 节点销毁自动解绑 | `unRegisterWhenNodeDestroyed(unRegister, node)` |
| 组件销毁自动解绑 | `unRegisterWhenComponentDestroyed(unRegister, component)` |
| 值类型绑定比较器 | `BindableProperty` 自动识别 `Vector2/3/4`、`Color`、`Quaternion`、`Rectangle`、`Bounds`、`Matrix`、`Matrix4x4` |

### 关于 Laya 全局对象

LayaAir 的 `LayaAir.d.ts` 是**全局声明**（`declare class Laya` / `declare namespace Laya`）。本框架：

- **编译期**直接使用全局类型（`Laya.Script`、`Laya.Node`、`Laya.Vector3` …）
- **运行期**通过 `globalThis.Laya` 延迟获取，因此在没有 Laya 的环境（如 Node 单元测试）也能安全 `import`

```ts
getLaya();      // => Laya | null
requireLaya();  // => Laya，缺失时抛异常
installLaya(laya); // 异步加载 Laya 时手动注入（必须在 import 本库之前调用）
```

> ⚠️ `AbstractController` 在**模块求值时**就会解析 `Laya.Script` 作为基类。
> 若 Laya 是异步加载的，务必在 `import 'QFramework'` **之前**完成注入，否则它会退化成空基类且无法补救。

---

## 核心概念

### 分层与调用方向

```
Controller ──sendCommand──▶ Command ──改──▶ Model ──事件──▶ System / Controller
Controller ──sendQuery────▶ Query   ──读──▶ Model
System     ──读──▶ Model / System / Utility
```

严格约束（编译期即生效）：

| 层 | 能做什么 | 不能做什么 |
|---|---|---|
| **Controller** | 发命令、发查询、注册事件、读 Model/System/Utility | 直接改 Model 的内部状态 |
| **Command** | 改 Model、发命令、发查询、发事件 | — |
| **Query** | 读 Model / System、发查询 | 改数据、发命令、发事件、取 Utility |
| **System** | 读 Model / System / Utility、注册事件、发事件 | 发命令 |
| **Model** | 取 Utility、发事件 | 发命令、发查询、注册事件 |
| **Utility** | 纯工具，不依赖架构 | — |

### 类型标识（重要）

TypeScript 的泛型在**运行时会被擦除**，C# 的 `typeof(T)` / `GetModel<T>()` 无法直接对应。
因此本框架统一用**构造函数（类本身）**作为类型标识：

```ts
// C#：  this.GetModel<CounterModel>()
// TS：  this.getModel(CounterModel)        // 传类，不传泛型
```

事件同理：

```ts
// C#：  this.RegisterEvent<GameStartEvent>(OnGameStart)
// TS：  this.registerEvent(GameStartEvent, OnGameStart)
```

也支持字符串 / Symbol 作为松散的事件通道：

```ts
this.registerEvent<string>('ui:refresh', () => this.refresh());
this.sendEvent<string>('panel', 'ui:refresh');
```

### 注销机制

所有 `register` 都返回 `IUnRegister`，调用 `unRegister()` 即可解绑。
在 Laya 中推荐绑定到节点生命周期，避免忘记解绑导致内存泄漏：

```ts
const unRegister = model.coin.register((v) => this.refresh(v));
unRegisterWhenNodeDestroyed(unRegister, this.node);
```

---

## 模块清单

| 模块 | 说明 |
|---|---|
| `Architecture<T>` | 架构基类，注册与分发中枢，按子类保持单例 |
| `AbstractController` | Laya 脚本版 Controller，架构入口 |
| `AbstractSystem` / `ISystem` | 领域逻辑层 |
| `AbstractModel` / `IModel` | 数据层 |
| `IUtility` | 基础设施层 |
| `AbstractCommand` / `AbstractCommandWithResult<T>` | 写操作（无返回值 / 带返回值） |
| `AbstractQuery<T>` | 读操作 |
| `BindableProperty<T>` | 可绑定属性，值变化自动通知 |
| `TypeEventSystem` | 类型事件系统（架构内部 + 全局 `Global`） |
| `EasyEvent` / `EasyEvent1/2/3` | 轻量事件（0/1/2/3 个参数） |
| `EasyEvents` | 事件集合，按 key 隔离 |
| `OrEvent` / `orEvent` | 或事件：任一源事件触发即触发 |
| `IOCContainer` | 简易 IOC 容器 |
| `IUnRegister` / `CustomUnRegister` | 注销机制 |
| `ArchitectureCapabilities` | 把架构能力挂到任意对象上 |
| `getLaya` / `requireLaya` / `installLaya` | Laya 全局对象访问 |

---

## 文档

| 文档 | 适合谁 |
|---|---|
| **[docs/GETTING-STARTED.md](docs/GETTING-STARTED.md)** | **新手入门** —— 从零开始的分步教程，含完整实战 |
| [docs/API.md](docs/API.md) | 需要查 API 时 —— 所有导出符号的签名与说明 |
| [docs/MIGRATION.md](docs/MIGRATION.md) | 从 C# 版迁移 —— 命名映射、行为差异、踩坑点 |

**建议学习路径**：先看本文件的「快速开始」跑通第一个例子，再按 [GETTING-STARTED.md](docs/GETTING-STARTED.md) 的章节顺序系统学习，之后把 [API.md](docs/API.md) 当字典查。

---

## 开发命令

```bash
bun install         # 安装依赖
bun run build       # 构建产物到 dist/（含 .d.ts）
bun run dev         # watch 模式构建
bun run typecheck   # 类型检查（src 与 tests，strict 模式）
bun run test        # 运行测试
bun run test:watch
```

## 类型检查

源码与测试均在 **`strict: true`** 下通过检查。

- `tsconfig.json` —— 只覆盖 `src`（`rootDir: "src"`，供 rslib 生成 `.d.ts`）
- `tsconfig.test.json` —— 继承前者，额外覆盖 `tests`（`rootDir: "."`）

两者分开是必要的：`.d.ts` 生成要求所有被 include 的源文件都在 `rootDir` 下，
而测试文件不在 `src` 内，混在一起会触发 `TS6059`。

## 测试

测试使用 [Rstest](https://rstest.rs/)，共 **252** 个用例，覆盖 10 个文件：

| 文件 | 用例数 | 覆盖内容 |
|---|---|---|
| `tests/basics.test.ts` | 15 | `IOCContainer`、`IUnRegister`、`CustomUnRegister`、`IUnRegisterList` |
| `tests/easy-event.test.ts` | 29 | `EasyEvent` / `EasyEvent1/2/3` / `EasyEvents`、重入触发 |
| `tests/type-event-system.test.ts` | 23 | `TypeEventSystem`、全局事件、`IOnEvent` |
| `tests/bindable-property.test.ts` | 38 | `BindableProperty`、比较器、Laya 值类型适配 |
| `tests/architecture.test.ts` | 48 | `Architecture`、Command/Query/Model/System/Utility、分层约束 |
| `tests/architecture-robustness.test.ts` | 9 | 初始化期动态注册、初始化失败、循环构造 / 循环依赖 |
| `tests/controller.test.ts` | 32 | `AbstractController`、节点销毁自动注销、Laya 运行时 |
| `tests/or-event.test.ts` | 12 | `OrEvent` |
| `tests/integration.test.ts` | 12 | 端到端「商店购买」场景 |
| `tests/docs-examples.test.ts` | 34 | **校验 `GETTING-STARTED.md` 里的示例代码真的能跑** |

> `docs-examples.test.ts` 逐章对应入门文档的示例。文档更新时请同步它，
> 以保证教程里的代码不是"看起来对"的伪代码。

### 测试中的 Laya 桩

`tests/laya-stub.ts` 提供了 Laya 的最小化桩（`Script` / `Node` / 各值类型），
并通过 `rstest.config.ts` 的 `setupFiles` 在**测试模块加载之前**注入 `globalThis.Laya`。

> 该文件**不能** import `src/index` —— 否则 `src/index` 会先于 Laya 注入求值，
> `AbstractController` 会退化成空基类。

---

## License

本项目是 [QFramework (C#)](https://github.com/liangxiegame/QFramework) 的 **TypeScript / LayaAir 移植版本**。

| | 版权 | 许可 |
|---|---|---|
| 原作 QFramework (C#) | Copyright (c) 2015 ~ 2023 liangxiegame | MIT License |
| 本移植版 | 同上（依 MIT 条款保留原版权声明） | MIT License |

完整条款见 [LICENSE](LICENSE)。

- https://qframework.cn
- https://github.com/liangxiegame/QFramework
