import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, ChevronDown, ChevronRight, CircleCheck, CircleX, Copy, ExternalLink, Info, Sparkles, TriangleAlert, Wand2 } from 'lucide-react';
import { Fragment, useRef, useState } from 'react';
import { errorMessage } from '../../../api/client';
import { insightApi } from '../../../api/endpoints';
import { Alert, Skeleton, Spinner } from '../../../components/ui/Feedback';
import { useToast } from '../../../components/ui/Toast';
import { fmt, safeHref, shortUrl } from '../../../utils/format';
import { Tip } from './common';

const STATUS = {
  found: { label: 'Bulundu', cls: 'badge-good', Icon: CircleCheck },
  verify: { label: 'Kontrol edin', cls: 'badge-warning', Icon: TriangleAlert },
  missing: { label: 'Eksik', cls: 'badge-neutral', Icon: Info },
  missing_required: { label: 'Eksik (önemli)', cls: 'badge-critical', Icon: CircleX },
};
const RICH_TEST = 'https://search.google.com/test/rich-results';
const wrap = (json) => `<script type="application/ld+json">\n${json}\n</script>`;

function Result({ r }) {
  const toast = useToast();
  const code = wrap(r.jsonld);
  const errors = r.validation.flatMap((v) => v.errors.map((e) => ({ type: v.type, msg: e })));
  const warnings = r.validation.flatMap((v) => v.warnings.map((e) => ({ type: v.type, msg: e })));
  const order = { missing_required: 0, verify: 1, missing: 2, found: 3 };
  const fields = [...r.fields].sort((a, b) => order[a.status] - order[b.status]);
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div className="row" style={{ gap: 6 }}>
        <span className="badge badge-notice">{r.sector.label} → {r.sector.type}</span>
        <span className="badge badge-neutral">Sayfa türü: {r.pageType}</span>
        {errors.length ? <span className="badge badge-critical">{errors.length} hata</span> : <span className="badge badge-good"><CircleCheck size={12} /> Zorunlu alanlar tamam</span>}
        {warnings.length > 0 && <span className="badge badge-warning">{warnings.length} önerilen alan eksik</span>}
      </div>
      {(errors.length > 0 || warnings.length > 0) && (
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
          {errors.map((e) => <li key={e.msg} style={{ color: 'var(--critical-ink)' }}>{e.msg}</li>)}
          {warnings.map((e) => <li key={e.msg} className="text-2">{e.msg}</li>)}
        </ul>
      )}
      <div className="grid grid-2" style={{ alignItems: 'start' }}>
        <div style={{ position: 'relative' }}>
          <pre style={{ margin: 0, padding: 12, borderRadius: 10, background: 'var(--surface-2)', border: '1px solid var(--border)', fontSize: 12, overflow: 'auto', maxHeight: 520 }}>{code}</pre>
          <div className="row" style={{ position: 'absolute', top: 8, right: 8, gap: 6 }}>
            <button className="btn btn-secondary btn-sm" onClick={() => navigator.clipboard.writeText(code).then(() => toast.success('Kopyalandı'), () => toast.error('Kopyalanamadı'))}><Copy size={13} /> Kopyala</button>
            <a className="btn btn-secondary btn-sm" href={RICH_TEST} target="_blank" rel="noopener noreferrer" title="Google Zengin Sonuçlar Testi: “Kod” sekmesine yapıştırın"><ExternalLink size={13} /> Test et</a>
          </div>
        </div>
        <div className="table-wrap" style={{ border: '1px solid var(--border)', borderRadius: 10, maxHeight: 520, overflowY: 'auto' }}>
          <table className="table">
            <thead><tr><th>Alan</th><th>Durum</th><th>Kaynak / değer</th></tr></thead>
            <tbody>
              {fields.map((f) => {
                const s = STATUS[f.status];
                return (
                  <tr key={f.path}>
                    <td className="cell-main" style={{ whiteSpace: 'nowrap' }}>{f.label}</td>
                    <td><span className={`badge ${s.cls}`}><s.Icon size={12} /> {s.label}</span></td>
                    <td style={{ fontSize: 12.5 }}>
                      {f.value && <div className="truncate" style={{ maxWidth: 260 }} title={f.value}>{f.value}</div>}
                      <div className="muted">{f.source || (f.status.startsWith('missing') ? 'Sayfada bulunamadı — kendiniz ekleyin' : '')}</div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <Tip>“Kontrol edin” işaretli değerler sayfa metninden çıkarıldı (ör. altbilgideki adres). Yayına almadan önce doğruluğunu kontrol edin. Bulunamayan bilgiler koda eklenmez; uydurma veri Google’ın yapısal veri yönergelerine aykırıdır.</Tip>
      {r.notes.map((n) => <Alert key={n} type="info">{n}</Alert>)}
    </div>
  );
}

/**
 * Şema oluşturucu: sektör tespiti (değiştirilebilir), sayfa türlerine göre şema planı ve
 * seçilen sayfa için canlı veriden doldurulmuş, doğrulanmış JSON-LD.
 */
export default function SchemaBuilder({ domain }) {
  const toast = useToast();
  const qc = useQueryClient();
  const genRef = useRef(null);
  const plan = useQuery({ queryKey: ['insights', domain.id, 'schema-plan'], queryFn: () => insightApi.schemaPlan(domain.id) });
  const [url, setUrl] = useState(`https://${domain.hostname}/`);
  const [pageType, setPageType] = useState('');
  const [openGroup, setOpenGroup] = useState(null);
  const sector = useMutation({
    mutationFn: (businessType) => insightApi.setSector(domain.id, businessType || null),
    onSuccess: () => {
      toast.success('Sektör kaydedildi');
      qc.invalidateQueries({ queryKey: ['insights', domain.id, 'schema-plan'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const gen = useMutation({
    mutationFn: (body) => insightApi.generateSchema(domain.id, body),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const generate = (u = url, t = pageType) => {
    setUrl(u);
    setPageType(t);
    gen.mutate({ url: u, ...(t && { pageType: t }) });
    genRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  if (plan.isLoading) return <Skeleton height={200} />;
  if (plan.isError) return <Alert type="error">{errorMessage(plan.error)}</Alert>;
  if (plan.data.needsAudit) return null;
  const p = plan.data;
  const sec = p.sector;
  const label = (k) => p.sectors.find((s) => s.key === k)?.label || k;

  return (
    <div className="stack">
      <div className="card">
        <div className="card-head">
          <div><h3 className="row" style={{ gap: 8 }}><Building2 size={17} /> Sektör ve şema planı</h3><p>Sektör; sayfa başlıkları, URL’ler, mevcut şema ve Search Console sorgularından tespit edilir.</p></div>
        </div>
        <div className="card-body" style={{ display: 'grid', gap: 12 }}>
          <div className="row" style={{ gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div className="field" style={{ width: 300 }}>
              <label htmlFor="sector">Sektör</label>
              <select id="sector" className="select select-sm" value={sec.override || ''} onChange={(e) => sector.mutate(e.target.value)} disabled={sector.isPending}>
                <option value="">Otomatik: {label(sec.detected)}{sec.confidence ? ` (%${Math.round(sec.confidence * 100)})` : ''}</option>
                {p.sectors.map((s) => <option key={s.key} value={s.key}>{s.label} · {s.type}</option>)}
              </select>
            </div>
            {sec.alternatives.length > 0 && <span className="hint">Diğer adaylar: {sec.alternatives.map((a) => a.label).join(', ')}</span>}
            {sector.isPending && <Spinner size={14} />}
          </div>
          {!sec.override && sec.confidence !== null && sec.confidence < 0.6 && <Alert type="warning">Tespit güveni düşük. Sektörünüzü listeden seçerseniz şemalar ona göre üretilir.</Alert>}
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th style={{ width: 28 }} /><th>Sayfa türü</th><th>Önerilen şema</th><th className="r">Sayfa</th><th className="r">Tam</th><th /></tr></thead>
            <tbody>
              {p.groups.map((g) => (
                <Fragment key={g.type}>
                  <tr className="clickable" onClick={() => setOpenGroup(openGroup === g.type ? null : g.type)} aria-expanded={openGroup === g.type}>
                    <td>{openGroup === g.type ? <ChevronDown size={15} /> : <ChevronRight size={15} />}</td>
                    <td className="cell-main">{g.label}</td>
                    <td><div className="row" style={{ gap: 4 }}>{g.recommend.map((t) => <span key={t} className="badge badge-neutral">{t}</span>)}</div></td>
                    <td className="r num">{fmt.num(g.count)}</td>
                    <td className="r"><span className={`badge ${g.complete === g.count ? 'badge-good' : g.complete ? 'badge-warning' : 'badge-critical'}`}>{g.complete}/{g.count}</span></td>
                    <td className="r"><button className="btn btn-secondary btn-sm" onClick={(e) => { e.stopPropagation(); generate(g.pages[0].url, g.type); }}><Wand2 size={13} /> Örnek üret</button></td>
                  </tr>
                  {openGroup === g.type && (
                    <tr>
                      <td colSpan={6} style={{ background: 'var(--surface-2)' }}>
                        <div className="url-list" style={{ maxHeight: 300, overflowY: 'auto' }}>
                          {g.pages.map((pg) => (
                            <div key={pg.url} style={{ alignItems: 'center' }}>
                              <a href={safeHref(pg.url)} target="_blank" rel="noopener noreferrer" className="truncate" title={pg.url}>{shortUrl(pg.url)}</a>
                              <span className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
                                {pg.missing.length ? pg.missing.map((t) => <span key={t} className="badge badge-critical" style={{ fontSize: 11 }}>{t} yok</span>) : <span className="badge badge-good" style={{ fontSize: 11 }}>Tam</span>}
                                <button className="btn btn-ghost btn-sm" onClick={() => generate(pg.url, g.type)}><Wand2 size={13} /> Oluştur</button>
                              </span>
                            </div>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card" ref={genRef}>
        <div className="card-head"><div><h3 className="row" style={{ gap: 8 }}><Sparkles size={17} /> Şema oluşturucu</h3><p>Sayfa canlı okunur; telefon, adres, harita, saatler, sosyal profiller, fiyat, stok, yazar, tarih ve SSS sayfadan çıkarılır.</p></div></div>
        <form className="card-body" style={{ display: 'grid', gap: 12 }} onSubmit={(e) => { e.preventDefault(); generate(); }}>
          <div className="row" style={{ alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div className="field" style={{ flex: 1, minWidth: 260 }}>
              <label htmlFor="schema-url">Sayfa URL’si</label>
              <input id="schema-url" className="input input-sm" value={url} onChange={(e) => setUrl(e.target.value)} placeholder={`https://${domain.hostname}/...`} />
            </div>
            <div className="field" style={{ width: 220 }}>
              <label htmlFor="schema-type">Sayfa türü</label>
              <select id="schema-type" className="select select-sm" value={pageType} onChange={(e) => setPageType(e.target.value)}>
                <option value="">Otomatik tespit</option>
                {p.pageTypes.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
              </select>
            </div>
            <button className="btn btn-primary btn-sm" disabled={gen.isPending || !/^https?:\/\//i.test(url)}>{gen.isPending ? <Spinner size={14} /> : <Wand2 size={15} />} Şema oluştur</button>
          </div>
          {gen.isPending && <div className="row muted" style={{ gap: 8 }}><Spinner size={14} /> Sayfa ve ana sayfa okunuyor, bilgiler çıkarılıyor…</div>}
          {gen.data && !gen.isPending && <Result r={gen.data} />}
        </form>
      </div>
    </div>
  );
}
