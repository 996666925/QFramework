/**
 * IOCContainer 与注销机制（IUnRegister / IUnRegisterList / CustomUnRegister）的测试。
 */

import { describe, expect, test } from '@rstest/core';
import {
  CustomUnRegister,
  IOCContainer,
  addToUnregisterList,
  unRegisterAll,
} from '../src/index';
import type { IUnRegister } from '../src/index';

// #region IOCContainer

describe('IOCContainer', () => {
  class Service {
    constructor(public value = 1) {}
  }
  class AnotherService {}

  test('01 - register / get：默认以实例的构造函数作为 key', () => {
    const container = new IOCContainer();
    const service = new Service();

    container.register(service);

    expect(container.get<Service>(Service)).toBe(service);
  });

  test('02 - register：可以显式指定 key', () => {
    const container = new IOCContainer();
    const service = new Service();

    container.register(service, 'my-service');

    expect(container.get<Service>('my-service')).toBe(service);
    expect(container.get<Service>(Service)).toBeNull();
  });

  test('03 - get：未注册时返回 null（不抛异常）', () => {
    const container = new IOCContainer();

    expect(container.get<Service>(Service)).toBeNull();
    expect(container.get<AnotherService>(AnotherService)).toBeNull();
  });

  test('04 - register：重复注册同名 key 会覆盖', () => {
    const container = new IOCContainer();
    container.register(new Service(1));
    const next = new Service(2);

    container.register(next);

    expect(container.get<Service>(Service)).toBe(next);
    expect(container.get<Service>(Service)!.value).toBe(2);
  });

  test('05 - contains：判断某个 key 是否已注册', () => {
    const container = new IOCContainer();
    container.register(new Service());

    expect(container.contains(Service)).toBe(true);
    expect(container.contains(AnotherService)).toBe(false);
  });

  test('06 - remove / clear', () => {
    const container = new IOCContainer();
    container.register(new Service());
    container.register(new AnotherService());

    container.remove(Service);
    expect(container.get<Service>(Service)).toBeNull();
    expect(container.get<AnotherService>(AnotherService)).not.toBeNull();

    container.clear();
    expect(container.get<AnotherService>(AnotherService)).toBeNull();
    expect(container.contains(AnotherService)).toBe(false);
  });

  test('07 - 按接口注册：key 与实例类型解耦', () => {
    // 常见用法：用接口类（或抽象基类）作为 key
    abstract class IStorage {
      abstract save(data: string): string;
    }
    class LocalStorage extends IStorage {
      save(data: string): string {
        return `local:${data}`;
      }
    }

    const container = new IOCContainer();
    container.register(new LocalStorage(), IStorage);

    expect(container.get<IStorage>(IStorage)!.save('a')).toBe('local:a');
  });

  test('08 - 容器之间互相隔离', () => {
    const a = new IOCContainer();
    const b = new IOCContainer();
    const service = new Service();

    a.register(service);

    expect(a.get<Service>(Service)).toBe(service);
    expect(b.get<Service>(Service)).toBeNull();
  });
});

// #endregion

// #region CustomUnRegister

describe('CustomUnRegister', () => {
  test('01 - 构造时不执行回调，unRegister 时执行', () => {
    let count = 0;
    const unRegister = new CustomUnRegister(() => count++);

    expect(count).toBe(0);
    unRegister.unRegister();
    expect(count).toBe(1);
  });

  test('02 - 回调只会执行一次（幂等）', () => {
    let count = 0;
    const unRegister = new CustomUnRegister(() => count++);

    unRegister.unRegister();
    unRegister.unRegister();
    unRegister.unRegister();

    expect(count).toBe(1);
  });

  test('03 - 与 EasyEvent 配合：register 返回的注销器可取消订阅', () => {
    // 这里用一个最小的事件对象验证注销语义
    const handlers: (() => void)[] = [];
    const register = (h: () => void): IUnRegister => {
      handlers.push(h);
      return new CustomUnRegister(() => {
        const i = handlers.indexOf(h);
        if (i >= 0) handlers.splice(i, 1);
      });
    };

    let hit = 0;
    const unRegister = register(() => hit++);

    handlers.forEach((h) => h());
    expect(hit).toBe(1);

    unRegister.unRegister();
    handlers.forEach((h) => h());
    expect(hit).toBe(1);
  });
});

// #endregion

// #region IUnRegisterList

describe('IUnRegisterList', () => {
  const createList = () => ({ unregisterList: [] as IUnRegister[] });

  test('01 - addToUnregisterList：把注销器加入列表', () => {
    const list = createList();
    const unRegister = new CustomUnRegister(() => {});

    addToUnregisterList(unRegister, list);

    expect(list.unregisterList.length).toBe(1);
    expect(list.unregisterList[0]).toBe(unRegister);
  });

  test('02 - unRegisterAll：逐个执行并清空列表', () => {
    const list = createList();
    const order: number[] = [];

    addToUnregisterList(new CustomUnRegister(() => order.push(1)), list);
    addToUnregisterList(new CustomUnRegister(() => order.push(2)), list);
    addToUnregisterList(new CustomUnRegister(() => order.push(3)), list);

    unRegisterAll(list);

    expect(order).toEqual([1, 2, 3]);
    expect(list.unregisterList.length).toBe(0);
  });

  test('03 - unRegisterAll：注销过程中新增的项不会被本次消费', () => {
    const list = createList();
    let hit = 0;

    addToUnregisterList(
      new CustomUnRegister(() => {
        hit++;
        // 注销过程中往列表里加东西（模拟遍历时修改集合）
        list.unregisterList.push(
          new CustomUnRegister(() => {
            hit += 100;
          }),
        );
      }),
      list,
    );

    unRegisterAll(list);

    expect(hit).toBe(1);
    // 列表最后被清空，新增项也被清掉了
    expect(list.unregisterList.length).toBe(0);
  });

  test('04 - 空列表调用 unRegisterAll 不报错', () => {
    const list = createList();
    expect(() => unRegisterAll(list)).not.toThrow();
  });
});

// #endregion
