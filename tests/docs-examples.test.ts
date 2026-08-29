/**
 * 文档示例验证测试。
 *
 * 目的：确保 docs/GETTING-STARTED.md 里的代码是真的能跑的，
 * 而不是"看起来对"的伪代码。文档一旦更新，这里的用例也要同步。
 */

import { describe, expect, test } from '@rstest/core';
import {
  AbstractCommand,
  AbstractCommandWithResult,
  AbstractController,
  AbstractModel,
  AbstractQuery,
  AbstractSystem,
  Architecture,
  BindableProperty,
  CustomUnRegister,
  EasyEvent,
  TypeEventSystem,
  orEvent,
  registerGlobalEvent,
  unRegisterGlobalEvent,
  unRegisterWhenComponentDestroyed,
  unRegisterWhenNodeDestroyed,
} from '../src/index';
import type { IArchitecture, ICommand, IOnEvent, IQuery, IUtility } from '../src/index';
import { StubNode } from './laya-stub';

// #region 第 1 章 计数器

class CounterModel extends AbstractModel {
  readonly count = new BindableProperty<number>(0);
  protected onInit(): void {
    this.count.value = 0;
  }
}

class IncreaseCountCommand extends AbstractCommand {
  protected onExecute(): void {
    this.getModel(CounterModel)!.count.value++;
  }
}

class GetCountQuery extends AbstractQuery<number> {
  protected onDo(): number {
    return this.getModel(CounterModel)!.count.value;
  }
}

class CounterApp extends Architecture<CounterApp> {
  protected init(): void {
    this.registerModel(new CounterModel());
  }
}

describe('第 1 章：五分钟跑通第一个架构', () => {
  test('完整示例可运行', () => {
    CounterApp.Interface.sendCommand(new IncreaseCountCommand());
    expect(CounterApp.Interface.sendQuery(new GetCountQuery())).toBe(1);

    CounterApp.Interface.sendCommand(new IncreaseCountCommand());
    expect(CounterApp.Interface.sendQuery(new GetCountQuery())).toBe(2);
  });
});

// #endregion

// #region 第 2 章 BindableProperty

describe('第 2 章：BindableProperty', () => {
  test('基本用法：相同值不触发', () => {
    const hp = new BindableProperty<number>(100);
    const values: number[] = [];

    hp.register((v) => values.push(v));
    hp.value = 80;
    hp.value = 80;
    hp.value = 60;

    expect(values).toEqual([80, 60]);
  });

  test('registerWithInitValue 先回调一次当前值', () => {
    const hp = new BindableProperty<number>(100);
    const values: number[] = [];

    hp.registerWithInitValue((v) => values.push(v));
    hp.value = 80;

    expect(values).toEqual([100, 80]);
  });

  test('复杂对象默认按引用比较', () => {
    class Point {
      constructor(
        public x = 0,
        public y = 0,
      ) {}
    }
    const p = new BindableProperty<Point>(new Point(1, 1));
    let hit = 0;
    p.register(() => hit++);

    p.value = new Point(1, 1);
    expect(hit).toBe(1);
  });

  test('办法 1：给类型加 static equals', () => {
    class Point {
      constructor(
        public x = 0,
        public y = 0,
      ) {}
      static equals(a: Point, b: Point): boolean {
        return a.x === b.x && a.y === b.y;
      }
    }
    const p = new BindableProperty<Point>(new Point(1, 1));
    let hit = 0;
    p.register(() => hit++);

    p.value = new Point(1, 1);
    expect(hit).toBe(0);
  });

  test('办法 2：注册全局比较器', () => {
    class Money {
      constructor(public cents = 0) {}
    }
    BindableProperty.setDefaultComparer<Money>(Money, (a, b) => a.cents === b.cents);

    const m = new BindableProperty<Money>(new Money(100));
    let hit = 0;
    m.register(() => hit++);

    m.value = new Money(100);
    expect(hit).toBe(0);
    m.value = new Money(200);
    expect(hit).toBe(1);
  });

  test('办法 3：实例级 withComparer', () => {
    class Point {
      constructor(public x = 0) {}
    }
    const p = new BindableProperty<Point>(new Point(0)).withComparer((a, b) => a.x === b.x);
    let hit = 0;
    p.register(() => hit++);

    p.value = new Point(0);
    expect(hit).toBe(0);
    p.value = new Point(1);
    expect(hit).toBe(1);
  });

  test('setValueWithoutEvent 静默改值', () => {
    const hp = new BindableProperty<number>(0);
    let hit = 0;
    hp.register(() => hit++);

    hp.setValueWithoutEvent(5);
    expect(hit).toBe(0);
    expect(hp.value).toBe(5);
  });
});

