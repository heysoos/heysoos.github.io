// modified from SmoothLife by davidar - https://www.shadertoy.com/view/Msy3RD

// bell-shaped curve (Gaussian bump)

// maximum 16 kernels by using 4x4 matrix
// when matrix operation not available (e.g. exp, mod, equal, /), split into four vec4 operations

#define EPSILON 0.000001
#define mult matrixCompMult

uniform mat4 Zin;

uniform vec3 iResolution;
uniform float iGlobalTime;
uniform int iFrame; 
uniform vec4 Keyin;

// music stuff
uniform vec4 uIn0;
uniform vec4 uIn1;
uniform vec4 uIn2;

const vec4 iBeta2 = vec4(0.);  // not used in this version

// species imports
uniform float R;
uniform float T;
uniform mat4 betaLen;
uniform mat4 beta0;
uniform mat4 beta1;
uniform mat4 beta2;
uniform mat4 mu;
uniform mat4 sigma;
uniform mat4 eta;
uniform mat4 relR;
uniform mat4 src;
uniform mat4 dst;

// ################################################################
// choose a species (0 to 9)
// #define species10
// ################################################################



// change to other numbers (with nearest or linear filter in Buffer A) for funny effects :)
const float samplingDist = 1.;
// 1:normal, int>1:heavy phantom, 
// 0.1-0.2:dots, 0.3-0.9:smooth zoom out, 1.1-1.8,2.2-2.8:smooth zoom in, 
// 1.9,2.1,2.9,3.1,3.9(near int):partial phantom, >=3.2:minor glitch, increase as larger
// linear filter: smoother, nearest filter: more glitch/phantom


mat4 addNoiseToParam(mat4 param, float noiseFactor) {
    return mat4(
        param[0][0] + noiseFactor, param[0][1] + noiseFactor, param[0][2] + noiseFactor, param[0][3] + noiseFactor,
        param[1][0] + noiseFactor, param[1][1] + noiseFactor, param[1][2] + noiseFactor, param[1][3] + noiseFactor,
        param[2][0] + noiseFactor, param[2][1] + noiseFactor, param[2][2] + noiseFactor, param[2][3] + noiseFactor,
        param[3][0] + noiseFactor, param[3][1] + noiseFactor, param[3][2] + noiseFactor, param[3][3] + noiseFactor
    );
}

mat4 mulNoiseToParam(mat4 param, float noiseFactor) {
    return mat4(
        param[0][0] * noiseFactor, param[0][1] * noiseFactor, param[0][2] * noiseFactor, param[0][3] * noiseFactor,
        param[1][0] * noiseFactor, param[1][1] * noiseFactor, param[1][2] * noiseFactor, param[1][3] * noiseFactor,
        param[2][0] * noiseFactor, param[2][1] * noiseFactor, param[2][2] * noiseFactor, param[2][3] * noiseFactor,
        param[3][0] * noiseFactor, param[3][1] * noiseFactor, param[3][2] * noiseFactor, param[3][3] * noiseFactor
    );
}



layout(location = 0) out vec4 fragColor;
const ivec4 iv0 = ivec4(0);
const ivec4 iv1 = ivec4(1);
const ivec4 iv2 = ivec4(2);
const ivec4 iv3 = ivec4(3);
const vec4 v0 = vec4(0.);
const vec4 v1 = vec4(1.);
const mat4 m0 = mat4(v0, v0, v0, v0);
const mat4 m1 = mat4(v1, v1, v1, v1);


#ifdef species0
// species: VT049W Tessellatium (highly reproductive)
const float baseNoise = 0.145;
const float R = 12.;  // space resolution = kernel radius
const float T = 2.;  // time resolution = number of divisions per unit time
const mat4    betaLen = mat4( 1., 1., 2., 2., 1., 2., 1., 1., 1., 2., 2., 2., 1., 2., 1., v0 );  // kernel ring number
const mat4      beta0 = mat4( 1., 1., 1., 0., 1., 5./6., 1., 1., 1., 11./12., 3./4., 11./12., 1., 1./6., 1., v0 );  // kernel ring heights
const mat4      beta1 = mat4( 0., 0., 1./4., 1., 0., 1., 0., 0., 0., 1., 1., 1., 0., 1., 0., v0 );
const mat4      beta2 = mat4( v0, v0, v0, v0 );
const mat4         mu = mat4( 0.272, 0.349, 0.2, 0.114, 0.447, 0.247, 0.21, 0.462, 0.446, 0.327, 0.476, 0.379, 0.262, 0.412, 0.201, v0 );  // growth center
const mat4      sigma = mat4( 0.0595, 0.1585, 0.0332, 0.0528, 0.0777, 0.0342, 0.0617, 0.1192, 0.1793, 0.1408, 0.0995, 0.0697, 0.0877, 0.1101, 0.0786, v1 );  // growth width
const mat4        eta = mat4( 0.19, 0.66, 0.39, 0.38, 0.74, 0.92, 0.59, 0.37, 0.94, 0.51, 0.77, 0.92, 0.71, 0.59, 0.41, v0 );  // growth strength
const mat4       relR = mat4( 0.91, 0.62, 0.5, 0.97, 0.72, 0.8, 0.96, 0.56, 0.78, 0.79, 0.5, 0.72, 0.68, 0.55, 0.82, v1 );  // relative kernel radius
const mat4        src = mat4( 0., 0., 0., 1., 1., 1., 2., 2., 2., 0., 0., 1., 1., 2., 2., v0 );  // source channels
const mat4        dst = mat4( 0., 0., 0., 1., 1., 1., 2., 2., 2., 1., 2., 0., 2., 0., 1., v0 );  // destination channels
#endif



