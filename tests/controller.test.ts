/**
 * LayaAir 适配层测试：
 *   - getLaya / requireLaya / installLaya
 *   - AbstractController（继承 Laya.Script）
 *   - unRegisterWhenNodeDestroyed / unRegisterWhenComponentDestroyed
 *   - 注销触发器组件 UnRegisterOnDestroyTrigger
 */

import { describe, expect, test } from '@rstest/core';
import {
  AbstractCommand,
  AbstractController,
  AbstractModel,
  AbstractQuery,
  Architecture,
  BindableProperty,
  CustomUnRegister,
  EasyEvent,
  TypeEventSystem,
  getLaya,
  getUnRegisterOnDestroyTriggerType,
  installLaya,
  registerGlobalEvent,
  requireLaya,
  unRegisterWhenComponentDestroyed,
  unRegisterWhenNodeDestroyed,
} from '../src/index';
import type { AbstractType, LayaNamespace } from '../src/index';
import { StubNode, StubScript, StubVector3, stubLaya } from './laya-stub';

// #region 演示模块

class HpModel extends AbstractModel {
  readonly hp = new BindableProperty<number>(100);

  protected onInit(): void {
    this.hp.value = 100;
  }
}

class HpChangedEvent {
  constructor(public readonly hp: number) {}
}

class DamageCommand extends AbstractCommand {
  constructor(private readonly amount: number) {
    super();
  }

  protected onExecute(): void {
    const model = this.getModel(HpModel)!;
    model.hp.value = Math.max(0, model.hp.value - this.amount);
    this.sendEvent(new HpChangedEvent(model.hp.value));
  }
}

class GetHpQuery extends AbstractQuery<number> {
  protected onDo(): number {
    return this.getModel(HpModel)!.hp.value;
  }
}

class GameApp extends Architecture<GameApp> {
  protected init(): void {
    this.registerModel(new HpModel());
  }
}

// #endregion

// #region Laya 运行时

describe('Laya 运行时', () => {
  test('01 - getLaya 返回注入的全局对象', () => {
    expect(getLaya()).not.toBeNull();
    expect(getLaya()).toBe(stubLaya as unknown as LayaNamespace);
  });

  test('02 - requireLaya 与 getLaya 返回同一个对象', () => {
    expect(requireLaya()).toBe(getLaya());
  });

  test('03 - Laya.Script / Laya.Node / 值类型均可访问', () => {
    const laya = getLaya()!;
    expect(laya.Script).toBe(StubScript);
    expect(laya.Node).toBe(StubNode);
    expect((laya as unknown as { Vector3: unknown }).Vector3).toBe(StubVector3);
  });

  test('04 - installLaya 可以重新注入并重置缓存', () => {
    const original = getLaya();
    try {
      const marker = { Script: StubScript, Node: StubNode } as unknown as LayaNamespace;
      installLaya(marker);
      expect(getLaya()).toBe(marker);
    } finally {
      installLaya(original as LayaNamespace);
    }
    expect(getLaya()).toBe(original);
  });
});

// #endregion

// #region AbstractController

class HudController extends AbstractController {
  /** onInit 被调用的次数 */
  initCount = 0;
  /** 收到的血量变化 */
  lastHp = -1;

  protected getArchitectureClass() {
    return GameApp;
  }

  protected onInit(): void {
    this.initCount++;
    this.registerEvent<HpChangedEvent>(HpChangedEvent, (e) => {
      this.lastHp = e.hp;
    });
  }

  takeDamage(amount: number): void {
    this.sendCommand(new DamageCommand(amount));
  }

  getHp(): number {
    return this.sendQuery(new GetHpQuery());
  }
}

/** 不绑定架构的 Controller（用于验证错误提示） */
class OrphanController extends AbstractController {}

