/****************************************************************************
 * QFramework v1.0 —— TypeScript / LayaAir 适配版
 *
 * 本文件是 QFramework (C#) 的 TypeScript / LayaAir 移植版本。
 *
 * 原作  QFramework (C#)
 *       https://qframework.cn
 *       https://github.com/liangxiegame/QFramework
 *       Copyright (c) 2015 ~ 2023 liangxiegame，以 MIT License 发布
 *
 * 移植  TypeScript / LayaAir 适配版（本仓库）
 *       核心架构与 C# 版保持一致，并针对 LayaAir 做了如下适配：
 *         1. Architecture / Command / Query / System / Model / Utility 核心架构与 C# 版保持一致
 *         2. Controller 以 Laya.Script 组件的形式存在（AbstractController）
 *         3. 事件注销可挂载到 Laya 节点的生命周期上（unRegisterWhenNodeDestroyed）
 *         4. BindableProperty 自动为 Laya 常用值类型（Vector2/3/4、Color 等）注册比较器
 *
 * LayaAir 的 d.ts 是全局声明（declare class Laya / declare namespace Laya），
 * 因此编译期直接使用全局类型，运行时通过 globalThis.Laya 延迟获取，
 * 这样在没有 Laya 的环境下（例如单元测试）也能安全 import。
 *
 * 完整的许可条款见仓库根目录的 LICENSE 文件。
 ****************************************************************************/

/* eslint-disable @typescript-eslint/no-explicit-any */

// #region 基础类型

/** 无参回调 */
export type Action = () => void;
/** 单参回调 */
export type Action1<T> = (arg: T) => void;
/** 双参回调 */
export type Action2<T1, T2> = (arg1: T1, arg2: T2) => void;
/** 三参回调 */
export type Action3<T1, T2, T3> = (arg1: T1, arg2: T2, arg3: T3) => void;

/**
 * 类的构造函数类型。
 * TypeScript 的泛型在运行时会被擦除，C# 的 typeof(T) 无法直接对应，
 * 因此本框架统一使用构造函数（类本身）作为“类型标识”。
 */
export type Type<T> = new (...args: any[]) => T;

/** 抽象类（不可 new）的构造函数类型 */
export type AbstractType<T> = abstract new (...args: any[]) => T;

/** 用于查询已注册模块的类型标识。抽象类、字符串和 Symbol 均可作为 token。 */
export type TypeToken<T> = Type<T> | AbstractType<T> | string | symbol;

/**
 * 基本类型的装箱构造函数。
 * `send(42)` 内部会以 `Number` 作为事件 key，
 * 因此 `register` 也必须能接受 `Number` / `String` / `Boolean` / `BigInt` 才能配对。
 */
export type PrimitiveConstructor<T> = T extends number
  ? NumberConstructor
  : T extends string
    ? StringConstructor
    : T extends boolean
      ? BooleanConstructor
      : T extends bigint
        ? BigIntConstructor
        : T extends symbol
          ? SymbolConstructor
          : never;

/**
 * 事件标识。
 * 通常是事件类的构造函数，也可以使用字符串或 Symbol 作为松散的事件通道；
 * 基本类型事件则用其装箱构造函数（number → Number）。
 */
export type EventKey<T> = Type<T> | PrimitiveConstructor<T> | string | symbol;

/** 比较器，用于 BindableProperty 判断值是否发生变化 */
export type Comparer<T> = (a: T, b: T) => boolean;

// #endregion

// #region Laya 运行时

/** Laya 全局对象（class Laya 与 namespace Laya 合并后的类型） */
export type LayaNamespace = typeof Laya;

/**
 * 获取 Laya 全局对象，未引入 LayaAir 时返回 null。
 * 采用延迟获取的方式，保证非 Laya 环境（如单元测试）也能正常加载本模块。
 */
export function getLaya(): LayaNamespace | null {
  const g = globalThis as unknown as { Laya?: LayaNamespace };
  return g.Laya ?? null;
}

/** 获取 Laya 全局对象，未引入 LayaAir 时抛出异常 */
export function requireLaya(): LayaNamespace {
  const laya = getLaya();
  if (!laya) {
    throw new Error('[QFramework] 未找到 Laya 全局对象，请确认已经引入 LayaAir。');
  }
  return laya;
}

let layaScriptBase: Type<Laya.Script> | null = null;

/**
 * 手动注入 Laya 全局对象。
 *
 * 使用 LayaAir 全局包时（本框架对应的场景），Laya 会在业务代码之前完成初始化，无需调用本方法。
 * 若 Laya 是异步加载的，请在 **import 本模块之前** 调用，
 * 否则 AbstractController 已经完成了类定义，无法再动态改变其基类。
 */
export function installLaya(laya: LayaNamespace): void {
  (globalThis as unknown as { Laya?: LayaNamespace }).Laya = laya;
  layaScriptBase = null;
  unRegisterTriggerType = null;
  comparerAutoRegistered = false;
}

/**
 * Laya.Script 基类。
 * 延迟解析，使得在没有 Laya 的环境下也能完成类的定义（此时退化为一个空基类）。
 */
export function LayaScriptBase(): Type<Laya.Script> {
  if (layaScriptBase) return layaScriptBase;
  const laya = getLaya();
  layaScriptBase = (laya?.Script ?? (class {} as unknown as Type<Laya.Script>)) as Type<Laya.Script>;
  return layaScriptBase;
}

// #endregion

// #region IOC

/** 取实例的“类型标识”，等价于 C# 的 typeof(T) */
function defaultTypeKey(instance: unknown): unknown {
  const value = instance as any;
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  return value.constructor ?? Object;
}

function removeAt(array: unknown[], index: number): void {
  if (index >= 0) array.splice(index, 1);
}

/**
 * 简易 IOC 容器。
 * 与 C# 版一致，使用“类型（构造函数）”作为 key。
 */
export class IOCContainer {
  private readonly mInstances = new Map<unknown, unknown>();

  /**
   * 注册实例。
   * @param instance 实例
   * @param key 类型标识，默认取实例的构造函数
   */
  register<T>(instance: T, key: unknown = defaultTypeKey(instance)): void {
    this.mInstances.set(key, instance);
  }

  /** 获取实例，未注册时返回 null */
  get<T>(key: unknown): T | null {
    return (this.mInstances.get(key) as T) ?? null;
  }

  /** 是否已经注册 */
  contains(key: unknown): boolean {
    return this.mInstances.has(key);
  }

  /** 移除注册 */
  remove(key: unknown): void {
    this.mInstances.delete(key);
  }

  /** 清空容器 */
  clear(): void {
    this.mInstances.clear();
  }
}

// #endregion

// #region UnRegister

/** 可注销的对象 */
export interface IUnRegister {
  unRegister(): void;
}

/** 持有注销列表的对象 */
export interface IUnRegisterList {
  readonly unregisterList: IUnRegister[];
}

