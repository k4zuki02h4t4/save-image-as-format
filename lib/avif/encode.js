import avifEncFactory from './avif_enc.js';

const defaultOptions = {
  quality: 60,
  qualityAlpha: -1,
  denoiseLevel: 0,
  tileColsLog2: 0,
  tileRowsLog2: 0,
  speed: 6,
  subsample: 1,
  chromaDeltaQ: false,
  sharpness: 0,
  tune: 0,
  enableSharpYUV: false,
  bitDepth: 8,
  lossless: false,
};

let modulePromise;

function getModule() {
  if (!modulePromise) {
    modulePromise = avifEncFactory({ noInitialRun: true });
  }
  return modulePromise;
}

export default async function encode(imageData, options = {}) {
  const _options = { ...defaultOptions, ...options };
  const module = await getModule();
  const output = module.encode(
    new Uint8Array(imageData.data.buffer),
    imageData.width,
    imageData.height,
    _options,
  );
  if (!output) throw new Error('AVIF encoding error.');
  return output.buffer;
}
