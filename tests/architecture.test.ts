/**
 * Architecture 及其四层模块（Model / System / Utility / Command / Query）的测试。
 *
 * 注意：Architecture 按「子类构造函数」注册为单例，且状态在同一测试文件内共享。
 * 因此每个 describe 使用独立的 Architecture 子类，避免互相污染。
 */

import { describe, expect, test } from '@rstest/core';
import {
  AbstractCommand,
  AbstractCommandWithResult,
  AbstractModel,
  AbstractQuery,
  AbstractSystem,
  Architecture,
  ArchitectureCapabilities,
  BindableProperty,
} from '../src/index';
import type { IArchitecture, ICommand, IModel, IQuery, IUtility } from '../src/index';

// #region 演示用的模块

class CounterModel extends AbstractModel {
  readonly count = new BindableProperty<number>(0);

  protected onInit(): void {
    this.count.value = 0;
  }
}

class CountChangedEvent {
  constructor(public readonly value: number) {}
}

class StorageUtility implements IUtility {
  save(data: string): string {
    return `saved:${data}`;
  }
}

/** 无返回值命令：累加计数并广播事件 */
class AddCountCommand extends AbstractCommand {
  constructor(private readonly delta: number) {
    super();
  }

  protected onExecute(): void {
    const model = this.getModel(CounterModel)!;
    model.count.value += this.delta;
    this.sendEvent(new CountChangedEvent(model.count.value));
  }
}

/** 带返回值命令：超过上限则失败 */
class TryAddCountCommand extends AbstractCommandWithResult<boolean> {
  constructor(
    private readonly delta: number,
    private readonly max: number,
  ) {
    super();
  }

  protected onExecute(): boolean {
    const model = this.getModel(CounterModel)!;
    if (model.count.value + this.delta > this.max) return false;
    model.count.value += this.delta;
    return true;
  }
}

/** 命令内部再发命令（嵌套） */
class AddTwiceCommand extends AbstractCommand {
  constructor(private readonly delta: number) {
    super();
  }

  protected onExecute(): void {
    this.sendCommand(new AddCountCommand(this.delta));
    this.sendCommand(new AddCountCommand(this.delta));
  }
}

class GetCountQuery extends AbstractQuery<number> {
  protected onDo(): number {
    return this.getModel(CounterModel)!.count.value;
  }
}

/** Query 内部调用 Command（只读语义由开发者保证） */
class GetCountAfterAddQuery extends AbstractQuery<number> {
  constructor(private readonly delta: number) {
    super();
  }

  protected onDo(): number {
    const model = this.getModel(CounterModel)!;
    return model.count.value + this.delta;
  }
}

class CounterSystem extends AbstractSystem {
  inited = false;
  changedValues: number[] = [];

  protected onInit(): void {
    this.inited = true;
    this.registerEvent<CountChangedEvent>(CountChangedEvent, (e) => this.changedValues.push(e.value));
  }
}

/** System 依赖另一个 System */
class StatisticSystem extends AbstractSystem {
  snapshot = -1;

  protected onInit(): void {
    this.snapshot = 0;
  }

  recordSum(): number {
    const counterSystem = this.getSystem(CounterSystem);
    return counterSystem ? counterSystem.changedValues.reduce((a, b) => a + b, 0) : -1;
  }
}

class CounterApp extends Architecture<CounterApp> {
  protected init(): void {
    this.registerModel(new CounterModel());
    this.registerSystem(new CounterSystem());
    this.registerUtility(new StorageUtility());
  }
}

// #endregion

// #region Architecture 生命周期

