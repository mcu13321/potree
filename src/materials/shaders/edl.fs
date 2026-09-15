
// 移动端浏览器不支持GL_EXT_frag_depth扩展
// #extension GL_EXT_frag_depth : enable

// 
// adapted from the EDL shader code from Christian Boucheny in cloud compare:
// https://github.com/cloudcompare/trunk/tree/master/plugins/qEDL/shaders/EDL
//

precision highp float;
precision mediump int;

uniform float screenWidth;
uniform float screenHeight;
uniform vec2 neighbours[NEIGHBOUR_COUNT];
uniform float edlStrength;
uniform float radius;
uniform float opacity;
// Normalize signed depth differences by the visible orthographic world-space height.
uniform bool uUseOrthographicCamera;
uniform float uOrthographicHeight;

uniform float uNear;
uniform float uFar;

uniform mat4 uProj;

uniform sampler2D uEDLColor;
uniform sampler2D uEDLDepth;

varying mediump vec2 vUv;

float response(float depth){
	vec2 uvRadius = radius / vec2(screenWidth, screenHeight);
	
	float sum = 0.0;
	
	for(int i = 0; i < NEIGHBOUR_COUNT; i++){
		vec2 uvNeighbor = vUv + uvRadius * neighbours[i];
		
		float neighbourDepth = texture2D(uEDLColor, uvNeighbor).a;
		if(uUseOrthographicCamera){
			// Depth-buffer coverage is independent of valid signed EDL values, including zero.
			if(texture2D(uEDLDepth, uvNeighbor).r < 1.0){
				sum += max(0.0, (depth - neighbourDepth) / uOrthographicHeight);
			}
			continue;
		}
		neighbourDepth = (neighbourDepth == 1.0) ? 0.0 : neighbourDepth;

		if(neighbourDepth != 0.0){
			if(depth == 0.0){
				sum += 100.0;
			}else{
				sum += max(0.0, depth - neighbourDepth);
			}
		}
	}
	
	return sum / float(NEIGHBOUR_COUNT);
}

void main(){
	vec4 cEDL = texture2D(uEDLColor, vUv);
	
	float depth = cEDL.a;
	// Preserve the legacy perspective sentinel while using actual coverage for orthographic views.
	if(uUseOrthographicCamera){
		if(texture2D(uEDLDepth, vUv).r >= 1.0){
			discard;
		}
	}else{
		depth = (depth == 1.0) ? 0.0 : depth;
	}
	float res = response(depth);
	float shade = exp(-res * 300.0 * edlStrength);

	gl_FragColor = vec4(cEDL.rgb * shade, opacity);

	{ // write regular hyperbolic depth values to depth buffer
		// Decode the projection-specific EDL payload before projecting depth.
		float dl = uUseOrthographicCamera ? depth : pow(2.0, depth);

		vec4 dp = uProj * vec4(0.0, 0.0, -dl, 1.0);
		float pz = dp.z / dp.w;
		float fragDepth = (pz + 1.0) / 2.0;
		// 移动端浏览器不支持gl_FragDepthEXT扩展
		// gl_FragDepthEXT = fragDepth;
	}

	if(!uUseOrthographicCamera && depth == 0.0){
		discard;
	}

}
