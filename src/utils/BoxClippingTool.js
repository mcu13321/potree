import { EventDispatcher } from '../EventDispatcher.js';
import { startBoxClippingSession } from './box-clipping/startBoxClippingSession.js';
import { mountBoxClippingControls } from './box-clipping/BoxClippingControls.js';
import {
  exportPotreeClippingJson, parsePotreeClippingJson, applyPotreeClippingJson,
} from './box-clipping/potreeClippingJson.js';

// A viewer can have one clipping result, with or without editing controls.
const owners = new WeakMap();

/** Reusable box editing and JSON IO; explicit targets take precedence over defaults. */
export class BoxClippingTool extends EventDispatcher {
  constructor(viewer) {
    super();
    this.viewer = viewer;
    this._session = null;
    this._removeControls = null;
    this._disposed = false;
  }

  get active() { return this._session !== null; }
  get editing() { return this._removeControls !== null; }
  get volume() { return this._session?.volume ?? null; }
  get targetCloud() { return this._session?.targetCloud ?? null; }
  get keep() { return this._session?.keepOutside ? 'outside' : 'inside'; }

  /** Open editing, preserving an imported result when the target stays the same. */
  start(options = {}) {
    this._ensureSession(options);
    this._setEditing(true);
    this._changed();
    return this;
  }

  /** An explicit invalid target must fail instead of silently clipping another cloud. */
  _resolveTarget(options) {
    if (this._disposed) throw new Error('Unavailable');
    const cloud = options.targetCloud !== undefined
      ? options.targetCloud : this.targetCloud ?? this.viewer.scene.pointclouds[0];
    if (!cloud?.visible || !this.viewer.scene.pointclouds.includes(cloud)) throw new Error('Unavailable');
    return cloud;
  }

  _ensureSession(options) {
    const targetCloud = this._resolveTarget(options);
    if (this.active && this.targetCloud === targetCloud) return;
    const bounds = this.viewer.scene.getBoundingBox4One(targetCloud);
    if (bounds.isEmpty() || ![...bounds.min.toArray(), ...bounds.max.toArray()].every(Number.isFinite)) throw new Error('Unavailable');
    owners.get(this.viewer)?.stop();
    this._session = startBoxClippingSession(this.viewer, { ...options, targetCloud }, () => this._closed());
    if (!this._session) throw new Error('Unavailable');
    // Hidden volumes still participate in native clipping, like existing height volumes.
    this.volume.visible = false;
    owners.set(this.viewer, this);
  }

  _setEditing(enabled) {
    if (!enabled) {
      const remove = this._removeControls;
      this._removeControls = null;
      remove?.();
      this.volume.visible = false;
      return;
    }
    this.volume.visible = true;
    if (this.editing) return;
    try {
      this._removeControls = mountBoxClippingControls(this.viewer, this.volume, () => {
        if (this.active) this._changed();
      });
    } catch (error) {
      this.stop();
      throw error;
    }
  }

  /** Change only this result's direction, keeping global business clipping intact. */
  setKeep(keep) {
    if (!['inside', 'outside'].includes(keep)) throw new Error('InvalidJson');
    if (!this.active) throw new Error('Unavailable');
    this._session.setKeepOutside(keep === 'outside');
    this._changed();
    return this;
  }

  /** Export is available for both editable and effect-only results. */
  toJSON() {
    if (!this.active) throw new Error('Unavailable');
    return exportPotreeClippingJson(this._session);
  }

  /** Validate before mutation, then apply without showing a box or editing controls. */
  fromJSON(data, options = {}) {
    const cloud = this._resolveTarget(options);
    let text;
    try { text = typeof data === 'string' ? data : JSON.stringify(data); }
    catch { throw new Error('InvalidJson'); }
    const pose = parsePotreeClippingJson(text, cloud);
    this._ensureSession({ ...options, targetCloud: cloud });
    // Cancel any captured drag before applying the imported pose.
    this._setEditing(false);
    applyPotreeClippingJson(this._session, pose);
    this._changed();
    return this;
  }

  /** Stop removes the result; dispose also releases subscribers permanently. */
  stop() { this._session?.dispose(); }

  dispose() {
    this.stop();
    this._disposed = true;
    this._listeners = {};
  }

  _closed() {
    this._session = null;
    const remove = this._removeControls;
    this._removeControls = null;
    remove?.();
    if (owners.get(this.viewer) === this) owners.delete(this.viewer);
    this._changed();
  }

  _changed() {
    this.dispatchEvent({ type: 'change', tool: this, active: this.active, editing: this.editing, volume: this.volume, keep: this.keep });
  }
}
