/**
 * 端到端集成测试：一个完整的「商店购买」场景。
 *
 * 覆盖：
 *   Architecture + Model(数据) + System(领域逻辑) + Utility(存储) +
 *   Command(写操作) + Query(读操作) + 事件 + BindableProperty +
 *   AbstractController(Laya 脚本) + 节点销毁自动注销
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
  unRegisterWhenNodeDestroyed,
} from '../src/index';
import type { IUtility } from '../src/index';
import { StubNode } from './laya-stub';

// #region 数据层：Model

class ShopModel extends AbstractModel {
  readonly coin = new BindableProperty<number>(100);
  readonly itemCount = new BindableProperty<number>(0);

  protected onInit(): void {
    this.coin.value = 100;
    this.itemCount.value = 0;
  }
}

// #endregion

// #region 事件

class PurchaseSucceededEvent {
  constructor(
    public readonly itemId: string,
    public readonly restCoin: number,
  ) {}
}

class PurchaseFailedEvent {
  constructor(public readonly reason: string) {}
}

// #endregion

// #region 基础设施层：Utility

interface IPriceTable extends IUtility {
  getPrice(itemId: string): number;
}

class PriceTable implements IPriceTable {
  private readonly mPrices: Record<string, number> = {
    sword: 60,
    potion: 20,
    shield: 150,
  };

  getPrice(itemId: string): number {
    return this.mPrices[itemId] ?? Number.MAX_SAFE_INTEGER;
  }
}

interface ILogger extends IUtility {
  readonly lines: string[];
  log(line: string): void;
}

class MemoryLogger implements ILogger {
  readonly lines: string[] = [];
  log(line: string): void {
    this.lines.push(line);
  }
}

// #endregion

// #region 查询

class GetCoinQuery extends AbstractQuery<number> {
  protected onDo(): number {
    return this.getModel(ShopModel)!.coin.value;
  }
}

/**
 * 注意：Query 层拿不到 Utility（C# 的 IQuery<TResult> 只继承
 * IBelongToArchitecture / ICanSetArchitecture / ICanGetModel / ICanGetSystem / ICanSendQuery）。
 * 因此价格由调用方传入，Query 只负责「读」。
 */
class CanAffordQuery extends AbstractQuery<boolean> {
  constructor(private readonly price: number) {
    super();
  }

  protected onDo(): boolean {
    return this.getModel(ShopModel)!.coin.value >= this.price;
  }
}

// #endregion

// #region 命令

class PurchaseCommand extends AbstractCommandWithResult<boolean> {
  constructor(private readonly itemId: string) {
    super();
  }

  protected onExecute(): boolean {
    const model = this.getModel(ShopModel)!;
    const price = this.getUtility(PriceTable)!.getPrice(this.itemId);
    const logger = this.getUtility(MemoryLogger)!;

    if (model.coin.value < price) {
      logger.log(`购买失败：${this.itemId} 金币不足`);
      this.sendEvent(new PurchaseFailedEvent('金币不足'));
      return false;
    }

    model.coin.value -= price;
    model.itemCount.value += 1;
    logger.log(`购买成功：${this.itemId}，剩余 ${model.coin.value}`);
    this.sendEvent(new PurchaseSucceededEvent(this.itemId, model.coin.value));
    return true;
  }
}

class EarnCoinCommand extends AbstractCommand {
  constructor(private readonly amount: number) {
    super();
  }

  protected onExecute(): void {
    const model = this.getModel(ShopModel)!;
    model.coin.value += this.amount;
    this.getUtility(MemoryLogger)!.log(`获得金币：${this.amount}`);
  }
}

// #endregion

// #region 领域层：System

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

  getPurchaseCount(): number {
    return this.mPurchaseCount;
  }
}

// #endregion

// #region 架构

class ShopApp extends Architecture<ShopApp> {
  protected init(): void {
    this.registerModel(new ShopModel());
    this.registerSystem(new AchievementSystem());
    this.registerUtility(new PriceTable());
    this.registerUtility(new MemoryLogger());
  }
}

// #endregion

// #region 表现层：Controller

class ShopController extends AbstractController {
  protected getArchitectureClass() {
    return ShopApp;
  }
}

// #endregion

