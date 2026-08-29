/**
 * EasyEvent 家族与 EasyEvents 事件集合的测试。
 */

import { describe, expect, test } from '@rstest/core';
import { EasyEvent, EasyEvent1, EasyEvent2, EasyEvent3, EasyEvents } from '../src/index';

// #region EasyEvent（无参）

describe('EasyEvent（无参，对应 C# EasyEvent）', () => {
  test('01 - register 后 trigger 会回调', () => {
    const e = new EasyEvent();
    let hit = 0;

    e.register(() => hit++);
    e.trigger();

    expect(hit).toBe(1);
  });

  test('02 - 支持多个监听者，按注册顺序触发', () => {
    const e = new EasyEvent();
    const order: string[] = [];

    e.register(() => order.push('a'));
    e.register(() => order.push('b'));
    e.trigger();

    expect(order).toEqual(['a', 'b']);
  });

  test('03 - 同一个监听者重复注册会触发多次', () => {
    const e = new EasyEvent();
    let hit = 0;
    const handler = () => hit++;

    e.register(handler);
    e.register(handler);
    e.trigger();

    expect(hit).toBe(2);
  });

  test('04 - unRegister 取消指定监听者', () => {
    const e = new EasyEvent();
    const order: string[] = [];
    const a = () => order.push('a');
    const b = () => order.push('b');

    e.register(a);
    e.register(b);
    e.unRegister(a);
    e.trigger();

    expect(order).toEqual(['b']);
  });

  test('05 - unRegister 未注册的监听者不报错', () => {
    const e = new EasyEvent();
    expect(() => e.unRegister(() => {})).not.toThrow();
  });

  test('06 - register 返回的 IUnRegister 可以取消订阅', () => {
    const e = new EasyEvent();
    let hit = 0;
    const unRegister = e.register(() => hit++);

    e.trigger();
    unRegister.unRegister();
    e.trigger();

    expect(hit).toBe(1);
  });

  test('07 - 触发过程中注销其它监听者不会漏触发 / 越界', () => {
    const e = new EasyEvent();
    const order: string[] = [];
    const b = () => order.push('b');

    e.register(() => {
      order.push('a');
      e.unRegister(b); // 遍历中移除
    });
    e.register(b);
    e.trigger();

    // 快照遍历：本次仍会触发 b
    expect(order).toEqual(['a', 'b']);

    order.length = 0;
    e.trigger();
    expect(order).toEqual(['a']);
  });

  test('08 - clear 清空所有监听者', () => {
    const e = new EasyEvent();
    let hit = 0;
    e.register(() => hit++);
    e.register(() => hit++);

    e.clear();
    e.trigger();

    expect(hit).toBe(0);
  });

  test('09 - 没有监听者时 trigger 不报错', () => {
    const e = new EasyEvent();
    expect(() => e.trigger()).not.toThrow();
  });

  test('10 - 重入触发：回调里再次触发同一事件不会破坏外层遍历', () => {
    const e = new EasyEvent();
    const order: string[] = [];
    let depth = 0;

    e.register(() => {
      order.push(`a${depth}`);
      if (depth === 0) {
        depth = 1;
        e.trigger(); // 重入
        depth = 0;
      }
      order.push(`a-end${depth}`);
    });
    e.register(() => order.push(`b${depth}`));

    e.trigger();

    // 外层遍历：a0 → 重入(a1 → a-end1, b1) → a-end0 → b0
    expect(order).toEqual(['a0', 'a1', 'a-end1', 'b1', 'a-end0', 'b0']);
  });

  test('11 - 重入触发时注销监听者不会越界', () => {
    const e = new EasyEvent();
    const order: string[] = [];
    const b = () => order.push('b');
    let first = true;

    e.register(() => {
      order.push('a');
      if (first) {
        first = false;
        e.unRegister(b);
      }
    });
    e.register(b);

    e.trigger();
    expect(order).toEqual(['a', 'b']);

    order.length = 0;
    e.trigger();
    expect(order).toEqual(['a']);
  });
});

// #endregion

// #region EasyEvent1（单参）

describe('EasyEvent1<T>（单参，对应 C# EasyEvent<T>）', () => {
  test('01 - 传递参数', () => {
    const e = new EasyEvent1<number>();
    const received: number[] = [];

    e.register((v) => received.push(v));
    e.trigger(7);

    expect(received).toEqual([7]);
  });

  test('02 - 支持无参回调（作为 IEasyEvent 使用）', () => {
    const e = new EasyEvent1<number>();
    let hit = 0;

    e.register(() => hit++);
    e.trigger(1);

    expect(hit).toBe(1);
  });

  test('03 - unRegister / 注销器', () => {
    const e = new EasyEvent1<string>();
    const received: string[] = [];
    const handler = (v: string) => received.push(v);

    const unRegister = e.register(handler);
    e.trigger('a');
    unRegister.unRegister();
    e.trigger('b');

    expect(received).toEqual(['a']);
  });

  test('04 - clear', () => {
    const e = new EasyEvent1<number>();
    let hit = 0;
    e.register(() => hit++);
    e.clear();
    e.trigger(1);
    expect(hit).toBe(0);
  });
});

// #endregion