describe('Architecture 生命周期', () => {
  test('01 - 首次访问 Interface 时才执行 init（延迟初始化）', () => {
    let initCount = 0;

    class LazyApp extends Architecture<LazyApp> {
      protected init(): void {
        initCount++;
      }
    }

    expect(initCount).toBe(0);
    void LazyApp.Interface;
    expect(initCount).toBe(1);
  });

  test('02 - init 只会执行一次', () => {
    let initCount = 0;

    class OnceApp extends Architecture<OnceApp> {
      protected init(): void {
        initCount++;
      }
    }

    void OnceApp.Interface;
    void OnceApp.Interface;
    void OnceApp.getInstance();

    expect(initCount).toBe(1);
  });

  test('03 - Interface 保持单例', () => {
    expect(CounterApp.Interface).toBe(CounterApp.Interface);
    expect(CounterApp.getInstance()).toBe(CounterApp.Interface);
  });

  test('04 - 不同 Architecture 子类各自独立', () => {
    class AppA extends Architecture<AppA> {
      protected init(): void {
        this.registerModel(new CounterModel());
      }
    }
    class AppB extends Architecture<AppB> {
      protected init(): void {
        this.registerModel(new CounterModel());
      }
    }

    expect(AppA.Interface).not.toBe(AppB.Interface);
    expect(AppA.Interface.getModel(CounterModel)).not.toBe(AppB.Interface.getModel(CounterModel));
  });

  test('05 - init 之后依次执行 Model.Init 再执行 System.Init', () => {
    const order: string[] = [];

    class OrderModel extends AbstractModel {
      protected onInit(): void {
        order.push('model');
      }
    }
    class OrderSystem extends AbstractSystem {
      protected onInit(): void {
        order.push('system');
      }
    }
    class OrderApp extends Architecture<OrderApp> {
      protected init(): void {
        // 故意先注册 System，框架仍会先初始化 Model
        this.registerSystem(new OrderSystem());
        this.registerModel(new OrderModel());
      }
    }

    void OrderApp.Interface;

    expect(order).toEqual(['model', 'system']);
  });

  test('06 - OnRegisterPatch 在 init 之后、模块 Init 之前执行', () => {
    const order: string[] = [];

    class PatchModel extends AbstractModel {
      protected onInit(): void {
        order.push('model-init');
      }
    }
    class PatchApp extends Architecture<PatchApp> {
      protected init(): void {
        order.push('init');
        this.registerModel(new PatchModel());
      }
    }

    Architecture.OnRegisterPatch = () => order.push('patch');
    try {
      void PatchApp.Interface;
    } finally {
      Architecture.OnRegisterPatch = null;
    }

    expect(order).toEqual(['init', 'patch', 'model-init']);
  });

  test('07 - 初始化完成后再注册 System / Model，会立即执行其 Init', () => {
    class LateModel extends AbstractModel {
      inited = false;
      protected onInit(): void {
        this.inited = true;
      }
    }
    class LateSystem extends AbstractSystem {
      inited = false;
      protected onInit(): void {
        this.inited = true;
      }
    }

    const model = new LateModel();
    const system = new LateSystem();

    CounterApp.Interface.registerModel(model);
    expect(model.inited).toBe(true);

    CounterApp.Interface.registerSystem(system);
    expect(system.inited).toBe(true);
  });

  test('08 - 初始化前注册的 System 会被收集，在 init 结束后统一 Init', () => {
    const system = new CounterSystem();
    class CollectApp extends Architecture<CollectApp> {
      protected init(): void {
        this.registerSystem(system);
      }
    }

    expect(system.inited).toBe(false);
    void CollectApp.Interface;
    expect(system.inited).toBe(true);
  });
});

// #endregion

// #region 注册与获取

