/**
 * OrEvent（或事件）的测试。
 */

import { describe, expect, test } from '@rstest/core';
import { EasyEvent, EasyEvent1, OrEvent, orEvent } from '../src/index';

describe('OrEvent', () => {
  test('01 - 任意一个源事件触发都会触发 OrEvent', () => {
    const coinChanged = new EasyEvent();
    const hpChanged = new EasyEvent();
    let hit = 0;

    new OrEvent().or(coinChanged).or(hpChanged).register(() => hit++);

    coinChanged.trigger();
    expect(hit).toBe(1);

    hpChanged.trigger();
    expect(hit).toBe(2);
  });

  test('02 - 支持链式 or 多个事件', () => {
    const a = new EasyEvent();
    const b = new EasyEvent();
    const c = new EasyEvent();
    let hit = 0;

    new OrEvent().or(a).or(b).or(c).register(() => hit++);

    a.trigger();
    b.trigger();
    c.trigger();

    expect(hit).toBe(3);
  });

  test('03 - 支持多个监听者', () => {
    const source = new EasyEvent();
    const order: string[] = [];

    const or = new OrEvent().or(source);
    or.register(() => order.push('a'));
    or.register(() => order.push('b'));

    source.trigger();

    expect(order).toEqual(['a', 'b']);
  });

  test('04 - 源事件可以是带参数的 EasyEvent1', () => {
    const coinChanged = new EasyEvent1<number>();
    let hit = 0;

    new OrEvent().or(coinChanged).register(() => hit++);

    coinChanged.trigger(10);

    expect(hit).toBe(1);
  });

  test('05 - orEvent 扩展函数：合并两个事件', () => {
    const a = new EasyEvent();
    const b = new EasyEvent();
    let hit = 0;

    orEvent(a, b).register(() => hit++);

    b.trigger();
    expect(hit).toBe(1);

    a.trigger();
    expect(hit).toBe(2);
  });

  test('06 - orEvent 等价于 new OrEvent().or(self).or(e)', () => {
    const a = new EasyEvent();
    const b = new EasyEvent();
    let hit1 = 0;
    let hit2 = 0;

    orEvent(a, b).register(() => hit1++);
    new OrEvent().or(a).or(b).register(() => hit2++);

    a.trigger();
    b.trigger();

    expect(hit1).toBe(hit2);
  });

  test('07 - register 返回的注销器可以取消订阅', () => {
    const source = new EasyEvent();
    let hit = 0;

    const or = new OrEvent().or(source);
    const unRegister = or.register(() => hit++);

    source.trigger();
    expect(hit).toBe(1);

    unRegister.unRegister();
    source.trigger();
    expect(hit).toBe(1);
  });

  test('08 - 注销时会一并注销所有源事件（与 C# 原版一致）', () => {
    const a = new EasyEvent();
    const b = new EasyEvent();
    let hit = 0;

    const or = new OrEvent().or(a).or(b);
    const unRegister = or.register(() => hit++);

    a.trigger();
    expect(hit).toBe(1);

    unRegister.unRegister();
    expect(or.unregisterList.length).toBe(0);

    a.trigger();
    b.trigger();
    expect(hit).toBe(1);
  });

  test('09 - 注销其中一个监听者会一并注销源事件，影响其它监听者', () => {
    // 这是 C# 原版的行为，使用时需注意：OrEvent 的注销是「整体注销」
    const source = new EasyEvent();
    let hitA = 0;
    let hitB = 0;

    const or = new OrEvent().or(source);
    const unRegisterA = or.register(() => hitA++);
    or.register(() => hitB++);

    source.trigger();
    expect(hitA).toBe(1);
    expect(hitB).toBe(1);

    unRegisterA.unRegister();
    source.trigger();

    expect(hitA).toBe(1);
    expect(hitB).toBe(1);
  });

  test('10 - 实现 IUnRegisterList，unregisterList 保存源事件的订阅', () => {
    const a = new EasyEvent();
    const b = new EasyEvent();

    const or = new OrEvent().or(a).or(b);

    expect(or.unregisterList.length).toBe(2);
  });

  test('11 - 没有源事件时，OrEvent 自身也能被触发（但无人调用 trigger）', () => {
    const or = new OrEvent();
    let hit = 0;

    or.register(() => hit++);

    expect(or.unregisterList.length).toBe(0);
    expect(hit).toBe(0);
  });

  test('12 - 与 BindableProperty 组合使用（值变化即刷新 UI）', () => {
    const coin = new EasyEvent1<number>();
    const hp = new EasyEvent1<number>();
    let refreshCount = 0;

    // BindableProperty 也是 IEasyEvent
    orEvent(coin, hp).register(() => refreshCount++);

    coin.trigger(1);
    hp.trigger(2);

    expect(refreshCount).toBe(2);
  });
});