#ifdef species1
// species: Z18A9R Tessellatium (moderately reproductive)
const float baseNoise = 0.145;
const float R = 12.;  // space resolution = kernel radius
const float T = 2.;  // time resolution = number of divisions per unit time
const mat4    betaLen = mat4( 1., 1., 2., 2., 1., 2., 1., 1., 1., 2., 2., 2., 1., 2., 1., v0 );  // kernel ring number
const mat4      beta0 = mat4( 1., 1., 1., 0., 1., 3./4., 1., 1., 1., 11./12., 3./4., 1., 1., 1./4., 1., v0 );  // kernel ring heights
const mat4      beta1 = mat4( 0., 0., 1./4., 1., 0., 1., 0., 0., 0., 1., 1., 11./12., 0., 1., 0., v0 );
const mat4      beta2 = mat4( v0, v0, v0, v0 );
const mat4         mu = mat4( 0.175, 0.382, 0.231, 0.123, 0.398, 0.224, 0.193, 0.512, 0.427, 0.286, 0.508, 0.372, 0.196, 0.371, 0.246, v0 );  // growth center
const mat4      sigma = mat4( 0.0682, 0.1568, 0.034, 0.0484, 0.0816, 0.0376, 0.063, 0.1189, 0.1827, 0.1422, 0.1079, 0.0724, 0.0934, 0.1107, 0.0712, v1 );  // growth width
const mat4        eta = mat4( 0.138, 0.544, 0.326, 0.256, 0.544, 0.544, 0.442, 0.198, 0.58, 0.282, 0.396, 0.618, 0.382, 0.374, 0.376, v0 );  // growth strength
const mat4       relR = mat4( 0.78, 0.56, 0.6, 0.84, 0.76, 0.82, 1.0, 0.68, 0.99, 0.72, 0.56, 0.65, 0.85, 0.54, 0.82, v1 );  // relative kernel radius
const mat4        src = mat4( 0., 0., 0., 1., 1., 1., 2., 2., 2., 0., 0., 1., 1., 2., 2., v0 );  // source channels
const mat4        dst = mat4( 0., 0., 0., 1., 1., 1., 2., 2., 2., 1., 2., 0., 2., 0., 1., v0 );  // destination channels
#endif

#ifdef species2
// species: G6G6CR Ciliatium
const float baseNoise = 0.175;
const float R = 12.;  // space resolution = kernel radius
const float T = 2.;  // time resolution = number of divisions per unit time
const mat4    betaLen = mat4( 1., 1., 1., 2., 1., 2., 1., 1., 1., 1., 1., 2., 1., 1., 2., v0 );  // kernel ring number
mat4      beta0 = mat4( 1., 1., 1., 1./12., 1., 5./6., 1., 1., 1., 1., 1., 1., 1., 1., 1., v0 );  // kernel ring heights
const mat4      beta1 = mat4( 0., 0., 0., 1., 0., 1., 0., 0., 0., 0., 0., 11./12., 1., 0., 0., v0 );
const mat4      beta2 = mat4( v0, v0, v0, v0 );
const mat4         mu = mat4( 0.118, 0.174, 0.244, 0.114, 0.374, 0.222, 0.306, 0.449, 0.498, 0.295, 0.43, 0.353, 0.238, 0.39, 0.1, v0 );  // growth center
//const mat4      sigma = mat4( 0.0639, 0.159, 0.0287, 0.0469, 0.0822, 0.0294, 0.0775, 0.124, 0.1836, 0.1373, 0.0999, 0.0754, 0.0995, 0.1144, 0.0601, v1 );  // growth width
const mat4      sigma = mat4( 0.0639, 0.159, 0.0287, 0.0469, 0.0822, 0.0294, 0.0775, 0.124, 0.1836, 0.1373, 0.0999, 0.0954, 0.0995, 0.1094, 0.0601, v1 );  // growth width
const mat4        eta = mat4( 0.082, 0.462, 0.496, 0.27, 0.518, 0.576, 0.324, 0.306, 0.544, 0.374, 0.33, 0.528, 0.498, 0.43, 0.26, v0 );  // growth strength
const mat4       relR = mat4( 0.85, 0.61, 0.5, 0.81, 0.85, 0.93, 0.88, 0.74, 0.97, 0.92, 0.56, 0.56, 0.95, 0.59, 0.58, v1 );  // relative kernel radius
const mat4        src = mat4( 0., 0., 0., 1., 1., 1., 2., 2., 2., 0., 0., 1., 1., 2., 2., v0 );  // source channels
const mat4        dst = mat4( 0., 0., 0., 1., 1., 1., 2., 2., 2., 1., 2., 0., 2., 0., 1., v0 );  // destination channels
#endif