describe('Architecture 注册与获取', () => {
  test('01 - getModel / getSystem / getUtility', () => {
    const architecture = CounterApp.Interface;

    expect(architecture.getModel(CounterModel)).toBeInstanceOf(CounterModel);
    expect(architecture.getSystem(CounterSystem)).toBeInstanceOf(CounterSystem);
    expect(architecture.getUtility(StorageUtility)).toBeInstanceOf(StorageUtility);
  });

  test('02 - 同一个 key 返回同一个实例', () => {
    const architecture = CounterApp.Interface;
    expect(architecture.getModel(CounterModel)).toBe(architecture.getModel(CounterModel));
  });

  test('03 - 未注册的模块返回 null', () => {
    class UnknownModel extends AbstractModel {
      protected onInit(): void {}
    }
    class UnknownSystem extends AbstractSystem {
      protected onInit(): void {}
    }
    class UnknownUtility implements IUtility {}

    expect(CounterApp.Interface.getModel(UnknownModel)).toBeNull();
    expect(CounterApp.Interface.getSystem(UnknownSystem)).toBeNull();
    expect(CounterApp.Interface.getUtility(UnknownUtility)).toBeNull();
  });

  test('04 - 可以显式指定注册 key', () => {
    interface IStorage extends IUtility {
      save(data: string): string;
    }
    class DiskStorage implements IStorage {
      save(data: string): string {
        return `disk:${data}`;
      }
    }
    abstract class StorageKey {}

    class KeyApp extends Architecture<KeyApp> {
      protected init(): void {
        this.registerUtility(new DiskStorage(), StorageKey);
      }
    }

    expect(KeyApp.Interface.getUtility<IStorage>(StorageKey as never)!.save('a')).toBe('disk:a');
  });

  test('05 - System 可以获取其它 System 与 Utility', () => {
    class DepSystem extends AbstractSystem {
      counterSystem: CounterSystem | null = null;
      storage: StorageUtility | null = null;

      protected onInit(): void {
        this.counterSystem = this.getSystem(CounterSystem);
        this.storage = this.getUtility(StorageUtility);
      }
    }
    class DepApp extends Architecture<DepApp> {
      protected init(): void {
        this.registerSystem(new CounterSystem());
        this.registerSystem(new DepSystem());
        this.registerUtility(new StorageUtility());
      }
    }

    const dep = DepApp.Interface.getSystem(DepSystem)!;

    expect(dep.counterSystem).toBeInstanceOf(CounterSystem);
    expect(dep.storage).toBeInstanceOf(StorageUtility);
  });

  test('06 - 注册时模块会持有架构引用', () => {
    const model = new CounterModel();
    class RefApp extends Architecture<RefApp> {
      protected init(): void {
        this.registerModel(model);
      }
    }

    void RefApp.Interface;
    expect(model.getArchitecture()).toBe(RefApp.Interface);
  });
});

// #endregion

// #region Command

describe('Command', () => {
  test('01 - sendCommand 执行无返回值命令', () => {
    const before = CounterApp.Interface.sendQuery(new GetCountQuery());

    CounterApp.Interface.sendCommand(new AddCountCommand(5));

    expect(CounterApp.Interface.sendQuery(new GetCountQuery())).toBe(before + 5);
  });

  test('02 - sendCommand 返回带返回值命令的结果', () => {
    const architecture = CounterApp.Interface;
    const current = architecture.sendQuery(new GetCountQuery());

    const ok = architecture.sendCommand(new TryAddCountCommand(1, current + 10));
    expect(ok).toBe(true);
    expect(architecture.sendQuery(new GetCountQuery())).toBe(current + 1);

    const failed = architecture.sendCommand(new TryAddCountCommand(100, current + 10));
    expect(failed).toBe(false);
    expect(architecture.sendQuery(new GetCountQuery())).toBe(current + 1);
  });

  test('03 - 命令可以发送事件', () => {
    const system = CounterApp.Interface.getSystem(CounterSystem)!;
    const before = system.changedValues.length;

    CounterApp.Interface.sendCommand(new AddCountCommand(1));

    expect(system.changedValues.length).toBe(before + 1);
  });

  test('04 - 命令可以嵌套发送命令', () => {
    const before = CounterApp.Interface.sendQuery(new GetCountQuery());

    CounterApp.Interface.sendCommand(new AddTwiceCommand(3));

    expect(CounterApp.Interface.sendQuery(new GetCountQuery())).toBe(before + 6);
  });

  test('05 - 命令可以发送查询', () => {
    class QueryInCommand extends AbstractCommandWithResult<number> {
      protected onExecute(): number {
        return this.sendQuery(new GetCountQuery());
      }
    }

    expect(CounterApp.Interface.sendCommand(new QueryInCommand())).toBe(
      CounterApp.Interface.sendQuery(new GetCountQuery()),
    );
  });

  test('06 - 命令实例是临时的，每次 new 都是新对象', () => {
    const c1 = new AddCountCommand(1);
    const c2 = new AddCountCommand(1);
    expect(c1).not.toBe(c2);
  });

  test('07 - 未绑定架构时调用 getModel 会抛错', () => {
    class Orphan extends AbstractCommand {
      protected onExecute(): void {
        this.getModel(CounterModel);
      }
    }

    expect(() => new Orphan().execute()).toThrow(/尚未注册到架构/);
  });

  test('08 - 重写 executeCommand 可以插入拦截逻辑', () => {
    const log: string[] = [];

    class LoggingApp extends Architecture<LoggingApp> {
      protected init(): void {
        this.registerModel(new CounterModel());
      }

      protected override executeCommand<TResult>(command: ICommand<TResult>): TResult {
        log.push(`before:${command.constructor.name}`);
        const result = super.executeCommand(command);
        log.push('after');
        return result;
      }
    }

    LoggingApp.Interface.sendCommand(new AddCountCommand(1));

    expect(log).toEqual(['before:AddCountCommand', 'after']);
    expect(LoggingApp.Interface.getModel(CounterModel)!.count.value).toBe(1);
  });
});

