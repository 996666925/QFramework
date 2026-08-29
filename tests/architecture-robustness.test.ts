/**
 * 架构健壮性回归测试：初始化期间的动态注册、初始化失败、循环构造 / 循环依赖。
 *
 * 这些用例对应历史上真实存在过的缺陷，修复后必须保持通过。
 */

import { describe, expect, test } from '@rstest/core';
import { AbstractModel, AbstractSystem, Architecture } from '../src/index';

// #region 初始化期间动态注册

describe('初始化期间动态注册模块', () => {
  test('01 - Model.onInit 中注册的 Model 也会被初始化', () => {
    class InnerModel extends AbstractModel {
      inited = false;
      protected onInit(): void {
        this.inited = true;
      }
    }
    class OuterModel extends AbstractModel {
      protected onInit(): void {
        this.getArchitecture().registerModel(new InnerModel());
      }
    }

    class App extends Architecture<App> {
      protected init(): void {
        this.registerModel(new OuterModel());
      }
    }

    void App.Interface;

    expect(App.Interface.getModel(InnerModel)).toBeInstanceOf(InnerModel);
    expect(App.Interface.getModel(InnerModel)!.inited).toBe(true);
  });

  test('02 - System.onInit 中注册的 System 也会被初始化', () => {
    class InnerSystem extends AbstractSystem {
      inited = false;
      protected onInit(): void {
        this.inited = true;
      }
    }
    class OuterSystem extends AbstractSystem {
      protected onInit(): void {
        // 注意：ISystem 不提供 registerSystem（与 C# 的分层一致），需经由架构注册
        this.getArchitecture().registerSystem(new InnerSystem());
      }
    }

    class App extends Architecture<App> {
      protected init(): void {
        this.registerSystem(new OuterSystem());
      }
    }

    void App.Interface;

    expect(App.Interface.getSystem(InnerSystem)).toBeInstanceOf(InnerSystem);
    expect(App.Interface.getSystem(InnerSystem)!.inited).toBe(true);
  });

  test('03 - Model.onInit 中注册的 System 也会被初始化', () => {
    class LazySystem extends AbstractSystem {
      inited = false;
      protected onInit(): void {
        this.inited = true;
      }
    }
    class BootstrapModel extends AbstractModel {
      protected onInit(): void {
        this.getArchitecture().registerSystem(new LazySystem());
      }
    }

    class App extends Architecture<App> {
      protected init(): void {
        this.registerModel(new BootstrapModel());
      }
    }

    void App.Interface;

    expect(App.Interface.getSystem(LazySystem)!.inited).toBe(true);
  });

  test('04 - 每个模块只 init 一次', () => {
    const counts = new Map<string, number>();
    const bump = (name: string) => counts.set(name, (counts.get(name) ?? 0) + 1);

    class A extends AbstractSystem {
      protected onInit(): void {
        bump('A');
        this.getArchitecture().registerSystem(new B());
      }
    }
    class B extends AbstractSystem {
      protected onInit(): void {
        bump('B');
        this.getArchitecture().registerSystem(new C());
      }
    }
    class C extends AbstractSystem {
      protected onInit(): void {
        bump('C');
      }
    }

    class App extends Architecture<App> {
      protected init(): void {
        this.registerSystem(new A());
      }
    }

    void App.Interface;

    expect(counts.get('A')).toBe(1);
    expect(counts.get('B')).toBe(1);
    expect(counts.get('C')).toBe(1);
  });

  test('05 - 初始化结束后内部队列被清空', () => {
    class SimpleSystem extends AbstractSystem {
      protected onInit(): void {}
    }
    class App extends Architecture<App> {
      protected init(): void {
        this.registerSystem(new SimpleSystem());
      }
      /** 供测试观察内部队列 */
      peekPending(): number {
        return (this as unknown as { mSystems: Set<unknown> }).mSystems.size;
      }
    }

    const app = App.getInstance();
    expect(app.peekPending()).toBe(0);
  });
});

// #endregion

// #region 初始化失败

describe('初始化失败', () => {
  test('01 - init 抛异常时错误会向外传播', () => {
    class BadApp extends Architecture<BadApp> {
      protected init(): void {
        throw new Error('boom');
      }
    }

    expect(() => BadApp.Interface).toThrow('boom');
  });

  test('02 - init 失败后不会污染注册表（再次访问仍抛同样的错误，不重复注册模块）', () => {
    let registerCount = 0;

    class Model extends AbstractModel {
      protected onInit(): void {}
    }
    class BadApp extends Architecture<BadApp> {
      protected init(): void {
        registerCount++;
        this.registerModel(new Model());
        throw new Error('boom');
      }
    }

    expect(() => BadApp.Interface).toThrow('boom');
    expect(() => BadApp.Interface).toThrow('boom');

    // 失败后不应留下可用的半成品实例
    expect(registerCount).toBe(2); // 每次访问都重试一次，但只重试一次
    expect(() => BadApp.Interface.getModel(Model)).toThrow();
  });
});

// #endregion

// #region 循环构造

describe('循环构造 / 循环依赖', () => {
  test('01 - 构造函数中访问 Interface 会抛出明确错误（而不是栈溢出）', () => {
    class CyclicApp extends Architecture<CyclicApp> {
      // 字段初始化器里访问 Interface：构造期 → 再次 resolve → 死循环
      private readonly mSelf = CyclicApp.Interface;

      protected init(): void {}
    }

    expect(() => CyclicApp.Interface).toThrow(/循环|circular|Cyclic/i);
    expect(() => CyclicApp.Interface).toThrow(/架构/);
  });

  test('02 - 循环依赖检测：A.init → B.Interface → B.init → A.Interface', () => {
    class AppA extends Architecture<AppA> {
      protected init(): void {
        void AppB.Interface;
      }
    }
    class AppB extends Architecture<AppB> {
      protected init(): void {
        void AppA.Interface;
      }
    }

    // 期望：抛出明确的循环依赖错误，而不是返回一个半成品架构
    let thrown: unknown = null;
    try {
      void AppA.Interface;
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect(String(thrown)).toMatch(/循环|circular/i);
  });
});

// #endregion