#ifdef species3
// species: tri-color ghosts
const float baseNoise = 0.185;
const float R = 10.;  // space resolution = kernel radius
const float T = 10.;  // time resolution = number of divisions per unit time
const mat4    betaLen = mat4( 2., 3., 1., 2., 3., 1., 2., 3., 1., v0, v0 );  // kernel ring number
const mat4      beta0 = mat4( 1./4., 1., 1., 1./4., 1., 1., 1./4., 1., 1., v0, v0 );  // kernel ring heights
const mat4      beta1 = mat4( 1., 3./4., 0., 1., 3./4., 0., 1., 3./4., 0., v0, v0 );
const mat4      beta2 = mat4( 0., 3./4., 0., 0., 3./4., 0., 0., 3./4., 0., v0, v0 );
const mat4         mu = mat4( 0.16, 0.22, 0.28, 0.16, 0.22, 0.28, 0.16, 0.22, 0.28, v0, v0 );  // growth center
const mat4      sigma = mat4( 0.025, 0.042, 0.025, 0.025, 0.042, 0.025, 0.025, 0.042, 0.025, v1, v1 );  // growth width
const mat4        eta = mat4( 0.666, 0.666, 0.666, 0.666, 0.666, 0.666, 0.666, 0.666, 0.666, v0, v0 );  // growth strength
const mat4       relR = mat4( 1., 1., 1., 1., 1., 1., 1., 1., 1., v0, v0 );  // relative kernel radius
const mat4        src = mat4( 0., 0., 0., 1., 1., 1., 2., 2., 2., v0, v0 );  // source channels
const mat4        dst = mat4( 0., 0., 0., 1., 1., 1., 2., 2., 2., v0, v0 );  // destination channels
#endif

// more choices

#ifdef species4
// species: KH97WU Tessellatium (slightly reproductive)
const float baseNoise = 0.175;
const float R = 12.;  // space resolution = kernel radius
const float T = 2.;  // time resolution = number of divisions per unit time
const mat4    betaLen = mat4( 1., 1., 2., 2., 1., 2., 1., 1., 1., 2., 2., 1., 1., 2., 1., v0 );  // kernel ring number
const mat4      beta0 = mat4( 1., 1., 1., 0., 1., 5./6., 1., 1., 1., 11./12., 3./4., 1., 1., 1./6., 1., v0 );  // kernel ring heights
const mat4      beta1 = mat4( 0., 0., 1./4., 1., 0., 1., 0., 0., 0., 1., 1., 0., 0., 1., 0., v0 );
const mat4      beta2 = mat4( 0., 0., 0., 0., 0., 0., 0., 0., 0., 0., 0., 0., 0., 0., 0., v0 );
const mat4         mu = mat4( 0.204, 0.359, 0.176, 0.128, 0.386, 0.229, 0.181, 0.466, 0.466, 0.37, 0.447, 0.391, 0.299, 0.398, 0.183, v0 );  // growth center
const mat4      sigma = mat4( 0.0574, 0.152, 0.0314, 0.0545, 0.0825, 0.0348, 0.0657, 0.1224, 0.1789, 0.1372, 0.1064, 0.0644, 0.0891, 0.1065, 0.0773, v1 );  // growth width
const mat4        eta = mat4( 0.116, 0.448, 0.332, 0.392, 0.398, 0.614, 0.448, 0.224, 0.624, 0.352, 0.342, 0.634, 0.362, 0.472, 0.242, v0 );  // growth strength
const mat4       relR = mat4( 0.93, 0.59, 0.58, 0.97, 0.79, 0.87, 1.0, 0.64, 0.67, 0.68, 0.5, 0.85, 0.69, 0.87, 0.66, v1 );  // relative kernel radius
const mat4        src = mat4( 0., 0., 0., 1., 1., 1., 2., 2., 2., 0., 0., 1., 1., 2., 2., v0 );  // source channels
const mat4        dst = mat4( 0., 0., 0., 1., 1., 1., 2., 2., 2., 1., 2., 0., 2., 0., 1., v0 );  // destination channels
#endif

