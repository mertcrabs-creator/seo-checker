import { useQuery } from '@tanstack/react-query';
import { Bot, ChevronDown, ChevronRight, CircleCheck, CircleX, Copy, Download, FileText, RefreshCw, ShieldAlert, Sparkles, TriangleAlert } from 'lucide-react';
import { Fragment, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { errorMessage } from '../../../api/client';
import { insightApi } from '../../../api/endpoints';
import { Alert, EmptyState, ScoreRing, Skeleton, Spinner } from '../../../components/ui/Feedback';
import { useToast } from '../../../components/ui/Toast';
import { fmt, safeHref, shortUrl } from '../../../utils/format';
import { NoAuditState } from '../site/shared';
import { PageLink, RecrawlState, Tip } from './common';

const PRIORITY = {
  high: { label: 'Yüksek', cls: 'badge-critical' },
  medium: { label: 'Orta', cls: 'badge-warning' },
  low: { label: 'Düşük', cls: 'badge-neutral' },
};
const CATEGORY = { access: 'Erişim', structure: 'İçerik yapısı', trust: 'Güven', entity: 'Marka varlığı', visibility: 'AI görünürlüğü' };
const PURPOSE = {
  search: { label: 'Arama / yanıt', cls: 'badge-notice', tip: 'Yapay zekâ yanıtlarında kaynak gösterilmek için erişim gerekli' },
  user: { label: 'Kullanıcı isteği', cls: 'badge-notice', tip: 'Kullanıcı sohbette sayfanızı paylaşınca/istediğinde okur' },
  training: { label: 'Model eğitimi', cls: 'badge-neutral', tip: 'İzin vermek tercihtir; aramada görünürlüğü doğrudan etkilemez' },
};
const MISSING = {
  js_rendered: 'İçerik JS ile oluşuyor',
  question_headings: 'Soru başlığı yok',
  direct_answers: 'Başlık altında net yanıt yok',
  intro_answer: 'Özet giriş yok',
  lists_tables: 'Liste/tablo yok',
  stats: 'Veri/istatistik yok',
  citations: 'Kaynak yok',
  author: 'Yazar yok',
  freshness: 'Güncel değil',
  schema: 'Şema yok',
  summary: 'Özet bölümü yok',
  long_paragraphs: 'Uzun paragraf',
};
const scoreCls = (s) => (s === null || s === undefined ? 'badge-neutral' : s >= 70 ? 'badge-good' : s >= 45 ? 'badge-warning' : 'badge-critical');

function CodeBox({ code, filename }) {
  const toast = useToast();
  const download = () => {
    const url = URL.createObjectURL(new Blob([code], { type: 'text/plain;charset=utf-8' }));
    Object.assign(document.createElement('a'), { href: url, download: filename }).click();
    URL.revokeObjectURL(url);
  };
  return (
    <div style={{ position: 'relative' }}>
      <pre style={{ margin: 0, padding: 12, borderRadius: 10, background: 'var(--surface-2)', border: '1px solid var(--border)', fontSize: 12, overflow: 'auto', maxHeight: 320, whiteSpace: 'pre-wrap' }}>{code}</pre>
      <div className="row" style={{ position: 'absolute', top: 8, right: 8, gap: 6 }}>
        <button className="btn btn-secondary btn-sm" onClick={() => navigator.clipboard.writeText(code).then(() => toast.success('Kopyalandı'), () => toast.error('Kopyalanamadı'))}><Copy size={13} /> Kopyala</button>
        {filename && <button className="btn btn-secondary btn-sm" onClick={download}><Download size={13} /> İndir</button>}
      </div>
    </div>
  );
}

function Recommendation({ r, open, onToggle, llms }) {
  const [, setParams] = useSearchParams();
  return (
    <div className="issue">
      <button className="issue-head" onClick={onToggle} aria-expanded={open}>
        {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        <span className={`badge ${PRIORITY[r.priority].cls}`}>{PRIORITY[r.priority].label}</span>
        <span className="issue-title">{r.title}</span>
        <span className="badge badge-neutral">{CATEGORY[r.category]}</span>
      </button>
      {open && (
        <div className="issue-body" style={{ display: 'grid', gap: 10 }}>
          <p className="text-2" style={{ fontSize: 13, whiteSpace: 'pre-line' }}>{r.detail}</p>
          {r.steps?.length > 0 && (
            <div className="issue-fix">
              <Sparkles size={16} />
              <ol style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 4 }}>{r.steps.map((s) => <li key={s}>{s}</li>)}</ol>
            </div>
          )}
          {r.code && <CodeBox code={r.code} />}
          {r.generated === 'llms' && llms && <><div className="hint">Taramanızdan üretilen llms.txt taslağı:</div><CodeBox code={llms} filename="llms.txt" /></>}
          {r.keywords?.length > 0 && (
            <div className="table-wrap" style={{ border: '1px solid var(--border)', borderRadius: 10, maxHeight: 260, overflowY: 'auto' }}>
              <table className="table">
                <thead><tr><th>Kelime</th><th>AI Overview kaynakları</th></tr></thead>
                <tbody>{r.keywords.map((k) => <tr key={`${k.keyword}${k.country}`}><td className="cell-main">{k.keyword}</td><td className="muted" style={{ fontSize: 12 }}>{k.sources.join(', ') || '—'}</td></tr>)}</tbody>
              </table>
            </div>
          )}
          {r.pages?.length > 0 && (
            <div className="url-list">
              {r.pages.map((p) => (
                <div key={p.url}>
                  <a href={safeHref(p.url)} target="_blank" rel="noopener noreferrer" className="truncate" title={p.url}>{shortUrl(p.url)}</a>
                  <span className="muted truncate" style={{ maxWidth: 280 }}>{p.title}</span>
                </div>
              ))}
            </div>
          )}
          {r.link && <div><button className="btn btn-secondary btn-sm" onClick={() => setParams({ view: r.link }, { replace: true })}>İlgili araca git</button></div>}
        </div>
      )}
    </div>
  );
}

