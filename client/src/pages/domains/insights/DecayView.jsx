import { useQuery } from '@tanstack/react-query';
import { CalendarClock, ChevronDown, ChevronRight, Search, TrendingDown, TriangleAlert } from 'lucide-react';
import { Fragment, useMemo, useState } from 'react';
import { errorMessage } from '../../../api/client';
import { insightApi } from '../../../api/endpoints';
import { PositionPill } from '../../../components/ui/DataTable';
import { Alert, EmptyState, Skeleton, Spinner } from '../../../components/ui/Feedback';
import { fmt } from '../../../utils/format';
import { MiniBars, PageLink, Tiles, Tip } from './common';

const STAGES = {
  severe: { label: 'Ciddi erime', cls: 'badge-critical' },
  decaying: { label: 'Eriyor', cls: 'badge-warning' },
  early: { label: 'Erken düşüş', cls: 'badge-notice' },
};
const CAUSES = {
  ranking: {
    label: 'Sıra kaybı', cls: 'badge-critical',
    fix: 'Rakipler öne geçmiş. İçeriği güncelleyin (yeni bilgi, güncel yıl, SSS, görseller), arama niyetiyle eşleştiğini kontrol edin; güçlü sayfalardan iç bağlantı verin.',
  },
  demand: {
    label: 'Talep düşüşü', cls: 'badge-notice',
    fix: 'Sıra yerinde ama gösterim düştü: konuya ilgi azalmış ya da mevsimsel. Geçen yılın aynı dönemine bakın; içeriği yükselen alt konulara genişletin.',
  },
  ctr: {
    label: 'TO düşüşü', cls: 'badge-warning',
    fix: 'Sıra aynı ama tıklama oranı düştü: sonuç sayfasında AI Overview, öne çıkan snippet veya reklam alanı büyümüş olabilir. Title ve meta açıklamayı yenileyin, yapısal veri ekleyin.',
  },
  mixed: {
    label: 'Karışık', cls: 'badge-neutral',
    fix: 'Tek bir belirgin neden yok. Sayfayı ilk sıradaki rakip sonuçlarla karşılaştırıp kapsamlı bir güncelleme yapın.',
  },
};
const STAGE_FILTERS = [{ key: '', label: 'Tümü' }, { key: 'severe', label: 'Ciddi' }, { key: 'decaying', label: 'Eriyen' }, { key: 'early', label: 'Erken' }];
const monthLabel = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString('tr-TR', { month: 'short', year: '2-digit' });

