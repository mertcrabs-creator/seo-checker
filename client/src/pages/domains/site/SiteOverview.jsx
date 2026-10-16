import { useQuery } from '@tanstack/react-query';
import { FileText, KeyRound, Link2, ScanSearch } from 'lucide-react';
import { Link } from 'react-router-dom';
import { domainApi } from '../../../api/endpoints';
import HealthSpeedCards from '../../../components/HealthSpeedCards';
import { Skeleton } from '../../../components/ui/Feedback';
import { fmt } from '../../../utils/format';
import { NoAuditState } from './shared';

function Stat({ icon: Icon, label, value, foot }) {
  return (
    <div className="card stat">
      <span className="stat-label"><span className="stat-icon"><Icon size={16} /></span>{label}</span>
      <span className="stat-value num">{value}</span>
      <span className="stat-foot">{foot}</span>
    </div>
  );
}

function Bars({ rows, colorOf }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {rows.map((r) => (
        <div key={r.label} className="row" style={{ flexWrap: 'nowrap', gap: 12 }}>
          <span className="text-2" style={{ width: 150, flex: 'none', fontSize: 13 }}>{r.label}</span>
          <div className="bar-cell" style={{ flex: 1 }}>
            <div className="bar-track">
              <div className="bar-fill" style={{ width: `${(r.value / max) * 100}%`, background: colorOf?.(r) }} />
            </div>
            <strong className="num" style={{ minWidth: 36, textAlign: 'right' }}>{fmt.num(r.value)}</strong>
          </div>
        </div>
      ))}
    </div>
  );
}

const Row = ({ label, value }) => (
  <div className="row" style={{ justifyContent: 'space-between' }}>
    <span className="text-2">{label}</span>
    <strong className="num">{value}</strong>
  </div>
);

/** Search Console olmadan, son taramadan üretilen genel bakış. */
export default function SiteOverview({ domain }) {
  const id = domain.id;
  const { data, isLoading } = useQuery({ queryKey: ['site', id, 'overview'], queryFn: () => domainApi.siteOverview(id) });

  if (isLoading) return <Skeleton height={320} />;
  if (!data?.audit) return <NoAuditState domain={domain} />;

  const { stats, scoreDistribution: dist } = data;
  return (
    <div className="stack">
      <div className="grid grid-4">
        <Stat icon={ScanSearch} label="Sayfa içi SEO puanı" value={stats.avg_onpage ?? '—'} foot={`${fmt.num(dist.good)} sayfa 90+ puanda`} />
        <Stat icon={FileText} label="İndekslenebilir sayfa" value={fmt.num(stats.indexable)} foot={`${fmt.num(stats.total)} sayfa tarandı`} />
        <Stat icon={KeyRound} label="Hedeflenen anahtar kelime" value={fmt.num(stats.targeted_keywords)} foot="Sayfaların ana kelimeleri" />
        <Stat icon={Link2} label="Ort. gelen iç bağlantı" value={fmt.num(stats.avg_inlinks)} foot={`Ort. ${fmt.num(stats.avg_words)} kelime/sayfa`} />
      </div>

      <div className="grid grid-2">
        <div className="card">
          <div className="card-head">
            <div>
              <h3>Hedeflenen anahtar kelimeler</h3>
              <p>Title ve H1’de kullandığınız, içerikte en güçlü işlenen kelimeler</p>
            </div>
            <Link to={`/domains/${id}/keywords`} className="btn btn-ghost btn-sm">Tümünü gör</Link>
          </div>
          <div className="table-wrap" style={{ marginTop: 10 }}>
            <table className="table">
              <thead><tr><th>Anahtar kelime</th><th className="r">Sayfa</th><th className="r">Title’da</th><th className="r">Geçiş</th></tr></thead>
              <tbody>
                {data.topKeywords.map((k) => (
                  <tr key={k.keyword}>
                    <td><div className="cell-main truncate" style={{ maxWidth: 280 }}>{k.keyword}</div></td>
                    <td className="r">{fmt.num(k.pages)}</td>
                    <td className="r">{fmt.num(k.title_pages)}</td>
                    <td className="r">{fmt.num(k.occurrences)}</td>
                  </tr>
                ))}
                {!data.topKeywords.length && <tr><td colSpan={4} className="muted">Hedeflenen kelime bulunamadı</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card card-pad" style={{ display: 'grid', gap: 18, alignContent: 'start' }}>
          <div>
            <h3 style={{ fontSize: 15, marginBottom: 12 }}>Sayfa içi puan dağılımı</h3>
            <Bars
              rows={[
                { label: 'İyi (90+)', value: dist.good, color: 'var(--good)' },
                { label: 'Geliştirilmeli (50–89)', value: dist.average, color: 'var(--warning)' },
                { label: 'Zayıf (<50)', value: dist.poor, color: 'var(--critical)' },
              ]}
              colorOf={(r) => r.color}
            />
          </div>
          {!!data.depth.length && (
            <div>
              <h3 style={{ fontSize: 15, marginBottom: 12 }}>Tık derinliği (ana sayfadan)</h3>
              <Bars rows={data.depth.map((d) => ({ label: d.depth === 0 ? 'Ana sayfa' : `${d.depth} tık`, value: d.pages }))} />
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-3">
        <div className="card card-pad" style={{ display: 'grid', gap: 8, fontSize: 13, alignContent: 'start' }}>
          <h3 style={{ fontSize: 15 }}>İndeksleme</h3>
          <Row label="noindex sayfa" value={fmt.num(stats.noindex)} />
          <Row label="Hatalı (4xx/5xx)" value={fmt.num(stats.errors)} />
          <Row label="Yönlendirme" value={fmt.num(stats.redirects)} />
          <Row label="Site haritasında" value={fmt.num(stats.in_sitemap)} />
          <Row label="Yetersiz içerik (<250 kelime)" value={fmt.num(stats.thin)} />
        </div>
        <div className="card card-pad" style={{ display: 'grid', gap: 10, alignContent: 'start' }}>
          <h3 style={{ fontSize: 15 }}>Yapısal veri</h3>
          <p className="text-2" style={{ fontSize: 13 }}>{fmt.num(stats.with_schema)} sayfada Schema.org işaretlemesi var.</p>
          <div className="row" style={{ gap: 6 }}>
            {data.schemaTypes.map((s) => <span key={s.type} className="badge badge-neutral">{s.type} · {s.pages}</span>)}
            {!data.schemaTypes.length && <span className="muted">Yapısal veri bulunamadı</span>}
          </div>
        </div>
        <div className="card card-pad" style={{ display: 'grid', gap: 10, alignContent: 'start' }}>
          <h3 style={{ fontSize: 15 }}>Marka / şablon terimleri</h3>
          <p className="text-2" style={{ fontSize: 13 }}>Sayfaların çoğunun title’ında tekrar eden terimler. Anahtar kelime analizinde ayrı tutulur.</p>
          <div className="row" style={{ gap: 6 }}>
            {data.templateTerms.map((t) => <span key={t} className="badge badge-notice">{t}</span>)}
            {!data.templateTerms.length && <span className="muted">Tespit edilmedi</span>}
          </div>
        </div>
      </div>

      <HealthSpeedCards domainId={id} />
    </div>
  );
}
