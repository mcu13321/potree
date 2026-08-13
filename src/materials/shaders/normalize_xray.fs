precision mediump float;
precision mediump int;

uniform sampler2D uDepthMap;
uniform sampler2D uAccumulationMap;
uniform sampler2D uFrontColorMap;
uniform float uDensityScale;
uniform float uMaxOpacity;
uniform float uFrontDetailStrength;
uniform float uColorGamma;

varying vec2 vUv;

void main() {
	float depth = texture2D(uDepthMap, vUv).r;
	if(depth >= 1.0){
		discard;
	}

	vec4 accumulation = texture2D(uAccumulationMap, vUv);
	if(accumulation.a <= 0.00001){
		discard;
	}

	// RGB stores premultiplied contribution while alpha stores accumulated density.
	vec3 averageColor = accumulation.rgb / accumulation.a;
	vec4 frontSample = texture2D(uFrontColorMap, vUv);
	vec3 frontColor = frontSample.rgb / max(frontSample.a, 0.00001);
	float density = max(accumulation.a, 0.0);
	float resolvedAlpha = clamp(uMaxOpacity, 0.0, 1.0)
		* (1.0 - exp(-max(uDensityScale, 0.0) * density));

	// Front detail is strongest at the splat center and vanishes at its circular edge.
	float frontStrength = clamp(uFrontDetailStrength, 0.0, 1.0)
		* clamp(frontSample.a, 0.0, 1.0);
	vec3 resolvedColor = mix(averageColor, frontColor, frontStrength);

	// Lift dark and mid-tone colors without pushing normalized highlights above white.
	resolvedColor = pow(
		clamp(resolvedColor, 0.0, 1.0),
		vec3(clamp(uColorGamma, 0.1, 1.0))
	);

	gl_FragColor = vec4(resolvedColor, resolvedAlpha);
}
