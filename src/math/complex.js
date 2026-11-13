const finite = (value, label) => {
  if (!Number.isFinite(value)) throw new TypeError(`${label} must be finite`);
  return value;
};

export class Complex {
  constructor(re = 0, im = 0) {
    this.re = finite(Number(re), "real part");
    this.im = finite(Number(im), "imaginary part");
    Object.freeze(this);
  }

  static from(value) {
    if (value instanceof Complex) return value;
    if (typeof value === "number") return new Complex(value, 0);
    if (value && typeof value === "object" && "re" in value) {
      return new Complex(value.re, value.im ?? 0);
    }
    throw new TypeError("Cannot convert value to Complex");
  }

  static polar(magnitude, phase) {
    return new Complex(magnitude * Math.cos(phase), magnitude * Math.sin(phase));
  }

  add(other) {
    const z = Complex.from(other);
    return new Complex(this.re + z.re, this.im + z.im);
  }

  sub(other) {
    const z = Complex.from(other);
    return new Complex(this.re - z.re, this.im - z.im);
  }

  mul(other) {
    const z = Complex.from(other);
    return new Complex(this.re * z.re - this.im * z.im, this.re * z.im + this.im * z.re);
  }

  div(other) {
    const z = Complex.from(other);
    const denominator = z.re * z.re + z.im * z.im;
    if (denominator === 0) throw new RangeError("Division by zero");
    return new Complex(
      (this.re * z.re + this.im * z.im) / denominator,
      (this.im * z.re - this.re * z.im) / denominator
    );
  }

  scale(factor) { return new Complex(this.re * factor, this.im * factor); }
  conj() { return new Complex(this.re, -this.im); }
  abs() { return Math.hypot(this.re, this.im); }
  phase() { return Math.atan2(this.im, this.re); }
  equals(other, tolerance = 1e-10) {
    const z = Complex.from(other);
    return Math.abs(this.re - z.re) <= tolerance && Math.abs(this.im - z.im) <= tolerance;
  }

  toJSON() { return { re: this.re, im: this.im }; }
}

export const ZERO = new Complex(0, 0);
export const ONE = new Complex(1, 0);
export const J = new Complex(0, 1);
