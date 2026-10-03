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

void loadLast().then((last) => last && pod.loadBundle(last.bytes, last.filename, false));
