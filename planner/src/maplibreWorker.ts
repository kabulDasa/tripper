// maplibre-gl v6 finds its worker via import.meta.url at runtime, which Vite can't see,
// so the worker isn't emitted in production. Bundle it explicitly and point MapLibre at it.
import { setWorkerUrl } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';

setWorkerUrl(workerUrl);
