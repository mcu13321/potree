import { afterEach, expect, test, vi } from 'vitest';
import { Box3, Object3D, PerspectiveCamera, Vector3 } from '../libs/three.js/build/three.module.js';
import { EventDispatcher } from '../src/EventDispatcher.js';
import { BoxClippingTool } from '../src/utils/BoxClippingTool.js';

// Keep real volumes and transforms; canvas text rasterization is outside these DOM tests.
vi.mock('../src/TextSprite.js', async () => {
  const { Object3D } = await import('../libs/three.js/build/three.module.js');
  return { TextSprite: class extends Object3D {
    constructor() { super(); this.material = {}; }
    setBorderColor() {}
    setBackgroundColor() {}
  } };
});

const tools = [];
afterEach(() => {
  tools.splice(0).forEach(tool => tool.dispose());
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

// Reproduce scene volume events and native clipping assignment without a WebGL context.
function fixture() {
  const viewer = new EventDispatcher();
  const host = document.createElement('div');
  const canvas = document.createElement('canvas');
  host.append(canvas); document.body.append(host);
  canvas.getBoundingClientRect = () => ({left:20,top:30,width:800,height:600});
  viewer.renderer = {domElement:canvas};
  viewer.scene = new EventDispatcher();
  viewer.scene.volumes = [];
  viewer.scene.addVolume = v => viewer.scene.volumes.push(v);
  viewer.scene.removeVolume = volume => {
    viewer.scene.volumes = viewer.scene.volumes.filter(v => v !== volume);
    viewer.scene.dispatchEvent({type:'volume_removed',volume});
  };
  const camera = new PerspectiveCamera(60, 4/3, .1, 100);
  camera.position.set(8,-12,10); camera.lookAt(0,0,0); camera.updateMatrixWorld(true);
  viewer.scene.getActiveCamera = () => camera;
  viewer.scene.getBoundingBox4One = c => c.getBoundingBoxWorld();
  viewer.scene.pointclouds = ['a','a','b'].map(baseUrl => {
    const c = new Object3D();
    c.baseUrl = baseUrl;
    c.pcoGeometry = {offset:new Vector3(100,200,300)};
    c.getBoundingBoxWorld = () => new Box3(new Vector3(-2,-3,-1),new Vector3(2,3,1));
    c.material = {clipBoxes:[],clipTask:0,clipMethod:0,setClipBoxes(boxes){this.clipBoxes=boxes;}};
    return c;
  });
  viewer.clipTask=0; viewer.clipMethod=0;
  viewer.inputHandler={selection:[],blacklist:new Set(),deselectAll(){this.selection=[];}};
  const tool = new BoxClippingTool(viewer); tools.push(tool);
  const tick = () => {
    for(const cloud of viewer.scene.pointclouds) {
      cloud.material.setClipBoxes(viewer.scene.volumes.map(box=>({box,inverse:box.matrixWorld.clone().invert()})));
      cloud.material.clipTask=viewer.clipTask; cloud.material.clipMethod=viewer.clipMethod;
    }
    viewer.dispatchEvent({type:'update'});
  };
  return {viewer,tool,host,tick,targetCloud:viewer.scene.pointclouds[0]};
}

test('default targets one object, mounts twelve native buttons, and cleans up on scene change', () => {
  const {viewer,tool,host,tick,targetCloud} = fixture();
  const changes=[]; tool.addEventListener('change', e=>changes.push(e.active));
  tool.start({targetCloud}); tick();
  expect(viewer.scene.pointclouds.map(c=>c.material.clipTask)).toEqual([2,0,0]);
  expect(host.querySelectorAll('button')).toHaveLength(12);
  expect(tool.volume.frame.material.color.getHex()).toBe(0xffff00);
  for(const axis of ['x','y','z']) {
    expect(host.querySelector(`[data-face="${axis}+"] button`).style.background)
      .toBe(host.querySelector(`[data-face="${axis}-"] button`).style.background);
  }
  viewer.dispatchEvent({type:'scene_changed'});
  expect(tool.active).toBe(false);
  expect(host.querySelector('[data-potree-box-clipping]')).toBeNull();
  expect(host.style.position).toBe('');
  expect(viewer.scene.volumes).toHaveLength(0);
  expect(viewer._listeners.update).toHaveLength(0);
  expect(changes).toEqual([true,false]);
});

test('host predicate includes duplicates and import preserves v1 without mutating its document', () => {
  const {viewer,tool,tick,targetCloud} = fixture();
  const options={targetCloud,matchesTarget:cloud=>cloud.baseUrl==='a'};
  tool.start(options); tool.setKeep('outside'); tick();
  expect(viewer.scene.pointclouds.map(c=>c.material.clipTask)).toEqual([3,3,0]);
  const data=tool.toJSON(); const original=JSON.stringify(data);
  tool.stop(); expect(tool.active).toBe(false);
  targetCloud.position.x+=20;
  tool.fromJSON(data,options);
  expect(tool.volume.position.x).toBeCloseTo(20);
  expect(tool.keep).toBe('outside');
  expect(JSON.stringify(data)).toBe(original);
  const box=tool.volume;
  expect(()=>tool.fromJSON('{')).toThrow('InvalidJson');
  expect(tool.volume).toBe(box);
  tool.stop();
  expect(()=>tool.fromJSON('{',options)).toThrow('InvalidJson');
  expect(tool.active).toBe(false);
  expect(viewer.scene.volumes).toHaveLength(0);
});

test('pointer cancellation restores the box and releases capture on dispose', () => {
  const {tool,host,targetCloud}=fixture(); tool.start({targetCloud});
  const button=host.querySelector('[data-face="z+"] [data-mode="rotate"]');
  let captured=false;
  button.setPointerCapture=()=>{captured=true;};
  button.hasPointerCapture=()=>captured;
  button.releasePointerCapture=()=>{captured=false;};
  const pointer=(type,x)=>{
    const e=new MouseEvent(type,{bubbles:true,cancelable:true,button:0,clientX:x,clientY:100});
    Object.defineProperties(e,{pointerId:{value:1},pointerType:{value:'mouse'}});
    button.dispatchEvent(e);
  };
  const box=tool.volume; const before=box.quaternion.clone();
  pointer('pointerdown',100); pointer('pointermove',160);
  expect(box.quaternion.equals(before)).toBe(false);
  window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}));
  expect(box.quaternion.equals(before)).toBe(true); expect(captured).toBe(false);
  pointer('pointerdown',100); pointer('pointermove',160); tool.dispose();
  expect(box.quaternion.equals(before)).toBe(true); expect(captured).toBe(false);
  expect(host.querySelectorAll('button')).toHaveLength(0);
  expect(()=>tool.start({targetCloud})).toThrow('Unavailable');
});

