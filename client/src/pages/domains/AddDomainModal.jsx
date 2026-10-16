import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Globe } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { errorMessage } from '../../api/client';
import { domainApi, integrationApi } from '../../api/endpoints';
import { Alert, Modal, Spinner } from '../../components/ui/Feedback';
import { useToast } from '../../components/ui/Toast';

const hostOf = (v) => {
  try {
    return new URL(/^[a-z]+:\/\//i.test(v) ? v : `https://${v}`).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};
const propertyHost = (p) => (p.startsWith('sc-domain:') ? p.slice(10) : hostOf(p));

export default function AddDomainModal({ onClose }) {
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const [hostname, setHostname] = useState('');
  const [property, setProperty] = useState('');
  const [touched, setTouched] = useState(false);

  const status = useQuery({ queryKey: ['google-status'], queryFn: integrationApi.googleStatus });
  const sites = useQuery({
    queryKey: ['google-sites'],
    queryFn: integrationApi.googleSites,
    enabled: Boolean(status.data?.connected),
  });

  // Alan adına uyan Search Console mülkünü otomatik seç (domain property öncelikli)
  const host = hostOf(hostname);
  const matches = useMemo(
    () => (sites.data?.sites || []).filter((s) => host && propertyHost(s.siteUrl).replace(/^www\./, '') === host),
    [sites.data, host],
  );
  useEffect(() => {
    if (touched) return;
    const best = matches.find((m) => m.siteUrl.startsWith('sc-domain:')) || matches[0];
    setProperty(best?.siteUrl || '');
  }, [matches, touched]);

  const create = useMutation({
    mutationFn: domainApi.create,
    onSuccess: ({ domain }) => {
      qc.invalidateQueries({ queryKey: ['domains'] });
      toast.success(`${domain.hostname} eklendi`);
      onClose();
      navigate(`/domains/${domain.id}`);
    },
  });

  return (
    <Modal
      title="Alan adı ekle"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>Vazgeç</button>
          <button
            className="btn btn-primary"
            disabled={!host || create.isPending}
            onClick={() => create.mutate({ hostname, gscProperty: property || null })}
          >
            {create.isPending ? <Spinner size={16} /> : 'Ekle ve analiz et'}
          </button>
        </>
      }
    >
      {create.isError && <Alert type="error">{errorMessage(create.error)}</Alert>}
      <div className="field">
        <label htmlFor="host">Alan adı</label>
        <div className="input-icon">
          <Globe size={16} />
          <input
            id="host" className="input" placeholder="ornek.com" value={hostname} maxLength={300} autoFocus
            onChange={(e) => setHostname(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && host && create.mutate({ hostname, gscProperty: property || null })}
          />
        </div>
        <span className="hint">Protokol ve yol otomatik temizlenir. Türkçe karakterli alan adları desteklenir.</span>
      </div>

      <div className="field">
        <label htmlFor="prop">Search Console mülkü</label>
        {status.isLoading ? (
          <div className="hint">Kontrol ediliyor…</div>
        ) : !status.data?.connected ? (
          <Alert type="info">
            Site analizi, anahtar kelime profili, site sağlığı ve hız raporu bağlantı olmadan otomatik hazırlanır.
            Google’daki gerçek tıklama/gösterim verisi için isteğe bağlı olarak <Link to="/settings">Search Console bağlayabilirsiniz</Link>.
          </Alert>
        ) : (
          <>
            <select
              id="prop" className="select" value={property}
              onChange={(e) => {
                setTouched(true);
                setProperty(e.target.value);
              }}
            >
              <option value="">— Mülk seçme (sadece site analizi) —</option>
              {(sites.data?.sites || []).map((s) => (
                <option key={s.siteUrl} value={s.siteUrl}>{s.siteUrl}</option>
              ))}
            </select>
            {sites.isError && <span className="field-error">{errorMessage(sites.error)}</span>}
            {host && !matches.length && sites.isSuccess && (
              <span className="hint">Bu alan adı için Search Console hesabınızda doğrulanmış bir mülk bulunamadı.</span>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
