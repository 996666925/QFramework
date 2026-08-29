/**
 * BindableProperty 的测试，包含 Laya 值类型比较器的适配验证。
 */

import { describe, expect, test } from '@rstest/core';
import { BindableProperty, registerBuiltInComparers } from '../src/index';
import {
  StubBounds,
  StubColor,
  StubMatrix,
  StubMatrix4x4,
  StubQuaternion,
  StubRectangle,
  StubVector2,
  StubVector3,
  StubVector4,
} from './laya-stub';

// #region 基础行为

describe('BindableProperty 基础行为', () => {
  test('01 - 构造时保存初始值', () => {
    expect(new BindableProperty<number>(10).value).toBe(10);
    expect(new BindableProperty<string>('a').value).toBe('a');
  });

  test('02 - 不传初始值时为 undefined', () => {
    const property = new BindableProperty<number>();
    expect(property.value).toBeUndefined();
  });

  test('03 - 值变化触发所有监听者', () => {
    const count = new BindableProperty<number>(0);
    const values: number[] = [];

    count.register((v) => values.push(v));
    count.value = 1;
    count.value = 2;

    expect(values).toEqual([1, 2]);
    expect(count.value).toBe(2);
  });

  test('04 - 监听者收到的是新值', () => {
    const count = new BindableProperty<number>(0);
    let last = -1;

    count.register((v) => (last = v));
    count.value = 5;

    expect(last).toBe(5);
  });

  test('05 - 设置相同的值不触发（number 使用 === 比较）', () => {
    const count = new BindableProperty<number>(1);
    let hit = 0;

    count.register(() => hit++);
    count.value = 1;

    expect(hit).toBe(0);
  });

  test('06 - 字符串按值比较', () => {
    const name = new BindableProperty<string>('a');
    let hit = 0;

    name.register(() => hit++);
    name.value = 'a';
    expect(hit).toBe(0);

    name.value = 'b';
    expect(hit).toBe(1);
  });

  test('07 - 布尔按值比较', () => {
    const flag = new BindableProperty<boolean>(false);
    let hit = 0;

    flag.register(() => hit++);
    flag.value = false;
    expect(hit).toBe(0);
    flag.value = true;
    expect(hit).toBe(1);
  });

  test('08 - 对象默认按引用比较（不同实例即视为变化）', () => {
    class Point {
      constructor(public x = 0) {}
    }
    const p = new BindableProperty<Point>(new Point(1));
    let hit = 0;

    p.register(() => hit++);
    p.value = new Point(1);

    expect(hit).toBe(1);
  });

  test('09 - 同一个对象实例赋值不触发', () => {
    class Point {
      constructor(public x = 0) {}
    }
    const point = new Point(1);
    const p = new BindableProperty<Point>(point);
    let hit = 0;

    p.register(() => hit++);
    p.value = point;

    expect(hit).toBe(0);
  });

  test('10 - registerWithInitValue：注册时立即回调一次当前值', () => {
    const count = new BindableProperty<number>(10);
    const values: number[] = [];

    count.registerWithInitValue((v) => values.push(v));
    count.value = 11;

    expect(values).toEqual([10, 11]);
  });

  test('11 - setValueWithoutEvent：静默改值，不触发回调', () => {
    const count = new BindableProperty<number>(0);
    let hit = 0;

    count.register(() => hit++);
    count.setValueWithoutEvent(5);

    expect(hit).toBe(0);
    expect(count.value).toBe(5);
  });

  test('12 - unRegister：取消指定监听', () => {
    const count = new BindableProperty<number>(0);
    let hit = 0;
    const onChanged = () => hit++;

    count.register(onChanged);
    count.value = 1;
    count.unRegister(onChanged);
    count.value = 2;

    expect(hit).toBe(1);
  });

  test('13 - unRegister 未注册的回调不报错', () => {
    const count = new BindableProperty<number>(0);
    expect(() => count.unRegister(() => {})).not.toThrow();
  });

  test('14 - register 返回的 IUnRegister 可以注销', () => {
    const count = new BindableProperty<number>(0);
    const values: number[] = [];

    const unRegister = count.register((v) => values.push(v));
    count.value = 1;
    unRegister.unRegister();
    count.value = 2;

    expect(values).toEqual([1]);
  });

  test('15 - 注销器只生效一次（幂等）', () => {
    const count = new BindableProperty<number>(0);
    let hit = 0;

    const unRegister = count.register(() => hit++);
    unRegister.unRegister();
    unRegister.unRegister();
    count.value = 1;

    expect(hit).toBe(0);
  });

  test('16 - clear：清空所有监听者', () => {
    const count = new BindableProperty<number>(0);
    let hit = 0;

    count.register(() => hit++);
    count.register(() => hit++);
    count.clear();
    count.value = 1;

    expect(hit).toBe(0);
  });

  test('17 - 支持无参回调（作为 IEasyEvent 使用）', () => {
    const count = new BindableProperty<number>(0);
    let hit = 0;

    count.register(() => hit++);
    count.value = 1;

    expect(hit).toBe(1);
  });

  test('18 - 多个监听者按注册顺序触发', () => {
    const count = new BindableProperty<number>(0);
    const order: string[] = [];

    count.register(() => order.push('a'));
    count.register(() => order.push('b'));
    count.value = 1;

    expect(order).toEqual(['a', 'b']);
  });

  test('19 - 触发过程中注销其它监听者不会越界', () => {
    const count = new BindableProperty<number>(0);
    const order: string[] = [];
    const b = () => order.push('b');

    count.register(() => {
      order.push('a');
      count.unRegister(b);
    });
    count.register(b);

    count.value = 1;
    expect(order).toEqual(['a', 'b']);

    order.length = 0;
    count.value = 2;
    expect(order).toEqual(['a']);
  });

  test('20 - toString 返回当前值的字符串形式', () => {
    expect(new BindableProperty<number>(42).toString()).toBe('42');
    expect(new BindableProperty<string>('hi').toString()).toBe('hi');
  });
});

