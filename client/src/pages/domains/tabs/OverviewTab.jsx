import { useQuery } from '@tanstack/react-query';
import { Eye, Hash, MousePointerClick, Percent, StickyNote, TrendingUp } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { domainApi, insightApi } from '../../../api/endpoints';
import AnnotationsModal from '../../../components/AnnotationsModal';
import TrendChart, { METRICS, UPDATE_COLORS } from '../../../components/charts/TrendChart';
import HealthSpeedCards from '../../../components/HealthSpeedCards';
import { PositionPill } from '../../../components/ui/DataTable';
import { Delta, EmptyState, Skeleton } from '../../../components/ui/Feedback';
import { fmt, relativeChange, safeHref, shortUrl } from '../../../utils/format';

function Kpi({ icon: Icon, label, value, delta, invert, mode }) {
  return (
    <div className="card stat">
      <span className="stat-label"><span className="stat-icon"><Icon size={16} /></span>{label}</span>
      <span className="stat-value num">{value}</span>
      <span className="stat-foot"><Delta value={delta} invert={invert} mode={mode} /> önceki döneme göre</span>
    </div>
  );
}

function TopList({ title, to, rows, loading, renderKey }) {
  return (
    <div className="card">
      <div className="card-head">
        <h3>{title}</h3>
        <Link to={to} className="btn btn-ghost btn-sm">Tümünü gör</Link>
      </div>
      <div className="table-wrap" style={{ marginTop: 10 }}>
        <table className="table">
          <thead>
            <tr><th>{title.includes('Sayfa') ? 'Sayfa' : 'Anahtar kelime'}</th><th className="r">Tıklama</th><th className="r">Gösterim</th><th className="r">Poz.</th></tr>
          </thead>
          <tbody>
            {loading
              ? [0, 1, 2, 3, 4].map((i) => <tr key={i}><td colSpan={4}><Skeleton height={14} /></td></tr>)
              : rows.map((r) => (
                  <tr key={r.key}>
                    <td><div className="cell-main truncate" style={{ maxWidth: 300 }}>{renderKey(r)}</div></td>
                    <td className="r">{fmt.num(r.clicks)}</td>
                    <td className="r">{fmt.num(r.impressions)}</td>
                    <td className="r"><PositionPill value={r.position} /></td>
                  </tr>
                ))}
            {!loading && !rows.length && <tr><td colSpan={4} className="muted">Veri yok</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function OverviewTab({ domain, days }) {
  const [metric, setMetric] = useState('clicks');
  const [notesOpen, setNotesOpen] = useState(false);
  const id = domain.id;
  const perf = useQuery({ queryKey: ['gsc', id, 'performance', days], queryFn: () => domainApi.performance(id, { days }) });
  const range = perf.data?.range;
  const notes = useQuery({
    queryKey: ['annotations', id, range?.start, range?.end],
    queryFn: () => insightApi.annotations(id, { start: range.start, end: range.end }),
    enabled: Boolean(range),
    staleTime: 5 * 60_000,
  });
  const top = { sort: 'clicks', order: 'desc', page: 1, pageSize: 8, days };
  const kw = useQuery({ queryKey: ['gsc', id, 'keywords', top], queryFn: () => domainApi.keywords(id, top) });
  const pages = useQuery({ queryKey: ['gsc', id, 'pages', top], queryFn: () => domainApi.pages(id, top) });

  const cur = perf.data?.current;
  const prev = perf.data?.previous;

  if (perf.isSuccess && !perf.data.range) {
    return (
      <div className="card">
        <EmptyState icon={TrendingUp} title="Henüz Search Console verisi yok">
          Senkronizasyon tamamlandığında tıklama ve gösterim verileri burada görünecek. Yeni doğrulanan mülklerde verinin oluşması 2-3 gün sürebilir.
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="stack">
      <div className="grid grid-4">
        {perf.isLoading ? (
          [0, 1, 2, 3].map((i) => <div key={i} className="card card-pad"><Skeleton height={80} /></div>)
        ) : (
          <>
            <Kpi icon={MousePointerClick} label="Tıklama" value={fmt.num(cur.clicks)} delta={relativeChange(cur.clicks, prev.clicks)} />
            <Kpi icon={Eye} label="Gösterim" value={fmt.num(cur.impressions)} delta={relativeChange(cur.impressions, prev.impressions)} />
            <Kpi icon={Percent} label="Ort. TO (CTR)" value={fmt.pct(cur.ctr)} delta={relativeChange(cur.ctr, prev.ctr)} />
            <Kpi
              icon={Hash} label="Ort. pozisyon" value={fmt.pos(cur.position)} invert mode="abs"
              delta={cur.position !== null && prev.position !== null ? cur.position - prev.position : null}
            />
          </>
        )}
      </div>

      <div className="card">
        <div className="card-head">
          <div>
            <h3>Organik performans</h3>
            <p>
              {perf.data?.range && `${fmt.dateShort(perf.data.range.start)} – ${fmt.dateShort(perf.data.range.end)}`}
              {cur && ` · ${fmt.num(cur.keywords)} anahtar kelime`}
            </p>
          </div>
          <div className="row">
            <div className="segmented" role="tablist" aria-label="Metrik">
              {Object.entries(METRICS).map(([k, m]) => (
                <button key={k} className={metric === k ? 'active' : ''} onClick={() => setMetric(k)} role="tab" aria-selected={metric === k}>
                  {m.label}
                </button>
              ))}
            </div>
            <button className="btn btn-secondary btn-sm" onClick={() => setNotesOpen(true)} title="Grafik notları ve Google güncellemeleri">
              <StickyNote size={15} /> Notlar{notes.data?.notes?.length ? ` (${notes.data.notes.length})` : ''}
            </button>
          </div>
        </div>
        <div className="card-body">
          {perf.isLoading ? <Skeleton height={280} /> : <TrendChart data={perf.data.daily} metric={metric} annotations={notes.data} />}
          {notes.data && (notes.data.updates.length > 0 || notes.data.notes.length > 0 || notes.data.changes.length > 0) && (
            <div className="row muted" style={{ gap: 16, fontSize: 12, marginTop: 10, flexWrap: 'wrap' }}>
              {notes.data.updates.some((u) => u.kind === 'core') && <span className="row" style={{ gap: 6 }}><span className="dot" style={{ background: UPDATE_COLORS.core, opacity: 0.6 }} /> Google core update</span>}
              {notes.data.updates.some((u) => u.kind === 'spam') && <span className="row" style={{ gap: 6 }}><span className="dot" style={{ background: UPDATE_COLORS.spam, opacity: 0.6 }} /> Spam update</span>}
              {notes.data.notes.length > 0 && <span className="row" style={{ gap: 6 }}><span className="dot" style={{ background: 'var(--primary)' }} /> Notunuz</span>}
              {notes.data.changes.length > 0 && <span className="row" style={{ gap: 6 }}><span className="dot" style={{ background: 'var(--critical)' }} /> Sitede tespit edilen önemli değişiklik</span>}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-2">
        <TopList
          title="En çok tıklanan anahtar kelimeler" to={`/domains/${id}/keywords`} loading={kw.isLoading}
          rows={kw.data?.rows || []} renderKey={(r) => r.key}
        />
        <TopList
          title="En çok trafik alan sayfalar" to={`/domains/${id}/pages`} loading={pages.isLoading}
          rows={pages.data?.rows || []}
          renderKey={(r) => <a href={safeHref(r.key)} target="_blank" rel="noopener noreferrer" title={r.key}>{shortUrl(r.key)}</a>}
        />
      </div>

      <HealthSpeedCards domainId={id} />
      {notesOpen && <AnnotationsModal domainId={id} data={notes.data} onClose={() => setNotesOpen(false)} />}
    </div>
  );
}