function LostQueries({ domainId, row }) {
  const q = useQuery({
    queryKey: ['insights', domainId, 'decay-queries', row.page, row.peakMonth],
    queryFn: () => insightApi.decayQueries(domainId, { url: row.page, peakMonth: row.peakMonth }),
    staleTime: 30 * 60_000,
    retry: false,
  });
  if (q.isLoading) return <div className="row muted" style={{ gap: 8 }}><Spinner size={14} /> Search Console’dan sorgular alınıyor…</div>;
  if (q.isError) return <Alert type="error">{errorMessage(q.error)}</Alert>;
  if (!q.data.rows.length) return <p className="muted">Kaybedilen belirgin sorgu bulunamadı.</p>;
  return (
    <div className="table-wrap" style={{ border: '1px solid var(--border)', borderRadius: 10 }}>
      <table className="table">
        <thead><tr><th>Kaybedilen sorgu</th><th className="r">Tıklama (zirve → şimdi)</th><th className="r">Pozisyon (zirve → şimdi)</th></tr></thead>
        <tbody>
          {q.data.rows.map((r) => (
            <tr key={r.query}>
              <td className="cell-main truncate" style={{ maxWidth: 320 }}>{r.query}</td>
              <td className="r num">{fmt.num(r.prevClicks)} → <strong>{fmt.num(r.clicks)}</strong></td>
              <td className="r"><span className="row" style={{ gap: 6, justifyContent: 'flex-end' }}><PositionPill value={r.prevPosition} /> → {r.position === null ? <span className="badge badge-critical">Yok</span> : <PositionPill value={r.position} />}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Detail({ domainId, row }) {
  const [showQueries, setShowQueries] = useState(false);
  const technical = row.statusCode && row.statusCode !== 200 ? `Sayfa şu anda HTTP ${row.statusCode} döndürüyor` : row.noindex ? 'Sayfa şu anda noindex' : null;
  return (
    <div style={{ display: 'grid', gap: 12, padding: '4px 4px 8px' }}>
      {technical && <Alert type="error">{technical}. Trafik kaybının asıl nedeni muhtemelen bu; önce bunu düzeltin.</Alert>}
      <div className="grid grid-4">
        <div className="metric-tile"><small>Zirve ({monthLabel(row.peakMonth)})</small><strong className="num">{fmt.num(row.peakClicks)}</strong><small>tık / ay</small></div>
        <div className="metric-tile"><small>Son 3 ay</small><strong className="num">{fmt.num(row.recentClicks)}</strong><small>tık / ay</small></div>
        <div className="metric-tile"><small>Gösterim değişimi</small><strong className="num">−%{fmt.num(Math.max(0, row.impressionDrop))}</strong><small>zirveye göre</small></div>
        <div className="metric-tile"><small>Geçen yıla göre</small><strong className="num">{row.yoy === null ? '—' : `${row.yoy > 0 ? '+' : ''}%${fmt.num(row.yoy)}`}</strong><small>{row.seasonal ? 'mevsimsel olabilir' : 'aynı dönem'}</small></div>
      </div>
      {row.causes.map((c) => (
        <div key={c} className="issue-fix"><TrendingDown size={16} /> <div><strong>{CAUSES[c].label}:</strong> {CAUSES[c].fix}</div></div>
      ))}
      {row.updates?.length > 0 && (
        <Alert type="warning">Düşüş <strong>{row.updates.join(', ')}</strong> döneminde başladı. Google’ın yardımcı içerik ve E-E-A-T yönergelerine göre içeriği gözden geçirin (uzman yazar, kaynak, özgün deneyim).</Alert>
      )}
      <div>
        <button className="btn btn-secondary btn-sm" onClick={() => setShowQueries((v) => !v)}>
          <Search size={14} /> {showQueries ? 'Sorguları gizle' : 'Hangi sorgular kaybedildi?'}
        </button>
      </div>
      {showQueries && <LostQueries domainId={domainId} row={row} />}
    </div>
  );
}

/** İçerik erimesi: aylık Search Console verisinde zirvesinden istikrarlı biçimde düşen sayfalar ve olası nedenleri. */
export default function DecayView({ domain }) {
  const { data, isLoading, isError, error } = useQuery({ queryKey: ['insights', domain.id, 'decay'], queryFn: () => insightApi.decay(domain.id) });
  const [stage, setStage] = useState('');
  const [hideSeasonal, setHideSeasonal] = useState(false);
  const [open, setOpen] = useState(null);
  const rows = useMemo(
    () => (data?.rows || []).filter((r) => (!stage || r.stage === stage) && (!hideSeasonal || !r.seasonal)),
    [data, stage, hideSeasonal],
  );

  if (isLoading) return <Skeleton height={320} />;
  if (isError) return <Alert type="error">{errorMessage(error)}</Alert>;
  if (data.insufficient) {
    return (
      <div className="card">
        <EmptyState icon={CalendarClock} title="Aylık geçmiş henüz yok">
          İçerik erimesi en az {data.minMonths} aylık veri gerektirir (şu an {data.months} ay). Bir sonraki Search Console senkronizasyonunda
          16 aya kadar geçmiş otomatik çekilir; hemen başlatmak için üstteki “Verileri güncelle” düğmesini kullanın.
        </EmptyState>
      </div>
    );
  }

  const s = data.summary;
  return (
    <div className="stack">
      <Tiles items={[
        { label: 'Eriyen sayfa', value: fmt.num(s.decaying), icon: TrendingDown, tone: 'critical', foot: `${fmt.num(s.severe)} tanesi ciddi (%70+ kayıp)` },
        { label: 'Kayıp tıklama', value: fmt.num(s.lostClicks), icon: TrendingDown, tone: 'warning', foot: 'aylık, zirveye göre' },
        { label: 'Sıra kaybından', value: fmt.num(s.ranking), icon: TriangleAlert, foot: 'güncelleme ile geri kazanılabilir' },
        { label: 'Mevsimsel olabilir', value: fmt.num(s.seasonal), icon: CalendarClock, foot: 'geçen yılla benzer seviyede' },
      ]} />
      <div className="card">
        <div className="card-head">
          <div>
            <h3 className="row" style={{ gap: 8 }}><TrendingDown size={17} /> Güncellenmesi gereken sayfalar</h3>
            <p>{monthLabel(data.range.start)} – {monthLabel(data.range.end)} · {data.months} ay{data.range.partialDays ? ` (son ay ${data.range.partialDays} günlük veri, ölçeklendi)` : ''}</p>
          </div>
          <div className="row">
            <label className="row muted" style={{ gap: 6, fontSize: 13 }}>
              <input type="checkbox" checked={hideSeasonal} onChange={(e) => setHideSeasonal(e.target.checked)} /> Mevsimselleri gizle
            </label>
            <div className="segmented" role="tablist" aria-label="Aşama">
              {STAGE_FILTERS.map((f) => (
                <button key={f.key} className={stage === f.key ? 'active' : ''} onClick={() => setStage(f.key)} role="tab" aria-selected={stage === f.key}>{f.label}</button>
              ))}
            </div>
          </div>
        </div>
        <Tip>
          Zirvesinden sonra en az 3 aydır düşen ve son 3 ayı zirvesinin %25+ altında kalan sayfalar. Bir satıra tıklayarak nedenini, önerileri ve
          kaybedilen sorguları görün. En çok tıklama kaybeden sayfadan başlamak en hızlı geri kazanımı sağlar.
        </Tip>
        <div className="table-wrap" style={{ marginTop: 10 }}>
          {rows.length ? (
            <table className="table">
              <thead>
                <tr><th style={{ width: 28 }} /><th>Sayfa</th><th>Trend (aylık tık)</th><th className="r">Kayıp</th><th className="r">Tık/ay</th><th className="r">Pozisyon</th><th>Neden</th></tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const isOpen = open === r.page;
                  const declineIdx = r.series.findIndex((p) => p.month === r.declineStart);
                  return (
                    <Fragment key={r.page}>
                      <tr className="clickable" onClick={() => setOpen(isOpen ? null : r.page)} aria-expanded={isOpen}>
                        <td>{isOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}</td>
                        <td><PageLink url={r.page} title={r.title} max={300} /></td>
                        <td><MiniBars values={r.series.map((p) => p.clicks)} highlightFrom={declineIdx >= 0 ? declineIdx : undefined} /></td>
                        <td className="r"><span className={`badge ${STAGES[r.stage].cls}`}>−%{fmt.num(r.drop)}</span></td>
                        <td className="r num" style={{ whiteSpace: 'nowrap' }}>{fmt.num(r.peakClicks)} → <strong>{fmt.num(r.recentClicks)}</strong></td>
                        <td className="r" style={{ whiteSpace: 'nowrap' }}><PositionPill value={r.peakPosition} /> → <PositionPill value={r.recentPosition} /></td>
                        <td>
                          <div className="row" style={{ gap: 4 }}>
                            {r.causes.map((c) => <span key={c} className={`badge ${CAUSES[c].cls}`}>{CAUSES[c].label}</span>)}
                            {r.seasonal && <span className="badge badge-neutral">Mevsimsel?</span>}
                            {r.updates?.length > 0 && <span className="badge badge-warning" title={r.updates.join(', ')}>Core update</span>}
                            {r.statusCode && r.statusCode !== 200 && <span className="badge badge-critical">HTTP {r.statusCode}</span>}
                          </div>
                        </td>
                      </tr>
                      {isOpen && <tr><td colSpan={7} style={{ background: 'var(--surface-2)' }}><Detail domainId={domain.id} row={r} /></td></tr>}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <EmptyState icon={TrendingDown} title="Eriyen sayfa yok">Seçili filtrelerde istikrarlı düşüş gösteren sayfa bulunamadı.</EmptyState>
          )}
        </div>
      </div>
    </div>
  );
}
