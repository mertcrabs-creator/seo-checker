import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, Plus, RefreshCw, Swords, Target, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { errorMessage } from '../../../api/client';
import { insightApi } from '../../../api/endpoints';
import { Alert, EmptyState, Skeleton, Spinner } from '../../../components/ui/Feedback';
import { useToast } from '../../../components/ui/Toast';
import { fmt, safeHref, shortUrl } from '../../../utils/format';
import { NoAuditState } from '../site/shared';
import { Tip } from './common';
import { ChangesPanel, IntelPanel } from './CompetitorIntel';

const MAX = 5;
const busy = (c) => ['queued', 'running'].includes(c.status);
const pctFmt = (v) => (v === null || v === undefined ? '—' : fmt.pct(v));
/** better: 'high' | 'low' | null (karşılaştırılamaz) */
const ROWS = [
  { key: 'score', label: 'Teknik sağlık puanı', better: 'high', format: fmt.num },
  { key: 'pages', label: 'Taranan sayfa', better: null, format: fmt.num },
  { key: 'avg_words', label: 'Ortalama kelime', better: 'high', format: fmt.num },
  { key: 'median_words', label: 'Medyan kelime', better: 'high', format: fmt.num },
  { key: 'long_pages', label: '1000+ kelimelik sayfa', better: 'high', format: fmt.num },
  { key: 'avg_onpage', label: 'Ort. sayfa içi puan', better: 'high', format: fmt.num },
  { key: 'schema_coverage', label: 'Yapısal veri kapsamı', better: 'high', format: pctFmt },
  { key: 'meta_coverage', label: 'Meta açıklama kapsamı', better: 'high', format: pctFmt },
  { key: 'h1_coverage', label: 'H1 kapsamı', better: 'high', format: pctFmt },
  { key: 'avg_title_len', label: 'Ort. title uzunluğu', better: null, format: fmt.num },
  { key: 'avgLoadMs', label: 'Ort. yanıt süresi', better: 'low', format: fmt.ms },
  { key: 'sitemapUrls', label: 'Site haritasındaki URL', better: null, format: fmt.num },
  { key: 'topics', label: 'Hedeflenen konu (title/H1)', better: 'high', format: fmt.num },
];

function CompareTable({ sites }) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Metrik</th>
            {sites.map((s) => <th key={s.hostname} className="r" style={s.own ? { color: 'var(--primary)' } : undefined}>{s.hostname}{s.own && ' (siz)'}</th>)}
          </tr>
        </thead>
        <tbody>
          {ROWS.map((r) => {
            const vals = sites.map((s) => s[r.key]).filter((v) => v !== null && v !== undefined);
            const best = r.better === 'high' ? Math.max(...vals) : r.better === 'low' ? Math.min(...vals) : null;
            return (
              <tr key={r.key}>
                <td className="text-2">{r.label}</td>
                {sites.map((s) => {
                  const v = s[r.key];
                  const isBest = best !== null && v === best && vals.length > 1;
                  return <td key={s.hostname} className="r num" style={isBest ? { color: 'var(--good-ink)', fontWeight: 600 } : undefined}>{r.format(v)}</td>;
                })}
              </tr>
            );
          })}
          <tr>
            <td className="text-2">Şema türleri</td>
            {sites.map((s) => <td key={s.hostname} className="r" style={{ fontSize: 12 }}>{(s.schema_types || []).join(', ') || '—'}</td>)}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/** Rakip karşılaştırması: rakip siteler kendi tarayıcımızla taranır; teknik/içerik metrikleri ve konu boşlukları. */
