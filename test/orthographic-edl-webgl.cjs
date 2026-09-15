// Run with PLAYWRIGHT_MODULE pointing to an existing Playwright installation.
// Arguments: candidate bundle, baseline bundle, evidence directory.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const [candidatePath, baselinePath, output] = process.argv.slice(2);
function shaders(file) {
  const text = fs.readFileSync(file, 'utf8');
  const result = {};
  for (const name of ['pointcloud.vs', 'pointcloud.fs', 'edl.fs', 'normalize_and_edl.fs']) {
    const marker = 'Shaders["' + name + '"] = `';
    const start = text.indexOf(marker) + marker.length;
    assert.ok(start >= marker.length, 'Missing shader: ' + name);
    result[name] = text.slice(start, text.indexOf('`;', start));
  }
  return result;
}
async function main() {
  const browser = await chromium.launch({executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true});
  try {
    const page = await browser.newPage({viewport: {width: 1000, height: 800}});
    await page.setContent('<body style="background:#222;color:white"><h3>Orthographic EDL GPU regression</h3></body>');
    const result = await page.evaluate(({candidate, baseline}) => {
      const canvas = document.createElement('canvas'); canvas.width = 960; canvas.height = 32;
      document.body.appendChild(canvas);
      const gl = canvas.getContext('webgl', {preserveDrawingBuffer: true});
      if (!gl) throw Error('WebGL unavailable');
      gl.getExtension('OES_texture_float'); gl.getExtension('WEBGL_color_buffer_float');
      if (!gl.getExtension('WEBGL_depth_texture')) throw Error('Depth textures unavailable');
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const renderer = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
      function program(vs, fs) {
        const p = gl.createProgram();
        for (const [type, code] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
          const s = gl.createShader(type); gl.shaderSource(s, code); gl.compileShader(s);
          if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(s));
          gl.attachShader(p, s);
        }
        gl.linkProgram(p); if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(p));
        return p;
      }
      const quadVs = 'attribute vec2 position; varying mediump vec2 vUv; void main(){vUv=position*.5+.5; gl_Position=vec4(position,0.,1.);}';
      const points = [];
      for (let y=0;y<32;y++) for (let x=0;x<960;x++) points.push((x+.5)/960*2-1,(y+.5)/32*2-1);
      const pointBuffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,pointBuffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(points),gl.STATIC_DRAW);
      const quadBuffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,quadBuffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);
      function draw(p, pointPass) {
        gl.bindBuffer(gl.ARRAY_BUFFER,pointPass?pointBuffer:quadBuffer);
        const loc=gl.getAttribLocation(p,'position');gl.enableVertexAttribArray(loc);gl.vertexAttribPointer(loc,2,gl.FLOAT,false,0,0);
        gl.drawArrays(pointPass?gl.POINTS:gl.TRIANGLE_STRIP,0,pointPass?points.length/2:4);
      }
      function texture(format,type,data) {
        const t=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,t);
        for(const k of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D,k,gl.NEAREST);
        for(const k of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T]) gl.texParameteri(gl.TEXTURE_2D,k,gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D,0,format,960,32,0,format,type,data);return t;
      }
      const color=texture(gl.RGBA,gl.FLOAT,null),depth=texture(gl.DEPTH_COMPONENT,gl.UNSIGNED_INT,null);
      const weights=new Float32Array(960*32*4);for(let i=0;i<weights.length;i+=4) weights.set([.8,.6,.4,1],i);
      const weight=texture(gl.RGBA,gl.FLOAT,weights);
      const fbo=gl.createFramebuffer();gl.bindFramebuffer(gl.FRAMEBUFFER,fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,color,0);
      gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.DEPTH_ATTACHMENT,gl.TEXTURE_2D,depth,0);
      if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE) throw Error('Incomplete float/depth target');
      const compiled={};
      for(const [version,sources] of Object.entries({candidate,baseline})) {
        const expression=sources['pointcloud.vs'].match(/vLogDepth = ([^;]+);/)[1];
        // Isolate geometry generation while executing the actual depth expression and full point fragment shader.
        const pointVs=`precision highp float; attribute vec2 position; uniform float center; uniform float span; uniform bool uUseOrthographicCamera;
        varying vec3 vColor; varying float vLogDepth; varying vec3 vViewPosition; varying float vRadius; varying float vPointSize; varying vec3 vPosition; varying float vDistance;
        void main(){float d=center+position.x*.5*span; vec4 mvPosition=vec4(position,-d,1.); vLogDepth=${expression}; vViewPosition=mvPosition.xyz;
        vColor=vec3(.8,.6,.4);vRadius=.2;vPointSize=1.;vPosition=vec3(position,0.);vDistance=abs(d);gl_PointSize=1.;gl_Position=vec4(position,d/10000.,1.);
        if(abs(position.x)>.9) gl_Position.x=2.;}`;
        for(const shape of ['circle','paraboloid']) {
          const defines='#define use_edl\n#define '+shape+'_point_shape\n';
          compiled[version+shape]=program(pointVs,defines+sources['pointcloud.fs']);
          // Compile the full shipping point shader pair as well, including shared uniform precision.
          const fullDefines=defines+'#define fixed_point_size\n#define color_type_rgb\n#define tree_type_octree\n';
          program(fullDefines+sources['pointcloud.vs'],fullDefines+sources['pointcloud.fs']);
        }
        for(const pipeline of ['standard','hq']) compiled[version+pipeline]=program(quadVs,'#define NEIGHBOUR_COUNT 8\n'+sources[pipeline==='hq'?'normalize_and_edl.fs':'edl.fs']);
      }
      const neighbours=[];for(let i=0;i<8;i++) neighbours.push(Math.cos(2*Math.PI*i/8),Math.sin(2*Math.PI*i/8));
      const cases=[];const frames={};
      for(const pipeline of ['standard','hq']) for(const shape of ['circle','paraboloid']) {
        for(const spec of [
          ['crossZero',0,40,true,1],['positive',60,40,true,1],['negative',-60,40,true,1],
          ['zero',0,0,true,1],['one',1,0,true,1],['two',2,0,true,1],['disabled',0,40,true,0],
          ['perspective',35,20,false,1],['baselinePerspective',35,20,false,1],['baselineFailure',5,20,false,1],
        ]) {
          const [name,center,span,ortho,strength]=spec;const version=name.startsWith('baseline')?'baseline':'candidate';
          const p=compiled[version+shape];gl.useProgram(p);gl.bindFramebuffer(gl.FRAMEBUFFER,fbo);
          gl.viewport(0,0,960,32);gl.enable(gl.DEPTH_TEST);gl.depthMask(true);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
          for(const [key,value] of Object.entries({center,span,uOpacity:1})) gl.uniform1f(gl.getUniformLocation(p,key),value);
          gl.uniform1i(gl.getUniformLocation(p,'uUseOrthographicCamera'),ortho?1:0);draw(p,true);
          const encoded=new Float32Array(960*4);gl.readPixels(0,16,960,1,gl.RGBA,gl.FLOAT,encoded);
          const post=compiled[version+pipeline];gl.useProgram(post);gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.disable(gl.DEPTH_TEST);
          gl.clearColor(.2,0,.2,1);gl.clear(gl.COLOR_BUFFER_BIT);
          for(const [unit,t,names] of [[0,color,['uEDLColor','uEDLMap']],[1,depth,['uEDLDepth','uDepthMap']],[2,weight,['uWeightMap']]]) {
            gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_2D,t);for(const key of names)gl.uniform1i(gl.getUniformLocation(post,key),unit);
          }
          for(const [key,value] of Object.entries({screenWidth:960,screenHeight:32,edlStrength:strength,radius:1.4,opacity:1,uOrthographicHeight:10}))gl.uniform1f(gl.getUniformLocation(post,key),value);
          gl.uniform1i(gl.getUniformLocation(post,'uUseOrthographicCamera'),ortho?1:0);
          gl.uniform2fv(gl.getUniformLocation(post,'neighbours[0]'),new Float32Array(neighbours));draw(post,false);
          const pixels=new Uint8Array(960*4);gl.readPixels(0,16,960,1,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
          const interior=Array.from({length:800},(_,i)=>pixels[(i+80)*4]);
          const key=[pipeline,shape,name].join('/');frames[key]=Array.from(pixels);
          const entry={key,min:Math.min(...interior),max:Math.max(...interior),nonFiniteDepths:Array.from({length:800},(_,i)=>encoded[(i+80)*4+3]).filter(v=>!Number.isFinite(v)).length,background:Array.from(pixels.slice(0,4)),glError:gl.getError()};cases.push(entry);
          if(shape==='circle'&&['crossZero','positive','negative','baselineFailure'].includes(name)) {
            const label=document.createElement('div');label.textContent=key;const image=document.createElement('img');image.src=canvas.toDataURL();document.body.append(label,image);
          }
        }
      }
      const comparisons=[];
      function compare(a,b){comparisons.push({a,b,maxDifference:Math.max(...frames[a].map((v,i)=>Math.abs(v-frames[b][i])))})}
      for(const pipeline of ['standard','hq']) for(const shape of ['circle','paraboloid']) {
        for(const shift of ['positive','negative'])compare(`${pipeline}/${shape}/crossZero`,`${pipeline}/${shape}/${shift}`);
        compare(`${pipeline}/${shape}/perspective`,`${pipeline}/${shape}/baselinePerspective`);
      }
      for(const name of ['crossZero','positive','negative','zero','one','two'])compare(`standard/circle/${name}`,`hq/circle/${name}`);
      canvas.remove();return {renderer,cases,comparisons};
    },{candidate:shaders(candidatePath),baseline:shaders(baselinePath)});
    fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,'gpu-results.json'),JSON.stringify(result,null,2));
    await page.screenshot({path:path.join(output,'gpu-comparison.png'),fullPage:true});
    for(const c of result.cases){
      assert.equal(c.glError,0,c.key);
      if(!c.key.endsWith('baselineFailure'))assert.equal(c.nonFiniteDepths,0,c.key);
      if(/\/(crossZero|positive|negative)$/.test(c.key)){assert.ok(c.min>0&&c.max<190,c.key+': EDL must remain visible without black clipping');assert.ok(c.max-c.min<=1,c.key+': planar depth gradient must shade uniformly');}
      if(/\/(zero|one|two|disabled)$/.test(c.key))assert.equal(c.min,204,c.key+': valid signed depths must retain color');
      if(!c.key.includes('baseline'))assert.deepEqual(c.background,[51,0,51,255],c.key+': background coverage');
    }
    for(const c of result.comparisons)assert.ok(c.maxDifference<=1,JSON.stringify(c));
    console.log(JSON.stringify({renderer:result.renderer,cases:result.cases.length,comparisons:result.comparisons,passed:true},null,2));
  } finally {await browser.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1});
