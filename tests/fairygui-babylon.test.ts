import { describe, expect, test } from '@rstest/core';
import {
  AbstractFairyGUIController,
  AbstractModel,
  Architecture,
  unRegisterWhenFairyGUIDisposed,
  unRegisterWhenFairyGUIUndisplayed,
} from '../packages/fairygui-babylon/src/index';

class FakeObject {
  disposed = false;
  private readonly listeners = new Map<string, Set<(...args: unknown[]) => void>>();

  on(type: string, listener: (...args: unknown[]) => void): void {
    let set = this.listeners.get(type);
    if (!set) this.listeners.set(type, (set = new Set()));
    set.add(listener);
  }

  off(type: string, listener?: (...args: unknown[]) => void): void {
    if (!listener) this.listeners.delete(type);
    else this.listeners.get(type)?.delete(listener);
  }

  emit(type: string): void {
    for (const listener of this.listeners.get(type) ?? []) listener();
  }

  dispose(): void {
    this.disposed = true;
  }
}

describe('FairyGUI-babylon adapter', () => {
  test('unregisters when a GObject is disposed', () => {
    const object = new FakeObject();
    let count = 0;
    unRegisterWhenFairyGUIDisposed({ unRegister: () => count++ }, object);
    object.dispose();
    object.dispose();
    expect(count).toBe(1);
  });

  test('unregisters immediately for an already disposed object', () => {
    const object = new FakeObject();
    object.dispose();
    let count = 0;
    unRegisterWhenFairyGUIDisposed({ unRegister: () => count++ }, object);
    expect(count).toBe(1);
  });

  test('unregisters when a GObject leaves the display list', () => {
    const object = new FakeObject();
    let count = 0;
    unRegisterWhenFairyGUIUndisplayed({ unRegister: () => count++ }, object);
    object.emit('fui_undisplay');
    object.emit('fui_undisplay');
    expect(count).toBe(1);
  });

  test('controller binds architecture and disposes with its view', () => {
    class App extends Architecture<App> {
      protected init(): void {
        this.registerModel(new Model());
      }
    }
    class Model extends AbstractModel {
      protected onInit(): void {}
    }
    class Controller extends AbstractFairyGUIController<FakeObject> {
      initialized = false;
      destroyed = false;
      constructor(view: FakeObject) { super(view); }
      protected getArchitectureClass() { return App; }
      protected onInit(): void { this.initialized = true; }
      protected onDestroy(): void { this.destroyed = true; }
    }

    const view = new FakeObject();
    const controller = Controller.create(view);
    expect(controller.initialized).toBe(true);
    expect(controller.getModel(Model)).not.toBeNull();
    view.dispose();
    expect(controller.destroyed).toBe(true);
  });
});