// #region EasyEvent2 / EasyEvent3

describe('EasyEvent2<T, K>（双参，对应 C# EasyEvent<T, K>）', () => {
  test('01 - 传递两个参数', () => {
    const e = new EasyEvent2<string, number>();
    const received: string[] = [];

    e.register((name, age) => received.push(`${name}:${age}`));
    e.trigger('tom', 18);

    expect(received).toEqual(['tom:18']);
  });

  test('02 - 支持无参回调', () => {
    const e = new EasyEvent2<string, number>();
    let hit = 0;
    e.register(() => hit++);
    e.trigger('a', 1);
    expect(hit).toBe(1);
  });

  test('03 - unRegister', () => {
    const e = new EasyEvent2<string, number>();
    let hit = 0;
    const handler = () => hit++;

    e.register(handler);
    e.trigger('a', 1);
    e.unRegister(handler);
    e.trigger('a', 1);

    expect(hit).toBe(1);
  });
});

describe('EasyEvent3<T, K, S>（三参，对应 C# EasyEvent<T, K, S>）', () => {
  test('01 - 传递三个参数', () => {
    const e = new EasyEvent3<number, number, number>();
    let sum = 0;

    e.register((a, b, c) => (sum = a + b + c));
    e.trigger(1, 2, 3);

    expect(sum).toBe(6);
  });

  test('02 - 支持无参回调', () => {
    const e = new EasyEvent3<number, number, number>();
    let hit = 0;
    e.register(() => hit++);
    e.trigger(1, 2, 3);
    expect(hit).toBe(1);
  });

  test('03 - clear', () => {
    const e = new EasyEvent3<number, number, number>();
    let hit = 0;
    e.register(() => hit++);
    e.clear();
    e.trigger(1, 2, 3);
    expect(hit).toBe(0);
  });
});

// #endregion

// #region EasyEvents

describe('EasyEvents（事件集合）', () => {
  class EventA {}
  class EventB {}

  test('01 - getOrAddEvent：同一个 key 返回同一个实例', () => {
    const events = new EasyEvents();

    const a1 = events.getOrAddEvent<EasyEvent1<number>>(EventA, () => new EasyEvent1<number>());
    const a2 = events.getOrAddEvent<EasyEvent1<number>>(EventA, () => new EasyEvent1<number>());

    expect(a1).toBe(a2);
  });

  test('02 - getOrAddEvent：不同 key 返回不同实例', () => {
    const events = new EasyEvents();

    const a = events.getOrAddEvent<EasyEvent1<number>>(EventA, () => new EasyEvent1<number>());
    const b = events.getOrAddEvent<EasyEvent1<number>>(EventB, () => new EasyEvent1<number>());

    expect(a).not.toBe(b);
  });

  test('03 - getEvent：未注册返回 null，不会自动创建', () => {
    const events = new EasyEvents();

    expect(events.getEvent<EasyEvent1<number>>(EventA)).toBeNull();
    expect(events.getEvent<EasyEvent1<number>>(EventA)).toBeNull();
  });

  test('04 - addEvent / removeEvent', () => {
    const events = new EasyEvents();
    const e = new EasyEvent1<number>();

    events.addEvent(EventA, e);
    expect(events.getEvent<EasyEvent1<number>>(EventA)).toBe(e);

    events.removeEvent(EventA);
    expect(events.getEvent<EasyEvent1<number>>(EventA)).toBeNull();
  });

  test('05 - 字符串 / Symbol 也可以作为 key', () => {
    const events = new EasyEvents();
    const key = Symbol('evt');

    const e = events.getOrAddEvent<EasyEvent>(key, () => new EasyEvent());

    expect(events.getEvent<EasyEvent>(key)).toBe(e);
    expect(events.getOrAddEvent<EasyEvent>('other', () => new EasyEvent())).not.toBe(e);
  });

  test('06 - clear：清空所有事件', () => {
    const events = new EasyEvents();
    events.getOrAddEvent<EasyEvent>(EventA, () => new EasyEvent());
    events.getOrAddEvent<EasyEvent>(EventB, () => new EasyEvent());

    events.clear();

    expect(events.getEvent<EasyEvent>(EventA)).toBeNull();
    expect(events.getEvent<EasyEvent>(EventB)).toBeNull();
  });

  test('07 - 静态全局集合：EasyEvents.get / register', () => {
    class GlobalEvent {}

    // 注意：静态集合是全局共享的，这里只验证“能拿到同一个实例”
    const e1 = EasyEvents.register<EasyEvent1<number>>(GlobalEvent, () => new EasyEvent1<number>());
    const e2 = EasyEvents.get<EasyEvent1<number>>(GlobalEvent);

    expect(e2).toBe(e1);
    expect(EasyEvents.get<EasyEvent>(Symbol('not-exists'))).toBeNull();
  });

  test('08 - 实例之间互相隔离', () => {
    const a = new EasyEvents();
    const b = new EasyEvents();

    const ea = a.getOrAddEvent<EasyEvent>(EventA, () => new EasyEvent());
    const eb = b.getOrAddEvent<EasyEvent>(EventA, () => new EasyEvent());

    expect(ea).not.toBe(eb);
  });
});

// #endregion