// #endregion

// #region 比较器

describe('BindableProperty 比较器', () => {
  test('01 - withComparer：自定义比较器', () => {
    const count = new BindableProperty<number>(0).withComparer((a, b) => Math.abs(a - b) < 2);
    let hit = 0;

    count.register(() => hit++);
    count.value = 1; // 差值 1 < 2，视为未变化
    expect(hit).toBe(0);
    count.value = 3; // 差值 3 >= 2，视为变化
    expect(hit).toBe(1);
  });

  test('02 - withComparer 返回 this，支持链式调用', () => {
    const count = new BindableProperty<number>(0);
    expect(count.withComparer((a, b) => a === b)).toBe(count);
  });

  test('03 - 构造时通过 type 参数指定比较器查找键', () => {
    class Money {
      constructor(public cents = 0) {}
      static equals(a: Money, b: Money) {
        return a.cents === b.cents;
      }
    }

    const money = new BindableProperty<Money>(new Money(1), Money);
    let hit = 0;
    money.register(() => hit++);

    money.value = new Money(1); // static equals 判定相同
    expect(hit).toBe(0);

    money.value = new Money(2);
    expect(hit).toBe(1);
  });

  test('04 - 实例上的 equals 方法也会被使用', () => {
    class Version {
      constructor(public v = 0) {}
      equals(other: Version) {
        return this.v === other.v;
      }
    }

    const version = new BindableProperty<Version>(new Version(1));
    let hit = 0;
    version.register(() => hit++);

    version.value = new Version(1);
    expect(hit).toBe(0);
    version.value = new Version(2);
    expect(hit).toBe(1);
  });

  test('05 - setDefaultComparer / getDefaultComparer', () => {
    class Temperature {
      constructor(public c = 0) {}
    }

    BindableProperty.setDefaultComparer<Temperature>(Temperature, (a, b) => a.c === b.c);
    expect(BindableProperty.getDefaultComparer<Temperature>(Temperature)).not.toBeNull();
    expect(BindableProperty.getDefaultComparer<Temperature>(class Unknown {})).toBeNull();

    const t = new BindableProperty<Temperature>(new Temperature(20));
    let hit = 0;
    t.register(() => hit++);
    t.value = new Temperature(20);
    expect(hit).toBe(0);
  });

  test('06 - null / undefined 之间的切换', () => {
    const property = new BindableProperty<string | null>(null);
    const values: (string | null)[] = [];

    property.register((v) => values.push(v));
    property.value = null; // 相同，不触发
    property.value = 'a';
    property.value = null;

    expect(values).toEqual(['a', null]);
  });

  test('07 - 数组比较器（逐元素浅比较）', () => {
    const list = new BindableProperty<number[]>([1, 2]);
    let hit = 0;

    list.register(() => hit++);
    list.value = [1, 2]; // 内容相同，不触发
    expect(hit).toBe(0);

    list.value = [1, 3];
    expect(hit).toBe(1);

    list.value = [1, 2, 3]; // 长度不同
    expect(hit).toBe(2);
  });
});

// #endregion

// #region Laya 值类型比较器

