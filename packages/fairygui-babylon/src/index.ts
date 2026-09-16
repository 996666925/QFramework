/* eslint-disable @typescript-eslint/no-explicit-any */

import {
  AbstractType,
  Action1,
  Architecture,
  ArchitectureCapabilities,
  ArchitectureHolder,
  CustomUnRegister,
  EventKey,
  ICommand,
  IArchitecture,
  IController,
  IModel,
  IQuery,
  ISystem,
  IUnRegister,
  IUtility,
  TypeToken,
} from '@qframework/core';

export * from '@qframework/core';

/** 最小的 FairyGUI 对象契约，避免适配层的声明依赖污染 core。 */
export interface FairyGUIObjectLike {
  dispose(): void;
  on(type: string, listener: (...args: any[]) => void, target?: unknown): void;
  off(type: string, listener?: (...args: any[]) => void, target?: unknown): void;
  readonly disposed?: boolean;
  readonly onStage?: boolean;
}

export interface FairyGUIComponentLike extends FairyGUIObjectLike {
  addChild?(child: FairyGUIObjectLike): FairyGUIObjectLike;
  removeChild?(child: FairyGUIObjectLike): FairyGUIObjectLike;
}

/** fairygui-babylon 包的运行时注入契约。可直接传入其命名空间对象。 */
export interface FairyGUIBabylonRuntime {
  EventType?: {
    DISPLAY?: string;
    UNDISPLAY?: string;
  };
}

let fairyGUIRuntime: FairyGUIBabylonRuntime | null = null;

export function installFairyGUIBabylon(runtime: FairyGUIBabylonRuntime): void {
  fairyGUIRuntime = runtime;
}

export function getFairyGUIBabylon(): FairyGUIBabylonRuntime | null {
  return fairyGUIRuntime;
}

function eventType(name: 'DISPLAY' | 'UNDISPLAY'): string {
  return fairyGUIRuntime?.EventType?.[name] ?? (name === 'DISPLAY' ? 'fui_display' : 'fui_undisplay');
}

const disposeHooks = new WeakMap<object, Set<IUnRegister>>();
const originalDispose = new WeakMap<object, () => void>();

/** 在 FairyGUI GObject.dispose() 时注销。可重复调用且不会重复包装 dispose。 */
export function unRegisterWhenFairyGUIDisposed<T extends FairyGUIObjectLike>(
  unRegister: IUnRegister,
  object: T,
): IUnRegister {
  if (object.disposed) {
    unRegister.unRegister();
    return new CustomUnRegister(() => undefined);
  }

  let hooks = disposeHooks.get(object);
  if (!hooks) {
    hooks = new Set<IUnRegister>();
    disposeHooks.set(object, hooks);
  }

  if (!originalDispose.has(object)) {
    const original = object.dispose.bind(object);
    originalDispose.set(object, original);
    object.dispose = () => {
      const current = disposeHooks.get(object);
      if (current) {
        for (const hook of Array.from(current)) hook.unRegister();
        current.clear();
      }
      original();
    };
  }

  hooks.add(unRegister);
  return new CustomUnRegister(() => hooks!.delete(unRegister));
}

/** 更短的别名，适合与 Laya 层的生命周期辅助函数配套使用。 */
export const unRegisterWhenObjectDisposed = unRegisterWhenFairyGUIDisposed;

/** 在 FairyGUI 对象离开显示列表时注销。 */
export function unRegisterWhenFairyGUIUndisplayed<T extends FairyGUIObjectLike>(
  unRegister: IUnRegister,
  object: T,
): IUnRegister {
  const type = eventType('UNDISPLAY');
  let registration: CustomUnRegister;
  const listener = () => registration.unRegister();
  object.on(type, listener);
  registration = new CustomUnRegister(() => {
    object.off(type, listener);
    unRegister.unRegister();
  });
  return registration;
}

export abstract class AbstractFairyGUIController<TView extends FairyGUIObjectLike = FairyGUIComponentLike>
  implements IController {
  private readonly mHolder = new ArchitectureHolder(this);
  private readonly mCap = new ArchitectureCapabilities(this.mHolder);
  private mArchitecture: IArchitecture | null = null;
  private mDestroyed = false;

  constructor(public readonly view: TView) {
    unRegisterWhenFairyGUIDisposed(new CustomUnRegister(() => this.destroy()), view);
  }

  /**
   * 创建并立即唤醒控制器。
   *
   * 使用工厂而不是在基类构造函数中调用 onAwake，是为了确保子类构造函数
   * 和字段初始化器已经完成后才执行 onInit。
   */
  static create<TController extends AbstractFairyGUIController<TView>, TView extends FairyGUIObjectLike>(
    this: new (view: TView) => TController,
    view: TView,
  ): TController {
    const controller = new this(view);
    controller.onAwake();
    return controller;
  }

  getArchitecture(): IArchitecture {
    if (!this.mArchitecture)
      throw new Error('[QFramework] AbstractFairyGUIController 尚未绑定架构，请重写 getArchitectureClass() 或先调用 onAwake()。');
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
  sendCommand<TResult = void>(command: ICommand<TResult>): TResult { return this.mCap.sendCommand(command); }
  sendQuery<TResult>(query: IQuery<TResult>): TResult { return this.mCap.sendQuery(query); }
  registerEvent<T>(key: EventKey<T>, onEvent: Action1<T>): IUnRegister { return this.mCap.registerEvent(key, onEvent); }
  unRegisterEvent<T>(key: EventKey<T>, onEvent: Action1<T>): void { this.mCap.unRegisterEvent(key, onEvent); }

  /** 在视图已经创建并可访问架构后调用；重复调用不会重复初始化。 */
  onAwake(): void {
    if (this.mDestroyed || this.mArchitecture) return;
    const architectureClass = this.getArchitectureClass();
    if (architectureClass) this.setArchitecture(Architecture.getInstance.call(architectureClass));
    this.onInit();
  }

  protected onInit(): void {}

  /** 主动销毁控制器及其 FairyGUI 视图。 */
  destroy(): void {
    if (this.mDestroyed) return;
    this.mDestroyed = true;
    this.onDestroy();
    if (!this.view.disposed) this.view.dispose();
  }

  protected onDestroy(): void {}
}

export const AbstractController = AbstractFairyGUIController;
