// 5-point finite-difference Laplacian curvature stencil over heightAt().
// Requires heightAt(vec2) to be defined beforehand.
export const LAPLACIAN = /* glsl */ `
float laplacianAt(vec2 p, float eps) {
  float c = heightAt(p);
  float s = heightAt(p - vec2(eps, 0.0)) + heightAt(p + vec2(eps, 0.0)) +
            heightAt(p - vec2(0.0, eps)) + heightAt(p + vec2(0.0, eps));
  return (s - 4.0 * c) / eps;
}
`;
