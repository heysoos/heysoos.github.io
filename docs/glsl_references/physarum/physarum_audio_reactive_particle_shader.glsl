uniform float dt;
uniform vec2 bounds;

// boid stuff
uniform vec2 B_rads; // boid radius
uniform float G; // attraction  
uniform float C; // repulsion
uniform float A; // alignment

uniform float F; // friction 
uniform vec2 S; // strong force [amp. coef, exp. coef]
uniform float rand;

layout (local_size_x = 8, local_size_y = 8) in;
int resX = int(uTD2DInfos[0].res.b);
int resY = int(uTD2DInfos[0].res.a);

float x_lim = bounds[0];
float y_lim = bounds[1];

float v_max = 0.22;
float dv_max = 6;

vec4 move(vec4 pos, vec4 vel) {	
	pos.xy += vel.xy * dt;
	return pos;
}

vec2 calc_particle_forces(vec2 pos,vec2 vel) {
	vec2 gs = vec2(0., 0.);
	vec2 p_g;

	
	for (int x = 0; x < resX; x++) {
		for (int y = 0; y < resY; y++) {
		
			if (x != gl_GlobalInvocationID.x || y != gl_GlobalInvocationID.y) { 
				vec4 pos_j = texelFetch(sTD2DInputs[0], ivec2(x, y), 0);
				vec4 vel_j = texelFetch(sTD2DInputs[1], ivec2(x, y), 0);
				
				vec2 p_g = vec2(0., 0.); // net particle-particle forces
				
				// periodic boundaries for distance calc
				vec2 diff = pos_j.xy - pos;
				if (abs(diff.x) > x_lim / 2) {
					diff.x = -1 * sign(diff.x) * (x_lim - abs(diff.x));
				}
				if (abs(diff.y) > y_lim / 2) {
					diff.y = -1 * sign(diff.y) * (y_lim - abs(diff.y));
				}
				float r = length(diff); // this is broken for some reason?
				// float r = distance(pos_j.xy, pos);
				
				// vec2 diff_dir = diff / sqrt(diff.x*diff.x + diff.y * diff.y);
				// vec2 vel_dir = vel / sqrt(vel.x*vel.x + vel.y*vel.y);
				vec2 diff_dir = normalize(diff);
				vec2 vel_dir = normalize(vel);

				// how aligned is the particle's velocity with the attracting object's position?
				// if greater than 0 it's in front, if less than 0 it's behind the cone of vision.

				float pointing = vel_dir.x * diff_dir.x + vel_dir.y * diff_dir.y;
				if (r < B_rads[0] && pointing > -1 ) {
					
					// color diff
					// float c_diff = (c_j.x * c_j.x - color.x * color.x) + 
					// (c_j.y * c_j.y - color.y * color.y) + 
					// (c_j.z * c_j.z - color.z * color.z);

					p_g += G * normalize(diff) / (r*r + 0.001); // attraction
					p_g += A * (vel_j.xy - vel); // alignment
					// p_g *= (1 + c_diff);
					
					// strong force thingy
					gs += clamp(S[0] * normalize(diff) / (r*r + 0.001) + S[1], -dv_max, dv_max);
					// (or weak force)
					// gs += clamp(S[0] * normalize(diff) / (r*r + 0.001) * exp(-S[1]*r), -5., 5.);
					
				}

				// boid stuff
				if (r < B_rads[1]) {
					p_g += C * normalize(diff) / (r*r); // close-range repulsion
				}
				
				gs += p_g; // net forces from all particles
			}
		}
	}
	
	return gs;
}



vec2 calc_gravity(vec2 pos){
	vec2 g;
	float r2 = length(pos);
	
	// if (r2 > 0.5) {
	// 	g *= 0.;
	// }
	// else if (r2 < 1.) {
		// g  = -G * normalize(pos.xy) * sqrt(r2);  // sphere of uniform density 
	// }
	// if (r2 > 0.4 && r2 < 0.5){ // ring of gravity
	// 	g = -0.1 * normalize(pos.xy) / r2; 
	// }

	g = -0.05 * normalize(pos.xy) / r2;
	
	return g;
}

vec2 norm_clip(vec2 vec, float maxnorm) {
	float norm;
	
	float norm2 = vec.x * vec.x + vec.y * vec.y;
	if (norm2 > maxnorm * maxnorm) {
		vec = maxnorm * vec / sqrt(norm2);
	}	
	return vec;
}

vec4 forces(vec4 pos, vec4 vel) {
	vec2 gravity;
	vec2 friction;
	vec2 dv;
	
	// gravity = -G * pos.xy; 
	// gravity = -G * normalize(pos.xy) / (pos.x * pos.x + pos.y * pos.y); 
	// gravity = calc_gravity(pos.xy);
	friction = -F * sign(vel.xy) * vel.xy * vel.xy;

	dv = friction + calc_particle_forces(pos.xy, vel.xy); // + gravity
	// dv *= 0;	
	// vel.xy += norm_clip(dt * dv, dv_max);
	vel.xy += dt * dv;
	vel.xy = norm_clip(vel.xy, v_max);
	
	return vel;
}


vec4 edge(vec4 pos) {
	
	if (pos.x < -x_lim * 0.5) {
		pos.x = pos.x + x_lim;
	}
	if (pos.x > x_lim * 0.5) {
		pos.x = pos.x - x_lim;
	}
	if (pos.y < -y_lim * 0.5) {
		pos.y = pos.y + y_lim;
	}
	if (pos.y > y_lim * 0.5) {
		pos.y = pos.y - y_lim;
	}
	return pos;
}


void main()
{
	vec4 pos = texelFetch(sTD2DInputs[0], ivec2(gl_GlobalInvocationID.xy), 0);
	vec4 vel = texelFetch(sTD2DInputs[1], ivec2(gl_GlobalInvocationID.xy), 0);
	vec4 rand_vel = rand * texelFetch(sTD2DInputs[2], ivec2(gl_GlobalInvocationID.xy), 0);
	// vec4 color = texelFetch(sTD2DInputs[3], ivec2(gl_GlobalInvocationID.xy), 0);
	
	vel = forces(pos, vel) + rand_vel;
	pos = move(pos, vel);
	pos = edge(pos);
	
	imageStore(mTDComputeOutputs[0], ivec2(gl_GlobalInvocationID.xy), TDOutputSwizzle(pos));
	imageStore(mTDComputeOutputs[1], ivec2(gl_GlobalInvocationID.xy), TDOutputSwizzle(vel));
}
