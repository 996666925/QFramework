# API 参考

全部导出均来自 `src/index.ts`，可从包根路径直接导入：

```ts
import { Architecture, AbstractController, BindableProperty } from 'qframework-laya';
import type { Type, EventKey, IArchitecture } from 'qframework-laya';
```

> 说明：以下签名中 `Type<T>` = `new (...args: any[]) => T`，是本框架统一使用的「类型标识」。

- [基础类型](#基础类型)
- [Laya 运行时](#laya-运行时)
- [IOCContainer](#ioccontainer)
- [注销机制](#注销机制)
- [EasyEvent 家族](#easyevent-家族)
- [TypeEventSystem](#typeeventsystem)
- [BindableProperty](#bindableproperty)
- [规则接口 Rule](#规则接口-rule)
- [Architecture](#architecture)
- [Command](#command)
- [Query](#query)
- [System / Model / Utility](#system--model--utility)
- [Controller](#controller)
- [Laya 生命周期注销](#laya-生命周期注销)
- [OrEvent](#orevent)

---

## 基础类型

```ts
type Action  = () => void;
type Action1<T> = (arg: T) => void;
type Action2<T1, T2> = (arg1: T1, arg2: T2) => void;
type Action3<T1, T2, T3> = (arg1: T1, arg2: T2, arg3: T3) => void;

/** 类的构造函数类型，用作运行时的「类型标识」 */
type Type<T> = new (...args: any[]) => T;

/** 抽象类的构造函数类型（不可 new） */
type AbstractType<T> = abstract new (...args: any[]) => T;

/** 已注册模块的查询 token：支持具体类、抽象类、字符串和 Symbol */
type TypeToken<T> = Type<T> | AbstractType<T> | string | symbol;

/** 比较器：返回 true 表示「值未变化」 */
type Comparer<T> = (a: T, b: T) => boolean;
```

### `EventKey<T>`

事件标识。通常是事件类的构造函数，也支持字符串 / Symbol 通道；基本类型事件用其装箱构造函数。

```ts
type PrimitiveConstructor<T> = T extends number ? NumberConstructor
  : T extends string  ? StringConstructor
  : T extends boolean ? BooleanConstructor
  : T extends bigint  ? BigIntConstructor
  : T extends symbol  ? SymbolConstructor
  : never;

type EventKey<T> = Type<T> | PrimitiveConstructor<T> | string | symbol;
```

```ts
system.register(GameStartEvent, onEvent);      // 事件类
system.register<string>('ui:refresh', onEvent); // 字符串通道
system.register<number>(Number, onEvent);       // 基本类型（对应 send(42)）
```

---

## Laya 运行时

```ts
/** Laya 全局对象（class Laya 与 namespace Laya 合并后的类型） */
type LayaNamespace = typeof Laya;

/** 获取 Laya 全局对象，未引入 LayaAir 时返回 null */
function getLaya(): LayaNamespace | null;

/** 获取 Laya 全局对象，未引入 LayaAir 时抛出异常 */
function requireLaya(): LayaNamespace;

/**
 * 手动注入 Laya 全局对象。
 * 必须在 import 本库 **之前** 调用，否则 AbstractController 已完成类定义，无法改变基类。
 */
function installLaya(laya: LayaNamespace): void;

/** Laya.Script 基类（延迟解析，无 Laya 时退化为空基类） */
function LayaScriptBase(): Type<Laya.Script>;
```

---

## IOCContainer

简易 IOC 容器，以「类型（构造函数）」为 key。

```ts
class IOCContainer {
  register<T>(instance: T, key?: unknown): void; // key 默认取 instance.constructor
  get<T>(key: unknown): T | null;                // 未注册返回 null
  contains(key: unknown): boolean;
  remove(key: unknown): void;
  clear(): void;
}
```

```ts
const container = new IOCContainer();
container.register(new StorageUtility());
container.get(StorageUtility);            // => StorageUtility

container.register(new DiskStorage(), IStorage); // 显式 key（抽象基类 / 接口）
container.get<IStorage>(IStorage);
```

---

## 注销机制

```ts
interface IUnRegister {
  unRegister(): void;
}

interface IUnRegisterList {
  readonly unregisterList: IUnRegister[];
}

/** 把注销器加入注销列表（C# 的 AddToUnregisterList） */
function addToUnregisterList(self: IUnRegister, unRegisterList: IUnRegisterList): void;

/** 注销列表中的所有对象并清空（C# 的 UnRegisterAll） */
function unRegisterAll(self: IUnRegisterList): void;

/** 自定义注销器：通过回调完成注销，只会生效一次 */
class CustomUnRegister implements IUnRegister {
  constructor(onUnRegister: Action);
  unRegister(): void;
}
```

---

## EasyEvent 家族

TS 类不支持同名重载，因此按参数个数命名为 `EasyEvent` / `EasyEvent1` / `EasyEvent2` / `EasyEvent3`。

```ts
interface IEasyEvent {
  register(onEvent: Action): IUnRegister;
}
```

### `EasyEvent`（0 参）

```ts
class EasyEvent implements IEasyEvent {
  register(onEvent: Action): IUnRegister;
  unRegister(onEvent: Action): void;
  trigger(): void;
  clear(): void;
}
```

### `EasyEvent1<T>`（1 参）

```ts
class EasyEvent1<T> implements IEasyEvent {
  register(onEvent: Action1<T>): IUnRegister;
  register(onEvent: Action): IUnRegister;   // 也可以当 IEasyEvent 用
  unRegister(onEvent: Action1<T>): void;
  trigger(t: T): void;
  clear(): void;
}
```

`EasyEvent2<T, K>`（`trigger(t, k)`）、`EasyEvent3<T, K, S>`（`trigger(t, k, s)`）同理。

> 触发时会对回调列表做**快照遍历**，因此在回调中注销其它监听者不会越界。

### `EasyEvents`

以 key 隔离的事件集合。

```ts
class EasyEvents {
  static get<T extends IEasyEvent>(key: unknown): T | null;
  static register<T extends IEasyEvent>(key: unknown, factory: () => T): T;

  addEvent<T extends IEasyEvent>(key: unknown, e: T): void;
  getEvent<T extends IEasyEvent>(key: unknown): T | null;   // 不会自动创建
  getOrAddEvent<T extends IEasyEvent>(key: unknown, factory: () => T): T;
  removeEvent(key: unknown): void;
  clear(): void;
}
```

---

## TypeEventSystem

```ts
class TypeEventSystem {
  static readonly Global: TypeEventSystem;

  register<T>(key: EventKey<T>, onEvent: Action1<T>): IUnRegister;
  unRegister<T>(key: EventKey<T>, onEvent: Action1<T>): void;

  /** 发送事件；key 默认取 e.constructor */
  send<T>(e: T, key?: EventKey<T>): void;

  /** 自动构造事件实例（对应 C# Send<T>() where T : new()） */
  sendByType<T>(key: Type<T>, ...args: any[]): void;

  clear(): void;
}
```

```ts
const system = new TypeEventSystem();
system.register(PlayerDieEvent, (e) => console.log(e.name));
system.send(new PlayerDieEvent('tom'));
system.sendByType(PlayerDieEvent, 'jerry');
```

### 全局事件接收者

```ts
interface IOnEvent<T> {
  onEvent(e: T): void;
}

function registerGlobalEvent<T>(self: IOnEvent<T>, key: EventKey<T>): IUnRegister;
function unRegisterGlobalEvent<T>(self: IOnEvent<T>, key: EventKey<T>): void;
```

> `registerGlobalEvent` / `unRegisterGlobalEvent` 内部会用 `WeakMap` 缓存「对象 + 事件」对应的回调引用，
> 因此**不需要**用户自己保存函数引用即可正确注销（模拟 C# 委托的按引用注销）。

```ts
const listener = { onEvent(e: PlayerDieEvent) { /* ... */ } };

registerGlobalEvent(listener, PlayerDieEvent);
TypeEventSystem.Global.send(new PlayerDieEvent('tom'));
unRegisterGlobalEvent(listener, PlayerDieEvent);   // 正确注销
```

---

## BindableProperty

```ts
interface IReadonlyBindableProperty<T> extends IEasyEvent {
  readonly value: T;
  registerWithInitValue(action: Action1<T>): IUnRegister;
  unRegister(onValueChanged: Action1<T>): void;
  register(onValueChanged: Action1<T>): IUnRegister;
}

interface IBindableProperty<T> extends IReadonlyBindableProperty<T> {
  value: T;
  setValueWithoutEvent(newValue: T): void;
}

class BindableProperty<T> implements IBindableProperty<T> {
  constructor(defaultValue?: T, type?: unknown);

  /** 为指定类型设置全局默认比较器 */
  static setDefaultComparer<T>(type: unknown, comparer: Comparer<T>): void;
  static getDefaultComparer<T>(type: unknown): Comparer<T> | null;

  /** 设置实例级比较器，返回 this */
  withComparer(comparer: Comparer<T>): this;

  get value(): T;
  set value(newValue: T);

  setValueWithoutEvent(newValue: T): void;   // 静默改值，不触发回调

  register(onValueChanged: Action1<T>): IUnRegister;
  register(onEvent: Action): IUnRegister;    // 也可当 IEasyEvent 用
  registerWithInitValue(onValueChanged: Action1<T>): IUnRegister;
  unRegister(onValueChanged: Action1<T>): void;
  clear(): void;

  toString(): string;

  protected setValue(newValue: T): void;     // 子类可重写
  protected getValue(): T;                   // 子类可重写
}

class BindablePropertyUnRegister<T> implements IUnRegister {
  constructor(bindableProperty: BindableProperty<T>, onValueChanged: Action1<T>);
  unRegister(): void;
}
```

### 比较器

`value` 的 setter 会先用比较器判断值是否变化，**未变化则不触发回调**。

内置比较器（`registerBuiltInComparers()`，首次构造 `BindableProperty` 时自动调用一次）：

| 类型 | 比较方式 |
|---|---|
| `number` / `string` / `boolean` / `bigint` | `===` |
| `Array` | 逐元素浅比较 |
| `Laya.Vector2` / `Vector3` / `Vector4` / `Matrix` | 其静态 `equals` |
| `Laya.Color` | `r/g/b/a` 分量 |
| `Laya.Quaternion` | `x/y/z/w` 分量 |
| `Laya.Rectangle` | `x/y/width/height` 分量 |
| `Laya.Bounds` | `getMin()` / `getMax()` |
| `Laya.Matrix4x4` | `elements` 逐元素 |

兜底比较器 `defaultComparer` 的顺序：

1. `a === b`
2. 构造函数上的 `static equals`（如 `Laya.Vector3.equals`）
3. 实例上的 `equals` 方法
4. 否则视为**已变化**（对象默认按引用比较）

```ts
const hp = new BindableProperty<number>(100);
hp.registerWithInitValue((v) => render(v));   // 立即回调一次，之后每次变化回调

hp.value = 100;   // 未变化，不触发
hp.value = 80;    // 触发

const position = new BindableProperty<Laya.Vector3>(new Laya.Vector3());
position.value = new Laya.Vector3(0, 0, 0);   // 与当前值相等，不触发
```

---

## 规则接口 Rule

C# 中的扩展方法在 TS 中没有对应语法，因此各「能力接口」都带有具体方法，
并由 `ArchitectureCapabilities` 统一实现，供 System / Model / Command / Query / Controller 复用。

```ts
interface IBelongToArchitecture { getArchitecture(): IArchitecture; }
interface ICanSetArchitecture  { setArchitecture(architecture: IArchitecture): void; }

interface ICanGetModel   extends IBelongToArchitecture { getModel<T extends IModel>(key: TypeToken<T>): T | null; }
interface ICanGetSystem  extends IBelongToArchitecture { getSystem<T extends ISystem>(key: TypeToken<T>): T | null; }
interface ICanGetUtility extends IBelongToArchitecture { getUtility<T extends IUtility>(key: TypeToken<T>): T | null; }

interface ICanRegisterEvent extends IBelongToArchitecture {
  registerEvent<T>(key: EventKey<T>, onEvent: Action1<T>): IUnRegister;
  unRegisterEvent<T>(key: EventKey<T>, onEvent: Action1<T>): void;
}

interface ICanSendCommand extends IBelongToArchitecture {
  sendCommand<TResult = void>(command: ICommand<TResult>): TResult;
}

interface ICanSendEvent extends IBelongToArchitecture {
  sendEvent<T>(e: T, key?: EventKey<T>): void;
  sendEventByType<T>(key: Type<T>, ...args: any[]): void;
}

interface ICanSendQuery extends IBelongToArchitecture {
  sendQuery<TResult>(query: IQuery<TResult>): TResult;
}
```

### `ArchitectureCapabilities`

把架构能力挂到**任意持有架构引用的对象**上（不必继承 `AbstractXxx`）。

```ts
class ArchitectureCapabilities {
  constructor(holder: IBelongToArchitecture);

  getSystem<T extends ISystem>(key: TypeToken<T>): T | null;
  getModel<T extends IModel>(key: TypeToken<T>): T | null;
  getUtility<T extends IUtility>(key: TypeToken<T>): T | null;
  sendCommand<TResult = void>(command: ICommand<TResult>): TResult;
  sendQuery<TResult>(query: IQuery<TResult>): TResult;
  sendEvent<T>(e: T, key?: EventKey<T>): void;
  sendEventByType<T>(key: Type<T>, ...args: any[]): void;
  registerEvent<T>(key: EventKey<T>, onEvent: Action1<T>): IUnRegister;
  unRegisterEvent<T>(key: EventKey<T>, onEvent: Action1<T>): void;
}
```

```ts
class MyService {
  private readonly mCap = new ArchitectureCapabilities(this);
  private mArchitecture: IArchitecture | null = null;

  getArchitecture(): IArchitecture {
    if (!this.mArchitecture) throw new Error('未绑定架构');
    return this.mArchitecture;
  }

  bind(architecture: IArchitecture) { this.mArchitecture = architecture; }

  getCoin() { return this.mCap.sendQuery(new GetCoinQuery()); }
}
```

---

## Architecture

```ts
interface IArchitecture {
  registerSystem<T extends ISystem>(system: T, key?: unknown): void;
  registerModel<T extends IModel>(model: T, key?: unknown): void;
  registerUtility<T extends IUtility>(utility: T, key?: unknown): void;

  getSystem<T extends ISystem>(key: TypeToken<T>): T | null;
  getModel<T extends IModel>(key: TypeToken<T>): T | null;
  getUtility<T extends IUtility>(key: TypeToken<T>): T | null;

  sendCommand<TResult = void>(command: ICommand<TResult>): TResult;
  sendQuery<TResult>(query: IQuery<TResult>): TResult;

  sendEvent<T>(e: T, key?: EventKey<T>): void;
  sendEventByType<T>(key: Type<T>, ...args: any[]): void;
  registerEvent<T>(key: EventKey<T>, onEvent: Action1<T>): IUnRegister;
  unRegisterEvent<T>(key: EventKey<T>, onEvent: Action1<T>): void;
}

abstract class Architecture<T extends Architecture<T>> implements IArchitecture {
  /** 架构初始化后的补丁回调（对应 C# OnRegisterPatch） */
  static OnRegisterPatch: Action1<any> | null;

  /** 获取架构接口，首次访问时自动完成初始化 */
  static get Interface(): IArchitecture;

  /** 获取架构实例，返回值带具体子类类型 */
  static getInstance<T extends Architecture<T>>(this: AbstractType<T> | Type<T>): T;

  protected abstract init(): void;

  /** 可重写以插入拦截逻辑（日志、统计等） */
  protected executeCommand<TResult>(command: ICommand<TResult>): TResult;
  protected doQuery<TResult>(query: IQuery<TResult>): TResult;
}
```

### 初始化顺序

1. `new T()`
2. `init()` —— 子类注册模块
3. `Architecture.OnRegisterPatch(this)`
4. 所有 **Model** 的 `init()`
5. 所有 **System** 的 `init()`
6. 标记 `mInited = true`

> 在 `init()` 中注册的 Model / System 会被收集，在第 4、5 步统一初始化；
> 初始化**完成之后**再注册，会立即调用其 `init()`。

```ts
class ShopApp extends Architecture<ShopApp> {
  protected init(): void {
    this.registerModel(new ShopModel());
    this.registerSystem(new AchievementSystem());
    this.registerUtility(new PriceTable());
  }
}

ShopApp.Interface.sendCommand(new PurchaseCommand('sword'));
```

---

## Command

```ts
interface ICommand<TResult = void> {
  getSystem<T extends ISystem>(key: TypeToken<T>): T | null;
  getModel<T extends IModel>(key: TypeToken<T>): T | null;
  getUtility<T extends IUtility>(key: TypeToken<T>): T | null;
  sendCommand<R = void>(command: ICommand<R>): R;
  sendQuery<R>(query: IQuery<R>): R;
  sendEvent<T>(e: T, key?: EventKey<T>): void;
  sendEventByType<T>(key: Type<T>, ...args: any[]): void;
  execute(): TResult;
}

/** 无返回值命令基类 */
abstract class AbstractCommand implements ICommand<void> {
  getSystem<T extends ISystem>(key: TypeToken<T>): T | null;
  getModel<T extends IModel>(key: TypeToken<T>): T | null;
  getUtility<T extends IUtility>(key: TypeToken<T>): T | null;

  sendCommand<TResult = void>(command: ICommand<TResult>): TResult;
  sendQuery<TResult>(query: IQuery<TResult>): TResult;
  sendEvent<T>(e: T, key?: EventKey<T>): void;
  sendEventByType<T>(key: Type<T>, ...args: any[]): void;

  execute(): void;
  protected abstract onExecute(): void;
}

/** 带返回值命令基类（对应 C# AbstractCommand<TResult>） */
abstract class AbstractCommandWithResult<TResult> implements ICommand<TResult> {
  /* 同上 */
  execute(): TResult;
  protected abstract onExecute(): TResult;
}
```

```ts
class PurchaseCommand extends AbstractCommandWithResult<boolean> {
  constructor(private readonly itemId: string) { super(); }

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
```

---

## Query

```ts
interface IQuery<TResult>
  extends IBelongToArchitecture, ICanSetArchitecture, ICanGetModel, ICanGetSystem, ICanSendQuery {
  do(): TResult;
}

abstract class AbstractQuery<TResult> implements IQuery<TResult> {
  getArchitecture(): IArchitecture;
  setArchitecture(architecture: IArchitecture): void;

  getModel<T extends IModel>(key: TypeToken<T>): T | null;
  getSystem<T extends ISystem>(key: TypeToken<T>): T | null;
  sendQuery<R>(query: IQuery<R>): R;

  do(): TResult;
  protected abstract onDo(): TResult;
}
```

> Query 层**没有** `getUtility` / `sendCommand` / `sendEvent`，与 C# 版 `IQuery<TResult>` 的分层约束一致。

---

## System / Model / Utility

```ts
interface ISystem {
  getModel<T extends IModel>(key: TypeToken<T>): T | null;
  getSystem<T extends ISystem>(key: TypeToken<T>): T | null;
  getUtility<T extends IUtility>(key: TypeToken<T>): T | null;
  sendEvent<T>(e: T, key?: EventKey<T>): void;
  sendEventByType<T>(key: Type<T>, ...args: any[]): void;
  registerEvent<T>(key: EventKey<T>, onEvent: Action1<T>): IUnRegister;
  unRegisterEvent<T>(key: EventKey<T>, onEvent: Action1<T>): void;
  init(): void;
}

abstract class AbstractSystem implements ISystem {
  getModel<T extends IModel>(key: TypeToken<T>): T | null;
  getSystem<T extends ISystem>(key: TypeToken<T>): T | null;
  getUtility<T extends IUtility>(key: TypeToken<T>): T | null;

  sendEvent<T>(e: T, key?: EventKey<T>): void;
  sendEventByType<T>(key: Type<T>, ...args: any[]): void;
  registerEvent<T>(key: EventKey<T>, onEvent: Action1<T>): IUnRegister;
  unRegisterEvent<T>(key: EventKey<T>, onEvent: Action1<T>): void;

  init(): void;
  protected abstract onInit(): void;
}

interface IModel {
  getUtility<T extends IUtility>(key: TypeToken<T>): T | null;
  sendEvent<T>(e: T, key?: EventKey<T>): void;
  sendEventByType<T>(key: Type<T>, ...args: any[]): void;
  init(): void;
}

abstract class AbstractModel implements IModel {
  getUtility<T extends IUtility>(key: TypeToken<T>): T | null;
  sendEvent<T>(e: T, key?: EventKey<T>): void;
  sendEventByType<T>(key: Type<T>, ...args: any[]): void;

  init(): void;
  protected abstract onInit(): void;
}

/** Utility：基础设施层，接口本身没有任何约束 */
interface IUtility {}
```

> `Model` / `System` 未注册到架构时调用能力方法会抛出统一错误：
> `[QFramework] XXX 尚未注册到架构，请先通过 Architecture.RegisterSystem / RegisterModel 注册。`

---

## Controller

```ts
interface IController
  extends IBelongToArchitecture, ICanSendCommand, ICanGetSystem, ICanGetModel,
          ICanRegisterEvent, ICanSendQuery, ICanGetUtility {}

/** 继承 Laya.Script，可直接挂到 Laya 节点上 */
abstract class AbstractController extends Laya.Script implements IController {
  /** 所属的 Laya 节点（等价于 Laya.Component.owner） */
  get node(): Laya.Node;

  getArchitecture(): IArchitecture;
  setArchitecture(architecture: IArchitecture): void;

  /** 重写后，onAwake 阶段自动绑定架构；返回 null 表示手动绑定 */
  protected getArchitectureClass(): AbstractType<Architecture<any>> | null;

  getSystem<T extends ISystem>(key: TypeToken<T>): T | null;
  getModel<T extends IModel>(key: TypeToken<T>): T | null;
  getUtility<T extends IUtility>(key: TypeToken<T>): T | null;
  sendCommand<TResult = void>(command: ICommand<TResult>): TResult;
  sendQuery<TResult>(query: IQuery<TResult>): TResult;
  registerEvent<T>(key: EventKey<T>, onEvent: Action1<T>): IUnRegister;
  unRegisterEvent<T>(key: EventKey<T>, onEvent: Action1<T>): void;

  /** Laya 生命周期：绑定架构 → 回调 onInit */
  onAwake(): void;

  /** 架构就绪后回调，子类在此注册事件 / 绑定数据 */
  protected onInit(): void;
}
```

```ts
class HudController extends AbstractController {
  protected getArchitectureClass() { return ShopApp; }

  protected onInit(): void {
    const model = this.getModel(ShopModel)!;
    unRegisterWhenNodeDestroyed(
      model.coin.registerWithInitValue((v) => this.render(v)),
      this.node,
    );
  }
}
```

> 未绑定架构时调用 `getArchitecture()` 会抛出：
> `[QFramework] AbstractController 尚未绑定架构，请重写 getArchitectureClass() 或在 onAwake 前调用 setArchitecture()。`

---

## Laya 生命周期注销

```ts
/** 挂在节点上的注销触发器组件 */
interface IUnRegisterTrigger {
  addUnRegister(unRegister: IUnRegister): void;
  removeUnRegister(unRegister: IUnRegister): void;
}

/** 获取（首次调用时创建）注销触发器组件类型 */
function getUnRegisterOnDestroyTriggerType(): Type<IUnRegisterTrigger & Laya.Component>;

/**
 * 节点销毁时自动注销（对应 C# UnRegisterWhenGameObjectDestroyed）。
 * 会在节点上挂一个触发器组件（同一节点只挂一次），返回传入的 unRegister。
 */
function unRegisterWhenNodeDestroyed(unRegister: IUnRegister, node: Laya.Node): IUnRegister;

/** 组件所属节点销毁时自动注销（使用 Laya.Component.owner） */
function unRegisterWhenComponentDestroyed(unRegister: IUnRegister, component: Laya.Component): IUnRegister;
```

```ts
// BindableProperty
unRegisterWhenNodeDestroyed(coin.register((v) => render(v)), this.node);

// 架构事件
unRegisterWhenNodeDestroyed(
  this.registerEvent(LevelUpEvent, (e) => this.playEffect(e)),
  this.node,
);

// 全局事件
unRegisterWhenNodeDestroyed(registerGlobalEvent(this, LevelUpEvent), this.node);

// 组件形式
unRegisterWhenComponentDestroyed(unRegister, someComponent);
```

---

## OrEvent

或事件：任意一个源事件触发时，都会触发本事件。

```ts
class OrEvent implements IUnRegisterList {
  readonly unregisterList: IUnRegister[];

  or(easyEvent: IEasyEvent): this;
  register(onEvent: Action): IUnRegister;
  unRegister(onEvent: Action): void;
}

/** 合并两个事件（C# 的 OrEventExtensions.Or） */
function orEvent(self: IEasyEvent, e: IEasyEvent): OrEvent;
```

```ts
orEvent(coinChanged, hpChanged).register(() => this.refresh());
new OrEvent().or(coinChanged).or(hpChanged).or(expChanged).register(() => this.refresh());
```

> ⚠️ 与 C# 原版保持一致：`unRegister()` 在注销自身回调的同时，会**一并注销所有源事件的订阅**。
> 也就是说 OrEvent 的注销是「整体注销」，多个监听者会互相影响。