/** 将注销对象加入注销列表（C# 中的 AddToUnregisterList 扩展方法） */
export function addToUnregisterList(self: IUnRegister, unRegisterList: IUnRegisterList): void {
  unRegisterList.unregisterList.push(self);
}

/** 注销列表中的所有对象（C# 中的 UnRegisterAll 扩展方法） */
export function unRegisterAll(self: IUnRegisterList): void {
  for (const unRegister of self.unregisterList.slice()) unRegister.unRegister();
  self.unregisterList.length = 0;
}

/** 自定义注销器：通过回调完成注销 */
export class CustomUnRegister implements IUnRegister {
  private mOnUnRegister: Action | null;

  constructor(onUnRegister: Action) {
    this.mOnUnRegister = onUnRegister;
  }

  unRegister(): void {
    this.mOnUnRegister?.();
    this.mOnUnRegister = null;
  }
}

// #endregion

// #region EasyEvent

/** 可注册无参回调的事件 */
export interface IEasyEvent {
  register(onEvent: Action): IUnRegister;
}

/**
 * 内部工具：管理一组同签名的回调。
 *
 * 两个关键点：
 * 1. 遍历使用快照，回调中增删监听者不会影响本次遍历（也不会越界）；
 * 2. 快照复用同一个缓冲数组，避免每帧触发时都分配新数组；
 *    只有重入触发（回调里再次触发同一事件）才临时分配，保证语义正确。
 */
class HandlerList<F extends (...args: never[]) => void> {
  private mHandlers: F[] = [];
  private mBuffer: F[] | null = null;
  private mIterating = false;

  add(handler: F): IUnRegister {
    this.mHandlers.push(handler);
    return new CustomUnRegister(() => this.remove(handler));
  }

  remove(handler: F): void {
    removeAt(this.mHandlers, this.mHandlers.indexOf(handler));
  }

  /** 按注册顺序调用所有回调 */
  forEach(invoke: (handler: F) => void): void {
    // 重入（回调中再次触发同一事件）：退化为独立快照，避免破坏外层遍历
    if (this.mIterating) {
      for (const handler of this.mHandlers.slice()) invoke(handler);
      return;
    }

    this.mIterating = true;
    try {
      const buffer = this.mBuffer ?? (this.mBuffer = []);
      buffer.length = 0;
      for (const handler of this.mHandlers) buffer.push(handler);
      for (const handler of buffer) invoke(handler);
      buffer.length = 0;
    } finally {
      this.mIterating = false;
    }
  }

  clear(): void {
    this.mHandlers.length = 0;
  }
}

/** 无参事件（对应 C# 的 EasyEvent） */
export class EasyEvent implements IEasyEvent {
  private readonly mHandlers = new HandlerList<Action>();

  register(onEvent: Action): IUnRegister {
    return this.mHandlers.add(onEvent);
  }

  unRegister(onEvent: Action): void {
    this.mHandlers.remove(onEvent);
  }

  trigger(): void {
    this.mHandlers.forEach((onEvent) => onEvent());
  }

  clear(): void {
    this.mHandlers.clear();
  }
}

/**
 * 单参事件（对应 C# 的 EasyEvent<T>）。
 * TS 不支持同名类的重载，因此按参数个数命名为 EasyEvent1 / EasyEvent2 / EasyEvent3。
 */
export class EasyEvent1<T> implements IEasyEvent {
  private readonly mHandlers = new HandlerList<Action1<T>>();

  register(onEvent: Action1<T>): IUnRegister;
  register(onEvent: Action): IUnRegister;
  register(onEvent: Action | Action1<T>): IUnRegister {
    return this.mHandlers.add(onEvent as Action1<T>);
  }

  unRegister(onEvent: Action1<T>): void {
    this.mHandlers.remove(onEvent);
  }

  trigger(t: T): void {
    this.mHandlers.forEach((onEvent) => onEvent(t));
  }

  clear(): void {
    this.mHandlers.clear();
  }
}

/** 双参事件（对应 C# 的 EasyEvent<T, K>） */
export class EasyEvent2<T, K> implements IEasyEvent {
  private readonly mHandlers = new HandlerList<Action2<T, K>>();

  register(onEvent: Action2<T, K>): IUnRegister;
  register(onEvent: Action): IUnRegister;
  register(onEvent: Action | Action2<T, K>): IUnRegister {
    return this.mHandlers.add(onEvent as Action2<T, K>);
  }

  unRegister(onEvent: Action2<T, K>): void {
    this.mHandlers.remove(onEvent);
  }

  trigger(t: T, k: K): void {
    this.mHandlers.forEach((onEvent) => onEvent(t, k));
  }

  clear(): void {
    this.mHandlers.clear();
  }
}

/** 三参事件（对应 C# 的 EasyEvent<T, K, S>） */
export class EasyEvent3<T, K, S> implements IEasyEvent {
  private readonly mHandlers = new HandlerList<Action3<T, K, S>>();

  register(onEvent: Action3<T, K, S>): IUnRegister;
  register(onEvent: Action): IUnRegister;
  register(onEvent: Action | Action3<T, K, S>): IUnRegister {
    return this.mHandlers.add(onEvent as Action3<T, K, S>);
  }

  unRegister(onEvent: Action3<T, K, S>): void {
    this.mHandlers.remove(onEvent);
  }

  trigger(t: T, k: K, s: S): void {
    this.mHandlers.forEach((onEvent) => onEvent(t, k, s));
  }

  clear(): void {
    this.mHandlers.clear();
  }
}

/**
 * 事件集合。
 * C# 中通过 typeof(T) 区分不同的 EasyEvent<T>，TS 泛型会被擦除，
 * 因此统一使用显式的 key（事件类的构造函数 / 字符串 / Symbol）区分。
 */
export class EasyEvents {
  private static readonly mGlobalEvents = new EasyEvents();

  private readonly mTypeEvents = new Map<unknown, IEasyEvent>();

  /** 获取全局事件 */
  static get<T extends IEasyEvent>(key: unknown): T | null {
    return EasyEvents.mGlobalEvents.getEvent<T>(key);
  }

  /** 获取（没有则创建）全局事件 */
  static register<T extends IEasyEvent>(key: unknown, factory: () => T): T {
    return EasyEvents.mGlobalEvents.getOrAddEvent<T>(key, factory);
  }

  addEvent<T extends IEasyEvent>(key: unknown, e: T): void {
    this.mTypeEvents.set(key, e);
  }

  getEvent<T extends IEasyEvent>(key: unknown): T | null {
    return (this.mTypeEvents.get(key) as T) ?? null;
  }

  getOrAddEvent<T extends IEasyEvent>(key: unknown, factory: () => T): T {
    let e = this.mTypeEvents.get(key) as T | undefined;
    if (!e) {
      e = factory();
      this.mTypeEvents.set(key, e);
    }
    return e;
  }

