# C# → TypeScript 迁移对照

本文说明 QFramework 从 C# 移植到 TypeScript / LayaAir 时的映射关系、行为差异与踩坑点。

- [命名空间与命名风格](#命名空间与命名风格)
- [类型系统映射](#类型系统映射)
- [逐 API 对照表](#逐-api-对照表)
- [行为差异](#行为差异)
- [踩坑点](#踩坑点)

---

## 命名空间与命名风格

| C# | TypeScript | 说明 |
|---|---|---|
| `namespace QFramework` | ES Module（`src/index.ts`） | 全部从包根路径导入 |
| `public void Foo()` | `foo()` | 方法名改为小驼峰 |
| `public T Value { get; set; }` | `get value()` / `set value()` | 属性名改为小驼峰 |
| `private T mValue;` | `private mValue: T` | 私有字段沿用 `m` 前缀 |
| `IUnRegisterList.UnregisterList` | `IUnRegisterList.unregisterList` | 同上 |
| `SendCommand` | `sendCommand` | — |
| `GetModel<T>()` | `getModel(CounterModel)` | 见「泛型擦除」 |

---

## 类型系统映射

### 泛型擦除 → 显式类型标识

C# 的 `typeof(T)` 可以在运行时拿到泛型参数，TypeScript 的泛型在编译后会被完全擦除。
这是本次移植**最核心的差异**。

```csharp
// C#
this.GetModel<CounterModel>();
this.RegisterEvent<GameStartEvent>(OnGameStart);
```

```ts
// TS：必须把「类」作为参数传进去
this.getModel(CounterModel);
this.registerEvent(GameStartEvent, OnGameStart);
```

框架统一定义：

```ts
type Type<T> = new (...args: any[]) => T;      // 用作「类型标识」
type AbstractType<T> = abstract new (...args: any[]) => T;
```

`IOCContainer` 内部即以 `Map<unknown, unknown>` 存储，key 默认是 `instance.constructor`：

```ts
register<T>(instance: T, key?: unknown): void;  // 省略 key 时用 instance.constructor
get<T>(key: unknown): T | null;
```

### 委托 → 函数类型

| C# | TypeScript |
|---|---|
| `Action` | `type Action = () => void` |
| `Action<T>` | `type Action1<T> = (arg: T) => void` |
| `Action<T1, T2>` | `type Action2<T1, T2>` |
| `Action<T1, T2, T3>` | `type Action3<T1, T2, T3>` |

### 扩展方法 → `ArchitectureCapabilities`

C# 用扩展方法给「规则接口」挂能力：

```csharp
public static class CanGetModelExtension {
    public static T GetModel<T>(this ICanGetModel self) where T : class, IModel
        => self.GetArchitecture().GetModel<T>();
}
```

TS 没有扩展方法，改为把实现集中到 `ArchitectureCapabilities`，由各基类持有并委托：

```ts
export class ArchitectureCapabilities {
  constructor(private readonly holder: IBelongToArchitecture) {}
  getModel<T extends IModel>(key: TypeToken<T>): T | null {
    return this.holder.getArchitecture().getModel<T>(key);
  }
  // ...
}

export abstract class AbstractSystem implements ISystem {
  private readonly mCap = new ArchitectureCapabilities(this);
  getModel<T extends IModel>(key: TypeToken<T>): T | null { return this.mCap.getModel<T>(key); }
}
```

若想在**不继承 `AbstractXxx`** 的类上获得全部能力，直接 new 一个 `ArchitectureCapabilities` 即可（见 [API.md](API.md#architecturecapabilities)）。

### 同名类重载 → 按参数个数命名

C# 有 `EasyEvent`、`EasyEvent<T>`、`EasyEvent<T, K>`、`EasyEvent<T, K, S>` 四个同名类。
TS 类不支持同名重载，因此改为：

| C# | TypeScript |
|---|---|
| `EasyEvent` | `EasyEvent` |
| `EasyEvent<T>` | `EasyEvent1<T>` |
| `EasyEvent<T, K>` | `EasyEvent2<T, K>` |
| `EasyEvent<T, K, S>` | `EasyEvent3<T, K, S>` |

同理：

| C# | TypeScript |
|---|---|
| `ICommand` / `ICommand<TResult>` | 单一 `ICommand<TResult = void>` |
| `AbstractCommand` / `AbstractCommand<TResult>` | `AbstractCommand` / `AbstractCommandWithResult<TResult>` |
| `SendCommand<T>(T command)` / `SendCommand<TResult>(ICommand<TResult>)` | 单一 `sendCommand<TResult = void>(command)` |

### 静态泛型字段 → 模块级注册表

C# 中 `Architecture<T>` 的每个封闭泛型都有独立的静态字段：

```csharp
protected static T mArchitecture;   // Architecture<CounterApp> 与 Architecture<ShopApp> 各一份
```

TS 没有这一机制，改为以「子类构造函数」为 key 的模块级 `Map`：

```ts
const architectureInstances = new Map<unknown, IArchitecture>();

function resolveArchitecture(ctor: unknown): IArchitecture { /* 惰性创建 + 初始化 */ }

static get Interface(): IArchitecture { return resolveArchitecture(this); }
static getInstance<T extends Architecture<T>>(this: AbstractType<T> | Type<T>): T;
```

### 事件系统

| C# | TypeScript |
|---|---|
| `Dictionary<Type, IEasyEvent>` | `Map<unknown, IEasyEvent>`，需要显式 key |
| `Send<T>() where T : new()` | `sendByType(key, ...args)` |
| `Send<T>(T e)` | `send(e, key?)` |
| `Register<T>(Action<T>)` | `register(key, onEvent)` |

`send(e)` 不传 key 时，用 `e.constructor` 作为 key；
基本类型会取其装箱构造函数（`42` → `Number`），因此 `register<number>(Number, cb)` 可以配对。

---

## 逐 API 对照表

### 架构

| C# | TypeScript |
|---|---|
| `IArchitecture` | `IArchitecture` |
| `Architecture<T>` | `Architecture<T extends Architecture<T>>` |
| `Architecture<T>.Interface` | `static get Interface(): IArchitecture` |
| `Architecture<T>.OnRegisterPatch` | `static OnRegisterPatch: Action1<any> \| null` |
| `protected abstract void Init()` | `protected abstract init(): void` |
| `RegisterSystem<T>(T)` | `registerSystem<T>(system, key?)` |
| `RegisterModel<T>(T)` | `registerModel<T>(model, key?)` |
| `RegisterUtility<T>(T)` | `registerUtility<T>(utility, key?)` |
| `GetSystem<T>()` | `getSystem<T>(key)` → `T \| null` |
| `GetModel<T>()` | `getModel<T>(key)` → `T \| null` |
| `GetUtility<T>()` | `getUtility<T>(key)` → `T \| null` |
| `SendCommand<T>(T)` / `SendCommand<TResult>(...)` | `sendCommand<TResult = void>(command)` |
| `SendQuery<TResult>(...)` | `sendQuery<TResult>(query)` |
| `SendEvent<T>()` / `SendEvent<T>(T)` | `sendEventByType(key, ...args)` / `sendEvent(e, key?)` |
| `RegisterEvent<T>(Action<T>)` | `registerEvent<T>(key, onEvent)` |
| `UnRegisterEvent<T>(Action<T>)` | `unRegisterEvent<T>(key, onEvent)` |
| `protected virtual ExecuteCommand(...)` | `protected executeCommand<TResult>(command)` |
| `protected virtual DoQuery(...)` | `protected doQuery<TResult>(query)` |

### 四层

| C# | TypeScript |
|---|---|
| `IController` | `IController` |
| `ISystem` / `AbstractSystem` | `ISystem` / `AbstractSystem` |
| `void Init()` | `init(): void` |
| `protected abstract void OnInit()` | `protected abstract onInit(): void` |
| `IModel` / `AbstractModel` | `IModel` / `AbstractModel` |
| `IUtility` | `IUtility` |
| `ICommand` / `AbstractCommand` | `ICommand<void>` / `AbstractCommand` |
| `ICommand<TResult>` / `AbstractCommand<TResult>` | `ICommand<TResult>` / `AbstractCommandWithResult<TResult>` |
| `void Execute()` / `TResult Execute()` | `execute(): void` / `execute(): TResult` |
| `protected abstract void OnExecute()` | `protected abstract onExecute()` |
| `IQuery<TResult>` / `AbstractQuery<T>` | `IQuery<TResult>` / `AbstractQuery<TResult>` |
| `TResult Do()` | `do(): TResult` |
| `protected abstract T OnDo()` | `protected abstract onDo(): TResult` |

### 值属性

| C# | TypeScript |
|---|---|
| `BindableProperty<T>` | `BindableProperty<T>` |
| `BindableProperty(T defaultValue = default)` | `constructor(defaultValue?: T, type?: unknown)` |
| `Func<T, T, bool> Comparer { get; set; }` | `static setDefaultComparer(type, comparer)` |
| `WithComparer(Func<T,T,bool>)` | `withComparer(comparer): this` |
| `T Value { get; set; }` | `get value()` / `set value(v)` |
| `SetValueWithoutEvent(T)` | `setValueWithoutEvent(v)` |
| `Register(Action<T>)` | `register(cb): IUnRegister` |
| `RegisterWithInitValue(Action<T>)` | `registerWithInitValue(cb): IUnRegister` |
| `UnRegister(Action<T>)` | `unRegister(cb)` |
| `BindablePropertyUnRegister<T>` | `BindablePropertyUnRegister<T>` |
| `ComparerAutoRegister` | `registerBuiltInComparers()`（惰性自动调用一次） |

### 事件

| C# | TypeScript |
|---|---|
| `IUnRegister` | `IUnRegister`（方法改为 `unRegister()`） |
| `IUnRegisterList` | `IUnRegisterList`（`unregisterList`） |
| `AddToUnregisterList(...)` | `addToUnregisterList(self, list)` |
| `UnRegisterAll()` | `unRegisterAll(self)` |
| `CustomUnRegister` | `CustomUnRegister` |
| `TypeEventSystem.Global` | `TypeEventSystem.Global` |
| `TypeEventSystem.Send<T>()` | `sendByType<T>(key, ...args)` |
| `TypeEventSystem.Send<T>(T e)` | `send<T>(e, key?)` |
| `TypeEventSystem.Register<T>(Action<T>)` | `register<T>(key, onEvent)` |
| `TypeEventSystem.UnRegister<T>(...)` | `unRegister<T>(key, onEvent)` |
| `EasyEvents` | `EasyEvents`（方法需要显式 key） |
| `OrEvent` / `Or(...)` | `OrEvent` / `or(easyEvent)` |
| `OrEventExtensions.Or(self, e)` | `orEvent(self, e)` |
| `IOnEvent<T>` | `IOnEvent<T>`（方法改为 `onEvent(e)`） |
| `OnGlobalEventExtension.RegisterEvent<T>(this IOnEvent<T>)` | `registerGlobalEvent(self, key)` |
| `OnGlobalEventExtension.UnRegisterEvent<T>(...)` | `unRegisterGlobalEvent(self, key)` |

### IOC

| C# | TypeScript |
|---|---|
| `IOCContainer` | `IOCContainer` |
| `Register<T>(T instance)` | `register<T>(instance, key?)` |
| `Get<T>() where T : class` | `get<T>(key): T \| null` |

---

## 行为差异

### 0. 初始化期间动态注册模块（C# 会抛异常，本版支持）

C# 的 `foreach` 在遍历 `HashSet` 时被修改会抛 `InvalidOperationException`，
也就是说初始化期间再注册模块，在 C# 里会**直接报错**。

本版改为**排空队列**语义并完整支持这个场景：

```ts
class BootstrapSystem extends AbstractSystem {
  protected onInit(): void {
    this.getArchitecture().registerSystem(new LazySystem());
  }
}
```

Model 只能获取 Utility 和发送事件；需要动态注册模块时，请在 System 或 Architecture 中完成。初始化顺序仍然是：全部 Model → 全部 System；初始化过程中新注册的模块会被继续处理，且**每个模块只 init 一次**。

### 1. 未注册返回 `null` 而不是抛异常

C# 的 `IOCContainer.Get<T>()` 返回 `null`，这一点保持一致。
但 `ArchitectureHolder.getArchitecture()` 在**未绑定架构**时会抛出明确的中文错误（C# 版是 `NullReferenceException`）：

```
[QFramework] CounterSystem 尚未注册到架构，请先通过 Architecture.RegisterSystem / RegisterModel 注册。
```

### 2. `OrEvent.UnRegister` 是「整体注销」

C# 原版实现：

```csharp
public void UnRegister(Action onEvent) {
    mOnEvent -= onEvent;
    this.UnRegisterAll();   // 一并注销所有源事件
}
```

本移植**刻意保留了这个行为**，因此注销 OrEvent 的任意一个监听者，都会同时断开所有源事件的订阅。
使用时建议：OrEvent 用一次就整体丢弃，或在需要长期存活的场景改用 `EasyEvent` + `unRegisterWhenNodeDestroyed`。

### 3. 全局事件的注销需要复用回调引用

C# 的委托可以按引用注销：

```csharp
TypeEventSystem.Global.Register<T>(self.OnEvent);   // 方法组
TypeEventSystem.Global.UnRegister<T>(self.OnEvent); // 同一个委托
```

TS 中每次写 `e => self.onEvent(e)` 都是**新的函数对象**，无法注销。
因此框架内部用 `WeakMap` 缓存「对象 + 事件」对应的回调：

```ts
const globalEventHandlers = new WeakMap<object, Map<unknown, Action1<any>>>();
```

> 推论：直接对 `TypeEventSystem` 使用箭头函数时，仍需自己保存引用；
> 只有 `registerGlobalEvent` / `unRegisterGlobalEvent` 提供了免引用的注销。

### 4. 触发时的快照遍历

所有事件（`EasyEvent` / `TypeEventSystem` / `BindableProperty`）在触发时都会对回调列表做快照：

```ts
for (const onEvent of this.mOnEvent.slice()) onEvent(t);
```

**好处**：在回调中注销其它监听者不会越界或漏触发。
**代价**：本次触发中，刚刚被注销的监听者仍会被调用一次。

### 5. `BindableProperty` 的默认值

C# 的 `default(T)` 对引用类型是 `null`，对值类型是 `0`。
TS 构造函数参数可省略，省略时值为 `undefined`：

```ts
new BindableProperty<number>(0);   // 推荐显式给初值
new BindableProperty<number>();    // 初值为 undefined
```

### 6. `BindableProperty.Comparer` 是静态的

C# 原版 `BindableProperty<T>.Comparer` 是静态属性，`WithComparer` 会**全局生效**（这是原版的 bug）。
本移植改为：静态的**类型 → 比较器**注册表 + 实例级 `withComparer`，语义更清晰：

```ts
BindableProperty.setDefaultComparer<Money>(Money, (a, b) => a.cents === b.cents); // 全局
new BindableProperty<Point>(p).withComparer((a, b) => a.x === b.x);              // 实例级
```

### 7. 初始化失败 / 循环依赖会显式报错

C# 版在这两种情况下会留下「半成品架构」，后续表现为难以定位的 `null`。本版主动检测：

| 场景 | 行为 |
|---|---|
| `init()` 抛异常 | 错误向外传播，且**不会**在注册表中留下半成品；下次访问会重新尝试 |
| 构造函数 / 字段初始化器中访问 `Interface` | 抛出「架构循环构造」错误（而非栈溢出） |
| `A.init()` → `B.Interface` → `B.init()` → `A.Interface` | 抛出「架构循环依赖」错误（而非返回未就绪的 A） |

```ts
class CyclicApp extends Architecture<CyclicApp> {
  private readonly mSelf = CyclicApp.Interface;   // ❌ 构造期访问，会报「循环构造」
  protected init(): void {}
}
```

### 8. Unity / Godot 相关代码

| C# | 本移植 |
|---|---|
| `UnRegisterOnDestroyTrigger : MonoBehaviour` | 继承 `Laya.Script` 的组件类（运行时动态创建） |
| `UnRegisterWhenGameObjectDestroyed(GameObject)` | `unRegisterWhenNodeDestroyed(unRegister, node)` |
| `UnRegisterWhenGameObjectDestroyed<T>(Component)` | `unRegisterWhenComponentDestroyed(unRegister, component)` |
| `UnRegisterWhenNodeExitTree(Godot.Node)` | —— （Laya 无对应概念） |
| `ComparerAutoRegister` 中的 `Vector2/3/4`、`Color` 等 | 换成 Laya 的 `Vector2/3/4`、`Color`、`Quaternion`、`Rectangle`、`Bounds`、`Matrix`、`Matrix4x4` |
| `[MenuItem("QFramework/...")]` | —— （无 IDE 菜单） |

---

## 踩坑点

### 1. Laya 必须在 `import` 本库之前就绪

`AbstractController` 在模块求值时就会执行 `extends LayaScriptBase()`：

```ts
export abstract class AbstractController extends LayaScriptBase() implements IController {}
```

一旦那时 `globalThis.Laya` 不存在，基类就会退化成空类，**且无法补救**。

```ts
// ✅ 正确
import { Laya } from 'LayaAir';   // 先引入 Laya
import { AbstractController } from 'qframework-laya';

// ✅ 异步加载 Laya 时
import { installLaya } from 'qframework-laya';
installLaya(layaInstance);              // 必须在 import 业务模块之前
await import('./MyController');
```

### 2. 测试里 Laya 桩的加载顺序

`tests/laya-stub.ts` 作为 `setupFiles` 运行，**且不能 import `src/index`**：

```ts
// ❌ 错误：import 会先求值 src/index，此时 Laya 还没注入
import { installLaya } from '../src/index';
installLaya(stubLaya);

// ✅ 正确：先设置全局，再让测试文件去 import src/index
(globalThis as unknown as { Laya: unknown }).Laya = stubLaya;
```

### 3. 命令 / 查询的构造参数

C# 命令通常无参（属性注入）。TS 推荐用构造函数传参：

```ts
class AddCountCommand extends AbstractCommand {
  constructor(private readonly delta: number) { super(); }   // 别忘了 super()
  protected onExecute(): void { /* ... */ }
}

architecture.sendCommand(new AddCountCommand(5));
```

### 4. `getModel()` 返回 `T | null`

C# 版返回 `T`（可能为 null 但类型上不体现）。TS 版显式返回 `T | null`，
确定已注册时用 `!`：

```ts
const model = this.getModel(CounterModel)!;
```

### 5. `AbstractType` vs `Type`

`getArchitectureClass()` 需要返回**可能抽象**的类，因此签名用 `AbstractType`：

```ts
protected getArchitectureClass(): AbstractType<Architecture<any>> | null {
  return CounterApp;   // CounterApp 是抽象类
}
```

`Laya.Node.addComponent` 要求**可实例化**的类型，因此触发器组件用 `Type<IUnRegisterTrigger & Laya.Component>`。

### 6. 事件 key 与继承

事件 key 是 `e.constructor`（精确匹配），**不做继承查找**。
若需要「监听基类事件」，请把监听注册到基类构造函数上，并在发送时显式指定该 key：

```ts
system.register(BaseEvent, onEvent);
system.send(new DerivedEvent(), BaseEvent);   // 显式指定 key
```