export default function CompetitorsView({ domain }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [host, setHost] = useState('');
  const [tab, setTab] = useState('intel');
  const key = ['insights', domain.id, 'competitors'];
  const { data, isLoading, isError, error } = useQuery({
    queryKey: key,
    queryFn: () => insightApi.competitors(domain.id),
    refetchInterval: (q) => (q.state.data?.competitors?.some(busy) ? 4000 : false),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: key });
  const add = useMutation({
    mutationFn: () => insightApi.addCompetitor(domain.id, host.trim()),
    onSuccess: () => {
      toast.success('Rakip eklendi, taranıyor');
      setHost('');
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const recrawl = useMutation({ mutationFn: (cid) => insightApi.recrawlCompetitor(domain.id, cid), onSuccess: refresh, onError: (e) => toast.error(errorMessage(e)) });
  const remove = useMutation({ mutationFn: (cid) => insightApi.removeCompetitor(domain.id, cid), onSuccess: refresh, onError: (e) => toast.error(errorMessage(e)) });

  if (isLoading) return <Skeleton height={320} />;
  if (isError) return <Alert type="error">{errorMessage(error)}</Alert>;
  const list = data.competitors || [];

  return (
    <div className="stack">
      <div className="card">
        <div className="card-head">
          <div>
            <h3 className="row" style={{ gap: 8 }}><Swords size={17} /> Rakipler</h3>
            <p>Rakip siteler robots.txt kurallarına uyularak taranır. Rakibin trafiği değil, içerik ve teknik yapısı karşılaştırılır (ücretsiz).</p>
          </div>
        </div>
        <form
          className="toolbar"
          onSubmit={(e) => {
            e.preventDefault();
            if (host.trim()) add.mutate();
          }}
        >
          <input className="input input-sm" style={{ maxWidth: 320 }} placeholder="rakip.com" value={host} onChange={(e) => setHost(e.target.value)} disabled={list.length >= MAX} aria-label="Rakip alan adı" />
          <button className="btn btn-primary btn-sm" disabled={!host.trim() || add.isPending || list.length >= MAX}>{add.isPending ? <Spinner size={14} /> : <Plus size={15} />} Rakip ekle</button>
          <span className="hint">{list.length}/{MAX}</span>
        </form>
        {list.length > 0 && (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Alan adı</th><th>Durum</th><th className="r">Sayfa</th><th className="r">Puan</th><th className="r">Son tarama</th><th className="r" /></tr></thead>
              <tbody>
                {list.map((c) => (
                  <tr key={c.id}>
                    <td className="cell-main"><a href={`https://${c.hostname}`} target="_blank" rel="noopener noreferrer">{c.hostname}</a></td>
                    <td>
                      {busy(c) ? <span className="row" style={{ gap: 6 }}><Spinner size={13} /> {c.status === 'queued' ? 'Sırada' : 'Taranıyor'}</span>
                        : c.status === 'failed' ? <span className="badge badge-critical" title={c.error || ''}>Başarısız</span>
                          : <span className="badge badge-good">Hazır</span>}
                      {c.status === 'failed' && c.error && <div className="cell-sub truncate" style={{ maxWidth: 260 }}>{c.error}</div>}
                    </td>
                    <td className="r">{fmt.num(c.pages_crawled)}</td>
                    <td className="r">{c.score ?? '—'}</td>
                    <td className="r muted">{fmt.dateTime(c.finished_at)}</td>
                    <td className="r" style={{ whiteSpace: 'nowrap' }}>
                      <button className="btn btn-ghost btn-sm btn-icon" onClick={() => recrawl.mutate(c.id)} disabled={busy(c) || recrawl.isPending} aria-label="Yeniden tara" title="Yeniden tara"><RefreshCw size={14} /></button>
                      <button className="btn btn-ghost btn-sm btn-icon" onClick={() => remove.mutate(c.id)} disabled={remove.isPending} aria-label="Rakibi sil" title="Sil"><Trash2 size={14} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {list.some((c) => c.status === 'completed') && (
        <div className="segmented" role="tablist" aria-label="Rakip görünümü" style={{ alignSelf: 'flex-start' }}>
          {[['intel', 'Öne çıkan bulgular'], ['compare', 'Karşılaştırma ve konu boşlukları'], ['changes', 'Rakip hareketleri']].map(([k, l]) => (
            <button key={k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)} role="tab" aria-selected={tab === k}>{l}</button>
          ))}
        </div>
      )}
      {tab === 'intel' && list.some((c) => c.status === 'completed') ? <IntelPanel domain={domain} />
        : tab === 'changes' && list.length ? <ChangesPanel domain={domain} competitors={list} />
          : data.needsAudit ? <NoAuditState domain={domain} /> : !data.sites.length ? (
        <div className="card">
          <EmptyState icon={Swords} title={list.length ? 'Rakip taraması sürüyor' : 'Henüz rakip yok'}>
            {list.length ? 'Tarama bitince karşılaştırma burada görünecek.' : 'Arama sonuçlarında karşılaştığınız 1–5 rakip ekleyin. İçerik boşlukları ve teknik farklar otomatik çıkarılır.'}
          </EmptyState>
        </div>
      ) : (
        <>
          <div className="card">
            <div className="card-head"><h3>Karşılaştırma</h3></div>
            <Tip>Yeşil değer o metrikte en iyi siteyi gösterir. Taranan sayfa sayısı tarama sınırına bağlıdır; büyük sitelerde örneklemdir.</Tip>
            <div style={{ marginTop: 10 }}><CompareTable sites={data.sites} /></div>
          </div>

          <div className="card">
            <div className="card-head"><h3 className="row" style={{ gap: 8 }}><Target size={17} /> Konu boşlukları</h3><span className="badge badge-neutral">{data.gaps.length}</span></div>
            <Tip>
              Rakiplerin title/H1’de hedeflediği ama sizin hiçbir sayfanızda hedeflemediğiniz konular. “Hiç yok” konular için yeni içerik, “Zayıf” konular
              (metinde geçiyor ama başlıkta değil) için mevcut sayfayı genişletmek veya ayrı sayfa açmak önerilir. Birden çok rakibin hedeflediği konular önceliklidir.
            </Tip>
            <div className="table-wrap" style={{ marginTop: 10, maxHeight: 520, overflowY: 'auto' }}>
              {data.gaps.length ? (
                <table className="table">
                  <thead><tr><th>Konu</th><th>Sizde</th><th className="r">Rakip</th><th>Rakip sayfası</th><th className="r">Kelime</th></tr></thead>
                  <tbody>
                    {data.gaps.map((g) => (
                      <tr key={g.keyword}>
                        <td className="cell-main">{g.keyword}</td>
                        <td>{g.weak ? <span className="badge badge-warning">Zayıf</span> : <span className="badge badge-critical">Hiç yok</span>}</td>
                        <td className="r"><span className={`badge ${g.competitors.length > 1 ? 'badge-good' : 'badge-neutral'}`}>{g.competitors.length}</span></td>
                        <td style={{ maxWidth: 360 }}>
                          <a href={safeHref(g.competitors[0].url)} target="_blank" rel="noopener noreferrer" className="truncate" style={{ display: 'block' }} title={g.competitors[0].url}>{g.competitors[0].hostname}{shortUrl(g.competitors[0].url)}</a>
                          <div className="cell-sub truncate">{g.competitors[0].title}</div>
                        </td>
                        <td className="r">{fmt.num(g.competitors[0].words)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : <EmptyState icon={Target} title="Konu boşluğu yok">Rakiplerin hedeflediği tüm konular sizde de hedefleniyor.</EmptyState>}
            </div>
          </div>

          {data.thinner?.length > 0 && (
            <div className="card">
              <div className="card-head"><h3 className="row" style={{ gap: 8 }}><FileText size={17} /> Rakibin daha kapsamlı olduğu konular</h3><span className="badge badge-neutral">{data.thinner.length}</span></div>
              <Tip>Aynı konuyu hedefleyen sayfalarda rakibin içeriği belirgin şekilde daha uzun. Uzunluk tek başına sıralama faktörü değildir; rakibin kapsadığı alt başlıkları kontrol edin.</Tip>
              <div className="table-wrap" style={{ marginTop: 10 }}>
                <table className="table">
                  <thead><tr><th>Konu</th><th>Sizin sayfanız</th><th className="r">Kelime</th><th>Rakip sayfası</th><th className="r">Kelime</th></tr></thead>
                  <tbody>
                    {data.thinner.map((t) => (
                      <tr key={`${t.keyword}|${t.theirUrl}`}>
                        <td className="cell-main">{t.keyword}</td>
                        <td className="truncate" style={{ maxWidth: 240 }}><a href={safeHref(t.ourUrl)} target="_blank" rel="noopener noreferrer" title={t.ourUrl}>{shortUrl(t.ourUrl)}</a></td>
                        <td className="r num">{fmt.num(t.ourWords)}</td>
                        <td className="truncate" style={{ maxWidth: 260 }}><a href={safeHref(t.theirUrl)} target="_blank" rel="noopener noreferrer" title={t.theirUrl}>{t.competitor}{shortUrl(t.theirUrl)}</a></td>
                        <td className="r num"><strong>{fmt.num(t.theirWords)}</strong></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