  removeEvent(key: unknown): void {
    this.mTypeEvents.delete(key);
  }

  clear(): void {
    this.mTypeEvents.clear();
  }
}

// #endregion

// #region TypeEventSystem

/** 事件实例为空值时的兜底标识 */
const NULL_EVENT_KEY = Symbol('QFramework.null');
const UNDEFINED_EVENT_KEY = Symbol('QFramework.undefined');

function eventKeyOf(e: unknown): unknown {
  if (e === null) return NULL_EVENT_KEY;
  if (e === undefined) return UNDEFINED_EVENT_KEY;
  return (e as any).constructor ?? Object;
}

/**
 * 类型事件系统。
 * 与 C# 版一致，Architecture 内部持有一个实例，同时提供全局静态实例。
 */
export class TypeEventSystem {
  static readonly Global: TypeEventSystem = new TypeEventSystem();

  private readonly mEvents = new EasyEvents();

  /** 注册事件 */
  register<T>(key: EventKey<T>, onEvent: Action1<T>): IUnRegister {
    return this.mEvents.getOrAddEvent<EasyEvent1<T>>(key, () => new EasyEvent1<T>()).register(onEvent);
  }

  /** 注销事件 */
  unRegister<T>(key: EventKey<T>, onEvent: Action1<T>): void {
    this.mEvents.getEvent<EasyEvent1<T>>(key)?.unRegister(onEvent);
  }

  /**
   * 发送事件。
   * @param e 事件实例
   * @param key 事件标识，默认取 e 的构造函数
   */
  send<T>(e: T, key?: EventKey<T>): void {
    this.mEvents.getEvent<EasyEvent1<T>>(key ?? eventKeyOf(e))?.trigger(e);
  }

  /**
   * 发送事件（自动创建事件实例，对应 C# 的 Send<T>() where T : new()）。
   * @param key 事件类型的构造函数
   * @param args 构造函数参数
   */
  sendByType<T>(key: Type<T>, ...args: any[]): void {
    this.send<T>(new key(...args), key);
  }

  /** 清空所有事件 */
  clear(): void {
    this.mEvents.clear();
  }
}

/** 全局事件接收者（对应 C# 的 IOnEvent<T>） */
export interface IOnEvent<T> {
  onEvent(e: T): void;
}

/**
 * 同一个「接收者 + 事件」复用同一个回调引用，
 * 这样才能像 C# 的委托一样按引用完成注销。
 */
const globalEventHandlers = new WeakMap<object, Map<unknown, Action1<any>>>();

function getGlobalEventHandler<T>(self: IOnEvent<T>, key: EventKey<T>): Action1<T> {
  let handlers = globalEventHandlers.get(self);
  if (!handlers) {
    handlers = new Map<unknown, Action1<any>>();
    globalEventHandlers.set(self, handlers);
  }

  let handler = handlers.get(key);
  if (!handler) {
    handler = (e: T) => self.onEvent(e);
    handlers.set(key, handler);
  }
  return handler as Action1<T>;
}

/** 将对象注册到全局事件系统 */
export function registerGlobalEvent<T>(self: IOnEvent<T>, key: EventKey<T>): IUnRegister {
  return TypeEventSystem.Global.register<T>(key, getGlobalEventHandler(self, key));
}

/** 从全局事件系统注销 */
export function unRegisterGlobalEvent<T>(self: IOnEvent<T>, key: EventKey<T>): void {
  TypeEventSystem.Global.unRegister<T>(key, getGlobalEventHandler(self, key));
}

// #endregion

// #region BindableProperty

/** 只读绑定属性 */
export interface IReadonlyBindableProperty<T> extends IEasyEvent {
  readonly value: T;
  registerWithInitValue(action: Action1<T>): IUnRegister;
  unRegister(onValueChanged: Action1<T>): void;
  register(onValueChanged: Action1<T>): IUnRegister;
}

/** 可读写绑定属性 */
export interface IBindableProperty<T> extends IReadonlyBindableProperty<T> {
  value: T;
  setValueWithoutEvent(newValue: T): void;
}

/**
 * 默认比较器：
 * 1. 引用相等
 * 2. 类型上提供了 static equals（Laya 的 Vector2/3/4、Matrix 等）则使用它
 * 3. 实例上提供了 equals 则使用它
 */
function defaultComparer<T>(a: T, b: T): boolean {
  if (a === b) return true;
  if (a === null || a === undefined || b === null || b === undefined) return false;

  const anyA = a as any;
  const ctor = anyA.constructor;
  if (ctor && typeof ctor.equals === 'function') {
    try {
      return !!ctor.equals(a, b);
    } catch {
      // 比较器签名不匹配时忽略，继续走实例 equals
    }
  }
  if (typeof anyA.equals === 'function') return !!anyA.equals(b);
  return false;
}

function fieldsComparer<T>(fields: readonly string[]): Comparer<T> {
  return (a: T, b: T) => {
    for (const field of fields) {
      if ((a as any)?.[field] !== (b as any)?.[field]) return false;
    }
    return true;
  };
}

let comparerAutoRegistered = false;

/**
 * 为常用值类型注册默认比较器（对应 C# 的 ComparerAutoRegister）。
 * 首次创建 BindableProperty 时会自动调用一次。
 */
