import { createSignalModel } from "../signals/registry.js";

export const CTFT_CONVENTION = Object.freeze({
  analysis: "X(jω)=∫x(t)e^(-jωt)dt",
  synthesis: "x(t)=(1/(2π))∫X(jω)e^(jωt)dω",
  frequencyVariable: "ω",
  frequencyUnit: "rad/s",
  sinc: "sinc(z)=sin(z)/z, sinc(0)=1"
});

export function fourierTransformOfSignal(id, parameters = {}) {
  return createSignalModel(id, parameters).spectrum;
}
