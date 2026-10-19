import { Binary, Bot, Boxes, FileClock, Lightbulb, Link2, MousePointerClick, Sparkles, Swords, TrendingDown } from 'lucide-react';
import { lazy, Suspense } from 'react';
import { useSearchParams } from 'react-router-dom';
import ErrorBoundary from '../../../components/ErrorBoundary';
import { Skeleton } from '../../../components/ui/Feedback';

const VIEWS = [
  { key: 'ideas', label: 'İçerik fikirleri', icon: Lightbulb, Comp: lazy(() => import('./IdeasView')) },
  { key: 'briefs', label: 'İçerik brief', icon: Sparkles, Comp: lazy(() => import('./BriefsView')) },
  { key: 'serp', label: 'SERP & AI Overview', icon: Bot, Comp: lazy(() => import('./SerpView')) },
  { key: 'decay', label: 'İçerik erimesi', icon: TrendingDown, gsc: true, Comp: lazy(() => import('./DecayView')) },
  { key: 'ctr', label: 'CTR anomalisi', icon: MousePointerClick, gsc: true, Comp: lazy(() => import('./CtrView')) },
  { key: 'clusters', label: 'Kelime kümeleri', icon: Boxes, Comp: lazy(() => import('./ClustersView')) },
  { key: 'links', label: 'İç link önerileri', icon: Link2, Comp: lazy(() => import('./LinksView')) },
  { key: 'schema', label: 'Yapısal veri', icon: Binary, Comp: lazy(() => import('./SchemaView')) },
  { key: 'competitors', label: 'Rakipler', icon: Swords, Comp: lazy(() => import('./CompetitorsView')) },
  { key: 'logs', label: 'Log analizi', icon: FileClock, Comp: lazy(() => import('./LogsView')) },
];

/** Derin analiz: alt görünüm URL'de (?view=) tutulur, paylaşılabilir ve geri tuşuyla çalışır. */
export default function InsightsTab({ domain }) {
  const [params, setParams] = useSearchParams();
  const views = VIEWS.filter((v) => !v.gsc || domain.gsc_property);
  const active = views.find((v) => v.key === params.get('view')) || views[0];
  const View = active.Comp;
  return (
    <div className="stack">
      <div className="segmented" role="tablist" aria-label="Analiz türü" style={{ flexWrap: 'wrap', alignSelf: 'flex-start' }}>
        {views.map(({ key, label, icon: Icon }) => (
          <button
            key={key} role="tab" aria-selected={key === active.key} className={key === active.key ? 'active' : ''}
            onClick={() => setParams({ view: key }, { replace: true })}
          >
            <span className="row" style={{ gap: 6 }}><Icon size={14} /> {label}</span>
          </button>
        ))}
      </div>
      {!domain.gsc_property && (
        <p className="hint">İçerik erimesi ve CTR anomalisi Search Console verisi gerektirir; diğer analizler site taramasıyla çalışır.</p>
      )}
      <Suspense fallback={<Skeleton height={320} />}>
        <ErrorBoundary key={active.key}>
          <View domain={domain} />
        </ErrorBoundary>
      </Suspense>
    </div>
  );
}