// #endregion

// #region 第 3 章 事件

class CountChangedEvent {
  constructor(public readonly value: number) {}
}

class EmitCountCommand extends AbstractCommand {
  protected onExecute(): void {
    const model = this.getModel(CounterModel)!;
    model.count.value++;
    this.sendEvent(new CountChangedEvent(model.count.value));
  }
}

describe('第 3 章：事件', () => {
  test('sendEvent / registerEvent / unRegisterEvent', () => {
    const received: number[] = [];
    const handler = (e: CountChangedEvent) => received.push(e.value);

    CounterApp.Interface.registerEvent(CountChangedEvent, handler);
    CounterApp.Interface.sendCommand(new EmitCountCommand());
    expect(received.length).toBeGreaterThan(0);

    CounterApp.Interface.unRegisterEvent(CountChangedEvent, handler);
    const before = received.length;
    CounterApp.Interface.sendCommand(new EmitCountCommand());
    expect(received.length).toBe(before);
  });

  test('字符串轻量通道', () => {
    const received: string[] = [];
    CounterApp.Interface.registerEvent<string>('ui:refresh', (e) => received.push(e));
    CounterApp.Interface.sendEvent<string>('panel', 'ui:refresh');
    expect(received).toEqual(['panel']);
  });

  test('全局事件：必须保存引用才能注销', () => {
    let hit = 0;
    const handler = () => hit++;

    TypeEventSystem.Global.register<CountChangedEvent>(CountChangedEvent, handler);
    TypeEventSystem.Global.unRegister<CountChangedEvent>(CountChangedEvent, handler);
    TypeEventSystem.Global.send(new CountChangedEvent(1));

    expect(hit).toBe(0);
  });

  test('全局事件：IOnEvent + registerGlobalEvent 可正确注销', () => {
    const received: number[] = [];
    class Player implements IOnEvent<CountChangedEvent> {
      onEvent(e: CountChangedEvent): void {
        received.push(e.value);
      }
    }
    const player = new Player();

    registerGlobalEvent(player, CountChangedEvent);
    TypeEventSystem.Global.send(new CountChangedEvent(1));
    unRegisterGlobalEvent(player, CountChangedEvent);
    TypeEventSystem.Global.send(new CountChangedEvent(2));

    expect(received).toEqual([1]);
  });

  test('OrEvent', () => {
    const coinChanged = new EasyEvent();
    const hpChanged = new EasyEvent();
    let hit = 0;

    orEvent(coinChanged, hpChanged).register(() => hit++);

    coinChanged.trigger();
    hpChanged.trigger();
    expect(hit).toBe(2);
  });
});

// #endregion

// #region 第 4 章 Command / Query

class ShopModel extends AbstractModel {
  readonly coin = new BindableProperty<number>(100);
  protected onInit(): void {
    this.coin.value = 100;
  }
}

class PriceTable implements IUtility {
  private readonly mPrices: Record<string, number> = { sword: 60, shield: 150 };
  getPrice(itemId: string): number {
    return this.mPrices[itemId] ?? Number.MAX_SAFE_INTEGER;
  }
}

class PurchaseSucceededEvent {
  constructor(
    public readonly itemId: string,
    public readonly restCoin: number,
  ) {}
}
class PurchaseFailedEvent {
  constructor(public readonly reason: string) {}
}

