import { useQuery } from '@tanstack/react-query';
import { Check, Copy, Link2, Link2Off, MessageSquareQuote, Target, Unlink } from 'lucide-react';
import { useState } from 'react';
import { errorMessage } from '../../../api/client';
import { insightApi } from '../../../api/endpoints';
import { PositionPill } from '../../../components/ui/DataTable';
import { Alert, EmptyState, Skeleton } from '../../../components/ui/Feedback';
import { useToast } from '../../../components/ui/Toast';
import { fmt, safeHref, shortUrl } from '../../../utils/format';
import { NoAuditState } from '../site/shared';
import { PageLink, RecrawlState, Tiles, Tip } from './common';

const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function CopyLink({ url, anchor }) {
  const toast = useToast();
  const [done, setDone] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`<a href="${escapeHtml(url)}">${escapeHtml(anchor)}</a>`);
      setDone(true);
      setTimeout(() => setDone(false), 1500);
    } catch {
      toast.error('Panoya kopyalanamadı');
    }
  };
  return (
    <button className="btn btn-ghost btn-sm" onClick={copy} title="HTML bağlantı kodunu kopyala">
      {done ? <Check size={14} /> : <Copy size={14} />} HTML
    </button>
  );
}

function TargetCard({ t }) {
  return (
    <div className="card">
      <div className="card-head" style={{ alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0 }}>
          <PageLink url={t.url} title={t.title} max={520} />
          <div className="row" style={{ gap: 6, marginTop: 8 }}>
            <span className={`badge ${t.inlinks === 0 ? 'badge-critical' : t.inlinks <= 2 ? 'badge-warning' : 'badge-neutral'}`}>{t.inlinks} iç bağlantı</span>
            {t.position !== null && <span className="row" style={{ gap: 4, fontSize: 12 }}><PositionPill value={t.position} /> <span className="muted">{fmt.num(t.impressions)} gösterim</span></span>}
            {t.striking && <span className="badge badge-good">Vuruş mesafesi</span>}
            {t.genericAnchors > 0 && <span className="badge badge-warning">{t.genericAnchors} jenerik anchor</span>}
          </div>
        </div>
        <div style={{ textAlign: 'right', flex: 'none' }}>
          <div className="hint">Önerilen anchor</div>
          <div className="row" style={{ gap: 4, justifyContent: 'flex-end' }}>
            <strong>“{t.anchor}”</strong>
            <CopyLink url={t.url} anchor={t.anchor} />
          </div>
        </div>
      </div>
      {t.existingAnchors.length > 0 && (
        <p className="text-2" style={{ padding: '8px 20px 0', fontSize: 12.5 }}>
          Mevcut anchor’lar: {t.existingAnchors.map((a) => <span key={a} className="badge badge-neutral" style={{ marginRight: 4 }}>{a}</span>)}
        </p>
      )}
      <div className="table-wrap" style={{ marginTop: 10 }}>
        <table className="table">
          <thead><tr><th>Bağlantı verecek sayfa</th><th>Ortak konular</th><th className="r">Kaynak gücü</th><th className="r">Not</th></tr></thead>
          <tbody>
            {t.suggestions.map((s) => (
              <tr key={s.source}>
                <td><PageLink url={s.source} title={s.sourceTitle} max={340} /></td>
                <td><div className="row" style={{ gap: 4 }}>{s.sharedTerms.map((k) => <span key={k} className="badge badge-neutral">{k}</span>)}</div></td>
                <td className="r num">{fmt.num(s.sourceInlinks)} iç bağ.</td>
                <td className="r">{s.mentionsAnchor ? <span className="badge badge-good" title="Önerilen ifade bu sayfanın metninde zaten geçiyor; o ifadeyi bağlantıya çevirmeniz yeterli">Metinde geçiyor</span> : <span className="muted">Cümle ekleyin</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** İç link önerileri: desteğe ihtiyacı olan sayfalar için konusu örtüşen kaynak sayfalar ve anchor metni. */
export default function LinksView({ domain }) {
  const { data, isLoading, isError, error } = useQuery({ queryKey: ['insights', domain.id, 'links'], queryFn: () => insightApi.links(domain.id) });
  if (isLoading) return <Skeleton height={320} />;
  if (isError) return <Alert type="error">{errorMessage(error)}</Alert>;
  if (data.needsAudit) return <NoAuditState domain={domain} />;
  if (data.needsRecrawl) return <RecrawlState domain={domain} />;

  const s = data.summary;
  return (
    <div className="stack">
      <Tiles items={[
        { label: 'Desteklenecek sayfa', value: fmt.num(s.targets), icon: Target, foot: `${fmt.num(s.striking)} tanesi 4–20. sırada` },
        { label: 'Bağlantı önerisi', value: fmt.num(s.suggestions), icon: Link2, tone: 'good', foot: 'konusu örtüşen kaynaklardan' },
        { label: 'Hiç bağlantı almayan', value: fmt.num(s.orphans), icon: Unlink, tone: s.orphans ? 'critical' : undefined, foot: 'öneri listesindeki' },
        { label: 'Jenerik anchor', value: fmt.num(s.genericAnchors), icon: Link2Off, tone: s.genericAnchors ? 'warning' : undefined, foot: `${fmt.num(s.edges)} iç bağlantı içinde` },
      ]} />
      <Tip>
        Hedefler: az iç bağlantı alan veya Search Console’da 4–20. sırada olan sayfalar. Kaynaklar aynı konuyu işleyen, henüz bağlantı vermeyen ve
        kendisi güçlü (çok iç bağlantı alan) sayfalardır. Anchor olarak sayfanın en çok gösterim alan marka dışı sorgusu önerilir; bağlantıyı menü/alt
        bilgi yerine metnin içine, doğal bir cümleyle ekleyin.
      </Tip>
      {data.genericSamples?.length > 0 && (
        <div className="card">
          <div className="card-head"><h3 className="row" style={{ gap: 8 }}><MessageSquareQuote size={17} /> Jenerik anchor örnekleri</h3></div>
          <Tip>“Tıklayın”, “devamı”, “detaylı bilgi” gibi metinler hedef sayfanın konusunu anlatmaz. Bunları hedef sayfanın anahtar kelimesiyle değiştirin.</Tip>
          <div className="table-wrap" style={{ marginTop: 10 }}>
            <table className="table">
              <thead><tr><th>Anchor</th><th>Bulunduğu sayfa</th><th>Hedef</th></tr></thead>
              <tbody>
                {data.genericSamples.map((g) => (
                  <tr key={`${g.anchor}|${g.source}`}>
                    <td className="cell-main">“{g.anchor}”</td>
                    <td className="truncate" style={{ maxWidth: 260 }}><a href={safeHref(g.source)} target="_blank" rel="noopener noreferrer">{shortUrl(g.source)}</a></td>
                    <td className="truncate" style={{ maxWidth: 260 }}><a href={safeHref(g.target)} target="_blank" rel="noopener noreferrer">{shortUrl(g.target)}</a></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {data.targets.length ? data.targets.map((t) => <TargetCard key={t.url} t={t} />) : (
        <div className="card"><EmptyState icon={Link2} title="Öneri yok">Önemli sayfalarınız yeterince iç bağlantı alıyor ya da konusu örtüşen kaynak sayfa bulunamadı.</EmptyState></div>
      )}
    </div>
  );
}
