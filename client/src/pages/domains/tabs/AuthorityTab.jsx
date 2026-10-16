import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Award, CheckCircle2, CircleHelp, Crown, Globe, Layers, Link2, RefreshCw, ShieldCheck, Wrench, XCircle } from 'lucide-react';
import { useState } from 'react';
import { errorMessage } from '../../../api/client';
import { authorityApi } from '../../../api/endpoints';
import Sparkline from '../../../components/charts/Sparkline';
import { PositionPill } from '../../../components/ui/DataTable';
import { Alert, EmptyState, ScoreRing, Skeleton, Spinner, scoreStatus } from '../../../components/ui/Feedback';
import { useToast } from '../../../components/ui/Toast';
import { fmt } from '../../../utils/format';

const PILLARS = {
  backlinks: { label: 'Backlink otoritesi', icon: Link2, tip: 'Bağlantı veren alan adı sayısı, onların otoritesi, dofollow oranı ve risk' },
  topical: { label: 'Konu otoritesi', icon: Layers, tip: 'Marka dışı sorgularda ilk 10 / ilk 3 görünürlük ve içerik derinliği' },
  brand: { label: 'Marka otoritesi', icon: Crown, tip: 'Markanızı adıyla arayanların hacmi ve trendi' },
  trust: { label: 'Güven (E-E-A-T)', icon: ShieldCheck, tip: 'Kurumsal sayfalar, uzman/yazar bilgisi, yapısal veri, iletişim ve alan adı yaşı' },
  technical: { label: 'Teknik', icon: Wrench, tip: 'Site sağlığı, mobil hız ve indekslenme oranı' },
};
const PRIORITY = { high: ['badge-critical', 'Yüksek'], medium: ['badge-warning', 'Orta'], low: ['badge-neutral', 'Düşük'] };

function PillarBar({ k, p }) {
  const meta = PILLARS[k];
  const s = scoreStatus(p.score);
  return (
    <div style={{ display: 'grid', gap: 6 }} title={meta.tip}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="row" style={{ gap: 8, fontWeight: 500 }}><meta.icon size={16} /> {meta.label} <span className="muted num" style={{ fontWeight: 400 }}>· %{p.weight}</span></span>
        <strong className="num">{p.score ?? '—'}</strong>
      </div>
      <div className="bar-track" style={{ height: 8 }}>
        <div className="bar-fill" style={{ width: `${p.score ?? 0}%`, background: s.color }} />
      </div>
    </div>
  );
}

function clusterStatus(c) {
  const share = c.queries ? c.top10 / c.queries : 0;
  if (share >= 0.4) return ['badge-good', 'Güçlü'];
  if (share >= 0.15 || c.striking >= 5) return ['badge-warning', 'Gelişiyor'];
  return ['badge-critical', 'Zayıf'];
}