describe('集成测试：商店购买场景', () => {
  test('01 - 架构初始化后各层就绪', () => {
    const app = ShopApp.Interface;

    expect(app.getModel(ShopModel)!.coin.value).toBe(100);
    expect(app.getSystem(AchievementSystem)).toBeInstanceOf(AchievementSystem);
    expect(app.getUtility(PriceTable)!.getPrice('sword')).toBe(60);
  });

  test('02 - Query：查询金币与购买力', () => {
    const app = ShopApp.Interface;

    expect(app.sendQuery(new GetCoinQuery())).toBe(100);
    expect(app.sendQuery(new CanAffordQuery(60))).toBe(true);
    expect(app.sendQuery(new CanAffordQuery(150))).toBe(false);
  });

  test('02b - 分层约束：Query 层拿不到 Utility', () => {
    const query = new GetCoinQuery();
    expect((query as unknown as { getUtility?: unknown }).getUtility).toBeUndefined();
  });

  test('03 - Command：购买成功会扣款、加物品、写日志、发事件', () => {
    const app = ShopApp.Interface;
    const model = app.getModel(ShopModel)!;
    const logger = app.getUtility(MemoryLogger)!;

    const ok = app.sendCommand(new PurchaseCommand('sword'));

    expect(ok).toBe(true);
    expect(model.coin.value).toBe(40);
    expect(model.itemCount.value).toBe(1);
    expect(logger.lines[logger.lines.length - 1]).toBe('购买成功：sword，剩余 40');
    expect(app.getSystem(AchievementSystem)!.getPurchaseCount()).toBe(1);
  });

  test('04 - Command：金币不足时失败并发出失败事件', () => {
    const app = ShopApp.Interface;
    const failed: string[] = [];

    app.registerEvent<PurchaseFailedEvent>(PurchaseFailedEvent, (e) => failed.push(e.reason));

    const ok = app.sendCommand(new PurchaseCommand('shield')); // 150 > 40

    expect(ok).toBe(false);
    expect(app.getModel(ShopModel)!.coin.value).toBe(40);
    expect(failed).toEqual(['金币不足']);
  });

  test('05 - BindableProperty：数据变化驱动 UI 刷新', () => {
    const model = ShopApp.Interface.getModel(ShopModel)!;
    const coinLog: number[] = [];

    model.coin.registerWithInitValue((v) => coinLog.push(v));

    ShopApp.Interface.sendCommand(new EarnCoinCommand(10));

    expect(coinLog[0]).toBe(40);
    expect(coinLog[coinLog.length - 1]).toBe(50);
    coinLog.length = 0;
  });

  test('06 - System：累计购买达成成就', () => {
    const app = ShopApp.Interface;
    const achievements = app.getSystem(AchievementSystem)!;

    app.sendCommand(new PurchaseCommand('potion')); // 第二次购买

    expect(achievements.getPurchaseCount()).toBe(2);
    expect(achievements.unlocked).toContain('连续购买');
    expect(app.getModel(ShopModel)!.coin.value).toBe(30);
  });

  test('07 - Controller：作为架构入口驱动整个流程', () => {
    const node = new StubNode();
    const controller = node.addComponent(ShopController);
    controller.onAwake();

    // 起始金币 30：earn 70 → 100
    controller.sendCommand(new EarnCoinCommand(70));
    const ok = controller.sendCommand(new PurchaseCommand('shield')); // 100 >= 150? 否

    expect(ok).toBe(false);
    expect(controller.getModel(ShopModel)!.coin.value).toBe(100);

    const ok2 = controller.sendCommand(new PurchaseCommand('sword')); // 100 >= 60
    expect(ok2).toBe(true);
    expect(controller.getModel(ShopModel)!.coin.value).toBe(40);
  });

  test('08 - 完整链路：命令 → 事件 → System → 成就', () => {
    const app = ShopApp.Interface;
    const achievements = app.getSystem(AchievementSystem)!;
    const before = achievements.unlocked.length;

    // 恰好花光所有金币，触发「一贫如洗」
    app.sendCommand(new EarnCoinCommand(20)); // 60
    app.sendCommand(new PurchaseCommand('sword')); // 0

    expect(app.getModel(ShopModel)!.coin.value).toBe(0);
    expect(achievements.unlocked.length).toBeGreaterThan(before);
    expect(achievements.unlocked).toContain('一贫如洗');
  });
});

// #region 生命周期集成

describe('集成测试：节点生命周期与注销', () => {
  class HudController extends AbstractController {
    readonly coinChanges: number[] = [];

    protected getArchitectureClass() {
      return ShopApp;
    }

    protected onInit(): void {
      const model = this.getModel(ShopModel)!;

      // 数据绑定，并绑定到节点生命周期
      unRegisterWhenNodeDestroyed(
        model.coin.registerWithInitValue((v) => this.coinChanges.push(v)),
        this.node,
      );
    }
  }

  test('01 - 节点存活时持续接收数据变化', () => {
    const node = new StubNode();
    const controller = node.addComponent(HudController);
    controller.onAwake();

    // registerWithInitValue 会立即收到一次当前值
    expect(controller.coinChanges.length).toBe(1);

    ShopApp.Interface.sendCommand(new EarnCoinCommand(5));
    expect(controller.coinChanges.length).toBe(2);
  });

  test('02 - 节点销毁后不再接收数据变化', () => {
    const node = new StubNode();
    const controller = node.addComponent(HudController);
    controller.onAwake();
    const before = controller.coinChanges.length;

    node.destroy();

    ShopApp.Interface.sendCommand(new EarnCoinCommand(5));
    expect(controller.coinChanges.length).toBe(before);
  });

  test('03 - 多个 Controller 独立绑定、独立注销', () => {
    const nodeA = new StubNode();
    const nodeB = new StubNode();
    const a = nodeA.addComponent(HudController);
    const b = nodeB.addComponent(HudController);
    a.onAwake();
    b.onAwake();

    ShopApp.Interface.sendCommand(new EarnCoinCommand(1));
    expect(a.coinChanges.length).toBe(b.coinChanges.length);

    nodeA.destroy();
    ShopApp.Interface.sendCommand(new EarnCoinCommand(1));

    expect(b.coinChanges.length).toBe(a.coinChanges.length + 1);
  });
});

// #endregion
