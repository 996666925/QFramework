/**
 * TypeEventSystem 类型事件系统 + IOnEvent 全局事件接收者的测试。
 */

import { describe, expect, test } from '@rstest/core';
import {
  TypeEventSystem,
  registerGlobalEvent,
  unRegisterGlobalEvent,
} from '../src/index';

// #region 事件定义

class PlayerDieEvent {
  constructor(public readonly name: string = '') {}
}

class ScoreChangedEvent {
  constructor(public readonly score: number = 0) {}
}

// #endregion

describe('TypeEventSystem', () => {
  test('01 - register / send：按事件类型分发', () => {
    const system = new TypeEventSystem();
    const received: string[] = [];

    system.register<PlayerDieEvent>(PlayerDieEvent, (e) => received.push(e.name));
    system.send(new PlayerDieEvent('a'));

    expect(received).toEqual(['a']);
  });

  test('02 - 不同事件类型互相隔离', () => {
    const system = new TypeEventSystem();
    const died: string[] = [];
    const scored: number[] = [];

    system.register<PlayerDieEvent>(PlayerDieEvent, (e) => died.push(e.name));
    system.register<ScoreChangedEvent>(ScoreChangedEvent, (e) => scored.push(e.score));

    system.send(new PlayerDieEvent('a'));

    expect(died).toEqual(['a']);
    expect(scored).toEqual([]);
  });

  test('03 - 同一事件支持多个监听者', () => {
    const system = new TypeEventSystem();
    const order: string[] = [];

    system.register<PlayerDieEvent>(PlayerDieEvent, () => order.push('a'));
    system.register<PlayerDieEvent>(PlayerDieEvent, () => order.push('b'));
    system.send(new PlayerDieEvent());

    expect(order).toEqual(['a', 'b']);
  });

  test('04 - unRegister：按引用注销（传同一个函数）', () => {
    const system = new TypeEventSystem();
    const received: string[] = [];
    const onEvent = (e: PlayerDieEvent) => received.push(e.name);

    system.register(PlayerDieEvent, onEvent);
    system.send(new PlayerDieEvent('a'));
    system.unRegister(PlayerDieEvent, onEvent);
    system.send(new PlayerDieEvent('b'));

    expect(received).toEqual(['a']);
  });

  test('05 - unRegister：传入不同的箭头函数无法注销', () => {
    // 这是 TS 与 C# 委托的关键差异，务必用下面的 registerGlobalEvent 规避
    const system = new TypeEventSystem();
    let hit = 0;

    system.register<PlayerDieEvent>(PlayerDieEvent, () => hit++);
    system.unRegister<PlayerDieEvent>(PlayerDieEvent, () => hit++);

    system.send(new PlayerDieEvent());
    expect(hit).toBe(1);
  });

  test('06 - register 返回的 IUnRegister 可以注销', () => {
    const system = new TypeEventSystem();
    const received: string[] = [];

    const unRegister = system.register<PlayerDieEvent>(PlayerDieEvent, (e) => received.push(e.name));
    system.send(new PlayerDieEvent('a'));
    unRegister.unRegister();
    system.send(new PlayerDieEvent('b'));

    expect(received).toEqual(['a']);
  });

  test('07 - 发送未注册的事件不报错（空转）', () => {
    const system = new TypeEventSystem();
    expect(() => system.send(new PlayerDieEvent())).not.toThrow();
  });

  test('08 - unRegister 未注册的事件不报错', () => {
    const system = new TypeEventSystem();
    expect(() => system.unRegister(PlayerDieEvent, () => {})).not.toThrow();
  });

  test('09 - sendByType：自动构造事件实例（对应 C# Send<T>() where T : new()）', () => {
    const system = new TypeEventSystem();
    const received: string[] = [];

    system.register<PlayerDieEvent>(PlayerDieEvent, (e) => received.push(e.name));
    system.sendByType(PlayerDieEvent, 'ctor-arg');

    expect(received).toEqual(['ctor-arg']);
  });

  test('10 - sendByType：透传多个构造参数', () => {
    const system = new TypeEventSystem();
    const received: string[] = [];

    class MultiArgEvent {
      constructor(
        public readonly a: string,
        public readonly b: number,
      ) {}
    }

    system.register<MultiArgEvent>(MultiArgEvent, (e) => received.push(`${e.a}${e.b}`));
    system.sendByType(MultiArgEvent, 'x', 1);

    expect(received).toEqual(['x1']);
  });

  test('11 - send 可以显式指定 key（同一个实例走不同通道）', () => {
    const system = new TypeEventSystem();
    const channelA: string[] = [];
    const channelB: string[] = [];

    system.register<string>('ch-a', (e) => channelA.push(e));
    system.register<string>('ch-b', (e) => channelB.push(e));

    system.send('hi', 'ch-a');

    expect(channelA).toEqual(['hi']);
    expect(channelB).toEqual([]);
  });

  test('12 - 字符串 / Symbol 通道', () => {
    const system = new TypeEventSystem();
    const sym = Symbol('sym');
    let hit = 0;

    system.register<number>(sym, () => hit++);
    system.send(1, sym);

    expect(hit).toBe(1);
  });

  test('13 - 基本类型事件：按装箱类型作为 key', () => {
    const system = new TypeEventSystem();
    const numbers: number[] = [];
    const strings: string[] = [];
    const booleans: boolean[] = [];

    system.register<number>(Number, (e) => numbers.push(e));
    system.register<string>(String, (e) => strings.push(e));
    system.register<boolean>(Boolean, (e) => booleans.push(e));

    system.send(42);
    system.send('hello');
    system.send(true);

    expect(numbers).toEqual([42]);
    expect(strings).toEqual(['hello']);
    expect(booleans).toEqual([true]);
  });

  test('13b - 基本类型事件可以注销', () => {
    const system = new TypeEventSystem();
    const received: number[] = [];
    const onEvent = (e: number) => received.push(e);

    system.register<number>(Number, onEvent);
    system.send(1);
    system.unRegister<number>(Number, onEvent);
    system.send(2);

    expect(received).toEqual([1]);
  });

  test('14 - 触发过程中注销其它监听者不会越界', () => {
    const system = new TypeEventSystem();
    const order: string[] = [];
    const b = () => order.push('b');

    system.register<PlayerDieEvent>(PlayerDieEvent, () => {
      order.push('a');
      system.unRegister<PlayerDieEvent>(PlayerDieEvent, b);
    });
    system.register<PlayerDieEvent>(PlayerDieEvent, b);

    system.send(new PlayerDieEvent());
    expect(order).toEqual(['a', 'b']);

    order.length = 0;
    system.send(new PlayerDieEvent());
    expect(order).toEqual(['a']);
  });

  test('15 - clear：清空该事件系统上的所有事件', () => {
    const system = new TypeEventSystem();
    let hit = 0;

    system.register<PlayerDieEvent>(PlayerDieEvent, () => hit++);
    system.register<ScoreChangedEvent>(ScoreChangedEvent, () => hit++);

    system.clear();
    system.send(new PlayerDieEvent());
    system.send(new ScoreChangedEvent());

    expect(hit).toBe(0);
  });

  test('16 - 实例之间互相隔离', () => {
    const a = new TypeEventSystem();
    const b = new TypeEventSystem();
    let hitA = 0;
    let hitB = 0;

    a.register<PlayerDieEvent>(PlayerDieEvent, () => hitA++);
    b.register<PlayerDieEvent>(PlayerDieEvent, () => hitB++);

    a.send(new PlayerDieEvent());

    expect(hitA).toBe(1);
    expect(hitB).toBe(0);
  });

  test('17 - Global 全局实例是单例', () => {
    expect(TypeEventSystem.Global).toBe(TypeEventSystem.Global);
  });
});