#ifdef species5
// species: XEH4YR Tessellatium (explosive)
const float baseNoise = 0.155;
const float R = 12.;  // space resolution = kernel radius
const float T = 2.;  // time resolution = number of divisions per unit time
const mat4    betaLen = mat4( 1., 1., 2., 2., 1., 2., 1., 1., 1., 2., 2., 2., 1., 3., 1., v0 );  // kernel ring number
const mat4      beta0 = mat4( 1., 1., 1., 0., 1., 5./6., 1., 1., 1., 11./12., 3./4., 11./12., 1., 1./6., 1., v0 );  // kernel ring heights
const mat4      beta1 = mat4( 0., 0., 1./4., 1., 0., 1., 0., 0., 0., 1., 1., 1., 0., 1., 0., v0 );
const mat4      beta2 = mat4( 0., 0., 0., 0., 0., 0., 0., 0., 0., 0., 0., 0., 0., 0., 0., v0 );
const mat4         mu = mat4( 0.282, 0.354, 0.197, 0.164, 0.406, 0.251, 0.259, 0.517, 0.455, 0.264, 0.472, 0.417, 0.208, 0.395, 0.184, v0 );  // growth center
const mat4      sigma = mat4( 0.0646, 0.1584, 0.0359, 0.056, 0.0738, 0.0383, 0.0665, 0.1164, 0.1806, 0.1437, 0.0939, 0.0666, 0.0815, 0.1049, 0.0748, v1 );  // growth width
const mat4        eta = mat4( 0.082, 0.544, 0.26, 0.294, 0.508, 0.56, 0.326, 0.21, 0.638, 0.346, 0.384, 0.748, 0.44, 0.366, 0.294, v0 );  // growth strength
const mat4       relR = mat4( 0.85, 0.62, 0.69, 0.84, 0.82, 0.86, 1.0, 0.5, 0.78, 0.6, 0.5, 0.7, 0.67, 0.6, 0.8, v1 );  // relative kernel radius
const mat4        src = mat4( 0., 0., 0., 1., 1., 1., 2., 2., 2., 0., 0., 1., 1., 2., 2., v0 );  // source channels
const mat4        dst = mat4( 0., 0., 0., 1., 1., 1., 2., 2., 2., 1., 2., 0., 2., 0., 1., v0 );  // destination channels
#endif

#ifdef species6
// species: HAESRE Tessellatium (zigzaging)
const float baseNoise = 0.185;
const float R = 12.;  // space resolution = kernel radius
const float T = 2.;  // time resolution = number of divisions per unit time
const mat4    betaLen = mat4( 1., 1., 2., 2., 1., 2., 1., 1., 1., 2., 2., 2., 1., 2., 1., v0 );  // kernel ring number
const mat4      beta0 = mat4( 1., 1., 1., 0., 1., 3./4., 1., 1., 1., 11./12., 5./6., 1., 1., 1./4., 1., v0 );  // kernel ring heights
const mat4      beta1 = mat4( 0., 0., 1./4., 1., 0., 1., 0., 0., 0., 1., 1., 11./12., 0., 1., 0., v0 );
const mat4      beta2 = mat4( 0., 0., 0., 0., 0., 0., 0., 0., 0., 0., 0., 0., 0., 0., 0., v0 );
const mat4         mu = mat4( 0.272, 0.337, 0.129, 0.132, 0.429, 0.239, 0.25, 0.497, 0.486, 0.276, 0.425, 0.352, 0.21, 0.381, 0.244, v0 );  // growth center
const mat4      sigma = mat4( 0.0674, 0.1576, 0.0382, 0.0514, 0.0813, 0.0409, 0.0691, 0.1166, 0.1751, 0.1344, 0.1026, 0.0797, 0.0921, 0.1056, 0.0813, v1 );  // growth width
const mat4        eta = mat4( 0.15, 0.474, 0.342, 0.192, 0.524, 0.598, 0.426, 0.348, 0.62, 0.338, 0.314, 0.608, 0.292, 0.426, 0.346, v0 );  // growth strength
const mat4       relR = mat4( 0.87, 0.65, 0.67, 0.98, 0.77, 0.83, 1.0, 0.7, 0.99, 0.69, 0.7, 0.57, 0.89, 0.84, 0.76, v1 );  // relative kernel radius
const mat4        src = mat4( 0., 0., 0., 1., 1., 1., 2., 2., 2., 0., 0., 1., 1., 2., 2., v0 );  // source channels
const mat4        dst = mat4( 0., 0., 0., 0., 1., 1., 2., 2., 2., 0., 0., 1., 1., 2., 2., v0 );  // destination channels
#endif

