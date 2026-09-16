/* eslint-disable @typescript-eslint/no-explicit-any */

/** LayaAir 适配层。核心包不依赖本文件。 */
import {
  AbstractType,
  Action1,
  Architecture,
  ArchitectureCapabilities,
  ArchitectureHolder,
  BindableProperty,
  Comparer,
  EventKey,
  IController,
  IArchitecture,
  IModel,
  IQuery,
  ISystem,
  IUtility,
  IUnRegister,
  Type,
  TypeToken,
} from '@qframework/core';

export * from '@qframework/core';

export type LayaNamespace = typeof Laya;

export function getLaya(): LayaNamespace | null {
  const g = globalThis as unknown as { Laya?: LayaNamespace };
  return g.Laya ?? null;
}

export function requireLaya(): LayaNamespace {
  const laya = getLaya();
  if (!laya) throw new Error('[QFramework] 未找到 Laya 全局对象，请确认已经引入 LayaAir。');
  return laya;
}

let layaScriptBase: Type<Laya.Script> | null = null;
let unRegisterTriggerType: Type<IUnRegisterTrigger & Laya.Component> | null = null;

export function installLaya(laya: LayaNamespace): void {
  (globalThis as unknown as { Laya?: LayaNamespace }).Laya = laya;
  layaScriptBase = null;
  unRegisterTriggerType = null;
  registerLayaComparers();
}

export function LayaScriptBase(): Type<Laya.Script> {
  if (layaScriptBase) return layaScriptBase;
  const laya = getLaya();
  layaScriptBase = (laya?.Script ?? (class {} as unknown as Type<Laya.Script>)) as Type<Laya.Script>;
  return layaScriptBase;
}

function fieldsComparer<T>(fields: readonly string[]): Comparer<T> {
  return (a: T, b: T) => fields.every((field) => (a as any)?.[field] === (b as any)?.[field]);
}

/** 注册 Laya 常用值类型比较器；可在切换/注入 Laya 实现后重复调用。 */
export function registerLayaComparers(): void {
  const laya = getLaya();
  if (!laya) return;
  const { Vector2, Vector3, Vector4, Matrix, Matrix4x4, Color, Quaternion, Rectangle, Bounds } = laya as any;

  if (Vector2) BindableProperty.setDefaultComparer(Vector2, Vector2.equals);
  if (Vector3) BindableProperty.setDefaultComparer(Vector3, Vector3.equals);
  if (Vector4) BindableProperty.setDefaultComparer(Vector4, Vector4.equals);
  if (Matrix) BindableProperty.setDefaultComparer(Matrix, Matrix.equals);
  if (Color) BindableProperty.setDefaultComparer(Color, fieldsComparer(['r', 'g', 'b', 'a']));
  if (Quaternion) BindableProperty.setDefaultComparer(Quaternion, fieldsComparer(['x', 'y', 'z', 'w']));
  if (Rectangle) BindableProperty.setDefaultComparer(Rectangle, fieldsComparer(['x', 'y', 'width', 'height']));
  if (Bounds)
    BindableProperty.setDefaultComparer(Bounds, (a: any, b: any) => {
      const equals = Vector3?.equals ?? ((x: any, y: any) => x === y);
      return !!equals(a?.getMin?.() ?? a?.min, b?.getMin?.() ?? b?.min) &&
        !!equals(a?.getMax?.() ?? a?.max, b?.getMax?.() ?? b?.max);
    });
  if (Matrix4x4)
    BindableProperty.setDefaultComparer(Matrix4x4, (a: any, b: any) => {
      if (a === b) return true;
      const ea = a?.elements;
      const eb = b?.elements;
      if (!ea || !eb || ea.length !== eb.length) return false;
      return ea.every((value: number, index: number) => value === eb[index]);
    });
}

registerLayaComparers();

export abstract class AbstractController extends LayaScriptBase() implements IController {
  private readonly mHolder = new ArchitectureHolder(this);
  private readonly mCap = new ArchitectureCapabilities(this.mHolder);
  private mArchitecture: IArchitecture | null = null;

  get node(): Laya.Node {
    return (this as unknown as Laya.Script).owner;
  }

  getArchitecture(): IArchitecture {
    if (!this.mArchitecture)
      throw new Error('[QFramework] AbstractController 尚未绑定架构，请重写 getArchitectureClass() 或在 onAwake 前调用 setArchitecture()。');
    return this.mArchitecture;
  }

  setArchitecture(architecture: IArchitecture): void {
    this.mArchitecture = architecture;
    this.mHolder.setArchitecture(architecture);
  }

  protected getArchitectureClass(): AbstractType<Architecture<any>> | null {
    return null;
  }

  getSystem<TSystem extends ISystem>(key: TypeToken<TSystem>): TSystem | null { return this.mCap.getSystem(key); }
  getModel<TModel extends IModel>(key: TypeToken<TModel>): TModel | null { return this.mCap.getModel(key); }
  getUtility<TUtility extends IUtility>(key: TypeToken<TUtility>): TUtility | null { return this.mCap.getUtility(key); }
  sendCommand<TResult = void>(command: any): TResult { return this.mCap.sendCommand(command); }
  sendQuery<TResult>(query: IQuery<TResult>): TResult { return this.mCap.sendQuery(query); }
  registerEvent<T>(key: EventKey<T>, onEvent: Action1<T>): IUnRegister { return this.mCap.registerEvent(key, onEvent); }
  unRegisterEvent<T>(key: EventKey<T>, onEvent: Action1<T>): void { this.mCap.unRegisterEvent(key, onEvent); }

  onAwake(): void {
    const architectureClass = this.getArchitectureClass();
    if (architectureClass && !this.mArchitecture) this.setArchitecture(Architecture.getInstance.call(architectureClass));
    this.onInit();
  }

  protected onInit(): void {}
}

export interface IUnRegisterTrigger {
  addUnRegister(unRegister: IUnRegister): void;
  removeUnRegister(unRegister: IUnRegister): void;
}

export function getUnRegisterOnDestroyTriggerType(): Type<IUnRegisterTrigger & Laya.Component> {
  if (unRegisterTriggerType) return unRegisterTriggerType;
  const Base = LayaScriptBase();
  class UnRegisterOnDestroyTrigger extends Base implements IUnRegisterTrigger {
    private readonly mUnRegisters = new Set<IUnRegister>();
    addUnRegister(unRegister: IUnRegister): void { this.mUnRegisters.add(unRegister); }
    removeUnRegister(unRegister: IUnRegister): void { this.mUnRegisters.delete(unRegister); }
    onDestroy(): void {
      for (const unRegister of Array.from(this.mUnRegisters)) unRegister.unRegister();
      this.mUnRegisters.clear();
    }
  }
  unRegisterTriggerType = UnRegisterOnDestroyTrigger as unknown as Type<IUnRegisterTrigger & Laya.Component>;
  return unRegisterTriggerType;
}

export function unRegisterWhenNodeDestroyed(unRegister: IUnRegister, node: Laya.Node): IUnRegister {
  requireLaya();
  const triggerType = getUnRegisterOnDestroyTriggerType();
  let trigger = node.getComponent(triggerType) as (IUnRegisterTrigger & Laya.Component) | null;
  if (!trigger) trigger = node.addComponent(triggerType);
  trigger.addUnRegister(unRegister);
  return unRegister;
}

export function unRegisterWhenComponentDestroyed(unRegister: IUnRegister, component: Laya.Component): IUnRegister {
  return unRegisterWhenNodeDestroyed(unRegister, component.owner);
}
