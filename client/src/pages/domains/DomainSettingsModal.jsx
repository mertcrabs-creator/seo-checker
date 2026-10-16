import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { errorMessage } from '../../api/client';
import { domainApi, integrationApi } from '../../api/endpoints';
import { Alert, Modal, Spinner } from '../../components/ui/Feedback';
import { useToast } from '../../components/ui/Toast';

export default function DomainSettingsModal({ domain, onClose }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [property, setProperty] = useState(domain.gsc_property || '');
  const status = useQuery({ queryKey: ['google-status'], queryFn: integrationApi.googleStatus });
  const sites = useQuery({ queryKey: ['google-sites'], queryFn: integrationApi.googleSites, enabled: Boolean(status.data?.connected) });

  const save = useMutation({
    mutationFn: async () => {
      await domainApi.update(domain.id, { gscProperty: property || null });
      if (property && property !== domain.gsc_property) await domainApi.sync(domain.id);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['domain', domain.id] });
      qc.invalidateQueries({ queryKey: ['domains'] });
      toast.success('Ayarlar kaydedildi');
      onClose();
    },
  });

  return (
    <Modal
      title="Alan adı ayarları"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>Vazgeç</button>
          <button className="btn btn-primary" onClick={() => save.mutate()} disabled={save.isPending || property === (domain.gsc_property || '')}>
            {save.isPending ? <Spinner size={16} /> : 'Kaydet'}
          </button>
        </>
      }
    >
      {save.isError && <Alert type="error">{errorMessage(save.error)}</Alert>}
      <div className="field">
        <label htmlFor="gsc">Search Console mülkü</label>
        {!status.data?.connected ? (
          <Alert type="info">Önce <Link to="/settings">Google Search Console hesabınızı bağlayın</Link>.</Alert>
        ) : (
          <select id="gsc" className="select" value={property} onChange={(e) => setProperty(e.target.value)}>
            <option value="">— Bağlantıyı kaldır —</option>
            {(sites.data?.sites || []).map((s) => <option key={s.siteUrl} value={s.siteUrl}>{s.siteUrl}</option>)}
          </select>
        )}
        <span className="hint">Mülk değiştirildiğinde veriler otomatik olarak yeniden senkronize edilir.</span>
      </div>
    </Modal>
  );
}