#ifdef species7
// species: GDNQYX Tessellatium (stable)
const float baseNoise = 0.175;
const float R = 12.;  // space resolution = kernel radius
const float T = 2.;  // time resolution = number of divisions per unit time
const mat4    betaLen = mat4( 1., 1., 2., 2., 1., 2., 1., 1., 1., 2., 2., 2., 1., 2., 1., v0 );  // kernel ring number
const mat4      beta0 = mat4( 1., 1., 1., 0., 1., 5./6., 1., 1., 1., 11./12., 3./4., 1., 1., 1./6., 1., v0 );  // kernel ring heights
const mat4      beta1 = mat4( 0., 0., 1./4., 1., 0., 1., 0., 0., 0., 1., 1., 11./12., 0., 1., 0., v0 );
const mat4      beta2 = mat4( 0., 0., 0., 0., 0., 0., 0., 0., 0., 0., 0., 0., 0., 0., 0., v0 );
const mat4         mu = mat4( 0.242, 0.375, 0.194, 0.122, 0.413, 0.221, 0.192, 0.492, 0.426, 0.361, 0.464, 0.361, 0.235, 0.381, 0.216, v0 );  // growth center
const mat4      sigma = mat4( 0.061, 0.1553, 0.0361, 0.0531, 0.0774, 0.0365, 0.0649, 0.1219, 0.1759, 0.1381, 0.1044, 0.0686, 0.0924, 0.1118, 0.0748, v1 );  // growth width
const mat4        eta = mat4( 0.144, 0.506, 0.332, 0.3, 0.502, 0.58, 0.344, 0.268, 0.582, 0.326, 0.418, 0.642, 0.39, 0.378, 0.294, v0 );  // growth strength
const mat4       relR = mat4( 0.98, 0.59, 0.5, 0.93, 0.73, 0.88, 0.93, 0.61, 0.84, 0.7, 0.57, 0.73, 0.74, 0.87, 0.72, v1 );  // relative kernel radius
const mat4        src = mat4( 0., 0., 0., 1., 1., 1., 2., 2., 2., 0., 0., 1., 1., 2., 2., v0 );  // source channels
const mat4        dst = mat4( 0., 0., 0., 1., 1., 1., 2., 2., 2., 1., 2., 0., 2., 0., 1., v0 );  // destination channels
#endif

#ifdef species8
// species: 5N7KKM Tessellatium (stable)
const float baseNoise = 0.175;
const float R = 8.;  // space resolution = kernel radius
const float T = 2.;  // time resolution = number of divisions per unit time
const mat4    betaLen = mat4( 1., 1., 2., 2., 1., 2., 1., 1., 1., 2., 2., 2., 1., 2., 1., v0 );  // kernel ring number
const mat4      beta0 = mat4( 1., 1., 1., 0., 1., 3./4., 1., 1., 1., 11./12., 3./4., 1., 1., 1./6., 1., v0 );  // kernel ring heights
const mat4      beta1 = mat4( 0., 0., 1./4., 1., 0., 1., 0., 0., 0., 1., 1., 11./12., 0., 1., 0., v0 );
const mat4      beta2 = mat4( 0., 0., 0., 0., 0., 0., 0., 0., 0., 0., 0., 0., 0., 0., 0., v0 );
const mat4         mu = mat4( 0.22, 0.351, 0.177, 0.126, 0.437, 0.234, 0.179, 0.489, 0.419, 0.341, 0.469, 0.369, 0.219, 0.385, 0.208, v0 );  // growth center
const mat4      sigma = mat4( 0.0628, 0.1539, 0.0333, 0.0525, 0.0797, 0.0369, 0.0653, 0.1213, 0.1775, 0.1388, 0.1054, 0.0721, 0.0898, 0.1102, 0.0749, v1 );  // growth width
const mat4        eta = mat4( 0.174, 0.46, 0.31, 0.242, 0.508, 0.566, 0.406, 0.27, 0.588, 0.294, 0.388, 0.62, 0.348, 0.436, 0.39, v0 );  // growth strength
const mat4       relR = mat4( 0.57, 0.52, 0.58, 0.89, 0.78, 0.79, 1.0, 0.64, 0.96, 0.66, 0.69, 0.61, 0.81, 0.81, 0.71, v1 );  // relative kernel radius
const mat4        src = mat4( 0., 0., 0., 1., 1., 1., 2., 2., 2., 0., 0., 1., 1., 2., 2., v0 );  // source channels
const mat4        dst = mat4( 0., 0., 0., 1., 1., 1., 2., 2., 2., 1., 2., 0., 2., 0., 1., v0 );  // destination channels
#endif

