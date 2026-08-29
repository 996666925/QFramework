/**
 * LayaAir 的最小化测试桩。
 *
 * 重要：本文件 **不能** import '../src/index'。
 *   原因：`AbstractController` 在 `src/index` 模块求值时就会解析 `Laya.Script` 作为基类，
 *   一旦那时 `globalThis.Laya` 还没就绪，它就会退化成空基类，后续再也改不回来。
 *   因此本文件必须作为 rstest 的 `setupFiles` 在测试模块加载 **之前** 执行，
 *   并且只做一件事：把 Laya 挂到 globalThis。
 *
 * 这里只模拟 QFramework 实际用到的 Laya API（签名对齐 types/LayaAir.d.ts）：
 *   - Laya.Component / Laya.Script：生命周期 + owner
 *   - Laya.Node：addComponent / getComponent / destroy
 *   - Laya.Vector2/3/4、Matrix、Matrix4x4、Color、Quaternion、Rectangle、Bounds
 */

// #region 显示对象

/** 模拟 Laya.Component（Laya.Script 的父类） */
export class StubScript {
  /** Laya.Component.owner */
  owner: unknown = null;
  destroyed = false;

  onAwake(): void {}
  onEnable(): void {}
  onDisable(): void {}
  onDestroy(): void {
    this.destroyed = true;
  }
}

/** 模拟 Laya.Node 的组件管理 + 销毁广播 */
export class StubNode {
  /** 已挂载的组件（按挂载顺序） */
  readonly components: unknown[] = [];
  destroyed = false;

  private readonly mComponents = new Map<unknown, unknown>();

  getComponent<T>(type: new () => T): T | null {
    return (this.mComponents.get(type) as T) ?? null;
  }

  addComponent<T>(type: new () => T): T {
    const existing = this.mComponents.get(type);
    if (existing) return existing as T;

    const component = new type();
    (component as unknown as { owner: unknown }).owner = this;
    this.mComponents.set(type, component);
    this.components.push(component);
    return component;
  }

  /** 模拟节点销毁：依次调用所有组件的 onDestroy（与 Laya 行为一致） */
  destroy(): void {
    for (const component of this.components.slice()) {
      const script = component as unknown as StubScript;
      if (typeof script.onDestroy === 'function') script.onDestroy();
    }
    this.destroyed = true;
  }
}

// #endregion

// #region 值类型

export class StubVector2 {
  constructor(
    public x = 0,
    public y = 0,
  ) {}

  static equals(a: StubVector2, b: StubVector2): boolean {
    return a.x === b.x && a.y === b.y;
  }
}

export class StubVector3 {
  constructor(
    public x = 0,
    public y = 0,
    public z = 0,
  ) {}

  static equals(a: StubVector3, b: StubVector3): boolean {
    return a.x === b.x && a.y === b.y && a.z === b.z;
  }
}

export class StubVector4 {
  constructor(
    public x = 0,
    public y = 0,
    public z = 0,
    public w = 0,
  ) {}

  static equals(a: StubVector4, b: StubVector4): boolean {
    return a.x === b.x && a.y === b.y && a.z === b.z && a.w === b.w;
  }
}

export class StubMatrix {
  constructor(
    public a = 1,
    public b = 0,
    public c = 0,
    public d = 1,
    public tx = 0,
    public ty = 0,
  ) {}

  static equals(a: StubMatrix, b: StubMatrix): boolean {
    return a.a === b.a && a.b === b.b && a.c === b.c && a.d === b.d && a.tx === b.tx && a.ty === b.ty;
  }
}

/** Laya.Matrix4x4 内部用 elements: Float32Array 存储 */
export class StubMatrix4x4 {
  constructor(public elements: number[] = []) {}
}

/** Laya.Color：r/g/b/a 四个分量 */
export class StubColor {
  constructor(
    public r = 0,
    public g = 0,
    public b = 0,
    public a = 1,
  ) {}
}

/** Laya.Quaternion：x/y/z/w */
export class StubQuaternion {
  constructor(
    public x = 0,
    public y = 0,
    public z = 0,
    public w = 1,
  ) {}
}

/** Laya.Rectangle：x/y/width/height */
export class StubRectangle {
  constructor(
    public x = 0,
    public y = 0,
    public width = 0,
    public height = 0,
  ) {}
}

/** Laya.Bounds：通过 getMin / getMax 读取端点 */
export class StubBounds {
  constructor(
    private readonly minValue: StubVector3,
    private readonly maxValue: StubVector3,
  ) {}

  get min(): StubVector3 {
    return this.minValue;
  }

  get max(): StubVector3 {
    return this.maxValue;
  }

  getMin(): StubVector3 {
    return this.minValue;
  }

  getMax(): StubVector3 {
    return this.maxValue;
  }
}

// #endregion

/** 注入到 globalThis 的 Laya 桩对象 */
export const stubLaya = {
  Script: StubScript,
  Component: StubScript,
  Node: StubNode,
  Vector2: StubVector2,
  Vector3: StubVector3,
  Vector4: StubVector4,
  Matrix: StubMatrix,
  Matrix4x4: StubMatrix4x4,
  Color: StubColor,
  Quaternion: StubQuaternion,
  Rectangle: StubRectangle,
  Bounds: StubBounds,
};

// 必须在任何 src 代码求值之前完成
(globalThis as unknown as { Laya: unknown }).Laya = stubLaya;