describe('BindableProperty 与 Laya 值类型', () => {
  test('01 - Laya.Vector2 使用 static equals', () => {
    const position = new BindableProperty<Laya.Vector2>(new StubVector2(0, 0) as never, StubVector2);
    let hit = 0;
    position.register(() => hit++);

    position.value = new StubVector2(0, 0) as never;
    expect(hit).toBe(0);
    position.value = new StubVector2(1, 0) as never;
    expect(hit).toBe(1);
  });

  test('02 - Laya.Vector3 使用 static equals', () => {
    const position = new BindableProperty<Laya.Vector3>(new StubVector3(0, 0, 0) as never, StubVector3);
    let hit = 0;
    position.register(() => hit++);

    position.value = new StubVector3(0, 0, 0) as never;
    expect(hit).toBe(0);
    position.value = new StubVector3(0, 1, 0) as never;
    expect(hit).toBe(1);
  });

  test('03 - Laya.Vector4 使用 static equals', () => {
    const v = new BindableProperty<Laya.Vector4>(new StubVector4(0, 0, 0, 0) as never, StubVector4);
    let hit = 0;
    v.register(() => hit++);

    v.value = new StubVector4(0, 0, 0, 0) as never;
    expect(hit).toBe(0);
    v.value = new StubVector4(0, 0, 0, 1) as never;
    expect(hit).toBe(1);
  });

  test('04 - Laya.Matrix 使用 static equals', () => {
    const m = new BindableProperty<Laya.Matrix>(new StubMatrix() as never, StubMatrix);
    let hit = 0;
    m.register(() => hit++);

    m.value = new StubMatrix() as never;
    expect(hit).toBe(0);
    m.value = new StubMatrix(2, 0, 0, 2, 0, 0) as never;
    expect(hit).toBe(1);
  });

  test('05 - Laya.Color 按 r/g/b/a 分量比较', () => {
    const color = new BindableProperty<Laya.Color>(new StubColor(1, 0, 0, 1) as never, StubColor);
    let hit = 0;
    color.register(() => hit++);

    color.value = new StubColor(1, 0, 0, 1) as never;
    expect(hit).toBe(0);
    color.value = new StubColor(1, 0, 0, 0.5) as never; // alpha 变化
    expect(hit).toBe(1);
  });

  test('06 - Laya.Quaternion 按 x/y/z/w 分量比较', () => {
    const q = new BindableProperty<Laya.Quaternion>(
      new StubQuaternion(0, 0, 0, 1) as never,
      StubQuaternion,
    );
    let hit = 0;
    q.register(() => hit++);

    q.value = new StubQuaternion(0, 0, 0, 1) as never;
    expect(hit).toBe(0);
    q.value = new StubQuaternion(0, 1, 0, 0) as never;
    expect(hit).toBe(1);
  });

  test('07 - Laya.Rectangle 按 x/y/width/height 比较', () => {
    const rect = new BindableProperty<Laya.Rectangle>(
      new StubRectangle(0, 0, 10, 10) as never,
      StubRectangle,
    );
    let hit = 0;
    rect.register(() => hit++);

    rect.value = new StubRectangle(0, 0, 10, 10) as never;
    expect(hit).toBe(0);
    rect.value = new StubRectangle(0, 0, 10, 20) as never;
    expect(hit).toBe(1);
  });

  test('08 - Laya.Bounds 按 getMin / getMax 比较', () => {
    const make = (min: number, max: number) =>
      new StubBounds(new StubVector3(min, min, min), new StubVector3(max, max, max));

    const bounds = new BindableProperty<Laya.Bounds>(make(0, 1) as never, StubBounds);
    let hit = 0;
    bounds.register(() => hit++);

    bounds.value = make(0, 1) as never;
    expect(hit).toBe(0);
    bounds.value = make(0, 2) as never;
    expect(hit).toBe(1);
  });

  test('09 - Laya.Matrix4x4 按 elements 逐元素比较', () => {
    const make = (v: number) => new StubMatrix4x4([v, 0, 0, 0]);

    const m = new BindableProperty<Laya.Matrix4x4>(make(1) as never, StubMatrix4x4);
    let hit = 0;
    m.register(() => hit++);

    m.value = make(1) as never;
    expect(hit).toBe(0);
    m.value = make(2) as never;
    expect(hit).toBe(1);
  });

  test('10 - registerBuiltInComparers 可重复调用（幂等）', () => {
    expect(() => {
      registerBuiltInComparers();
      registerBuiltInComparers();
    }).not.toThrow();

    // 内置比较器仍然有效
    const count = new BindableProperty<number>(1);
    let hit = 0;
    count.register(() => hit++);
    count.value = 1;
    expect(hit).toBe(0);
  });

  test('11 - 未指定 type 时，用初始值的构造函数查找比较器', () => {
    // 初始值不为 null 时，构造函数即 StubVector3
    const p = new BindableProperty<Laya.Vector3>(new StubVector3(1, 1, 1) as never);
    let hit = 0;
    p.register(() => hit++);

    p.value = new StubVector3(1, 1, 1) as never;
    expect(hit).toBe(0);
    p.value = new StubVector3(2, 1, 1) as never;
    expect(hit).toBe(1);
  });
});

// #endregion