// #endregion

// #region Query

describe('Query', () => {
  test('01 - sendQuery 返回查询结果', () => {
    const current = CounterApp.Interface.sendQuery(new GetCountQuery());
    expect(typeof current).toBe('number');
    expect(CounterApp.Interface.sendQuery(new GetCountQuery())).toBe(current);
  });

  test('02 - Query 可以带构造参数', () => {
    const current = CounterApp.Interface.sendQuery(new GetCountQuery());
    expect(CounterApp.Interface.sendQuery(new GetCountAfterAddQuery(10))).toBe(current + 10);
  });

  test('03 - Query 可以获取 System', () => {
    class SystemCountQuery extends AbstractQuery<number> {
      protected onDo(): number {
        return this.getSystem(CounterSystem)?.changedValues.length ?? -1;
      }
    }

    expect(CounterApp.Interface.sendQuery(new SystemCountQuery())).toBeGreaterThan(0);
  });

  test('04 - Query 可以嵌套发送 Query', () => {
    class NestedQuery extends AbstractQuery<number> {
      protected onDo(): number {
        return this.sendQuery(new GetCountQuery()) * 2;
      }
    }

    expect(CounterApp.Interface.sendQuery(new NestedQuery())).toBe(
      CounterApp.Interface.sendQuery(new GetCountQuery()) * 2,
    );
  });

  test('05 - 未绑定架构时调用会抛错', () => {
    class OrphanQuery extends AbstractQuery<number> {
      protected onDo(): number {
        return this.getModel(CounterModel)!.count.value;
      }
    }

    expect(() => new OrphanQuery().do()).toThrow(/尚未注册到架构/);
  });

  test('06 - 重写 doQuery 可以插入拦截逻辑', () => {
    const log: string[] = [];

    class LoggingQueryApp extends Architecture<LoggingQueryApp> {
      protected init(): void {
        this.registerModel(new CounterModel());
      }

      protected override doQuery<TResult>(query: IQuery<TResult>): TResult {
        log.push('before-query');
        const result = super.doQuery(query);
        log.push('after-query');
        return result;
      }
    }

    LoggingQueryApp.Interface.sendQuery(new GetCountQuery());
    expect(log).toEqual(['before-query', 'after-query']);
  });
});

// #endregion

// #region Model / System / Utility