describe('AbstractController', () => {
  test('01 - 继承 Laya.Script，可以挂到 Laya 节点上', () => {
    const node = new StubNode();
    const controller = node.addComponent(HudController);

    expect(controller).toBeInstanceOf(StubScript);
    expect(node.getComponent(HudController)).toBe(controller);
  });

  test('02 - node 属性等价于 Laya.Component.owner', () => {
    const node = new StubNode();
    const controller = node.addComponent(HudController);

    expect(controller.node).toBe(node);
  });

  test('03 - onAwake 时自动绑定架构并回调 onInit', () => {
    const controller = new StubNode().addComponent(HudController);

    expect(controller.initCount).toBe(0);

    controller.onAwake();

    expect(controller.initCount).toBe(1);
    expect(controller.getArchitecture()).toBe(GameApp.Interface);
  });

  test('04 - 重复 onAwake 会重复回调 onInit，但架构只绑定一次', () => {
    const controller = new StubNode().addComponent(HudController);

    controller.onAwake();
    const architecture = controller.getArchitecture();
    controller.onAwake();

    expect(controller.initCount).toBe(2);
    expect(controller.getArchitecture()).toBe(architecture);
  });

  test('05 - 可以获取 Model / 发送命令 / 发送查询', () => {
    const controller = new StubNode().addComponent(HudController);
    controller.onAwake();

    expect(controller.getModel(HpModel)).toBe(GameApp.Interface.getModel(HpModel));

    const before = controller.getHp();
    controller.takeDamage(30);

    expect(controller.getHp()).toBe(before - 30);
  });

  test('06 - 可以注册并接收架构事件', () => {
    const controller = new StubNode().addComponent(HudController);
    controller.onAwake();

    GameApp.Interface.sendCommand(new DamageCommand(10));

    expect(controller.lastHp).toBe(controller.getHp());
  });

  test('07 - Controller 不具备发送事件能力', () => {
    const controller = new StubNode().addComponent(HudController);
    expect((controller as unknown as { sendEvent?: unknown }).sendEvent).toBeUndefined();
    expect((controller as unknown as { sendEventByType?: unknown }).sendEventByType).toBeUndefined();
  });

  test('08 - 可以获取 Utility', () => {
    class AudioUtil {
      play(): string {
        return 'played';
      }
    }
    class UtilApp extends Architecture<UtilApp> {
      protected init(): void {
        this.registerUtility(new AudioUtil());
      }
    }
    class UtilController extends AbstractController {
      protected getArchitectureClass() {
        return UtilApp;
      }
    }

    const controller = new StubNode().addComponent(UtilController);
    controller.onAwake();

    expect(controller.getUtility(AudioUtil)).toBeInstanceOf(AudioUtil);
  });

  test('09 - 可以调用 setArchitecture 手动绑定', () => {
    const controller = new StubNode().addComponent(OrphanController);

    controller.setArchitecture(GameApp.Interface);

    expect(controller.getArchitecture()).toBe(GameApp.Interface);
    expect(controller.getModel(HpModel)).toBe(GameApp.Interface.getModel(HpModel));
  });

  test('10 - 未绑定架构时调用会抛错', () => {
    const controller = new StubNode().addComponent(OrphanController);

    expect(() => controller.getArchitecture()).toThrow(/尚未绑定架构/);
  });

  test('11 - onAwake 不会覆盖已手动绑定的架构', () => {
    class OtherApp extends Architecture<OtherApp> {
      protected init(): void {}
    }
    const controller = new StubNode().addComponent(HudController);

    controller.setArchitecture(OtherApp.Interface);
    controller.onAwake();

    expect(controller.getArchitecture()).toBe(OtherApp.Interface);
  });

  test('12 - 拥有 Laya.Script 的完整生命周期方法', () => {
    const controller = new StubNode().addComponent(HudController);

    expect(typeof controller.onAwake).toBe('function');
    expect(typeof controller.onEnable).toBe('function');
    expect(typeof (controller as unknown as { onDestroy?: unknown }).onDestroy).toBe('function');
  });

  test('13 - 可以重写 Laya 生命周期', () => {
    const calls: string[] = [];

    class LifecycleController extends AbstractController {
      override onEnable(): void {
        calls.push('enable');
      }
      onDestroy(): void {
        calls.push('destroy');
      }
    }

    const node = new StubNode();
    const controller = node.addComponent(LifecycleController);

    controller.onEnable();
    controller.onDestroy();

    expect(calls).toEqual(['enable', 'destroy']);
  });
});