function BotTable({ robots, cdn }) {
  const ua = new Map(cdn.tests.map((t) => [t.agent, t]));
  return (
    <div className="card">
      <div className="card-head">
        <div><h3 className="row" style={{ gap: 8 }}><Bot size={17} /> Yapay zekâ botlarının erişimi</h3><p>robots.txt kuralları ve gerçek bot User-Agent’ıyla canlı istek (CDN/WAF engeli)</p></div>
        {!robots.found && <span className="badge badge-warning">robots.txt yok</span>}
      </div>
      {cdn.inconclusive && <div style={{ padding: '10px 20px 0' }}><Alert type="info">Sunucu, tarayıcı isteğimizi de reddetti (HTTP {cdn.baseStatus ?? 'hata'}); CDN testi bu site için sonuç vermedi.</Alert></div>}
      <div className="table-wrap" style={{ marginTop: 10 }}>
        <table className="table">
          <thead><tr><th>Bot</th><th>Ürün</th><th>Amaç</th><th className="r">robots.txt</th><th className="r">Canlı test</th></tr></thead>
          <tbody>
            {robots.bots.map((b) => {
              const t = ua.get(b.agent);
              return (
                <tr key={b.agent}>
                  <td><div className="cell-main">{b.agent}</div><div className="cell-sub">{b.company}</div></td>
                  <td className="text-2" style={{ fontSize: 12.5 }}>{b.product}</td>
                  <td><span className={`badge ${PURPOSE[b.purpose].cls}`} title={PURPOSE[b.purpose].tip}>{PURPOSE[b.purpose].label}</span></td>
                  <td className="r">
                    {!b.allowed ? <span className="badge badge-critical" title={b.explicit ? 'Bu bot için özel kural' : 'Genel (*) kural'}>Engelli</span>
                      : b.blockedPages ? <span className="badge badge-warning" title="Önemli sayfalardan bazıları engelli">{b.blockedPages}/{b.sampled} sayfa engelli</span>
                        : <span className="badge badge-good">İzinli</span>}
                  </td>
                  <td className="r">
                    {!t ? <span className="muted">—</span> : t.inconclusive ? <span className="muted">Belirsiz</span>
                      : t.blocked ? <span className="badge badge-critical" title={t.reason}>{t.reason}</span> : <span className="badge badge-good">HTTP {t.status}</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Tip>Eğitim botlarını engellemek bir tercihtir. Arama ve kullanıcı isteği botlarını engellemek ise ChatGPT, Perplexity, Claude ve Copilot yanıtlarında kaynak gösterilmenizi engeller.</Tip>
      <div style={{ height: 14 }} />
    </div>
  );
}

function PagesTable({ pages }) {
  const [open, setOpen] = useState(null);
  const [filter, setFilter] = useState('');
  const counts = useMemo(() => {
    const c = {};
    for (const p of pages) for (const m of p.missing) c[m] = (c[m] || 0) + 1;
    return Object.entries(c).sort((a, b) => b[1] - a[1]);
  }, [pages]);
  const list = filter ? pages.filter((p) => p.missing.includes(filter)) : pages;
  return (
    <div className="card">
      <div className="card-head">
        <div><h3>Sayfa bazında GEO hazırlığı</h3><p>En düşük puanlı içerik sayfaları önce · 150+ kelime</p></div>
        <select className="select select-sm" style={{ width: 230 }} value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Eksiğe göre filtrele">
          <option value="">Tüm eksikler ({pages.length})</option>
          {counts.map(([k, n]) => <option key={k} value={k}>{MISSING[k] || k} ({n})</option>)}
        </select>
      </div>
      <div className="table-wrap" style={{ marginTop: 10, maxHeight: 560, overflowY: 'auto' }}>
        <table className="table">
          <thead><tr><th style={{ width: 28 }} /><th>Sayfa</th><th className="r">Puan</th><th>Eksikler</th><th className="r">Kelime</th></tr></thead>
          <tbody>
            {list.slice(0, 200).map((p) => (
              <Fragment key={p.url}>
                <tr className="clickable" onClick={() => setOpen(open === p.url ? null : p.url)} aria-expanded={open === p.url}>
                  <td>{open === p.url ? <ChevronDown size={15} /> : <ChevronRight size={15} />}</td>
                  <td><PageLink url={p.url} title={p.title} max={360} /></td>
                  <td className="r"><span className={`badge ${scoreCls(p.score)}`}>{p.score}</span></td>
                  <td><div className="row" style={{ gap: 4 }}>{p.missing.slice(0, 4).map((m) => <span key={m} className="badge badge-neutral" style={{ fontSize: 11 }}>{MISSING[m] || m}</span>)}{p.missing.length > 4 && <span className="muted" style={{ fontSize: 12 }}>+{p.missing.length - 4}</span>}</div></td>
                  <td className="r num">{fmt.num(p.words)}</td>
                </tr>
                {open === p.url && (
                  <tr>
                    <td colSpan={5} style={{ background: 'var(--surface-2)' }}>
                      <div className="grid grid-4" style={{ padding: '4px 4px 8px' }}>
                        <div className="metric-tile"><small>Başlık (H2/H3)</small><strong className="num">{p.geo.headings}</strong><small>{p.geo.questions} soru biçiminde</small></div>
                        <div className="metric-tile"><small>Net yanıtlı başlık</small><strong className="num">{p.geo.answered}</strong><small>15–90 kelimelik ilk paragraf</small></div>
                        <div className="metric-tile"><small>Liste / tablo</small><strong className="num">{p.geo.lists} / {p.geo.tables}</strong><small>{p.geo.stats} sayısal veri</small></div>
                        <div className="metric-tile"><small>Kaynak / yazar</small><strong className="num">{p.geo.citations} / {p.geo.author ? 'var' : 'yok'}</strong><small>{p.modifiedAt ? `güncelleme ${fmt.dateShort(p.modifiedAt)}` : 'tarih yok'}</small></div>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
        {!list.length && <EmptyState icon={CircleCheck} title="Bu eksik hiçbir sayfada yok" />}
      </div>
    </div>
  );
}

/**
 * GEO (Generative Engine Optimization): sitenin ChatGPT, Perplexity, Claude, Google AI Overview / AI Mode
 * yanıtlarında kaynak gösterilmeye hazırlığı ve öncelikli geliştirme önerileri.
 */
export default function GeoView({ domain }) {
  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['insights', domain.id, 'geo'], queryFn: () => insightApi.geo(domain.id), staleTime: 10 * 60_000,
  });
  const [open, setOpen] = useState(0);
  const [cat, setCat] = useState('');
  if (isLoading) return <div className="card"><EmptyState icon={Bot} title="GEO analizi hazırlanıyor"><span className="row" style={{ gap: 8, justifyContent: 'center' }}><Spinner size={14} /> robots.txt, AI botu erişimi, llms.txt ve sayfa yapısı kontrol ediliyor…</span></EmptyState></div>;
  if (isError) return <Alert type="error">{errorMessage(error)}</Alert>;
  if (data.needsAudit) return <NoAuditState domain={domain} />;
  if (data.needsRecrawl) return <RecrawlState domain={domain} title="GEO sinyalleri için yeni tarama gerekli">GEO analizi, tarayıcının yeni topladığı sayfa yapısı sinyallerini (soru başlıkları, kısa yanıtlar, liste/tablo, yazar, kaynak) kullanır. Bir kez yeniden tarama yeterlidir.</RecrawlState>;

  const recs = cat ? data.recommendations.filter((r) => r.category === cat) : data.recommendations;
  const s = data.summary;
  return (
    <div className="stack">
      <div className="card card-pad" style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 24, alignItems: 'center' }}>
        <ScoreRing score={data.overall} label="GEO puanı" />
        <div style={{ display: 'grid', gap: 10 }}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <div>
              <h2 style={{ fontSize: 18 }}>Yapay zekâ aramalarına hazırlık</h2>
              <p className="text-2" style={{ fontSize: 13 }}>Google AI Overview / AI Mode, ChatGPT, Perplexity, Claude ve Copilot yanıtlarında kaynak gösterilme olasılığı.</p>
            </div>
            <button className="btn btn-secondary btn-sm" onClick={() => refetch()} disabled={isFetching}>{isFetching ? <Spinner size={14} /> : <RefreshCw size={14} />} Yenile</button>
          </div>
          <div className="grid grid-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' }}>
            {data.axes.map((a) => (
              <button key={a.key} className="metric-tile" style={{ textAlign: 'left', cursor: 'pointer', outline: cat === a.key ? '2px solid var(--accent, var(--chart-1))' : undefined }} title={a.tip} onClick={() => setCat(cat === a.key ? '' : a.key)}>
                <small>{a.label} · %{a.weight}</small>
                <strong className="num">{a.score ?? '—'}</strong>
                <small>{a.score === null ? 'veri yok' : a.score >= 70 ? 'iyi' : a.score >= 45 ? 'geliştirilebilir' : 'zayıf'}</small>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-4">
        <div className="card stat"><span className="stat-label">İçerik sayfası</span><span className="stat-value num">{fmt.num(s.contentPages)}</span><span className="stat-foot">ortalama sayfa puanı {s.avgScore ?? '—'}</span></div>
        <div className="card stat"><span className="stat-label">Soru başlıklı sayfa</span><span className="stat-value num">{fmt.pct(s.questionShare)}</span><span className="stat-foot">içerik sayfalarının</span></div>
        <div className="card stat"><span className="stat-label">Yazar bilgisi</span><span className="stat-value num">{fmt.pct(s.authorShare)}</span><span className="stat-foot">son 1 yılda güncel: {fmt.pct(s.freshShare)}</span></div>
        <div className="card stat"><span className="stat-label">AI Overview atfı</span><span className="stat-value num">{data.aio.withAio ? `${data.aio.cited}/${data.aio.withAio}` : '—'}</span><span className="stat-foot">{data.aio.tracked ? `${data.aio.tracked} takip edilen kelime` : 'SERP takibi yok'}</span></div>
      </div>

      <div className="card">
        <div className="card-head">
          <div><h3 className="row" style={{ gap: 8 }}><Sparkles size={17} /> Geliştirme önerileri</h3><p>Öncelik sırasına göre · {cat ? `${CATEGORY[cat]} filtresi` : 'tümü'}</p></div>
          <div className="row" style={{ gap: 6 }}>
            {['high', 'medium', 'low'].map((p) => <span key={p} className={`badge ${PRIORITY[p].cls}`}>{data.recommendations.filter((r) => r.priority === p).length} {PRIORITY[p].label.toLowerCase()}</span>)}
            {cat && <button className="btn btn-ghost btn-sm" onClick={() => setCat('')}>Filtreyi kaldır</button>}
          </div>
        </div>
        <div style={{ marginTop: 10 }}>
          {recs.length ? recs.map((r, i) => <Recommendation key={r.id} r={r} open={open === i} onToggle={() => setOpen(open === i ? null : i)} llms={data.llms.generated} />)
            : <EmptyState icon={CircleCheck} title="Bu alanda öneri yok" />}
        </div>
      </div>

      <BotTable robots={data.robots} cdn={data.cdn} />

      <div className="grid grid-2">
        <div className="card">
          <div className="card-head"><h3 className="row" style={{ gap: 8 }}><FileText size={17} /> llms.txt</h3>{data.llms.main.found ? <span className="badge badge-good">Var</span> : <span className="badge badge-warning">Yok</span>}</div>
          <div className="card-body" style={{ display: 'grid', gap: 10 }}>
            {data.llms.main.found ? (
              <div className="row" style={{ gap: 6 }}>
                <span className={`badge ${data.llms.main.hasTitle ? 'badge-good' : 'badge-warning'}`}>{data.llms.main.hasTitle ? <CircleCheck size={12} /> : <CircleX size={12} />} Başlık</span>
                <span className={`badge ${data.llms.main.hasSummary ? 'badge-good' : 'badge-neutral'}`}>Özet</span>
                <span className="badge badge-neutral">{data.llms.main.sections} bölüm</span>
                <span className="badge badge-neutral">{data.llms.main.links} bağlantı</span>
                <span className={`badge ${data.llms.full.found ? 'badge-good' : 'badge-neutral'}`}>llms-full.txt {data.llms.full.found ? 'var' : 'yok'}</span>
              </div>
            ) : <p className="text-2" style={{ fontSize: 13 }}>Taramadan üretilen taslak: en çok iç bağlantı alan sayfalar, URL bölümlerine göre gruplanmıştır.</p>}
            <CodeBox code={data.llms.generated} filename="llms.txt" />
          </div>
        </div>
        <div className="card">
          <div className="card-head"><h3 className="row" style={{ gap: 8 }}><ShieldAlert size={17} /> Marka varlığı (entity)</h3></div>
          <div className="card-body" style={{ display: 'grid', gap: 10, fontSize: 13.5 }}>
            <div className="row" style={{ gap: 6 }}>
              <span className={`badge ${data.entity.orgType ? 'badge-good' : 'badge-critical'}`}>{data.entity.orgType || 'Kuruluş şeması yok'}</span>
              <span className={`badge ${data.entity.website ? 'badge-good' : 'badge-neutral'}`}>WebSite {data.entity.website ? 'var' : 'yok'}</span>
              <span className={`badge ${data.entity.aboutPage ? 'badge-good' : 'badge-warning'}`}>Hakkımızda {data.entity.aboutPage ? 'var' : 'yok'}</span>
              <span className={`badge ${data.entity.contactPage ? 'badge-good' : 'badge-warning'}`}>İletişim {data.entity.contactPage ? 'var' : 'yok'}</span>
            </div>
            <div><strong>sameAs ({data.entity.sameAs.length}):</strong> {data.entity.sameAs.length ? data.entity.sameAs.map((u) => <a key={u} href={safeHref(u)} target="_blank" rel="noopener noreferrer" className="badge badge-neutral" style={{ marginRight: 4 }}>{shortUrl(u)}</a>) : <span className="muted">yok</span>}</div>
            {data.entity.profileLinks.filter((u) => !data.entity.sameAs.includes(u)).length > 0 && (
              <div className="hint">Sayfada bulunup sameAs’e eklenmemiş profiller: {data.entity.profileLinks.filter((u) => !data.entity.sameAs.includes(u)).map(shortUrl).join(', ')}</div>
            )}
            {data.aio.topSources.length > 0 && (
              <div>
                <strong className="row" style={{ gap: 6 }}><TriangleAlert size={14} /> AI Overview’da en çok alıntılananlar</strong>
                <div className="row" style={{ gap: 4, marginTop: 6 }}>{data.aio.topSources.map((x) => <span key={x.domain} className="badge badge-neutral">{x.domain} · {x.count}</span>)}</div>
              </div>
            )}
          </div>
        </div>
      </div>

      <PagesTable pages={data.pages} />
      <p className="hint">Kontrol zamanı: {fmt.dateTime(data.generatedAt)} · Sayfa sinyalleri son site taramasından, bot erişimi ve llms.txt canlı olarak alınır.</p>
    </div>
  );
}