export default function AuthorityTab({ domain }) {
  const id = domain.id;
  const qc = useQueryClient();
  const toast = useToast();
  const [pillar, setPillar] = useState('');
  const { data, isLoading, isError, error } = useQuery({ queryKey: ['authority', id], queryFn: () => authorityApi.latest(id) });
  const compute = useMutation({
    mutationFn: () => authorityApi.compute(id),
    onSuccess: () => {
      toast.success('Otorite analizi güncellendi');
      qc.invalidateQueries({ queryKey: ['authority', id] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (isLoading) return <Skeleton height={320} />;
  if (isError) return <Alert type="error">{errorMessage(error)}</Alert>;

  const computeBtn = (
    <button className="btn btn-primary btn-sm" onClick={() => compute.mutate()} disabled={compute.isPending}>
      {compute.isPending ? <><Spinner size={14} /> Hesaplanıyor…</> : <><RefreshCw size={15} /> {data.snapshot ? 'Yeniden hesapla' : 'Otoriteyi analiz et'}</>}
    </button>
  );
  if (!data.snapshot) {
    return (
      <div className="card">
        <EmptyState icon={Award} title="Henüz otorite analizi yok" action={computeBtn}>
          Backlink profili, konu kümeleri, marka aramaları, güven (E-E-A-T) sinyalleri ve teknik sağlıktan 0–100 otorite puanı ve
          önceliklendirilmiş bir yükseltme planı çıkarılır.
        </EmptyState>
      </div>
    );
  }

  const { score, pillars, metrics: m, recommendations, created_at: at } = data.snapshot;
  const ext = m.external;
  const ageYears = ext.registeredAt ? (Date.now() - new Date(ext.registeredAt)) / (365.25 * 86_400_000) : null;
  const recs = recommendations.filter((r) => !pillar || r.pillar === pillar);
  const historyScores = data.history.map((h) => h.score);

  return (
    <div className="stack">
      <div className="card card-pad row" style={{ justifyContent: 'space-between', gap: 12 }}>
        <div style={{ display: 'grid', gap: 4 }}>
          <h3 className="row" style={{ gap: 8, fontSize: 15 }}><Award size={17} /> Site otoritesi</h3>
          <p className="text-2" style={{ fontSize: 13 }}>Son analiz {fmt.dateTime(at)} · haftalık otomatik güncellenir</p>
        </div>
        {computeBtn}
      </div>

      {m.partial && (
        <Alert type="warning">
          Puan kısmi: {m.missingPillars.map((k) => PILLARS[k].label).join(', ')} için veri yok, bu bileşen hesaba katılmadı.
          {m.missingPillars.includes('backlinks') && ' Backlinkler sekmesinden Bing API anahtarı ekleyin veya Search Console bağlantılarını içe aktarın.'}
        </Alert>
      )}
      {!ext.oprEnabled && (
        <Alert type="info">
          Bağlantı veren sitelerin otoritesini ölçmek için ücretsiz bir Open PageRank anahtarı (keywordseverywhere.com → Open PageRank) alıp
          sunucudaki <code>.env</code> dosyasına <code>OPEN_PAGERANK_API_KEY</code> olarak ekleyin.
        </Alert>
      )}

      <div className="grid grid-2-1">
        <div className="card card-pad" style={{ display: 'grid', gap: 16 }}>
          <div className="row" style={{ gap: 24, flexWrap: 'nowrap', alignItems: 'center' }}>
            <ScoreRing score={score} size={136} label="Otorite" />
            <div style={{ display: 'grid', gap: 14, flex: 1, minWidth: 0 }}>
              {Object.entries(pillars).map(([k, p]) => <PillarBar key={k} k={k} p={p} />)}
            </div>
          </div>
          {historyScores.length > 1 && (
            <div className="row" style={{ gap: 12 }}>
              <span className="muted" style={{ fontSize: 12 }}>Puan geçmişi ({historyScores.length} analiz)</span>
              <Sparkline values={historyScores} width={220} height={36} />
            </div>
          )}
        </div>
        <div className="card card-pad" style={{ display: 'grid', gap: 10, alignContent: 'start' }}>
          <h3 style={{ fontSize: 15 }}>Dış otorite metrikleri</h3>
          <div className="metric-tile"><small>Open PageRank (0–10)</small><strong className="num">{ext.opr ?? '—'}{ext.oprRank ? <span className="muted" style={{ fontSize: 13 }}> · #{fmt.num(ext.oprRank)}</span> : null}</strong></div>
          <div className="metric-tile"><small>Tranco sıralaması (ilk 1M)</small><strong className="num">{ext.trancoRank ? `#${fmt.num(ext.trancoRank)}` : 'İlk 1M dışında'}</strong></div>
          <div className="metric-tile"><small>Alan adı yaşı</small><strong className="num">{ageYears === null ? '—' : `${ageYears.toFixed(1)} yıl`}</strong></div>
        </div>
      </div>

      <div className="grid grid-4">
        {[
          [Globe, 'Bağlantı veren alan adı', fmt.num(m.backlinks.referringDomains), `${fmt.num(m.backlinks.dofollowDomains)} dofollow`],
          [Award, 'Güçlü kaynak (OPR 4+)', fmt.num(m.backlinks.highQuality), m.backlinks.avgOpr !== null ? `Ort. OPR ${m.backlinks.avgOpr}` : 'OPR anahtarı yok'],
          [Crown, 'Marka tıklaması (28g)', fmt.num(m.brand.clicks), m.brand.trend === null ? '—' : `${m.brand.trend >= 0 ? '+' : ''}${Math.round(m.brand.trend * 100)}% önceki döneme göre`],
          [Layers, 'Marka dışı ilk 10', fmt.num(m.topical.top10), `${fmt.num(m.topical.top3)} kelime ilk 3’te`],
        ].map(([Icon, label, value, foot]) => (
          <div key={label} className="card stat">
            <span className="stat-label"><span className="stat-icon"><Icon size={16} /></span>{label}</span>
            <span className="stat-value num">{value}</span>
            <span className="stat-foot">{foot}</span>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="card-head" style={{ paddingBottom: 14 }}>
          <div><h3>Otoriteyi yükseltme planı</h3><p>Önceliğe göre sıralı; yüksek öncelikliler en büyük etkiyi yapar</p></div>
          <div className="segmented">
            <button className={!pillar ? 'active' : ''} onClick={() => setPillar('')}>Tümü ({recommendations.length})</button>
            {Object.entries(PILLARS).map(([k, p]) => {
              const n = recommendations.filter((r) => r.pillar === k).length;
              return n ? <button key={k} className={pillar === k ? 'active' : ''} onClick={() => setPillar(k)}>{p.label.split(' ')[0]} ({n})</button> : null;
            })}
          </div>
        </div>
        <div style={{ borderTop: '1px solid var(--border)' }}>
          {recs.map((r, i) => (
            <div key={i} style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'grid', gap: 6 }}>
              <div className="row" style={{ gap: 8 }}>
                <span className={`badge ${PRIORITY[r.priority][0]}`}>{PRIORITY[r.priority][1]}</span>
                <span className="badge badge-neutral">{PILLARS[r.pillar]?.label}</span>
                <strong>{r.title}</strong>
              </div>
              <p className="text-2" style={{ fontSize: 13 }}>{r.detail}</p>
              {!!r.actions?.length && (
                <ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 3, fontSize: 13 }}>
                  {r.actions.map((a) => <li key={a}>{a}</li>)}
                </ul>
              )}
            </div>
          ))}
          {!recs.length && <EmptyState icon={CheckCircle2} title="Bu bileşende öneri yok" />}
        </div>
      </div>

      {!!m.topical.clusters.length && (
        <div className="card">
          <div className="card-head">
            <div>
              <h3>Konu kümeleri (konu otoritesi)</h3>
              <p>Ana konu: <strong>{m.topical.mainTopic || '—'}</strong> · alt konularda ne kadar otoritesiniz, nerede takılıyorsunuz</p>
            </div>
          </div>
          <div className="table-wrap" style={{ marginTop: 10 }}>
            <table className="table">
              <thead>
                <tr><th>Konu</th><th>Durum</th><th className="r">Sorgu</th><th className="r">Gösterim</th><th className="r">İlk 3</th><th className="r">İlk 10</th><th className="r">11–30 (fırsat)</th><th className="r">Ort. sıra</th></tr>
              </thead>
              <tbody>
                {m.topical.clusters.map((c) => {
                  const [cls, label] = clusterStatus(c);
                  return (
                    <tr key={c.topic}>
                      <td>
                        <div className="cell-main">{c.topic}</div>
                        <div className="cell-sub truncate" style={{ maxWidth: 340 }} title={c.examples.map((e) => `${e.query} (#${e.position})`).join(', ')}>
                          {c.examples.slice(0, 3).map((e) => e.query).join(' · ')}
                        </div>
                      </td>
                      <td><span className={`badge ${cls}`}>{label}</span></td>
                      <td className="r">{fmt.num(c.queries)}</td>
                      <td className="r">{fmt.num(c.impressions)}</td>
                      <td className="r">{fmt.num(c.top3)}</td>
                      <td className="r">{fmt.num(c.top10)}</td>
                      <td className="r">{c.striking ? <span className="badge badge-warning">{c.striking}</span> : '—'}</td>
                      <td className="r"><PositionPill value={c.position} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="grid grid-2">
        <div className="card">
          <div className="card-head"><h3>Güven sinyalleri (E-E-A-T)</h3><span className="badge badge-neutral">{pillars.trust.score ?? '—'}/100</span></div>
          <div className="card-body" style={{ display: 'grid', gap: 10 }}>
            {m.trust.map((t) => (
              <div key={t.key} className="row" style={{ flexWrap: 'nowrap', alignItems: 'flex-start', gap: 10 }}>
                {t.pass === null ? <CircleHelp size={18} className="muted" style={{ flex: 'none' }} />
                  : t.pass ? <CheckCircle2 size={18} style={{ color: 'var(--good)', flex: 'none' }} />
                    : <XCircle size={18} style={{ color: 'var(--critical)', flex: 'none' }} />}
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 500 }}>{t.label}{t.value !== undefined && t.value !== null ? <span className="muted"> · {t.value} yıl</span> : null}</div>
                  {t.pass === false && <div className="text-2" style={{ fontSize: 12.5 }}>{t.fix}</div>}
                  {t.pass === null && <div className="muted" style={{ fontSize: 12.5 }}>Kontrol edilemedi (tarama veya site erişimi gerekli)</div>}
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="card">
          <div className="card-head"><h3>Bağlantı veren sitelerin kalitesi</h3></div>
          <div className="card-body" style={{ display: 'grid', gap: 12 }}>
            {m.backlinks.referringDomains ? (
              <>
                {ext.oprEnabled && (
                  <div style={{ display: 'grid', gap: 8 }}>
                    {m.backlinks.oprDistribution.map((d) => {
                      const max = Math.max(1, ...m.backlinks.oprDistribution.map((x) => x.domains));
                      return (
                        <div key={d.range} className="row" style={{ flexWrap: 'nowrap', gap: 10 }}>
                          <span className="text-2 num" style={{ width: 90, flex: 'none', fontSize: 13 }}>OPR {d.range}</span>
                          <div className="bar-cell" style={{ flex: 1 }}>
                            <div className="bar-track"><div className="bar-fill" style={{ width: `${(d.domains / max) * 100}%` }} /></div>
                            <strong className="num" style={{ minWidth: 30, textAlign: 'right' }}>{d.domains}</strong>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
                <div className="table-wrap" style={{ maxHeight: 300, overflowY: 'auto' }}>
                  <table className="table">
                    <thead><tr><th>Alan adı</th><th className="r">OPR</th><th className="r">Bağlantı</th><th className="r">Dofollow</th></tr></thead>
                    <tbody>
                      {m.backlinks.topDomains.slice(0, 50).map((d) => (
                        <tr key={d.source_domain}>
                          <td className="truncate" style={{ maxWidth: 220 }}>{d.source_domain} {d.risk >= 40 && <span className="badge badge-critical">riskli</span>}</td>
                          <td className="r num">{d.opr ?? '—'}</td>
                          <td className="r">{fmt.num(d.links)}</td>
                          <td className="r">{fmt.num(d.dofollow)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <p className="muted">Backlink verisi yok. Backlinkler sekmesinden Bing anahtarı ekleyin veya Search Console bağlantılarını içe aktarın.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