describe('Model / System / Utility', () => {
  test('01 - Model 可以发送事件', () => {
    const received: number[] = [];

    class EmitterModel extends AbstractModel {
      emit(value: number): void {
        this.sendEvent(new CountChangedEvent(value));
      }
      protected onInit(): void {}
    }
    class ModelApp extends Architecture<ModelApp> {
      protected init(): void {
        this.registerModel(new EmitterModel());
      }
    }

    ModelApp.Interface.registerEvent<CountChangedEvent>(CountChangedEvent, (e) =>
      received.push(e.value),
    );
    ModelApp.Interface.getModel(EmitterModel)!.emit(7);

    expect(received).toEqual([7]);
  });

  test('02 - Model 可以获取 Utility', () => {
    class StorageModel extends AbstractModel {
      saved = '';
      protected onInit(): void {
        this.saved = this.getUtility(StorageUtility)!.save('x');
      }
    }
    class StorageApp extends Architecture<StorageApp> {
      protected init(): void {
        this.registerUtility(new StorageUtility());
        this.registerModel(new StorageModel());
      }
    }

    expect(StorageApp.Interface.getModel(StorageModel)!.saved).toBe('saved:x');
  });

  test('03 - System 可以注册 / 注销事件', () => {
    const system = CounterApp.Interface.getSystem(CounterSystem)!;
    const before = system.changedValues.length;

    CounterApp.Interface.sendEvent(new CountChangedEvent(999));
    expect(system.changedValues.length).toBe(before + 1);
    expect(system.changedValues[system.changedValues.length - 1]).toBe(999);
  });

  test('04 - System 注销事件后不再收到', () => {
    const system = CounterApp.Interface.getSystem(CounterSystem)!;
    const before = system.changedValues.length;
    const handler = () => system.changedValues.push(-1);

    const unRegister = system.registerEvent<CountChangedEvent>(CountChangedEvent, handler);
    CounterApp.Interface.sendEvent(new CountChangedEvent(1));
    expect(system.changedValues.length).toBe(before + 2);

    unRegister.unRegister();
    CounterApp.Interface.sendEvent(new CountChangedEvent(2));
    expect(system.changedValues.length).toBe(before + 3);
  });

  test('05 - System 可以发送事件', () => {
    const received: number[] = [];

    class SenderSystem extends AbstractSystem {
      send(value: number): void {
        this.sendEventByType(CountChangedEvent, value);
      }
      protected onInit(): void {}
    }
    class SenderApp extends Architecture<SenderApp> {
      protected init(): void {
        this.registerSystem(new SenderSystem());
      }
    }

    SenderApp.Interface.registerEvent<CountChangedEvent>(CountChangedEvent, (e) =>
      received.push(e.value),
    );
    SenderApp.Interface.getSystem(SenderSystem)!.send(42);

    expect(received).toEqual([42]);
  });

  test('06 - Utility 是纯粹的工具层，不依赖架构', () => {
    const util = new StorageUtility();
    expect(util.save('a')).toBe('saved:a');
    expect(CounterApp.Interface.getUtility(StorageUtility)).toBeInstanceOf(StorageUtility);
  });

  test('07 - Model / System 的 init 对外不可见（通过 onInit 实现）', () => {
    const model = new CounterModel();
    // init() 是接口方法，会转发到 onInit()
    expect(typeof model.init).toBe('function');
  });
});

// #endregion

// #region 事件

describe('Architecture 事件', () => {
  test('01 - sendEvent 按事件类型分发', () => {
    const received: number[] = [];
    class EvtApp extends Architecture<EvtApp> {
      protected init(): void {}
    }

    EvtApp.Interface.registerEvent<CountChangedEvent>(CountChangedEvent, (e) => received.push(e.value));
    EvtApp.Interface.sendEvent(new CountChangedEvent(1));

    expect(received).toEqual([1]);
  });

  test('02 - sendEventByType 自动构造事件', () => {
    const received: number[] = [];
    class EvtApp2 extends Architecture<EvtApp2> {
      protected init(): void {}
    }

    EvtApp2.Interface.registerEvent<CountChangedEvent>(CountChangedEvent, (e) => received.push(e.value));
    EvtApp2.Interface.sendEventByType(CountChangedEvent, 88);

    expect(received).toEqual([88]);
  });

  test('03 - unRegisterEvent 注销指定监听', () => {
    const received: number[] = [];
    const handler = (e: CountChangedEvent) => received.push(e.value);

    class EvtApp3 extends Architecture<EvtApp3> {
      protected init(): void {}
    }

    EvtApp3.Interface.registerEvent(CountChangedEvent, handler);
    EvtApp3.Interface.sendEvent(new CountChangedEvent(1));
    EvtApp3.Interface.unRegisterEvent(CountChangedEvent, handler);
    EvtApp3.Interface.sendEvent(new CountChangedEvent(2));

    expect(received).toEqual([1]);
  });

  test('04 - 架构之间的事件互相隔离', () => {
    const a: number[] = [];
    const b: number[] = [];

    class IsoA extends Architecture<IsoA> {
      protected init(): void {}
    }
    class IsoB extends Architecture<IsoB> {
      protected init(): void {}
    }

    IsoA.Interface.registerEvent<CountChangedEvent>(CountChangedEvent, (e) => a.push(e.value));
    IsoB.Interface.registerEvent<CountChangedEvent>(CountChangedEvent, (e) => b.push(e.value));

    IsoA.Interface.sendEvent(new CountChangedEvent(1));

    expect(a).toEqual([1]);
    expect(b).toEqual([]);
  });

  test('05 - 支持字符串 / Symbol 通道', () => {
    const received: string[] = [];
    class ChannelApp extends Architecture<ChannelApp> {
      protected init(): void {}
    }

    ChannelApp.Interface.registerEvent<string>('ui:refresh', (e) => received.push(e));
    ChannelApp.Interface.sendEvent<string>('panel', 'ui:refresh');

    expect(received).toEqual(['panel']);
  });
});