// #endregion

// #region unRegisterWhenNodeDestroyed

describe('unRegisterWhenNodeDestroyed', () => {
  const createNode = () => new StubNode() as unknown as Laya.Node;
  const getTrigger = (node: Laya.Node) =>
    node.getComponent(getUnRegisterOnDestroyTriggerType()) as unknown as { onDestroy(): void } | null;

  test('01 - 会在节点上挂一个触发器组件', () => {
    const node = createNode();

    unRegisterWhenNodeDestroyed(new CustomUnRegister(() => {}), node);

    expect(getTrigger(node)).not.toBeNull();
  });

  test('02 - 同一个节点只挂一个触发器组件', () => {
    const node = createNode();

    unRegisterWhenNodeDestroyed(new CustomUnRegister(() => {}), node);
    const first = getTrigger(node);
    unRegisterWhenNodeDestroyed(new CustomUnRegister(() => {}), node);

    expect(getTrigger(node)).toBe(first);
  });

  test('03 - 节点销毁时自动注销', () => {
    const node = createNode();
    let hit = 0;

    unRegisterWhenNodeDestroyed(new CustomUnRegister(() => hit++), node);
    expect(hit).toBe(0);

    getTrigger(node)!.onDestroy();
    expect(hit).toBe(1);
  });

  test('04 - 可以注册多个注销器，销毁时全部执行', () => {
    const node = createNode();
    const order: number[] = [];

    unRegisterWhenNodeDestroyed(new CustomUnRegister(() => order.push(1)), node);
    unRegisterWhenNodeDestroyed(new CustomUnRegister(() => order.push(2)), node);
    unRegisterWhenNodeDestroyed(new CustomUnRegister(() => order.push(3)), node);

    getTrigger(node)!.onDestroy();

    expect(order).toEqual([1, 2, 3]);
  });

  test('05 - 与 BindableProperty 配合：节点销毁后不再收到变更', () => {
    const node = createNode();
    const hp = new BindableProperty<number>(0);
    const values: number[] = [];

    unRegisterWhenNodeDestroyed(hp.register((v) => values.push(v)), node);

    hp.value = 1;
    expect(values).toEqual([1]);

    getTrigger(node)!.onDestroy();
    hp.value = 2;
    expect(values).toEqual([1]);
  });

  test('06 - 与架构事件配合：节点销毁后不再收到事件', () => {
    const node = createNode();
    const received: number[] = [];

    class EvtApp extends Architecture<EvtApp> {
      protected init(): void {}
    }

    const unRegister = EvtApp.Interface.registerEvent<HpChangedEvent>(HpChangedEvent, (e) =>
      received.push(e.hp),
    );
    unRegisterWhenNodeDestroyed(unRegister, node);

    EvtApp.Interface.sendEvent(new HpChangedEvent(1));
    expect(received).toEqual([1]);

    getTrigger(node)!.onDestroy();
    EvtApp.Interface.sendEvent(new HpChangedEvent(2));
    expect(received).toEqual([1]);
  });

  test('07 - 与全局事件配合', () => {
    const node = createNode();
    let hit = 0;
    const event = new EasyEvent();

    unRegisterWhenNodeDestroyed(event.register(() => hit++), node);

    event.trigger();
    expect(hit).toBe(1);

    getTrigger(node)!.onDestroy();
    event.trigger();
    expect(hit).toBe(1);
  });

  test('08 - 返回传入的注销器本身（支持链式写法）', () => {
    const node = createNode();
    const unRegister = new CustomUnRegister(() => {});

    expect(unRegisterWhenNodeDestroyed(unRegister, node)).toBe(unRegister);
  });

  test('09 - 不同节点的触发器互相隔离', () => {
    const nodeA = createNode();
    const nodeB = createNode();
    let hitA = 0;
    let hitB = 0;

    unRegisterWhenNodeDestroyed(new CustomUnRegister(() => hitA++), nodeA);
    unRegisterWhenNodeDestroyed(new CustomUnRegister(() => hitB++), nodeB);

    getTrigger(nodeA)!.onDestroy();

    expect(hitA).toBe(1);
    expect(hitB).toBe(0);
  });

  test('10 - 触发器组件提供 addUnRegister / removeUnRegister', () => {
    const node = createNode();
    let hit = 0;
    const unRegister = new CustomUnRegister(() => hit++);

    unRegisterWhenNodeDestroyed(unRegister, node);
    const trigger = node.getComponent(getUnRegisterOnDestroyTriggerType()) as unknown as {
      removeUnRegister(u: unknown): void;
    };

    trigger.removeUnRegister(unRegister);
    getTrigger(node)!.onDestroy();

    expect(hit).toBe(0);
  });

  test('11 - 在 Controller 中使用：销毁节点即解绑', () => {
    class BoundController extends AbstractController {
      readonly values: number[] = [];

      protected getArchitectureClass() {
        return GameApp;
      }

      protected onInit(): void {
        // 监听架构事件，并绑定到节点生命周期
        unRegisterWhenNodeDestroyed(
          this.registerEvent<HpChangedEvent>(HpChangedEvent, (e) => this.values.push(e.hp)),
          this.node,
        );
      }
    }

    const node = new StubNode();
    const controller = node.addComponent(BoundController);
    controller.onAwake();

    GameApp.Interface.sendCommand(new DamageCommand(10));
    expect(controller.values.length).toBe(1);

    node.destroy();
    GameApp.Interface.sendCommand(new DamageCommand(10));
    expect(controller.values.length).toBe(1);
  });
});