test('only one tool is active per viewer and removing the last target closes it', () => {
  const {tool,viewer,targetCloud,host}=fixture(); tool.start({targetCloud});
  const other=new BoxClippingTool(viewer); tools.push(other);
  other.start({targetCloud});
  expect(tool.active).toBe(false); expect(other.active).toBe(true);
  expect(host.querySelectorAll('[data-potree-box-clipping]')).toHaveLength(1);
  viewer.scene.pointclouds.shift();
  viewer.scene.dispatchEvent({type:'pointcloud_removed',pointcloud:targetCloud});
  expect(other.active).toBe(false);
  expect(host.querySelectorAll('button')).toHaveLength(0);
});


// Explicit targets override the default even when another result is already active.
test('start defaults to the first cloud and can switch to an explicitly selected cloud', () => {
  const {tool,viewer,tick,targetCloud}=fixture();
  tool.start(); expect(tool.targetCloud).toBe(targetCloud);
  const selected=viewer.scene.pointclouds[2];
  tool.start({targetCloud:selected}); tick();
  expect(tool.targetCloud).toBe(selected);
  expect(viewer.scene.pointclouds.map(c=>c.material.clipTask)).toEqual([0,0,2]);
  const box=tool.volume;
  expect(()=>tool.start({targetCloud:new Object3D()})).toThrow('Unavailable');
  expect(tool.volume).toBe(box);
});

// JSON application has no editor side effects, but retains a reusable/exportable result.
test('import applies a hidden result to the explicit target and editing resumes the same box', () => {
  const {tool,viewer,host,tick}=fixture();
  tool.start(); tool.volume.position.x=1; tool.setKeep('outside');
  const data=tool.toJSON();
  const selected=viewer.scene.pointclouds[2];
  tool.fromJSON(data,{targetCloud:selected}); tick();
  expect(tool.active).toBe(true); expect(tool.editing).toBe(false);
  expect(tool.targetCloud).toBe(selected); expect(tool.volume.visible).toBe(false);
  expect(host.querySelectorAll('[data-potree-box-clipping]')).toHaveLength(0);
  expect(viewer.scene.pointclouds.map(c=>c.material.clipTask)).toEqual([0,0,3]);
  const box=tool.volume; const matrix=box.matrixWorld.clone();
  const exported=tool.toJSON(); expect(exported.clipping.keep).toBe('outside');
  tool.start();
  expect(tool.volume).toBe(box); expect(tool.volume.matrixWorld.equals(matrix)).toBe(true);
  expect(tool.editing).toBe(true); expect(tool.volume.visible).toBe(true);
  expect(host.querySelectorAll('button')).toHaveLength(12);
  expect(()=>tool.fromJSON('{',{targetCloud:viewer.scene.pointclouds[0]})).toThrow('InvalidJson');
  expect(tool.targetCloud).toBe(selected); expect(tool.editing).toBe(true);
  tool.stop();
  tool.fromJSON(data); tick();
  expect(tool.targetCloud).toBe(viewer.scene.pointclouds[0]);
  expect(tool.editing).toBe(false); expect(tool.volume.visible).toBe(false);
  tool.stop(); expect(viewer.scene.volumes).toHaveLength(0);
  expect(host.querySelectorAll('button')).toHaveLength(0);
});