class PurchaseCommand extends AbstractCommandWithResult<boolean> {
  constructor(private readonly itemId: string) {
    super();
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

class EarnCoinCommand extends AbstractCommand {
  constructor(private readonly amount: number) {
    super();
  }
  protected onExecute(): void {
    this.getModel(ShopModel)!.coin.value += this.amount;
  }
}

class CanAffordQuery extends AbstractQuery<boolean> {
  constructor(private readonly price: number) {
    super();
  }
  protected onDo(): boolean {
    return this.getModel(ShopModel)!.coin.value >= this.price;
  }
}

class AddCountCommand extends AbstractCommand {
  constructor(private readonly delta: number) {
    super();
  }
  protected onExecute(): void {
    this.getModel(CounterModel)!.count.value += this.delta;
  }
}

class AddTwiceCommand extends AbstractCommand {
  constructor(private readonly delta: number) {
    super();
  }
  protected onExecute(): void {
    this.sendCommand(new AddCountCommand(this.delta));
    this.sendCommand(new AddCountCommand(this.delta));
  }
}

class LoggingApp extends Architecture<LoggingApp> {
  static readonly log: string[] = [];

  protected init(): void {
    this.registerModel(new CounterModel());
  }

  protected override executeCommand<TResult>(command: ICommand<TResult>): TResult {
    LoggingApp.log.push(`cmd:${command.constructor.name}`);
    return super.executeCommand(command);
  }

  protected override doQuery<TResult>(query: IQuery<TResult>): TResult {
    LoggingApp.log.push(`query:${query.constructor.name}`);
    return super.doQuery(query);
  }
}

describe('第 4 章：Command 与 Query', () => {
  test('带返回值的命令', () => {
    class ShopApp extends Architecture<ShopApp> {
      protected init(): void {
        this.registerModel(new ShopModel());
        this.registerUtility(new PriceTable());
      }
    }

    const ok = ShopApp.Interface.sendCommand(new PurchaseCommand('sword'));
    expect(ok).toBe(true);
    expect(ShopApp.Interface.getModel(ShopModel)!.coin.value).toBe(40);

    const failed = ShopApp.Interface.sendCommand(new PurchaseCommand('shield'));
    expect(failed).toBe(false);
    expect(ShopApp.Interface.getModel(ShopModel)!.coin.value).toBe(40);
  });

  test('命令带构造参数', () => {
    const before = CounterApp.Interface.sendQuery(new GetCountQuery());
    CounterApp.Interface.sendCommand(new AddCountCommand(5));
    expect(CounterApp.Interface.sendQuery(new GetCountQuery())).toBe(before + 5);
  });

  test('命令嵌套', () => {
    const before = CounterApp.Interface.sendQuery(new GetCountQuery());
    CounterApp.Interface.sendCommand(new AddTwiceCommand(3));
    expect(CounterApp.Interface.sendQuery(new GetCountQuery())).toBe(before + 6);
  });

  test('Query 带参数', () => {
    class ShopApp2 extends Architecture<ShopApp2> {
      protected init(): void {
        this.registerModel(new ShopModel());
      }
    }
    expect(ShopApp2.Interface.sendQuery(new CanAffordQuery(60))).toBe(true);
    expect(ShopApp2.Interface.sendQuery(new CanAffordQuery(150))).toBe(false);
  });

  test('Query 拿不到 Utility（分层约束）', () => {
    const query = new CanAffordQuery(1);
    expect((query as unknown as { getUtility?: unknown }).getUtility).toBeUndefined();
  });

  test('重写 executeCommand / doQuery 做拦截', () => {
    LoggingApp.log.length = 0;
    LoggingApp.Interface.sendCommand(new AddCountCommand(1));
    LoggingApp.Interface.sendQuery(new GetCountQuery());

    expect(LoggingApp.log).toEqual(['cmd:AddCountCommand', 'query:GetCountQuery']);
  });
});

// #endregion

// #region 第 5 章 System

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

describe('第 5 章：System', () => {
  test('System 监听事件做联动', () => {
    class SysApp extends Architecture<SysApp> {
      protected init(): void {
        this.registerModel(new ShopModel());
        this.registerSystem(new AchievementSystem());
        this.registerUtility(new PriceTable());
      }
    }

    // 100 → 买剑(60) → 40 → 打工(+20) → 60 → 买剑(60) → 0
    SysApp.Interface.sendCommand(new PurchaseCommand('sword'));
    SysApp.Interface.sendCommand(new EarnCoinCommand(20));
    SysApp.Interface.sendCommand(new PurchaseCommand('sword'));

    const achievements = SysApp.Interface.getSystem(AchievementSystem)!;
    expect(SysApp.Interface.getModel(ShopModel)!.coin.value).toBe(0);
    expect(achievements.unlocked).toContain('连续购买');
    expect(achievements.unlocked).toContain('一贫如洗');
  });

  test('System 的 onInit 里可以安全取 Model（初始化顺序保证）', () => {
    class StatSystem extends AbstractSystem {
      initialCoin = -1;
      protected onInit(): void {
        this.initialCoin = this.getModel(ShopModel)!.coin.value;
      }
    }
    class OrderApp extends Architecture<OrderApp> {
      protected init(): void {
        this.registerModel(new ShopModel());
        this.registerSystem(new StatSystem());
      }
    }

    expect(OrderApp.Interface.getSystem(StatSystem)!.initialCoin).toBe(100);
  });

  test('各层能力矩阵', () => {
    const command = new AddCountCommand(1);
    const query = new GetCountQuery();
    const model = new ShopModel();
    const system = new AchievementSystem();

    // Command 全能
    expect(typeof command.getModel).toBe('function');
    expect(typeof command.getSystem).toBe('function');
    expect(typeof command.getUtility).toBe('function');
    expect(typeof command.sendCommand).toBe('function');
    expect(typeof command.sendQuery).toBe('function');
    expect(typeof command.sendEvent).toBe('function');

    // Query：能读，不能写，拿不到 Utility
    expect(typeof query.getModel).toBe('function');
    expect(typeof query.sendQuery).toBe('function');
    expect((query as unknown as { getUtility?: unknown }).getUtility).toBeUndefined();
    expect((query as unknown as { sendCommand?: unknown }).sendCommand).toBeUndefined();
    expect((query as unknown as { sendEvent?: unknown }).sendEvent).toBeUndefined();

    // Model：能取 Utility、发事件；不能发命令、注册事件
    expect(typeof model.getUtility).toBe('function');
    expect(typeof model.sendEvent).toBe('function');
    expect((model as unknown as { sendCommand?: unknown }).sendCommand).toBeUndefined();
    expect((model as unknown as { registerEvent?: unknown }).registerEvent).toBeUndefined();

    // System：能注册事件、发事件；不能发命令
    expect(typeof system.registerEvent).toBe('function');
    expect(typeof system.sendEvent).toBe('function');
    expect((system as unknown as { sendCommand?: unknown }).sendCommand).toBeUndefined();
  });
});

// #endregion

// #region 第 6 章 Laya 接入

describe('第 6 章：接入 LayaAir', () => {
  class HudController extends AbstractController {
    rendered: number[] = [];

    protected getArchitectureClass() {
      return CounterApp;
    }

    protected onInit(): void {
      const model = this.getModel(CounterModel)!;
      unRegisterWhenNodeDestroyed(
        model.count.registerWithInitValue((v) => this.rendered.push(v)),
        this.node,
      );
    }

    onAddClick(): void {
      this.sendCommand(new IncreaseCountCommand());
    }
  }

  test('Controller 即 Laya.Script，可挂到节点', () => {
    const node = new StubNode();
    const ctrl = node.addComponent(HudController);

    expect(node.getComponent(HudController)).toBe(ctrl);
    expect(ctrl.node).toBe(node);
  });

  test('onAwake 完成架构绑定并回调 onInit', () => {
    const node = new StubNode();
    const ctrl = node.addComponent(HudController);

    expect(ctrl.rendered).toEqual([]);
    ctrl.onAwake();

    expect(ctrl.rendered.length).toBe(1); // registerWithInitValue 先回调一次
    expect(ctrl.getArchitecture()).toBe(CounterApp.Interface);
  });

  test('onAddClick 发命令后 UI 自动刷新', () => {
    const node = new StubNode();
    const ctrl = node.addComponent(HudController);
    ctrl.onAwake();
    const before = ctrl.rendered.length;

    ctrl.onAddClick();

    expect(ctrl.rendered.length).toBe(before + 1);
  });

  test('节点销毁后不再收到通知', () => {
    const node = new StubNode();
    const ctrl = node.addComponent(HudController);
    ctrl.onAwake();
    const before = ctrl.rendered.length;

    node.destroy();
    CounterApp.Interface.sendCommand(new IncreaseCountCommand());

    expect(ctrl.rendered.length).toBe(before);
  });

  test('四种注销用法', () => {
    const node = new StubNode() as unknown as Laya.Node;
    const model = new CounterModel();
    let cleanup = 0;

    // 1. BindableProperty
    unRegisterWhenNodeDestroyed(model.count.register(() => {}), node);
    // 2. 自定义注销器
    unRegisterWhenNodeDestroyed(new CustomUnRegister(() => cleanup++), node);
    // 4. 组件形式
    const comp = new StubNode().addComponent(HudController) as unknown as Laya.Component;
    unRegisterWhenComponentDestroyed(new CustomUnRegister(() => cleanup++), comp);

    expect(cleanup).toBe(0);
    (node as unknown as StubNode).destroy();
    expect(cleanup).toBe(1);
  });

  test('手动绑定架构', () => {
    class ManualController extends AbstractController {
      protected onInit(): void {}
    }
    const node = new StubNode();
    const ctrl = node.addComponent(ManualController);

    ctrl.setArchitecture(CounterApp.Interface);
    expect(ctrl.getArchitecture()).toBe(CounterApp.Interface);
  });

  test('未绑定架构时报错', () => {
    class OrphanController extends AbstractController {}
    const node = new StubNode();
    const ctrl = node.addComponent(OrphanController);

    expect(() => ctrl.getArchitecture()).toThrow(/尚未绑定架构/);
  });
});

// #endregion

// #region 第 8 章 常见错误

describe('第 8 章：常见错误与排查', () => {
  test('8.1 未注册的模块返回 null', () => {
    class EmptyApp extends Architecture<EmptyApp> {
      protected init(): void {}
    }
    expect(EmptyApp.Interface.getModel(CounterModel)).toBeNull();
  });

  test('8.2 未注册到架构时调用会抛错', () => {
    class Orphan extends AbstractCommand {
      protected onExecute(): void {
        this.getModel(CounterModel);
      }
    }
    expect(() => new Orphan().execute()).toThrow(/尚未注册到架构/);
  });

  test('8.6 循环构造会抛出明确错误', () => {
    class CyclicApp extends Architecture<CyclicApp> {
      private readonly mSelf = CyclicApp.Interface;
      protected init(): void {}
    }
    expect(() => CyclicApp.Interface).toThrow(/循环构造/);
  });

  test('8.7 循环依赖会抛出明确错误', () => {
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
    expect(() => AppA.Interface).toThrow(/循环依赖/);
  });

  test('8.7 正确写法：不要在构造期访问，改用 init', () => {
    class GoodApp extends Architecture<GoodApp> {
      static self: IArchitecture | null = null;
      protected init(): void {
        GoodApp.self = this;
        this.registerModel(new CounterModel());
      }
    }
    void GoodApp.Interface;
    expect(GoodApp.self).toBe(GoodApp.Interface);
    expect(GoodApp.Interface.getModel(CounterModel)).not.toBeNull();
  });
});

// #endregion