#ifdef species9
// species: Y3CS55 fast emitter
const float baseNoise = 0.165;
const float R = 12.;  // space resolution = kernel radius
const float T = 2.;  // time resolution = number of divisions per unit time
const mat4    betaLen = mat4( 1., 1., 1., 2., 1., 2., 1., 1., 1., 1., 1., 3., 1., 1., 2., v0 );  // kernel ring number
const mat4      beta0 = mat4( 1., 1., 1., 1./12., 1., 5./6., 1., 1., 1., 1., 1., 1., 1., 1., 1., v0 );  // kernel ring heights
const mat4      beta1 = mat4( 0., 0., 0., 1., 0., 1., 0., 0., 0., 0., 0., 11./12., 0., 0., 1./12., v0 );
const mat4      beta2 = mat4( 0., 0., 0., 0., 0., 0., 0., 0., 0., 0., 0., 0., 0., 0., 0., v0 );
const mat4         mu = mat4( 0.168, 0.1, 0.265, 0.111, 0.327, 0.223, 0.293, 0.465, 0.606, 0.404, 0.377, 0.297, 0.319, 0.483, 0.1, v0 );  // growth center
const mat4      sigma = mat4( 0.062, 0.1495, 0.0488, 0.0555, 0.0763, 0.0333, 0.0724, 0.1345, 0.1807, 0.1413, 0.1136, 0.0701, 0.1038, 0.1185, 0.0571, v1 );  // growth width
const mat4        eta = mat4( 0.076, 0.562, 0.548, 0.306, 0.568, 0.598, 0.396, 0.298, 0.59, 0.396, 0.156, 0.426, 0.558, 0.388, 0.132, v0 );  // growth strength
const mat4       relR = mat4( 0.58, 0.68, 0.5, 0.87, 1.0, 1.0, 0.88, 0.88, 0.86, 0.98, 0.63, 0.53, 1.0, 0.89, 0.59, v1 );  // relative kernel radius
const mat4        src = mat4( 0., 0., 0., 1., 1., 1., 2., 2., 2., 0., 0., 1., 1., 2., 2., v0 );  // source channels
const mat4        dst = mat4( 0., 0., 0., 1., 1., 1., 2., 2., 2., 1., 2., 0., 2., 0., 1., v0 );  // destination channels
#endif


#ifdef species10
// species: VT049W Tessellatium (highly reproductive)
const float baseNoise = 0.25;
const float R = 8.;         // space resolution = kernel radius
const float T = 10.;         // time resolution = number of divisions per unit time
const mat4 betaLen = mat4( 2., 3., 1., v0, v0, v0, v0 );    // kernel ring number
const mat4 beta0 = mat4( 1./4., 1., 1., v0, v0, v0, v0 );    // kernel ring heights
const mat4 beta1 = mat4( 1., 3./4., 0., v0, v0, v0, v0 );
const mat4 beta2 = mat4( 0., 3./4., 0., v0, v0, v0, v0 );
const mat4 mu = mat4( 0.16, 0.22, 0.28, v0, v0, v0, v0 );    // growth center
const mat4 sigma = mat4( 0.025, 0.042, 0.025, v1, v1, v1, v1 );    // growth width
const mat4 eta = mat4( 2., 2., 2., 1.,1., v0, v0, v0 );     
const mat4       relR = mat4( 1., 1., 1., 1., 0.72, 0.8, 0.96, 0.56, 0.78, 0.79, 0.5, 0.72, 0.68, 0.55, 0.82, v1 );  // relative kernel radius
const mat4        src = mat4( 0., 0., 0., 1., 2., 1., 2., 2., 2., 0., 0., 1., 1., 2., 2., v0 );  // source channels
const mat4        dst = mat4( 0., 1., 2., 1., 2., 1., 2., 2., 2., 1., 2., 2., 2., 2., 1., v0 );  // destination channels
#endif


// add noise to params
mat4 noisyBetaLen = addNoiseToParam(betaLen, uIn0.r * Zin[0].r);
mat4 noisyBeta0   = addNoiseToParam(beta0, uIn0.g * Zin[0].g);
mat4 noisyBeta1   = addNoiseToParam(beta1, uIn0.b * Zin[0].b);
mat4 noisyBeta2   = addNoiseToParam(beta2, uIn0.a * Zin[0].a);
mat4 noisyMu      = addNoiseToParam(mu, uIn1.r * Zin[1].r);
mat4 noisySigma   = addNoiseToParam(sigma, uIn1.g * Zin[1].g);
mat4 noisyEta     = addNoiseToParam(eta, uIn1.b * Zin[1].b);
mat4 noisyRelR    = addNoiseToParam(relR, uIn1.a * Zin[1].a);

