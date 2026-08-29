# QFramework.ts 新手学习指南

这是一份**从零开始**的教程。假设你写过一些 TypeScript，用过 LayaAir，但从没接触过 QFramework。

读完这份文档，你将能够：
- 说清楚 QFramework 为什么要分这几层
- 从零搭出一个完整的功能模块
- 把它接到 LayaAir 的节点与生命周期上
- 知道遇到问题时该去哪里查

> 配套文档：
> - [README.md](../README.md) —— 项目总览
> - [API.md](API.md) —— 完整 API 参考（当作字典查）
> - [MIGRATION.md](MIGRATION.md) —— C# 版对照（从 QFramework 其他语言版本迁移时看）

---

## 目录

- [第 0 章 学前必读](#第-0-章-学前必读)
- [第 1 章 五分钟跑通第一个架构](#第-1-章-五分钟跑通第一个架构)
- [第 2 章 BindableProperty：让数据自己通知 UI](#第-2-章-bindableproperty让数据自己通知-ui)
- [第 3 章 事件：让模块之间解耦](#第-3-章-事件让模块之间解耦)
- [第 4 章 Command 与 Query：读写分离](#第-4-章-command-与-query读写分离)
- [第 5 章 System：领域逻辑放哪里](#第-5-章-system领域逻辑放哪里)
- [第 6 章 接入 LayaAir](#第-6-章-接入-layaair)
- [第 7 章 实战：完整的游戏模块](#第-7-章-实战完整的游戏模块)
- [第 8 章 常见错误与排查](#第-8-章-常见错误与排查)
- [第 9 章 什么时候该用什么](#第-9-章-什么时候该用什么)
- [附录 速查表](#附录-速查表)

---

## 第 0 章 学前必读

### 0.1 我们到底在解决什么问题

先看一段典型的"新手写法"：

```ts
// ❌ 典型反面教材
class GamePanel extends Laya.Script {
  private coin = 0;
  private lblCoin: Laya.Label;

  onAwake(): void {
    this.lblCoin = this.owner.getChildByName('lblCoin') as Laya.Label;
    this.updateUI();
  }

  onBuyClick(): void {
    if (this.coin < 60) return;
    this.coin -= 60;
    Laya.LocalStorage.setItem('coin', String(this.coin));  // 顺手存了个档
    this.updateUI();

    // 顺便弹个提示
    if (this.coin === 0) this.owner.getChildByName('tip').visible = true;
  }

  onEarnClick(): void {
    this.coin += 10;
    this.updateUI();
    // 忘了存档…… bug 出现了
  }

  private updateUI(): void {
    this.lblCoin.text = String(this.coin);
  }
}
```

这段代码能跑，但项目一大就会崩：

| 问题 | 表现 |
|---|---|
| **UI 和逻辑绞在一起** | 换一套 UI（比如加个悬浮窗），所有逻辑要重写一遍 |
| **数据散落各处** | 金币到底是 0 还是 60，取决于你问的是哪个脚本 |
| **改数据的入口不止一个** | `onBuyClick` 会存档，`onEarnClick` 忘了存档 |
| **没法单独测试** | 想验证"买东西扣钱"，必须先启动整个游戏 |

QFramework 的做法是：**把改数据的入口收敛到一个地方，其他地方只能读、只能订阅。**

### 0.2 一句话心智模型

> **数据只在 Command 里改，其他地方只能读、只能订阅变化。**

整个框架只有四个角色，记住这张图就够了：

```
┌─────────────────────────────────────────────────────┐
│  表现层  Controller（挂在 Laya 节点上的脚本）          │
│         只做三件事：发命令、查数据、收事件              │
└─────────────────────────────────────────────────────┘
        │ sendCommand        │ sendQuery       ▲ 事件
        ▼                    ▼                 │
┌─────────────────────────────────────────────────────┐
│              Architecture（中枢 / 注册表）            │
│                                                     │
│   ┌──────────┐  ┌──────────┐  ┌─────────────────┐  │
│   │ Command  │  │  Query   │  │     System      │  │
│   │ 改数据   │  │  读数据  │  │  领域逻辑        │  │
│   └────┬─────┘  └────┬─────┘  └────────┬────────┘  │
│        │             │                 │            │
│        ▼             ▼                 ▼            │
│   ┌─────────────────────────────────────────────┐  │
│   │  Model（数据 + BindableProperty）            │  │
│   └─────────────────────────────────────────────┘  │
│                                                     │
│   ┌─────────────────────────────────────────────┐  │
│   │  Utility（存档、配置、网络……纯工具）          │  │
│   └─────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

四个角色的职责：

| 角色 | 一句话职责 | 类比 |
|---|---|---|
| **Controller** | 把用户操作翻译成命令；把数据渲染到屏幕 | 服务员 |
| **Command** | **唯一**能改数据的地方，一次操作一个命令 | 后厨 |
| **Query** | 只读，算好了把结果交出去 | 问询处 |
| **System** | 跨 Model 的领域逻辑，监听事件做联动 | 领域专家 |
| **Model** | 存数据，数据变了广播出去 | 账本 |
| **Utility** | 存档 / 读表 / 网络，跟架构无关 | 工具箱 |

### 0.3 ⚠️ 一个 TS 特有的关键差异（最重要的一节）

如果你用过 C# / Java 版的 QFramework，这里是最容易懵的地方。

**TypeScript 的泛型在编译后会被完全擦除**，运行时根本拿不到 `T` 是什么。

```ts
// ❌ 这样写不出来：运行时不知道 T 是啥
getModel<CounterModel>()
```

所以本框架统一约定：**把"类"本身作为参数传进去**。

```ts
// C# 版
this.GetModel<CounterModel>()
this.RegisterEvent<GameStartEvent>(OnGameStart)

// TS 版：传类，不传泛型
this.getModel(CounterModel)
this.registerEvent(GameStartEvent, OnGameStart)
```

这个"类即类型标识"的约定贯穿全框架：

```ts
type Type<T> = new (...args: any[]) => T;   // 就是"某个类的构造函数"
```

**记住这一条，后面所有 API 的写法都顺理成章了。**

---

## 第 1 章 五分钟跑通第一个架构

我们来做一个计数器。这是最小可运行的一套东西。

### 1.1 第一步：定义 Model（数据）

Model 就是"账本"，只负责存数据。

```ts
import { AbstractModel, BindableProperty } from 'qframework-laya';

class CounterModel extends AbstractModel {
  // 用 BindableProperty 而不是普通字段，这样值变化时会通知别人
  readonly count = new BindableProperty<number>(0);

  // onInit 是初始化回调，注册到架构后自动调用
  protected onInit(): void {
    this.count.value = 0;
  }
}
```

两个要点：

1. `readonly count` —— 属性本身只读（不能整个换掉），但 `count.value` 可读写
2. `onInit()` 必须实现，它是 `protected` 的

### 1.2 第二步：定义 Command（改数据）

**只有 Command 能改数据。**

```ts
import { AbstractCommand } from 'qframework-laya';

class IncreaseCountCommand extends AbstractCommand {
  protected onExecute(): void {
    const model = this.getModel(CounterModel)!;
    model.count.value++;
  }
}
```

注意 `this.getModel(CounterModel)` —— 传的是类，不是泛型。

`getModel()` 返回 `T | null`，确定已注册时用 `!` 断言。

### 1.3 第三步：定义 Query（读数据）

```ts
import { AbstractQuery } from 'qframework-laya';

class GetCountQuery extends AbstractQuery<number> {
  protected onDo(): number {
    return this.getModel(CounterModel)!.count.value;
  }
}
```

> **Query 和 Command 为什么要分开？**
> 因为分开之后，你一眼就能看出"这段代码会不会改数据"。
> 看到 `sendQuery`，你知道它绝对没有副作用；看到 `sendCommand`，你知道它会改东西。
> 这在排查 bug 时价值巨大。

### 1.4 第四步：定义 Architecture（把它们装起来）

```ts
import { Architecture } from 'qframework-laya';

class CounterApp extends Architecture<CounterApp> {
  protected init(): void {
    this.registerModel(new CounterModel());
  }
}
```

`Architecture<CounterApp>` 里那个 `CounterApp` 看着有点怪（自己的名字填自己），这是为了让 TS 推导出正确的子类类型，照抄即可。

### 1.5 第五步：使用

```ts
// 第一次访问 Interface 时才真正执行 init()，之后保持单例
CounterApp.Interface.sendCommand(new IncreaseCountCommand());
CounterApp.Interface.sendCommand(new IncreaseCountCommand());

const count = CounterApp.Interface.sendQuery(new GetCountQuery());
console.log(count); // => 2
```

### 1.6 完整代码

```ts
import { AbstractCommand, AbstractModel, AbstractQuery, Architecture, BindableProperty } from 'qframework-laya';

// 1. 数据
class CounterModel extends AbstractModel {
  readonly count = new BindableProperty<number>(0);
  protected onInit(): void {
    this.count.value = 0;
  }
}

// 2. 改数据
class IncreaseCountCommand extends AbstractCommand {
  protected onExecute(): void {
    this.getModel(CounterModel)!.count.value++;
  }
}

// 3. 读数据
class GetCountQuery extends AbstractQuery<number> {
  protected onDo(): number {
    return this.getModel(CounterModel)!.count.value;
  }
}

// 4. 组装
class CounterApp extends Architecture<CounterApp> {
  protected init(): void {
    this.registerModel(new CounterModel());
  }
}

// 5. 用
CounterApp.Interface.sendCommand(new IncreaseCountCommand());
console.log(CounterApp.Interface.sendQuery(new GetCountQuery())); // 1
```

**本章要点**

- `Architecture.Interface` 是惰性单例：只有第一次访问时才执行 `init()`
- Command 实现 `onExecute()`，Query 实现 `onDo()`，Model 实现 `onInit()`
- 取模块一律传类：`this.getModel(CounterModel)`

---

## 第 2 章 BindableProperty：让数据自己通知 UI

### 2.1 它解决什么问题

没有 BindableProperty 时，改完数据你得记得手动刷新 UI：

```ts
model.count++;
this.updateUI();   // ← 忘了这行就出 bug
```

有了它，数据自己会广播：

```ts
model.count.value++;   // UI 自动更新
```

### 2.2 基本用法

```ts
const hp = new BindableProperty<number>(100);

// 注册监听：值变化时收到通知
hp.register((v) => console.log('hp =', v));

hp.value = 80;  // 输出 "hp = 80"
hp.value = 80;  // 相同的值，不触发
hp.value = 60;  // 输出 "hp = 60"
```

### 2.3 四个常用方法

| 方法 | 作用 |
|---|---|
| `register(cb)` | 监听变化，返回注销器 |
| `registerWithInitValue(cb)` | **先立刻回调一次当前值**，再监听 |
| `unRegister(cb)` | 取消监听 |
| `setValueWithoutEvent(v)` | 静默改值，不通知（初始化时用） |

`registerWithInitValue` 是最常用的一个 —— UI 初始化时既要显示当前值，之后又要跟着变：

```ts
// 一行搞定：先显示 100，之后每次变化都更新
hp.registerWithInitValue((v) => { this.lblHp.text = String(v); });
```

### 2.4 比较器：什么时候算"变了"

`BindableProperty` 会先比较新旧值，**相同就不触发**。

基础类型（`number` / `string` / `boolean`）用 `===`，开箱可用。

复杂对象默认是**按引用**比较，也就是"换个新对象就算变了"：

```ts
class Point { constructor(public x = 0, public y = 0) {} }

const p = new BindableProperty<Point>(new Point(1, 1));
p.value = new Point(1, 1);   // 内容一样，但引用不同 → 会触发
```

想按内容比较，有三种办法：

**办法 1：给类型加 `static equals`（推荐）**

```ts
class Point {
  constructor(public x = 0, public y = 0) {}
  static equals(a: Point, b: Point) {
    return a.x === b.x && a.y === b.y;
  }
}

const p = new BindableProperty<Point>(new Point(1, 1));
p.value = new Point(1, 1);   // 不触发 ✅
```

**办法 2：注册全局比较器**

```ts
BindableProperty.setDefaultComparer<Point>(Point, (a, b) => a.x === b.x && a.y === b.y);
```

**办法 3：给单个实例设置**

```ts
const p = new BindableProperty<Point>(new Point()).withComparer((a, b) => a.x === b.x);
```

### 2.5 Laya 值类型开箱可用

Laya 的这些类型**自动**按内容比较，不用你做任何事：

| 类型 | 比较方式 |
|---|---|
| `Laya.Vector2` / `Vector3` / `Vector4` / `Matrix` | 用 Laya 自带的 `static equals` |
| `Laya.Color` | `r/g/b/a` 四个分量 |
| `Laya.Quaternion` | `x/y/z/w` |
| `Laya.Rectangle` | `x/y/width/height` |
| `Laya.Bounds` | 两个端点 |
| `Laya.Matrix4x4` | `elements` 数组 |

```ts
const pos = new BindableProperty<Laya.Vector3>(new Laya.Vector3(0, 0, 0));
pos.register((v) => transform.position = v);

pos.value = new Laya.Vector3(0, 0, 0);   // 不触发 ✅
pos.value = new Laya.Vector3(1, 0, 0);   // 触发 ✅
```

### 2.6 一定要记得注销

```ts
// ❌ 危险：Controller 销毁后，这个监听还挂着 → 内存泄漏 + 报错
model.count.register((v) => this.updateUI(v));

// ✅ 推荐：绑定到 Laya 节点生命周期（第 6 章详讲）
unRegisterWhenNodeDestroyed(
  model.count.register((v) => this.updateUI(v)),
  this.node,
);
```

**本章要点**

- 用 `registerWithInitValue` 做 UI 初始化
- 复杂对象默认按引用比较，需要时加 `static equals`
- Laya 值类型开箱按内容比较
- **监听了就要记得注销**

---

## 第 3 章 事件：让模块之间解耦

### 3.1 事件长什么样

事件就是一个普通的类：

```ts
class CountChangedEvent {
  constructor(public readonly value: number) {}
}
```

### 3.2 发事件 / 收事件

```ts
// 发送（通常在 Command 里）
class IncreaseCountCommand extends AbstractCommand {
  protected onExecute(): void {
    const model = this.getModel(CounterModel)!;
    model.count.value++;
    this.sendEvent(new CountChangedEvent(model.count.value));
  }
}

// 接收
const unRegister = CounterApp.Interface.registerEvent<CountChangedEvent>(
  CountChangedEvent,
  (e) => console.log('变了：', e.value),
);

// 注销
CounterApp.Interface.unRegisterEvent<CountChangedEvent>(CountChangedEvent, handler);
// 或者用 register 返回的注销器
unRegister.unRegister();
```

### 3.3 各层能发/收事件吗

| 层 | 发事件 | 收事件 |
|---|---|---|
| Controller | ✅ | ✅ |
| Command | ✅ | ❌ |
| System | ✅ | ✅ |
| Model | ✅ | ❌ |
| Query | ❌ | ❌ |

> System 既能发又能收，所以"监听 A 事情，然后做 B 联动"这类逻辑放 System 最合适。

### 3.4 用字符串做轻量通道

有时候事件太轻，不值得建个类：

```ts
this.registerEvent<string>('ui:refresh', () => this.refresh());
this.sendEvent<string>('panel', 'ui:refresh');
```

但**正式业务事件还是建议建类** —— 有类型检查，重构时不容易漏。

### 3.5 全局事件（跨架构）

不属于任何架构的全局广播：

```ts
class GameOverEvent {}

// 方式一：直接收发
TypeEventSystem.Global.register(GameOverEvent, () => this.showGameOver());
TypeEventSystem.Global.send(new GameOverEvent());

// 方式二：让一个类实现 IOnEvent（可以正确注销，推荐）
class AudioPlayer implements IOnEvent<GameOverEvent> {
  onEvent(e: GameOverEvent): void {
    this.play('gameover.mp3');
  }
}

const player = new AudioPlayer();
registerGlobalEvent(player, GameOverEvent);     // 订阅
unRegisterGlobalEvent(player, GameOverEvent);   // 正确注销 ✅
```

> ⚠️ 用 `TypeEventSystem.Global.register()` 时，**必须自己保存回调引用**才能注销：
> ```ts
> // ❌ 注销不掉：两次的箭头函数是两个不同对象
> Global.register(Evt, () => fn());
> Global.unRegister(Evt, () => fn());
>
> // ✅ 保存引用
> const handler = () => fn();
> Global.register(Evt, handler);
> Global.unRegister(Evt, handler);
>
> // ✅ 或用 registerGlobalEvent，内部帮你缓存引用
> ```

### 3.6 OrEvent：任意一个条件满足就刷新

```ts
const coinChanged = new EasyEvent();
const hpChanged = new EasyEvent();

// 金币或血量任一变化，都刷新 HUD
orEvent(coinChanged, hpChanged).register(() => this.refreshHud());
```

> ⚠️ 注意：`OrEvent` 注销时会**连带注销所有源事件**。这是为了跟 C# 原版保持一致的设计，
> 需要长期存活的监听请改用 `EasyEvent` + `unRegisterWhenNodeDestroyed`。

**本章要点**

- 事件就是一个普通类
- System 是"监听 → 联动"的主战场
- 事件监听要配对的注销
- 用 `registerGlobalEvent` 可以避免"注销不掉"的坑

---

## 第 4 章 Command 与 Query：读写分离

### 4.1 带返回值的命令

"购买"这种操作需要知道成功还是失败：

```ts
import { AbstractCommandWithResult } from 'qframework-laya';

class PurchaseCommand extends AbstractCommandWithResult<boolean> {
  constructor(private readonly itemId: string) {
    super();       // ← 别忘了 super()
  }

  protected onExecute(): boolean {
    const model = this.getModel(ShopModel)!;
    const price = this.getUtility(PriceTable)!.getPrice(this.itemId);

    if (model.coin.value < price) {
      this.sendEvent(new PurchaseFailedEvent('金币不足'));
      return false;
    }

    model.coin.value -= price;
    this.sendEvent(new PurchaseSucceededEvent(this.itemId, model.coin.value));
    return true;
  }
}

// 用法
const ok = CounterApp.Interface.sendCommand(new PurchaseCommand('sword'));
if (!ok) showToast('金币不足');
```

### 4.2 命令可以带构造参数

```ts
class AddCountCommand extends AbstractCommand {
  constructor(private readonly delta: number) { super(); }
  protected onExecute(): void {
    this.getModel(CounterModel)!.count.value += this.delta;
  }
}

CounterApp.Interface.sendCommand(new AddCountCommand(5));
```

> 这是 TS 版相比 C# 版的一个便利：C# 通常靠属性注入，TS 直接用构造函数更自然。

### 4.3 命令可以嵌套

```ts
class AddTwiceCommand extends AbstractCommand {
  constructor(private readonly delta: number) { super(); }
  protected onExecute(): void {
    this.sendCommand(new AddCountCommand(this.delta));
    this.sendCommand(new AddCountCommand(this.delta));
  }
}
```

### 4.4 Query 也能带参数

```ts
class CanAffordQuery extends AbstractQuery<boolean> {
  constructor(private readonly price: number) { super(); }
  protected onDo(): boolean {
    return this.getModel(ShopModel)!.coin.value >= this.price;
  }
}

if (app.sendQuery(new CanAffordQuery(60))) { /* ... */ }
```

> ⚠️ **Query 拿不到 Utility**（框架刻意限制）。需要外部数据时，把参数通过构造函数传进去。

### 4.5 拦截所有命令 / 查询

想给所有命令加日志？重写架构的两个钩子：

```ts
class ShopApp extends Architecture<ShopApp> {
  protected init(): void {
    this.registerModel(new ShopModel());
  }

  protected override executeCommand<TResult>(command: ICommand<TResult>): TResult {
    console.log('[cmd]', command.constructor.name);
    return super.executeCommand(command);
  }

  protected override doQuery<TResult>(query: IQuery<TResult>): TResult {
    console.log('[query]', query.constructor.name);
    return super.doQuery(query);
  }
}
```

**本章要点**

- 无返回值用 `AbstractCommand`，有返回值用 `AbstractCommandWithResult<T>`
- 构造函数里一定要 `super()`
- Query 拿不到 Utility，参数走构造函数
- 用 `executeCommand` / `doQuery` 做统一拦截

---

## 第 5 章 System：领域逻辑放哪里

### 5.1 什么时候该建 System

问自己一个问题：**这段逻辑是不是"跨数据"的联动？**

- "金币增加时刷新显示" → 不用 System，Controller 订阅即可
- "累计购买 2 次解锁成就" → 用 System（它监听事件、跨多次操作统计）
- "血量归零时触发死亡" → 用 System

### 5.2 写法

```ts
class AchievementSystem extends AbstractSystem {
  readonly unlocked: string[] = [];
  private mPurchaseCount = 0;

  protected onInit(): void {
    // onInit 里注册事件监听
    this.registerEvent<PurchaseSucceededEvent>(PurchaseSucceededEvent, (e) => {
      this.mPurchaseCount++;
      if (this.mPurchaseCount >= 2) this.unlocked.push('连续购买');
      if (e.restCoin === 0) this.unlocked.push('一贫如洗');
    });
  }
}
```

注册到架构：

```ts
class ShopApp extends Architecture<ShopApp> {
  protected init(): void {
    this.registerModel(new ShopModel());
    this.registerSystem(new AchievementSystem());
  }
}
```

### 5.3 初始化顺序

```
1. new Architecture()
2. init()                      ← 你注册模块的地方
3. OnRegisterPatch（可选钩子）
4. 所有 Model 的 onInit()
5. 所有 System 的 onInit()
```

**先 Model 后 System**，所以 System 的 `onInit` 里可以放心取 Model：

```ts
class StatSystem extends AbstractSystem {
  protected onInit(): void {
    const model = this.getModel(ShopModel)!;   // ✅ 此时 Model 已就绪
    this.mCoin = model.coin.value;
  }
}
```

### 5.4 各层能力一览

| 能力 | Controller | Command | Query | System | Model |
|---|:---:|:---:|:---:|:---:|:---:|
| `getModel` | ✅ | ✅ | ✅ | ✅ | ❌ |
| `getSystem` | ✅ | ✅ | ✅ | ✅ | ❌ |
| `getUtility` | ✅ | ✅ | ❌ | ✅ | ✅ |
| `sendCommand` | ✅ | ✅ | ❌ | ❌ | ❌ |
| `sendQuery` | ✅ | ✅ | ✅ | ❌ | ❌ |
| `sendEvent` | ✅ | ✅ | ❌ | ✅ | ✅ |
| `registerEvent` | ✅ | ❌ | ❌ | ✅ | ❌ |

> 这些限制是**刻意的**。比如 Model 不能 `sendCommand`，就杜绝了"数据层反过来调用业务操作"造成的循环依赖。
> 如果发现某层"缺能力"，通常说明这段代码放错层了。

**本章要点**

- System 放"跨数据的联动逻辑"
- 在 `onInit()` 里注册事件监听
- 初始化顺序保证 System 取 Model 时 Model 已就绪
- 各层能力是刻意限制的，放错层会导致"缺能力"

---

## 第 6 章 接入 LayaAir

这是本框架最有价值的部分：`AbstractController` 直接继承 `Laya.Script`。

### 6.1 前提条件

`Laya` 必须在本库加载**之前**就绪。用 LayaAir 全局包时天然满足：

```ts
import { Laya } from 'LayaAir';   // 先
import { AbstractController } from 'qframework-laya';   // 后
```

> 如果 Laya 是异步加载的，需要在 import 业务代码前调用 `installLaya(laya)`。
> 详见 [MIGRATION.md 踩坑点 1](MIGRATION.md#1-laya-必须在-import-本库之前就绪)。

### 6.2 第一个 Controller

```ts
import { Laya } from 'LayaAir';
import { AbstractController, BindableProperty, unRegisterWhenNodeDestroyed } from 'qframework-laya';

const { regClass } = Laya;

@regClass()
export class HudController extends AbstractController {
  // 绑定架构：onAwake 时自动完成
  protected getArchitectureClass() {
    return CounterApp;
  }

  // 架构就绪后回调，在这里订阅数据 / 注册事件
  protected onInit(): void {
    const model = this.getModel(CounterModel)!;

    // 数据绑定 + 绑定到节点生命周期
    unRegisterWhenNodeDestroyed(
      model.count.registerWithInitValue((v) => this.render(v)),
      this.node,
    );
  }

  private render(count: number): void {
    const label = this.node.getChildByName('lblCount') as Laya.Label;
    if (label) label.text = String(count);
  }

  // 按钮点击（在 IDE 里绑定，或代码里绑）
  onAddClick(): void {
    this.sendCommand(new IncreaseCountCommand());
  }
}
```

### 6.3 生命周期是怎么串起来的

```
Laya 节点创建
    ↓
Laya 调用 onAwake()        ← AbstractController 在这里绑定架构
    ↓
    ├─ getArchitectureClass() → resolveArchitecture() → 架构 init
    └─ onInit()            ← 你的代码：订阅数据、注册事件
    ↓
Laya 调用 onEnable() / onStart() / onUpdate()
    ↓
节点 destroy()
    ↓
Laya 调用 onDestroy()      ← 挂在本节点的注销器自动执行
```

**关键：你只需要重写 `onInit()`，不要在 `onAwake()` 里写业务代码。**

如果你确实需要重写 `onAwake`，记得调 `super.onAwake()`：

```ts
override onAwake(): void {
  super.onAwake();     // ← 必须有，否则架构不会绑定
  this.setupSomething();
}
```

### 6.4 节点销毁自动注销

这是防止内存泄漏的核心 API：

```ts
unRegisterWhenNodeDestroyed(注销器, 节点);
```

它会在节点上挂一个触发器组件（同一节点只挂一次），节点销毁时统一执行注销。

四种常见用法：

```ts
// 1. BindableProperty
unRegisterWhenNodeDestroyed(
  model.coin.registerWithInitValue((v) => this.render(v)),
  this.node,
);

// 2. 架构事件
unRegisterWhenNodeDestroyed(
  this.registerEvent<LevelUpEvent>(LevelUpEvent, (e) => this.playEffect(e)),
  this.node,
);

// 3. 全局事件
unRegisterWhenNodeDestroyed(
  registerGlobalEvent(this, GameOverEvent),
  this.node,
);

// 4. 自定义注销器
unRegisterWhenNodeDestroyed(
  new CustomUnRegister(() => this.cleanup()),
  this.node,
);
```

如果手上只有组件没有节点：

```ts
unRegisterWhenComponentDestroyed(unRegister, someComponent);   // 用 component.owner
```

### 6.5 手动绑定架构

不重写 `getArchitectureClass()` 时，可以手动绑：

```ts
class MyController extends AbstractController {
  protected onInit(): void {
    // ...
  }
}

const ctrl = node.addComponent(MyController);
ctrl.setArchitecture(CounterApp.Interface);
```

这在**一个脚本要用不同架构**时有用（比如做成可复用的预制体）。

### 6.6 一个节点挂多个 Controller

完全可以，每个 Controller 独立绑定、独立注销：

```ts
const hud = node.addComponent(HudController);
const bag = node.addComponent(BagController);
```

两者的注销互不干扰。

**本章要点**

- Controller 就是 `Laya.Script`，用 `@regClass()` 注册
- 业务代码写 `onInit()`，不是 `onAwake()`
- 重写 `onAwake()` 必须 `super.onAwake()`
- **所有监听都用 `unRegisterWhenNodeDestroyed` 包一层**

---

## 第 7 章 实战：完整的游戏模块

做一个"商店购买"功能，把前面学的串起来。

### 7.1 先想清楚分层

| 需求 | 归属 |
|---|---|
| 金币、背包数量 | Model |
| 购买、获得金币 | Command |
| 查询金币、能否买得起 | Query |
| 累计购买解锁成就 | System |
| 价格表、日志 | Utility |
| 商店界面 | Controller（Laya 脚本） |

### 7.2 数据层

```ts
import { AbstractModel, BindableProperty } from 'qframework-laya';

class ShopModel extends AbstractModel {
  readonly coin = new BindableProperty<number>(100);
  readonly itemCount = new BindableProperty<number>(0);

  protected onInit(): void {
    this.coin.value = 100;
    this.itemCount.value = 0;
  }
}
```

### 7.3 事件

```ts
class PurchaseSucceededEvent {
  constructor(
    public readonly itemId: string,
    public readonly restCoin: number,
  ) {}
}

class PurchaseFailedEvent {
  constructor(public readonly reason: string) {}
}
```

### 7.4 基础设施层

```ts
import type { IUtility } from 'qframework-laya';

class PriceTable implements IUtility {
  private readonly mPrices: Record<string, number> = {
    sword: 60,
    potion: 20,
    shield: 150,
  };
  getPrice(itemId: string): number {
    return this.mPrices[itemId] ?? Number.MAX_SAFE_INTEGER;
  }
}

class GameLogger implements IUtility {
  readonly lines: string[] = [];
  log(line: string): void { this.lines.push(line); }
}
```

> Utility 是**纯工具**，不依赖架构，拿出去单独测试也没问题。

### 7.5 查询

```ts
import { AbstractQuery } from 'qframework-laya';

class GetCoinQuery extends AbstractQuery<number> {
  protected onDo(): number {
    return this.getModel(ShopModel)!.coin.value;
  }
}

class CanAffordQuery extends AbstractQuery<boolean> {
  constructor(private readonly price: number) { super(); }
  protected onDo(): boolean {
    return this.getModel(ShopModel)!.coin.value >= this.price;
  }
}
```

### 7.6 命令

```ts
import { AbstractCommand, AbstractCommandWithResult } from 'qframework-laya';

class PurchaseCommand extends AbstractCommandWithResult<boolean> {
  constructor(private readonly itemId: string) { super(); }

  protected onExecute(): boolean {
    const model = this.getModel(ShopModel)!;
    const price = this.getUtility(PriceTable)!.getPrice(this.itemId);
    const logger = this.getUtility(GameLogger)!;

    if (model.coin.value < price) {
      logger.log(`购买失败：${this.itemId}（金币不足）`);
      this.sendEvent(new PurchaseFailedEvent('金币不足'));
      return false;
    }

    model.coin.value -= price;
    model.itemCount.value += 1;
    logger.log(`购买成功：${this.itemId}，剩余 ${model.coin.value}`);
    this.sendEvent(new PurchaseSucceededEvent(this.itemId, model.coin.value));
    return true;
  }
}

class EarnCoinCommand extends AbstractCommand {
  constructor(private readonly amount: number) { super(); }
  protected onExecute(): void {
    const model = this.getModel(ShopModel)!;
    model.coin.value += this.amount;
    this.getUtility(GameLogger)!.log(`获得金币：${this.amount}`);
  }
}
```

### 7.7 领域层

```ts
import { AbstractSystem } from 'qframework-laya';

class AchievementSystem extends AbstractSystem {
  readonly unlocked: string[] = [];
  private mPurchaseCount = 0;

  protected onInit(): void {
    this.registerEvent<PurchaseSucceededEvent>(PurchaseSucceededEvent, (e) => {
      this.mPurchaseCount++;
      if (this.mPurchaseCount >= 2) this.unlocked.push('连续购买');
      if (e.restCoin === 0) this.unlocked.push('一贫如洗');
    });
  }
}
```

### 7.8 架构

```ts
import { Architecture } from 'qframework-laya';

class ShopApp extends Architecture<ShopApp> {
  protected init(): void {
    this.registerModel(new ShopModel());
    this.registerSystem(new AchievementSystem());
    this.registerUtility(new PriceTable());
    this.registerUtility(new GameLogger());
  }
}
```

### 7.9 表现层

```ts
import { Laya } from 'LayaAir';
import { AbstractController, unRegisterWhenNodeDestroyed } from 'qframework-laya';

const { regClass } = Laya;

@regClass()
export class ShopController extends AbstractController {
  protected getArchitectureClass() {
    return ShopApp;
  }

  protected onInit(): void {
    const model = this.getModel(ShopModel)!;

    // 金币变化 → 刷新标签
    unRegisterWhenNodeDestroyed(
      model.coin.registerWithInitValue((v) => this.renderCoin(v)),
      this.node,
    );

    // 购买成功 → 播放音效
    unRegisterWhenNodeDestroyed(
      this.registerEvent<PurchaseSucceededEvent>(
        PurchaseSucceededEvent,
        (e) => this.playSfx('buy'),
      ),
      this.node,
    );

    // 成就解锁 → 弹提示
    unRegisterWhenNodeDestroyed(
      this.registerEvent<PurchaseFailedEvent>(
        PurchaseFailedEvent,
        (e) => this.showToast(e.reason),
      ),
      this.node,
    );
  }

  /** IDE 里绑定到"购买"按钮 */
  onBuyClick(): void {
    const ok = this.sendCommand(new PurchaseCommand('sword'));
    if (!ok) this.showToast('金币不足');
  }

  /** IDE 里绑定到"打工"按钮 */
  onWorkClick(): void {
    this.sendCommand(new EarnCoinCommand(50));
  }

  private renderCoin(coin: number): void {
    const label = this.node.getChildByName('lblCoin') as Laya.Label;
    if (label) label.text = String(coin);
  }

  private playSfx(name: string): void { /* ... */ }
  private showToast(msg: string): void { /* ... */ }
}
```

### 7.10 回过头看看我们得到了什么

| 需求变化 | 要改哪里 |
|---|---|
| 换一套 UI | **只改 Controller**，其余不动 |
| 金币要在别处显示 | 新增一个 Controller，订阅同一个 `BindableProperty` |
| 加一种成就 | 只改 `AchievementSystem` |
| 加存档 | 加一个 `SaveUtility`，在 Command 里调用 |
| 改价格 | 只改 `PriceTable` |

而且：**所有逻辑都不依赖 Laya**，可以脱离引擎在 Node 里跑单元测试 —— 这正是本项目 218 个测试用例的做法。

---

## 第 8 章 常见错误与排查

### 8.1 `getModel(...)` 返回 null

```
原因：这个类没注册到架构，或者注册/取用用的不是同一个 key。
```

```ts
class App extends Architecture<App> {
  protected init(): void {
    // ❌ 忘了这行
    // this.registerModel(new CounterModel());
  }
}
App.Interface.getModel(CounterModel);   // null
```

### 8.2 报错"尚未注册到架构"

```
[QFramework] CounterSystem 尚未注册到架构，请先通过 Architecture.registerSystem / registerModel 注册。
```

原因：这个 Command / System / Model **没有经过架构注册**就被使用了。

```ts
// ❌ 直接 new 出来用
new IncreaseCountCommand().execute();

// ✅ 交给架构
App.Interface.sendCommand(new IncreaseCountCommand());
```

### 8.3 报错"AbstractController 尚未绑定架构"

```
[QFramework] AbstractController 尚未绑定架构，请重写 getArchitectureClass() 或在 onAwake 前调用 setArchitecture()。
```

原因：
1. 忘了重写 `getArchitectureClass()`
2. 重写了 `onAwake()` 但**没调 `super.onAwake()`**
3. Controller 是手动 `new` 出来的，没经过 Laya 的 `addComponent`

### 8.4 `Controller` 继承后拿不到 Laya 的方法

```
原因：Laya 在本库加载之后才就绪，AbstractController 退化成了空基类。
```

解决：确保 `import 'LayaAir'` 在 `import 'QFramework'` 之前；异步加载时用 `installLaya()`。

### 8.5 事件注销不掉

```ts
// ❌ 两次是不同函数对象
Global.register(Evt, () => fn());
Global.unRegister(Evt, () => fn());

// ✅ 保存引用
const handler = () => fn();
Global.register(Evt, handler);
Global.unRegister(Evt, handler);
```

### 8.6 报错"架构循环构造"

```
[QFramework] 检测到架构循环构造：XXX 的构造函数或字段初始化器中不能访问 Interface / getInstance
```

```ts
// ❌
class App extends Architecture<App> {
  private readonly mSelf = App.Interface;   // 构造期访问
  protected init(): void {}
}

// ✅ 放到 init() 里
class App extends Architecture<App> {
  protected init(): void {
    const self = App.Interface;   // 或者干脆用 this
  }
}
```

### 8.7 报错"架构循环依赖"

```
[QFramework] 检测到架构循环依赖：XXX 尚未完成初始化就被再次访问
```

原因：`A.init()` 访问 `B.Interface`，而 `B.init()` 又访问 `A.Interface`。

解决：拆出第三个架构，或改成延迟访问（不要在 init 期间互相访问）。

### 8.8 节点销毁后仍收到通知

```
原因：监听时没有用 unRegisterWhenNodeDestroyed 包一层。
```

```ts
// ❌
model.coin.register((v) => this.render(v));

// ✅
unRegisterWhenNodeDestroyed(model.coin.register((v) => this.render(v)), this.node);
```

### 8.9 Query 里拿不到 Utility

```
原因：框架刻意限制（C# 版同样如此）。
```

解决：把需要的数据通过构造函数传进 Query。

```ts
// ❌
class CanAffordQuery extends AbstractQuery<boolean> {
  protected onDo(): boolean {
    return this.getModel(ShopModel)!.coin.value >= this.getUtility(PriceTable)!.getPrice(id);
  }
}

// ✅
class CanAffordQuery extends AbstractQuery<boolean> {
  constructor(private readonly price: number) { super(); }
  protected onDo(): boolean {
    return this.getModel(ShopModel)!.coin.value >= this.price;
  }
}
```

---

## 第 9 章 什么时候该用什么

### 9.1 这段逻辑放哪一层？

```
问：它会改数据吗？
├─ 是 → Command
└─ 否
   ├─ 问：它是"算出来给别人用"吗？
   │  └─ 是 → Query
   ├─ 问：它是"某件事发生后，触发另一件事"吗？
   │  └─ 是 → System
   ├─ 问：它跟游戏无关（存档、读表、网络、加密）吗？
   │  └─ 是 → Utility
   └─ 问：它要碰 UI / 节点吗？
      └─ 是 → Controller
```

### 9.2 用 BindableProperty 还是普通字段？

| 场景 | 选择 |
|---|---|
| 这个值要显示在 UI 上 | `BindableProperty` |
| 这个值变了要触发别的事 | `BindableProperty` |
| 纯粹的内部计数、中间变量 | 普通字段 |

### 9.3 用事件还是直接调用？

| 场景 | 选择 |
|---|---|
| 一个操作引发多个不相关的反应 | 事件 |
| A 明确需要 B 的结果 | 直接调用 / Query |
| 跨层通知（Command → UI） | 事件 |

### 9.4 什么时候该拆多个 Architecture？

默认**一个游戏一个 Architecture** 就够了。拆分的信号：

- 两个模块完全没有数据交集
- 有独立的存档 / 生命周期（比如"主玩法"和"内置编辑器"）

注意：**架构之间不要互相 init 时访问**，会触发循环依赖检测。

---

## 附录 速查表

### 定义模板

```ts
// Model
class XxxModel extends AbstractModel {
  readonly data = new BindableProperty<number>(0);
  protected onInit(): void {}
}

// System
class XxxSystem extends AbstractSystem {
  protected onInit(): void {
    this.registerEvent<SomeEvent>(SomeEvent, (e) => { /* 联动 */ });
  }
}

// Command（无返回值）
class XxxCommand extends AbstractCommand {
  protected onExecute(): void {}
}

// Command（有返回值）
class XxxCommand extends AbstractCommandWithResult<boolean> {
  protected onExecute(): boolean { return true; }
}

// Query
class XxxQuery extends AbstractQuery<number> {
  protected onDo(): number { return 0; }
}

// Utility
class XxxUtility implements IUtility {}

// Architecture
class XxxApp extends Architecture<XxxApp> {
  protected init(): void {
    this.registerModel(new XxxModel());
    this.registerSystem(new XxxSystem());
    this.registerUtility(new XxxUtility());
  }
}

// Controller（Laya）
@regClass()
export class XxxController extends AbstractController {
  protected getArchitectureClass() { return XxxApp; }
  protected onInit(): void {}
}
```

### 调用速查

```ts
// 架构层
App.Interface.sendCommand(new Cmd());          // 改
App.Interface.sendQuery(new Query());          // 读
App.Interface.getModel(XxxModel);              // 取（可能为 null）
App.Interface.registerEvent(Evt, handler);     // 收
App.Interface.unRegisterEvent(Evt, handler);   // 取消
App.Interface.sendEvent(new Evt());            // 发

// 各层内部
this.getModel(XxxModel)
this.getSystem(XxxSystem)
this.getUtility(XxxUtility)
this.sendCommand(new Cmd())
this.sendQuery(new Query())
this.sendEvent(new Evt())              // 传实例
this.sendEventByType(Evt, arg1, arg2)  // 自动 new
this.registerEvent(Evt, handler)
this.unRegisterEvent(Evt, handler)

// BindableProperty
prop.value                        // 读
prop.value = x                    // 写（变化才通知）
prop.register(cb)                 // 订阅 → 返回注销器
prop.registerWithInitValue(cb)    // 先回调一次再订阅
prop.unRegister(cb)
prop.setValueWithoutEvent(x)      // 静默写
prop.withComparer((a, b) => ...)  // 自定义比较

// 注销
unRegisterWhenNodeDestroyed(unRegister, node)
unRegisterWhenComponentDestroyed(unRegister, component)
unRegister.unRegister()
unRegisterAll(list)

// 全局事件
registerGlobalEvent(obj, Evt)
unRegisterGlobalEvent(obj, Evt)
TypeEventSystem.Global.send(new Evt())

// Laya
getLaya() / requireLaya() / installLaya(laya)
```

### 各层能力矩阵

| 能力 | Controller | Command | Query | System | Model |
|---|:---:|:---:|:---:|:---:|:---:|
| `getModel` | ✅ | ✅ | ✅ | ✅ | ❌ |
| `getSystem` | ✅ | ✅ | ✅ | ✅ | ❌ |
| `getUtility` | ✅ | ✅ | ❌ | ✅ | ✅ |
| `sendCommand` | ✅ | ✅ | ❌ | ❌ | ❌ |
| `sendQuery` | ✅ | ✅ | ✅ | ❌ | ❌ |
| `sendEvent` | ✅ | ✅ | ❌ | ✅ | ✅ |
| `registerEvent` | ✅ | ❌ | ❌ | ✅ | ❌ |
| `init()` / `onInit()` | ❌ | ❌ | ❌ | ✅ | ✅ |

### 一句话记忆

> **改数据走 Command，读数据走 Query，联动放 System，UI 挂 Controller，
> 数据用 BindableProperty，监听记得绑节点销毁。**
