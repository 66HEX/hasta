import assert from 'node:assert/strict';

import { createHasta, createHastaController } from '@66hex/hasta';
import { KalmanPredictor } from '@66hex/hasta/core';
import { createHastaController as vanilla } from '@66hex/hasta/vanilla';

assert.equal('document' in globalThis, false);

assert.equal(createHastaController, vanilla);

assert.throws(() => createHasta(), /requires a document/u);

const hasta = vanilla();
const target = hasta.target({ when: { type: 'intersects', withinMs: 100 }, onPredict() {} });

target.ref(null);

hasta.destroy();

const predictor = new KalmanPredictor();

predictor.update({ x: 0, y: 0, timeStamp: 0 });

predictor.update({ x: 20, y: 0, timeStamp: 16 });

assert.ok(predictor.predict(16, 100).points.at(-1).x > 20);