export function registerBuiltInComparers(): void {
  BindableProperty.setDefaultComparer<number>(Number, (a, b) => a === b);
  BindableProperty.setDefaultComparer<string>(String, (a, b) => a === b);
  BindableProperty.setDefaultComparer<boolean>(Boolean, (a, b) => a === b);
  BindableProperty.setDefaultComparer<bigint>(BigInt, (a, b) => a === b);
  BindableProperty.setDefaultComparer<unknown[]>(Array, (a, b) => {
    if (a === b) return true;
    if (!a || !b || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  });

  const laya = getLaya();
  if (!laya) return;

  const {
    Vector2,
    Vector3,
    Vector4,
    Matrix,
    Matrix4x4,
    Color,
    Quaternion,
    Rectangle,
    Bounds,
  } = laya as unknown as Record<string, any>;

  if (Vector2) BindableProperty.setDefaultComparer(Vector2, Vector2.equals);
  if (Vector3) BindableProperty.setDefaultComparer(Vector3, Vector3.equals);
  if (Vector4) BindableProperty.setDefaultComparer(Vector4, Vector4.equals);
  if (Matrix) BindableProperty.setDefaultComparer(Matrix, Matrix.equals);
  if (Color) BindableProperty.setDefaultComparer(Color, fieldsComparer<Laya.Color>(['r', 'g', 'b', 'a']));
  if (Quaternion)
    BindableProperty.setDefaultComparer(Quaternion, fieldsComparer<Laya.Quaternion>(['x', 'y', 'z', 'w']));
  if (Rectangle)
    BindableProperty.setDefaultComparer(Rectangle, fieldsComparer<Laya.Rectangle>(['x', 'y', 'width', 'height']));
  if (Bounds)
    BindableProperty.setDefaultComparer<Laya.Bounds>(Bounds, (a, b) => {
      const equals = Vector3 ? Vector3.equals : defaultComparer;
      return (
        !!equals(a?.getMin?.() ?? a?.min, b?.getMin?.() ?? b?.min) &&
        !!equals(a?.getMax?.() ?? a?.max, b?.getMax?.() ?? b?.max)
      );
    });
  if (Matrix4x4)
    BindableProperty.setDefaultComparer<Laya.Matrix4x4>(Matrix4x4, (a, b) => {
      const ea = (a as any)?.elements;
      const eb = (b as any)?.elements;
      if (a === b) return true;
      if (!ea || !eb || ea.length !== eb.length) return false;
      for (let i = 0; i < ea.length; i++) if (ea[i] !== eb[i]) return false;
      return true;
    });
}

function autoRegisterComparers(): void {
  if (comparerAutoRegistered) return;
  comparerAutoRegistered = true;
  registerBuiltInComparers();
}

/** 可绑定属性：值发生变化时通知所有监听者 */
export class BindableProperty<T> implements IBindableProperty<T> {
  private static readonly sComparers = new Map<unknown, Comparer<any>>();

  /** 为指定类型设置默认比较器 */
  static setDefaultComparer<T>(type: unknown, comparer: Comparer<T>): void {
    BindableProperty.sComparers.set(type, comparer as Comparer<any>);
  }

  /** 获取指定类型的默认比较器 */
  static getDefaultComparer<T>(type: unknown): Comparer<T> | null {
    return (BindableProperty.sComparers.get(type) as Comparer<T>) ?? null;
  }

  protected mValue: T;
  private mComparer: Comparer<T>;
  private readonly mHandlers = new HandlerList<Action1<T>>();

  /**
   * @param defaultValue 初始值
   * @param type 类型标识（用于查找默认比较器），默认取初始值的构造函数
   */
  constructor(defaultValue?: T, type?: unknown) {
    autoRegisterComparers();
    this.mValue = defaultValue as T;
    const key = type ?? defaultTypeKey(defaultValue);
    this.mComparer = (key !== undefined ? BindableProperty.getDefaultComparer<T>(key) : null) ?? defaultComparer;
  }

  /** 设置自定义比较器 */
  withComparer(comparer: Comparer<T>): this {
    this.mComparer = comparer;
    return this;
  }

  get value(): T {
    return this.getValue();
  }

  set value(newValue: T) {
    if (this.mComparer(newValue, this.mValue)) return;
    this.setValue(newValue);
    this.mHandlers.forEach((onValueChanged) => onValueChanged(newValue));
  }

  protected setValue(newValue: T): void {
    this.mValue = newValue;
  }

  protected getValue(): T {
    return this.mValue;
  }

  /** 静默设置值，不触发值变更事件 */
  setValueWithoutEvent(newValue: T): void {
    this.mValue = newValue;
  }

  register(onValueChanged: Action1<T>): IUnRegister;
  register(onEvent: Action): IUnRegister;
  register(handler: Action | Action1<T>): IUnRegister {
    const onValueChanged = handler as Action1<T>;
    this.mHandlers.add(onValueChanged);
    return new BindablePropertyUnRegister<T>(this, onValueChanged);
  }

  /** 注册时立即回调一次当前值 */
  registerWithInitValue(onValueChanged: Action1<T>): IUnRegister {
    onValueChanged(this.mValue);
    return this.register(onValueChanged);
  }

  unRegister(onValueChanged: Action1<T>): void {
    this.mHandlers.remove(onValueChanged);
  }

  /** 清空所有监听 */
  clear(): void {
    this.mHandlers.clear();
  }

  toString(): string {
    return String(this.value);
  }
}

/** BindableProperty 的注销器 */
export class BindablePropertyUnRegister<T> implements IUnRegister {
  private mBindableProperty: BindableProperty<T> | null;
  private mOnValueChanged: Action1<T> | null;

  constructor(bindableProperty: BindableProperty<T>, onValueChanged: Action1<T>) {
    this.mBindableProperty = bindableProperty;
    this.mOnValueChanged = onValueChanged;
  }

  unRegister(): void {
    this.mBindableProperty?.unRegister(this.mOnValueChanged as Action1<T>);
    this.mBindableProperty = null;
    this.mOnValueChanged = null;
  }
}

// #endregion

// #region Rule

/** 属于某个架构 */
export interface IBelongToArchitecture {
  getArchitecture(): IArchitecture;
}

/** 可以被设置架构 */
export interface ICanSetArchitecture {
  setArchitecture(architecture: IArchitecture): void;
}

/** 可以获取 Model */
export interface ICanGetModel extends IBelongToArchitecture {
  getModel<TModel extends IModel>(key: TypeToken<TModel>): TModel | null;
}

/** 可以获取 System */
export interface ICanGetSystem extends IBelongToArchitecture {
  getSystem<TSystem extends ISystem>(key: TypeToken<TSystem>): TSystem | null;
}

/** 可以获取 Utility */
export interface ICanGetUtility extends IBelongToArchitecture {
  getUtility<TUtility extends IUtility>(key: TypeToken<TUtility>): TUtility | null;
}

/** 可以注册事件 */
export interface ICanRegisterEvent extends IBelongToArchitecture {
  registerEvent<T>(key: EventKey<T>, onEvent: Action1<T>): IUnRegister;
  unRegisterEvent<T>(key: EventKey<T>, onEvent: Action1<T>): void;
}

/** 可以发送命令 */
export interface ICanSendCommand extends IBelongToArchitecture {
  sendCommand<TResult = void>(command: ICommand<TResult>): TResult;
}

/** 可以发送事件 */
export interface ICanSendEvent extends IBelongToArchitecture {
  sendEvent<T>(e: T, key?: EventKey<T>): void;
  sendEventByType<T>(key: Type<T>, ...args: any[]): void;
}

/** 可以发送查询 */
export interface ICanSendQuery extends IBelongToArchitecture {
  sendQuery<TResult>(query: IQuery<TResult>): TResult;
}

/**
 * C# 中的扩展方法在 TS 中没有直接对应的语法，
 * 这里把「规则能力」的实现集中到 ArchitectureCapabilities，
 * 由 System / Model / Command / Query / Controller 直接复用。
 */
export class ArchitectureCapabilities {
  constructor(private readonly holder: IBelongToArchitecture) {}

  private get architecture(): IArchitecture {
    return this.holder.getArchitecture();
  }

  getSystem<TSystem extends ISystem>(key: TypeToken<TSystem>): TSystem | null {
    return this.architecture.getSystem<TSystem>(key);
  }

  getModel<TModel extends IModel>(key: TypeToken<TModel>): TModel | null {
    return this.architecture.getModel<TModel>(key);
  }

  getUtility<TUtility extends IUtility>(key: TypeToken<TUtility>): TUtility | null {
    return this.architecture.getUtility<TUtility>(key);
  }

  sendCommand<TResult = void>(command: ICommand<TResult>): TResult {
    return this.architecture.sendCommand<TResult>(command);
  }

  sendQuery<TResult>(query: IQuery<TResult>): TResult {
    return this.architecture.sendQuery<TResult>(query);
  }

  sendEvent<T>(e: T, key?: EventKey<T>): void {
    this.architecture.sendEvent<T>(e, key);
  }

  sendEventByType<T>(key: Type<T>, ...args: any[]): void {
    this.architecture.sendEventByType<T>(key, ...args);
  }

  registerEvent<T>(key: EventKey<T>, onEvent: Action1<T>): IUnRegister {
    return this.architecture.registerEvent<T>(key, onEvent);
  }

  unRegisterEvent<T>(key: EventKey<T>, onEvent: Action1<T>): void {
    this.architecture.unRegisterEvent<T>(key, onEvent);
  }
}

/** 架构持有者：统一处理“尚未注册到架构”的异常提示 */
class ArchitectureHolder implements IBelongToArchitecture, ICanSetArchitecture {
  private mArchitecture: IArchitecture | null = null;
  private readonly mOwner: string;

  /** @param owner 持有者实例，仅用于生成可读的错误信息 */
  constructor(owner: object) {
    this.mOwner = owner.constructor?.name ?? 'ArchitectureObject';
  }

  getArchitecture(): IArchitecture {
    if (!this.mArchitecture) {
      throw new Error(
        `[QFramework] ${this.mOwner} 尚未注册到架构，请先通过 Architecture.registerSystem / registerModel 注册。`,
      );
    }
    return this.mArchitecture;
  }

  setArchitecture(architecture: IArchitecture): void {
    this.mArchitecture = architecture;
  }
}

/**
 * Model 的架构绑定是框架内部实现细节。
 *
 * QFramework 规定 Model 只能使用 Utility 和发送事件，不能取得或操作
 * IArchitecture。用 WeakMap 保存 AbstractModel 的持有者，避免将绑定方法
 * 暴露在 Model 的公共 API 上。
 */
const architectureHolders = new WeakMap<object, ArchitectureHolder>();

function registerArchitectureHolder(owner: object, holder: ArchitectureHolder): void {
  architectureHolders.set(owner, holder);
}

/**
 * 绑定由框架持有的基类实例；保留对手写模块的兼容：若其自行实现了
 * setArchitecture，仍按原版 QFramework 的约定调用它。
 */
function bindArchitecture(owner: object, architecture: IArchitecture): void {
  const holder = architectureHolders.get(owner);
  if (holder) {
    holder.setArchitecture(architecture);
    return;
  }

  const legacyOwner = owner as { setArchitecture?: (value: IArchitecture) => void };
  legacyOwner.setArchitecture?.(architecture);
}

// #endregion

// #region Architecture

/** 架构接口 */
export interface IArchitecture {
  registerSystem<TSystem extends ISystem>(system: TSystem, key?: unknown): void;
  registerModel<TModel extends IModel>(model: TModel, key?: unknown): void;
  registerUtility<TUtility extends IUtility>(utility: TUtility, key?: unknown): void;

  getSystem<TSystem extends ISystem>(key: TypeToken<TSystem>): TSystem | null;
  getModel<TModel extends IModel>(key: TypeToken<TModel>): TModel | null;
  getUtility<TUtility extends IUtility>(key: TypeToken<TUtility>): TUtility | null;

  sendCommand<TResult = void>(command: ICommand<TResult>): TResult;
  sendQuery<TResult>(query: IQuery<TResult>): TResult;

  sendEvent<T>(e: T, key?: EventKey<T>): void;
  sendEventByType<T>(key: Type<T>, ...args: any[]): void;
  registerEvent<T>(key: EventKey<T>, onEvent: Action1<T>): IUnRegister;
  unRegisterEvent<T>(key: EventKey<T>, onEvent: Action1<T>): void;
}

/**
 * C# 中 Architecture<T> 的每个封闭泛型都有独立的静态字段，
 * TS 没有这一机制，因此统一使用一个以「子类构造函数」为 key 的注册表。
 */
const architectureInstances = new Map<unknown, IArchitecture>();

/** 正在 **构造** 中的架构：用于检测「构造函数 / 字段初始化器里访问 Interface」的死循环 */
const constructing = new Set<unknown>();

/** 正在 **初始化** 中的架构：用于检测跨架构的循环依赖 */
const initializing = new Set<unknown>();

function architectureName(ctor: unknown): string {
  return (ctor as { name?: string })?.name ?? 'Architecture';
}

function resolveArchitecture(ctor: unknown): IArchitecture {
  const existing = architectureInstances.get(ctor);
  if (existing) {
    // 实例已存在但仍在初始化中，说明形成了 A.init → B.init → A 的环
    if (initializing.has(ctor)) {
      throw new Error(
        `[QFramework] 检测到架构循环依赖：${architectureName(ctor)} 尚未完成初始化就被再次访问，` +
          '请检查各架构 init() 之间是否存在相互引用。',
      );
    }
    return existing;
  }

  // 构造函数（含字段初始化器）里访问 Interface 会导致无限递归，这里提前给出可读的错误
  if (constructing.has(ctor)) {
    throw new Error(
      `[QFramework] 检测到架构循环构造：${architectureName(ctor)} 的构造函数或字段初始化器中` +
        '不能访问 Interface / getInstance，请改为在 init() 或之后访问。',
    );
  }

  constructing.add(ctor);
  let created: IArchitecture;
  try {
    if ((ctor as { length?: number }).length !== 0) {
      throw new Error(
        `[QFramework] ${architectureName(ctor)} 的构造函数不能声明必填参数；` +
          'Architecture.Interface 只能无参创建架构实例。',
      );
    }
    created = new (ctor as Type<IArchitecture>)();
  } finally {
    constructing.delete(ctor);
  }

  architectureInstances.set(ctor, created);
  initializing.add(ctor);
  try {
    (created as unknown as Architecture<any>).makeSureArchitecture();
  } catch (error) {
    // 初始化失败时不能留下半成品，否则后续访问会拿到一个未就绪的架构
    architectureInstances.delete(ctor);
    throw error;
  } finally {
    initializing.delete(ctor);
  }

  return created;
}

/**
 * 架构基类。
 *
 * ```ts
 * class CounterApp extends Architecture<CounterApp> {
 *   protected init(): void {
 *     this.registerSystem(new CounterSystem());
 *     this.registerModel(new CounterModel());
 *   }
 * }
 *
 * CounterApp.Interface.sendCommand(new IncreaseCountCommand());
 * ```
 */
export abstract class Architecture<T extends Architecture<T>> implements IArchitecture {
  /** 架构初始化完成后的补丁回调（对应 C# 的 OnRegisterPatch） */
  static OnRegisterPatch: Action1<any> | null = null;

  /** 获取架构接口（首次访问时自动完成初始化） */
  static get Interface(): IArchitecture {
    return resolveArchitecture(this);
  }

  /** 获取架构实例（返回值带具体子类类型） */
  static getInstance<T extends Architecture<T>>(this: AbstractType<T> | Type<T>): T {
    return resolveArchitecture(this) as T;
  }

  private mInited = false;
  private readonly mSystems = new Set<ISystem>();
  private readonly mModels = new Set<IModel>();
  private readonly mContainer = new IOCContainer();
  private readonly mTypeEventSystem = new TypeEventSystem();

  /** 由子类实现，用于注册模块 */
  protected abstract init(): void;

  /**
   * 完成架构的初始化（只会执行一次）。
   * @internal 由 Interface / getInstance 首次访问时自动调用
   */
  makeSureArchitecture(): void {
    if (this.mInited) return;

    this.init();

    const patch = (this.constructor as unknown as typeof Architecture).OnRegisterPatch;
    patch?.(this);

    // 「排空队列」而不是「遍历快照后清空」：
    // 某模块的 init() 可能动态注册新模块，快照 + clear 会把它们静默丢弃。
    while (this.mModels.size > 0 || this.mSystems.size > 0) {
      while (this.mModels.size > 0) this.drainQueue(this.mModels);
      while (this.mSystems.size > 0) this.drainQueue(this.mSystems);
    }

    this.mInited = true;
  }

  /** 取出当前待初始化的模块并逐个初始化（先摘除再执行，保证只初始化一次） */
  private drainQueue(queue: Set<{ init(): void }>): void {
    const pending = Array.from(queue);
    queue.clear();
    for (const item of pending) item.init();
  }

  registerSystem<TSystem extends ISystem>(system: TSystem, key?: unknown): void {
    bindArchitecture(system, this);
    this.mContainer.register<TSystem>(system, key ?? defaultTypeKey(system));

    if (!this.mInited) {
      this.mSystems.add(system);
    } else {
      system.init();
    }
  }

  registerModel<TModel extends IModel>(model: TModel, key?: unknown): void {
    bindArchitecture(model, this);
    this.mContainer.register<TModel>(model, key ?? defaultTypeKey(model));

    if (!this.mInited) {
      this.mModels.add(model);
    } else {
      model.init();
    }
  }

  registerUtility<TUtility extends IUtility>(utility: TUtility, key?: unknown): void {
    this.mContainer.register<TUtility>(utility, key ?? defaultTypeKey(utility));
  }

  getSystem<TSystem extends ISystem>(key: TypeToken<TSystem>): TSystem | null {
    return this.mContainer.get<TSystem>(key);
  }

  getModel<TModel extends IModel>(key: TypeToken<TModel>): TModel | null {
    return this.mContainer.get<TModel>(key);
  }

  getUtility<TUtility extends IUtility>(key: TypeToken<TUtility>): TUtility | null {
    return this.mContainer.get<TUtility>(key);
  }

  sendCommand<TResult = void>(command: ICommand<TResult>): TResult {
    return this.executeCommand<TResult>(command);
  }

  /** 命令执行入口，子类可以重写以加入日志、拦截器逻辑 */
  protected executeCommand<TResult>(command: ICommand<TResult>): TResult {
    bindArchitecture(command, this);
    return command.execute();
  }

  sendQuery<TResult>(query: IQuery<TResult>): TResult {
    return this.doQuery<TResult>(query);
  }

  /** 查询执行入口，子类可以重写以加入日志、拦截器逻辑 */
  protected doQuery<TResult>(query: IQuery<TResult>): TResult {
    query.setArchitecture(this);
    return query.do();
  }

  sendEvent<T>(e: T, key?: EventKey<T>): void {
    this.mTypeEventSystem.send<T>(e, key);
  }

  sendEventByType<T>(key: Type<T>, ...args: any[]): void {
    this.mTypeEventSystem.sendByType<T>(key, ...args);
  }

  registerEvent<T>(key: EventKey<T>, onEvent: Action1<T>): IUnRegister {
    return this.mTypeEventSystem.register<T>(key, onEvent);
  }

  unRegisterEvent<T>(key: EventKey<T>, onEvent: Action1<T>): void {
    this.mTypeEventSystem.unRegister<T>(key, onEvent);
  }
}

// #endregion

// #region Command

/** 命令可使用所有业务能力，但不直接操作架构。 */
export interface ICommand<TResult = void> {
  getSystem<TSystem extends ISystem>(key: TypeToken<TSystem>): TSystem | null;
  getModel<TModel extends IModel>(key: TypeToken<TModel>): TModel | null;
  getUtility<TUtility extends IUtility>(key: TypeToken<TUtility>): TUtility | null;
  sendCommand<TCommandResult = void>(command: ICommand<TCommandResult>): TCommandResult;
  sendQuery<TQueryResult>(query: IQuery<TQueryResult>): TQueryResult;
  sendEvent<T>(e: T, key?: EventKey<T>): void;
  sendEventByType<T>(key: Type<T>, ...args: any[]): void;
  execute(): TResult;
}

/** 命令基类（无返回值） */
export abstract class AbstractCommand implements ICommand<void> {
  private readonly mHolder = new ArchitectureHolder(this);
  private readonly mCap = new ArchitectureCapabilities(this.mHolder);

  constructor() {
    registerArchitectureHolder(this, this.mHolder);
  }

  getSystem<TSystem extends ISystem>(key: TypeToken<TSystem>): TSystem | null {
    return this.mCap.getSystem<TSystem>(key);
  }

  getModel<TModel extends IModel>(key: TypeToken<TModel>): TModel | null {
    return this.mCap.getModel<TModel>(key);
  }

  getUtility<TUtility extends IUtility>(key: TypeToken<TUtility>): TUtility | null {
    return this.mCap.getUtility<TUtility>(key);
  }

  sendCommand<TResult = void>(command: ICommand<TResult>): TResult {
    return this.mCap.sendCommand<TResult>(command);
  }

  sendQuery<TResult>(query: IQuery<TResult>): TResult {
    return this.mCap.sendQuery<TResult>(query);
  }

  sendEvent<T>(e: T, key?: EventKey<T>): void {
    this.mCap.sendEvent<T>(e, key);
  }

  sendEventByType<T>(key: Type<T>, ...args: any[]): void {
    this.mCap.sendEventByType<T>(key, ...args);
  }

  execute(): void {
    this.onExecute();
  }

  protected abstract onExecute(): void;
}

/** 命令基类（带返回值，对应 C# 的 AbstractCommand<TResult>） */
export abstract class AbstractCommandWithResult<TResult> implements ICommand<TResult> {
  private readonly mHolder = new ArchitectureHolder(this);
  private readonly mCap = new ArchitectureCapabilities(this.mHolder);

  constructor() {
    registerArchitectureHolder(this, this.mHolder);
  }

  getSystem<TSystem extends ISystem>(key: TypeToken<TSystem>): TSystem | null {
    return this.mCap.getSystem<TSystem>(key);
  }

  getModel<TModel extends IModel>(key: TypeToken<TModel>): TModel | null {
    return this.mCap.getModel<TModel>(key);
  }

  getUtility<TUtility extends IUtility>(key: TypeToken<TUtility>): TUtility | null {
    return this.mCap.getUtility<TUtility>(key);
  }

  sendCommand<TCommandResult = void>(command: ICommand<TCommandResult>): TCommandResult {
    return this.mCap.sendCommand<TCommandResult>(command);
  }

  sendQuery<TQueryResult>(query: IQuery<TQueryResult>): TQueryResult {
    return this.mCap.sendQuery<TQueryResult>(query);
  }

  sendEvent<T>(e: T, key?: EventKey<T>): void {
    this.mCap.sendEvent<T>(e, key);
  }

  sendEventByType<T>(key: Type<T>, ...args: any[]): void {
    this.mCap.sendEventByType<T>(key, ...args);
  }

  execute(): TResult {
    return this.onExecute();
  }

  protected abstract onExecute(): TResult;
}

// #endregion

// #region Query

/** 查询 */
export interface IQuery<TResult>
  extends IBelongToArchitecture,
    ICanSetArchitecture,
    ICanGetModel,
    ICanGetSystem,
    ICanSendQuery {
  do(): TResult;
}

/** 查询基类 */
export abstract class AbstractQuery<TResult> implements IQuery<TResult> {
  private readonly mHolder = new ArchitectureHolder(this);
  private readonly mCap = new ArchitectureCapabilities(this.mHolder);

  getArchitecture(): IArchitecture {
    return this.mHolder.getArchitecture();
  }

  setArchitecture(architecture: IArchitecture): void {
    this.mHolder.setArchitecture(architecture);
  }

  getModel<TModel extends IModel>(key: TypeToken<TModel>): TModel | null {
    return this.mCap.getModel<TModel>(key);
  }

  getSystem<TSystem extends ISystem>(key: TypeToken<TSystem>): TSystem | null {
    return this.mCap.getSystem<TSystem>(key);
  }

  sendQuery<TQueryResult>(query: IQuery<TQueryResult>): TQueryResult {
    return this.mCap.sendQuery<TQueryResult>(query);
  }

  do(): TResult {
    return this.onDo();
  }

  protected abstract onDo(): TResult;
}

// #endregion

// #region System / Model / Utility

/** System 可访问领域模块和事件，但不直接操作架构。 */
export interface ISystem {
  getModel<TModel extends IModel>(key: TypeToken<TModel>): TModel | null;
  getSystem<TSystem extends ISystem>(key: TypeToken<TSystem>): TSystem | null;
  getUtility<TUtility extends IUtility>(key: TypeToken<TUtility>): TUtility | null;
  sendEvent<T>(e: T, key?: EventKey<T>): void;
  sendEventByType<T>(key: Type<T>, ...args: any[]): void;
  registerEvent<T>(key: EventKey<T>, onEvent: Action1<T>): IUnRegister;
  unRegisterEvent<T>(key: EventKey<T>, onEvent: Action1<T>): void;
  init(): void;
}

/** System 基类 */
export abstract class AbstractSystem implements ISystem {
  private readonly mHolder = new ArchitectureHolder(this);
  private readonly mCap = new ArchitectureCapabilities(this.mHolder);

  constructor() {
    registerArchitectureHolder(this, this.mHolder);
  }

  getModel<TModel extends IModel>(key: TypeToken<TModel>): TModel | null {
    return this.mCap.getModel<TModel>(key);
  }

  getSystem<TSystem extends ISystem>(key: TypeToken<TSystem>): TSystem | null {
    return this.mCap.getSystem<TSystem>(key);
  }

  getUtility<TUtility extends IUtility>(key: TypeToken<TUtility>): TUtility | null {
    return this.mCap.getUtility<TUtility>(key);
  }

  sendEvent<T>(e: T, key?: EventKey<T>): void {
    this.mCap.sendEvent<T>(e, key);
  }

  sendEventByType<T>(key: Type<T>, ...args: any[]): void {
    this.mCap.sendEventByType<T>(key, ...args);
  }

  registerEvent<T>(key: EventKey<T>, onEvent: Action1<T>): IUnRegister {
    return this.mCap.registerEvent<T>(key, onEvent);
  }

  unRegisterEvent<T>(key: EventKey<T>, onEvent: Action1<T>): void {
    this.mCap.unRegisterEvent<T>(key, onEvent);
  }

  init(): void {
    this.onInit();
  }

  protected abstract onInit(): void;
}

/**
 * Model 只能获取 Utility 和发送事件。
 *
 * 架构绑定由 Architecture.registerModel 在内部完成；Model 不暴露
 * getArchitecture / setArchitecture，以维持 QFramework 的分层约束。
 */
export interface IModel {
  getUtility<TUtility extends IUtility>(key: TypeToken<TUtility>): TUtility | null;
  sendEvent<T>(e: T, key?: EventKey<T>): void;
  sendEventByType<T>(key: Type<T>, ...args: any[]): void;
  init(): void;
}

/** Model 基类 */
export abstract class AbstractModel implements IModel {
  private readonly mHolder = new ArchitectureHolder(this);
  private readonly mCap = new ArchitectureCapabilities(this.mHolder);

  constructor() {
    registerArchitectureHolder(this, this.mHolder);
  }

  getUtility<TUtility extends IUtility>(key: TypeToken<TUtility>): TUtility | null {
    return this.mCap.getUtility<TUtility>(key);
  }

  sendEvent<T>(e: T, key?: EventKey<T>): void {
    this.mCap.sendEvent<T>(e, key);
  }

  sendEventByType<T>(key: Type<T>, ...args: any[]): void {
    this.mCap.sendEventByType<T>(key, ...args);
  }

  init(): void {
    this.onInit();
  }

  protected abstract onInit(): void;
}

/** Utility（基础设施层，一般只做纯粹的工具） */
export interface IUtility {
  // Utility 本身没有任何约束
}

// #endregion

// #region Controller

/** Controller：架构的入口，Laya 中一般以脚本组件的形式存在 */
export interface IController
  extends IBelongToArchitecture,
    ICanSendCommand,
    ICanGetSystem,
    ICanGetModel,
    ICanRegisterEvent,
    ICanSendQuery,
    ICanGetUtility {}

/**
 * Laya 版的 Controller 基类。
 *
 * 继承 Laya.Script，因此可以直接挂到 Laya 的节点上，
 * 并拥有 onAwake / onEnable / onStart / onUpdate / onDestroy 等生命周期。
 *
 * ```ts
 * class GameCtrl extends AbstractController {
 *   private readonly mCount = new BindableProperty<number>(0);
 *
 *   protected onInit(): void {
 *     // 已挂到节点、架构已就绪
 *     this.registerEvent(GameStartEvent, (e) => this.mCount.value++);
 *   }
 *
 *   protected onDestroy(): void {
 *     super.onDestroy();
 *   }
 * }
 * ```
 */
export abstract class AbstractController extends LayaScriptBase() implements IController {
  private readonly mHolder = new ArchitectureHolder(this);
  private readonly mCap = new ArchitectureCapabilities(this.mHolder);
  private mArchitecture: IArchitecture | null = null;

  /** 所属的 Laya 节点（等价于 Laya.Component.owner） */
  get node(): Laya.Node {
    return (this as unknown as Laya.Script).owner;
  }

  getArchitecture(): IArchitecture {
    if (!this.mArchitecture) {
      throw new Error(
        '[QFramework] AbstractController 尚未绑定架构，请重写 getArchitectureClass() 或在 onAwake 前调用 setArchitecture()。',
      );
    }
    return this.mArchitecture;
  }

  setArchitecture(architecture: IArchitecture): void {
    this.mArchitecture = architecture;
    this.mHolder.setArchitecture(architecture);
  }

  /**
   * 绑定架构的构造函数，重写后会在 onAwake 阶段自动完成架构绑定与初始化。
   * ```ts
   * protected getArchitectureClass(): AbstractType<CounterApp> { return CounterApp; }
   * ```
   */
  protected getArchitectureClass(): AbstractType<Architecture<any>> | null {
    return null;
  }

  getSystem<TSystem extends ISystem>(key: TypeToken<TSystem>): TSystem | null {
    return this.mCap.getSystem<TSystem>(key);
  }

  getModel<TModel extends IModel>(key: TypeToken<TModel>): TModel | null {
    return this.mCap.getModel<TModel>(key);
  }

  getUtility<TUtility extends IUtility>(key: TypeToken<TUtility>): TUtility | null {
    return this.mCap.getUtility<TUtility>(key);
  }

  sendCommand<TResult = void>(command: ICommand<TResult>): TResult {
    return this.mCap.sendCommand<TResult>(command);
  }

  sendQuery<TResult>(query: IQuery<TResult>): TResult {
    return this.mCap.sendQuery<TResult>(query);
  }

  registerEvent<T>(key: EventKey<T>, onEvent: Action1<T>): IUnRegister {
    return this.mCap.registerEvent<T>(key, onEvent);
  }

  unRegisterEvent<T>(key: EventKey<T>, onEvent: Action1<T>): void {
    this.mCap.unRegisterEvent<T>(key, onEvent);
  }

  onAwake(): void {
    const architectureClass = this.getArchitectureClass();
    if (architectureClass && !this.mArchitecture) {
      this.setArchitecture(resolveArchitecture(architectureClass));
    }
    this.onInit();
  }

  /** 架构就绪后调用，子类在此注册事件、初始化数据 */
  protected onInit(): void {
    // 子类按需重写
  }
}

// #endregion

// #region Laya 适配：节点销毁时自动注销

/** 挂在节点上的注销触发器组件 */
export interface IUnRegisterTrigger {
  addUnRegister(unRegister: IUnRegister): void;
  removeUnRegister(unRegister: IUnRegister): void;
}

let unRegisterTriggerType: Type<IUnRegisterTrigger & Laya.Component> | null = null;

/** 获取（第一次调用时创建）注销触发器组件类型 */
export function getUnRegisterOnDestroyTriggerType(): Type<IUnRegisterTrigger & Laya.Component> {
  if (unRegisterTriggerType) return unRegisterTriggerType;

  const Base = LayaScriptBase();

  class UnRegisterOnDestroyTrigger extends Base implements IUnRegisterTrigger {
    private readonly mUnRegisters = new Set<IUnRegister>();

    addUnRegister(unRegister: IUnRegister): void {
      this.mUnRegisters.add(unRegister);
    }

    removeUnRegister(unRegister: IUnRegister): void {
      this.mUnRegisters.delete(unRegister);
    }

    onDestroy(): void {
      for (const unRegister of Array.from(this.mUnRegisters)) unRegister.unRegister();
      this.mUnRegisters.clear();
    }
  }

  unRegisterTriggerType = UnRegisterOnDestroyTrigger as unknown as Type<IUnRegisterTrigger & Laya.Component>;
  return unRegisterTriggerType;
}

/**
 * 节点销毁时自动注销（对应 C# 的 UnRegisterWhenGameObjectDestroyed）。
 * 会在节点上挂一个触发器组件（同一个节点只会挂一次）。
 */
export function unRegisterWhenNodeDestroyed(unRegister: IUnRegister, node: Laya.Node): IUnRegister {
  requireLaya();
  const triggerType = getUnRegisterOnDestroyTriggerType();
  let trigger = node.getComponent(triggerType) as (IUnRegisterTrigger & Laya.Component) | null;
  if (!trigger) trigger = node.addComponent(triggerType);
  trigger.addUnRegister(unRegister);
  return unRegister;
}

/** 组件所属节点销毁时自动注销 */
export function unRegisterWhenComponentDestroyed(
  unRegister: IUnRegister,
  component: Laya.Component,
): IUnRegister {
  return unRegisterWhenNodeDestroyed(unRegister, component.owner);
}

// #endregion

// #region Event Extension

/**
 * Or 事件：任意一个源事件触发时，都会触发本事件。
 * ```ts
 * new OrEvent().or(coinChanged).or(hpChanged).register(() => refresh());
 * ```
 */
export class OrEvent implements IUnRegisterList {
  readonly unregisterList: IUnRegister[] = [];

  private readonly mHandlers = new HandlerList<Action>();

  or(easyEvent: IEasyEvent): this {
    this.unregisterList.push(easyEvent.register(() => this.trigger()));
    return this;
  }

  /**
   * 注意：这里返回的注销器走的是 `unRegister`，
   * 而不是「仅摘除回调」——OrEvent 的注销还包含「一并注销所有源事件」。
   */
  register(onEvent: Action): IUnRegister {
    this.mHandlers.add(onEvent);
    return new CustomUnRegister(() => this.unRegister(onEvent));
  }

  /**
   * 注销回调。
   * 与 C# 原版保持一致：注销自身回调的同时会一并注销所有源事件。
   */
  unRegister(onEvent: Action): void {
    this.mHandlers.remove(onEvent);
    unRegisterAll(this);
  }

  private trigger(): void {
    this.mHandlers.forEach((onEvent) => onEvent());
  }
}

/** 将两个事件合并为 Or 事件（C# 中的 OrEventExtensions.Or） */
export function orEvent(self: IEasyEvent, e: IEasyEvent): OrEvent {
  return new OrEvent().or(self).or(e);
}

// #endregion