// #endregion

// #region ArchitectureCapabilities

describe('ArchitectureCapabilities', () => {
  test('01 - 为任意持有架构的对象提供全部能力', () => {
    const holder = { getArchitecture: () => CounterApp.Interface };
    const cap = new ArchitectureCapabilities(holder);

    expect(cap.getModel(CounterModel)).toBeInstanceOf(CounterModel);
    expect(cap.getSystem(CounterSystem)).toBeInstanceOf(CounterSystem);
    expect(cap.getUtility(StorageUtility)).toBeInstanceOf(StorageUtility);
    expect(typeof cap.sendQuery(new GetCountQuery())).toBe('number');
  });

  test('02 - sendCommand / sendEvent / registerEvent 均可用', () => {
    const holder = { getArchitecture: () => CounterApp.Interface };
    const cap = new ArchitectureCapabilities(holder);
    const received: number[] = [];

    const unRegister = cap.registerEvent<CountChangedEvent>(CountChangedEvent, (e) =>
      received.push(e.value),
    );
    cap.sendEvent(new CountChangedEvent(5));
    expect(received).toEqual([5]);

    unRegister.unRegister();
    cap.sendEventByType(CountChangedEvent, 6);
    expect(received).toEqual([5]);

    const before = cap.sendQuery(new GetCountQuery());
    cap.sendCommand(new AddCountCommand(2));
    expect(cap.sendQuery(new GetCountQuery())).toBe(before + 2);
  });

  test('03 - 架构未就绪时抛出统一错误', () => {
    const holder = {
      getArchitecture: (): IArchitecture => {
        throw new Error('架构未就绪');
      },
    };
    const cap = new ArchitectureCapabilities(holder);

    expect(() => cap.getModel(CounterModel)).toThrow('架构未就绪');
  });

  test('04 - 可用于自定义对象（不继承 AbstractXxx）', () => {
    class MyService {
      private readonly mCap = new ArchitectureCapabilities(this);
      private mArchitecture: IArchitecture | null = null;

      getArchitecture(): IArchitecture {
        if (!this.mArchitecture) throw new Error('未绑定');
        return this.mArchitecture;
      }

      bind(architecture: IArchitecture): void {
        this.mArchitecture = architecture;
      }

      getCount(): number {
        return this.mCap.sendQuery(new GetCountQuery());
      }
    }

    const service = new MyService();
    expect(() => service.getCount()).toThrow('未绑定');

    service.bind(CounterApp.Interface);
    expect(typeof service.getCount()).toBe('number');
  });
});

// #endregion

// #region 接口一致性

describe('接口一致性', () => {
  test('01 - AbstractModel 实现 IModel', () => {
    const model: IModel = new CounterModel();
    expect(typeof model.init).toBe('function');
    expect(typeof model.getArchitecture).toBe('function');
    expect(typeof model.setArchitecture).toBe('function');
    expect(typeof model.sendEvent).toBe('function');
    expect(typeof model.getUtility).toBe('function');
  });

  test('02 - 分层约束：Model 不能发命令、不能注册事件', () => {
    const model = new CounterModel();
    // IModel 只暴露 getUtility / sendEvent，编译期即受限
    expect((model as unknown as { sendCommand?: unknown }).sendCommand).toBeUndefined();
    expect((model as unknown as { registerEvent?: unknown }).registerEvent).toBeUndefined();
  });

  test('03 - 分层约束：Query 不能发命令、不能发送事件', () => {
    const query = new GetCountQuery();
    expect((query as unknown as { sendCommand?: unknown }).sendCommand).toBeUndefined();
    expect((query as unknown as { sendEvent?: unknown }).sendEvent).toBeUndefined();
  });

  test('04 - Command 能力最全', () => {
    const command = new AddCountCommand(1);
    expect(typeof command.getSystem).toBe('function');
    expect(typeof command.getModel).toBe('function');
    expect(typeof command.getUtility).toBe('function');
    expect(typeof command.sendCommand).toBe('function');
    expect(typeof command.sendQuery).toBe('function');
    expect(typeof command.sendEvent).toBe('function');
  });
});

// #endregion