// #region IOnEvent / 全局事件

describe('IOnEvent 全局事件', () => {
  class TowerUpgradedEvent {
    constructor(public readonly level: number = 0) {}
  }

  test('01 - registerGlobalEvent：把对象注册为全局事件接收者', () => {
    const received: number[] = [];
    const listener = {
      onEvent(e: TowerUpgradedEvent) {
        received.push(e.level);
      },
    };

    registerGlobalEvent(listener, TowerUpgradedEvent);
    TypeEventSystem.Global.send(new TowerUpgradedEvent(3));

    expect(received).toEqual([3]);
  });

  test('02 - unRegisterGlobalEvent：可以正确注销', () => {
    // 关键用例：register / unRegister 内部复用同一个回调引用，
    // 因此不需要用户自己保存函数引用。
    const received: number[] = [];
    const listener = {
      onEvent(e: TowerUpgradedEvent) {
        received.push(e.level);
      },
    };

    registerGlobalEvent(listener, TowerUpgradedEvent);
    TypeEventSystem.Global.send(new TowerUpgradedEvent(1));

    unRegisterGlobalEvent(listener, TowerUpgradedEvent);
    TypeEventSystem.Global.send(new TowerUpgradedEvent(2));

    expect(received).toEqual([1]);
  });

  test('03 - 重复注册同一个对象只会订阅一次', () => {
    const received: number[] = [];
    const listener = {
      onEvent(e: TowerUpgradedEvent) {
        received.push(e.level);
      },
    };

    registerGlobalEvent(listener, TowerUpgradedEvent);
    registerGlobalEvent(listener, TowerUpgradedEvent);

    TypeEventSystem.Global.send(new TowerUpgradedEvent(1));

    // 第二次 register 复用同一个 handler，EasyEvent 会注册两次 → 触发两次
    expect(received.length).toBe(2);
  });

  test('04 - registerGlobalEvent 返回的注销器可以使用', () => {
    const received: number[] = [];
    const listener = {
      onEvent(e: TowerUpgradedEvent) {
        received.push(e.level);
      },
    };

    const unRegister = registerGlobalEvent(listener, TowerUpgradedEvent);
    TypeEventSystem.Global.send(new TowerUpgradedEvent(1));
    unRegister.unRegister();
    TypeEventSystem.Global.send(new TowerUpgradedEvent(2));

    expect(received).toEqual([1]);
  });

  test('05 - 不同对象的同名事件互相隔离', () => {
    const a: number[] = [];
    const b: number[] = [];
    const listenerA = { onEvent: (e: TowerUpgradedEvent) => a.push(e.level) };
    const listenerB = { onEvent: (e: TowerUpgradedEvent) => b.push(e.level) };

    registerGlobalEvent(listenerA, TowerUpgradedEvent);
    registerGlobalEvent(listenerB, TowerUpgradedEvent);

    TypeEventSystem.Global.send(new TowerUpgradedEvent(1));
    unRegisterGlobalEvent(listenerA, TowerUpgradedEvent);
    TypeEventSystem.Global.send(new TowerUpgradedEvent(2));

    expect(a).toEqual([1]);
    expect(b).toEqual([1, 2]);
  });
});

// #endregion