// mat4 noisyBetaLen = mulNoiseToParam(betaLen, 1.);
// mat4 noisyBeta0   = mulNoiseToParam(beta0, 1.);
// mat4 noisyBeta1   = mulNoiseToParam(beta1, 0.);
// mat4 noisyBeta2   = mulNoiseToParam(beta2, 0.);
// mat4 noisyMu      = mulNoiseToParam(mu, 1.);
// mat4 noisySigma   = mulNoiseToParam(sigma, 1.);
// mat4 noisyEta     = mulNoiseToParam(eta, 1.);
// mat4 noisyRelR    = mulNoiseToParam(relR, 1.);


// precalculate
int intR = int(ceil(R));
float dt = 1./T;       // time step

const vec4 kmv = vec4(0.5);    // kernel ring center
const mat4 kmu = mat4(kmv, kmv, kmv, kmv);
const vec4 ksv = vec4(0.15);    // kernel ring width
mat4 ksigma = mat4(ksv, ksv, ksv, ksv); // + mat4(uIn0, uIn1, uIn0, uIn1);

ivec4 src0 = ivec4(src[0]), src1 = ivec4(src[1]), src2 = ivec4(src[2]), src3 = ivec4(src[3]);
ivec4 dst0 = ivec4(dst[0]), dst1 = ivec4(dst[1]), dst2 = ivec4(dst[2]), dst3 = ivec4(dst[3]);

mat4 bell(in mat4 x, in mat4 m, in mat4 s)
{
    mat4 v = -mult(x-m, x-m) / s / s / 2.;
    return mat4( exp(v[0]), exp(v[1]), exp(v[2]), exp(v[3]) );
}

// get neighbor weights (vectorized) for given radius
mat4 getWeight(in float r, in mat4 noisyRelR)
{
    mat4 Br = (noisyBetaLen) / noisyRelR * r;
    ivec4 Br0 = ivec4(Br[0]), Br1 = ivec4(Br[1]), Br2 = ivec4(Br[2]), Br3 = ivec4(Br[3]);

    // (Br==0 ? beta0 : 0) + (Br==1 ? beta1 : 0) + (Br==2 ? beta2 : 0)
    mat4 height = mat4(
        noisyBeta0[0] * vec4(equal(Br0, iv0)) + noisyBeta1[0] * vec4(equal(Br0, iv1)) + noisyBeta2[0] * vec4(equal(Br0, iv2)),
        noisyBeta0[1] * vec4(equal(Br1, iv0)) + noisyBeta1[1] * vec4(equal(Br1, iv1)) + noisyBeta2[1] * vec4(equal(Br1, iv2)),
        noisyBeta0[2] * vec4(equal(Br2, iv0)) + noisyBeta1[2] * vec4(equal(Br2, iv1)) + noisyBeta2[2] * vec4(equal(Br2, iv2)),
        noisyBeta0[3] * vec4(equal(Br3, iv0)) + noisyBeta1[3] * vec4(equal(Br3, iv1)) + noisyBeta2[3] * vec4(equal(Br3, iv2)) );
    mat4 mod1 = mat4( mod(Br[0], 1.), mod(Br[1], 1.), mod(Br[2], 1.), mod(Br[3], 1.) );
    return mult(height, bell(mod1, kmu, ksigma));
}

// get colors (vectorized) from source channels
vec4 getSrc(in vec3 v, in ivec4 srcv)
{
    return
        v.r * vec4(equal(srcv, iv0)) + 
        v.g * vec4(equal(srcv, iv1)) +
        v.b * vec4(equal(srcv, iv2));
}

// get color for destination channel
float getDst(in mat4 m, in ivec4 ch)
{
    return 
        dot(m[0], vec4(equal(dst0, ch))) + 
        dot(m[1], vec4(equal(dst1, ch))) + 
        dot(m[2], vec4(equal(dst2, ch))) + 
        dot(m[3], vec4(equal(dst3, ch)));
}

// get values at given position
mat4 getVal(in vec2 xy)
{
    vec2 txy = mod(xy / iResolution.xy, 1.);
    vec3 val = texture(sTD2DInputs[0], txy).rgb;
    return mat4( getSrc(val, src0), getSrc(val, src1), getSrc(val, src2), getSrc(val, src3) );
}

// draw the shape of kernels
vec3 drawKernel(in vec2 uv)
{
    ivec2 ij = ivec2(uv / 0.25);  // 0..3
    vec2 xy = mod(uv, 0.25) * 8. - 1.;  // -1..1
    if (ij.x > 3) return vec3(0.);
    float r = length(xy);
    vec3 rgb = vec3(getWeight(r, noisyRelR)[3-ij.y][ij.x]);
    return rgb;
}

