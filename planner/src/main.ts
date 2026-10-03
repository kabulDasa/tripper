import 'maplibre-gl/dist/maplibre-gl.css';
import './style.css';
import './maplibreWorker';
import { PlanView } from './plan/planView';
import { loadLast } from './pod/lastBundle';
import { PodView } from './pod/podView';

type Tab = 'plan' | 'pod';

const pod = new PodView();
const plan = new PlanView({
  onBundle: (bytes, filename) => {
    showTab('pod');
    void pod.loadBundle(bytes, filename);
  },
});

function showTab(tab: Tab): void {
  document.querySelectorAll<HTMLButtonElement>('.tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
  (document.getElementById('tab-plan') as HTMLElement).hidden = tab !== 'plan';
  (document.getElementById('tab-pod') as HTMLElement).hidden = tab !== 'pod';
  if (tab === 'pod') pod.shown();
  else plan.resize();
}

document.querySelectorAll<HTMLButtonElement>('.tabs button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab as Tab)));

// Deep links: #pod opens the Pod tab, #demo opens it with the bundled demo route.
function applyHash(): boolean {
  if (location.hash === '#demo') {
    showTab('pod');
    void pod.loadDemo();
    // Consume the hash so a later reload restores the user's own route, not the demo.
    history.replaceState(null, '', location.pathname + location.search + '#pod');
    return true;
  }
  if (location.hash === '#pod') showTab('pod');
  return false;
}
window.addEventListener('hashchange', () => void applyHash());
if (!applyHash()) {
  const before = pod.loadsStarted;
  void loadLast().then((last) => {
    // Skip if the user (or a #demo hashchange) loaded something while IndexedDB was answering.
    if (last && pod.loadsStarted === before) void pod.loadBundle(last.bytes, last.filename, false);
  });
}