// #endregion

// #region unRegisterWhenComponentDestroyed

describe('unRegisterWhenComponentDestroyed', () => {
  test('01 - 使用组件所属节点（Laya.Component.owner）', () => {
    const node = new StubNode();
    const component = node.addComponent(StubScript) as unknown as Laya.Component;
    let hit = 0;

    unRegisterWhenComponentDestroyed(new CustomUnRegister(() => hit++), component);

    expect(
      node.getComponent(getUnRegisterOnDestroyTriggerType()) as unknown as { onDestroy?(): void },
    ).not.toBeNull();

    node.destroy();
    expect(hit).toBe(1);
  });

  test('02 - 与其它组件共用同一个触发器', () => {
    const node = new StubNode();
    const a = node.addComponent(StubScript) as unknown as Laya.Component;
    const b = node.addComponent(StubScript) as unknown as Laya.Component;
    let hitA = 0;
    let hitB = 0;

    unRegisterWhenComponentDestroyed(new CustomUnRegister(() => hitA++), a);
    unRegisterWhenComponentDestroyed(new CustomUnRegister(() => hitB++), b);

    node.destroy();

    expect(hitA).toBe(1);
    expect(hitB).toBe(1);
  });

  test('03 - 返回传入的注销器本身', () => {
    const node = new StubNode();
    const component = node.addComponent(StubScript) as unknown as Laya.Component;
    const unRegister = new CustomUnRegister(() => {});

    expect(unRegisterWhenComponentDestroyed(unRegister, component)).toBe(unRegister);
  });
});

// #endregion

// #region 全局事件与 Laya 的配合

describe('全局事件与 Laya 节点生命周期', () => {
  test('01 - 全局事件 + 节点销毁自动注销', () => {
    const node = new StubNode() as unknown as Laya.Node;
    const received: number[] = [];
    const listener = {
      onEvent(e: HpChangedEvent) {
        received.push(e.hp);
      },
    };

    const unRegister = registerGlobalEvent(listener, HpChangedEvent);
    unRegisterWhenNodeDestroyed(unRegister, node);

    TypeEventSystem.Global.send(new HpChangedEvent(1));
    expect(received).toEqual([1]);

    (node as unknown as StubNode).destroy();
    TypeEventSystem.Global.send(new HpChangedEvent(2));
    expect(received).toEqual([1]);
  });
});

// #endregion