void main()
{

    // parameters that music should change
    // R
    // betaLen
    // beta0
    // mat4 new_beta0 = beta0 + Zin * mat4(uIn0, uIn1, uIn0, uIn1);
    // beta1
    // beta2
    // mat4 n_mu = mu * mat4(uIn0, uIn1, uIn0, uIn1);
    // mat4 n_sigma = 
    // mat4 n_eta = eta
    // relR
    // src
    // dst
    // dt 
    // dt = dt/2. + uIn2.y;


    vec2 uv = gl_FragCoord.xy/ iResolution.xy;

    // loop through the neighborhood, optimized: same weights for all quadrants/octants
    // calculate the weighted average of neighborhood from source channel
    mat4 sum = mat4(0.), total = mat4(0.);
    // self
    float r = 0.;
    mat4 weight = getWeight(r, noisyRelR);
    mat4 valSrc = getVal(gl_FragCoord.xy+ vec2(0, 0)); sum += mult(valSrc, weight); total += weight;
    // orthogonal
    for (int x=1; x<=intR; x++)
    {
        r = float(x) / R;
        weight = getWeight(r, noisyRelR);
        valSrc = getVal(gl_FragCoord.xy+ vec2(+x, 0)*samplingDist); sum += mult(valSrc, weight); total += weight;
        valSrc = getVal(gl_FragCoord.xy+ vec2(-x, 0)*samplingDist); sum += mult(valSrc, weight); total += weight;
        valSrc = getVal(gl_FragCoord.xy+ vec2(0, +x)*samplingDist); sum += mult(valSrc, weight); total += weight;
        valSrc = getVal(gl_FragCoord.xy+ vec2(0, -x)*samplingDist); sum += mult(valSrc, weight); total += weight;
    }
    // diagonal
    for (int x=1; x<=intR; x++)
    {
        r = sqrt(2.) * float(x) / R;
        if (r <= 1.) {
            weight = getWeight(r, noisyRelR);
            valSrc = getVal(gl_FragCoord.xy+ vec2(+x, +x)*samplingDist); sum += mult(valSrc, weight); total += weight;
            valSrc = getVal(gl_FragCoord.xy+ vec2(+x, -x)*samplingDist); sum += mult(valSrc, weight); total += weight;
            valSrc = getVal(gl_FragCoord.xy+ vec2(-x, +x)*samplingDist); sum += mult(valSrc, weight); total += weight;
            valSrc = getVal(gl_FragCoord.xy+ vec2(-x, -x)*samplingDist); sum += mult(valSrc, weight); total += weight;
        }
    }
    // others
    for (int y=1; y<=intR-1; y++)
    for (int x=y+1; x<=intR; x++)
    {
        r = sqrt(float(x*x + y*y)) / R;
        if (r <= 1.) {
            weight = getWeight(r, noisyRelR);
            valSrc = getVal(gl_FragCoord.xy+ vec2(+x, +y)*samplingDist); sum += mult(valSrc, weight); total += weight;
            valSrc = getVal(gl_FragCoord.xy+ vec2(+x, -y)*samplingDist); sum += mult(valSrc, weight); total += weight;
            valSrc = getVal(gl_FragCoord.xy+ vec2(-x, +y)*samplingDist); sum += mult(valSrc, weight); total += weight;
            valSrc = getVal(gl_FragCoord.xy+ vec2(-x, -y)*samplingDist); sum += mult(valSrc, weight); total += weight;
            valSrc = getVal(gl_FragCoord.xy+ vec2(+y, +x)*samplingDist); sum += mult(valSrc, weight); total += weight;
            valSrc = getVal(gl_FragCoord.xy+ vec2(+y, -x)*samplingDist); sum += mult(valSrc, weight); total += weight;
            valSrc = getVal(gl_FragCoord.xy+ vec2(-y, +x)*samplingDist); sum += mult(valSrc, weight); total += weight;
            valSrc = getVal(gl_FragCoord.xy+ vec2(-y, -x)*samplingDist); sum += mult(valSrc, weight); total += weight;
        }
    }
    mat4 avg = sum / (total + EPSILON);    // avoid divided by zero

    // calculate growth, add a small portion to destination channel
    mat4 growth = mult(noisyEta, bell(avg, noisyMu, noisySigma) * 2. - 1.);
    vec3 growthDst = vec3( getDst(growth, iv0), getDst(growth, iv1), getDst(growth, iv2) );
    vec3 val = texture(sTD2DInputs[0], uv).rgb;
    vec3 rgb = clamp(dt * growthDst + val, 0., 1.);

    // debug: uncomment to show list of kernels
    // rgb = drawKernel(gl_FragCoord.xy/ iResolution.y);

    // randomize at start, or add patch on mouse click
    if (iFrame < 2 || Keyin.x > 0.)
    
    {
        vec3 noiseRGB = texture(sTD2DInputs[1], uv).rgb;
        rgb = noiseRGB;
    }

    // add noise with beats
    if (uIn0.r > 0.6)
    
    {
        vec3 noiseRGB = texture(sTD2DInputs[1], uv).rgb;
        rgb += -noiseRGB;
    }


    fragColor = vec4(rgb, 1.);
}
