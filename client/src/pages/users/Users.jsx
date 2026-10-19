import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, KeyRound, Pencil, Plus, RefreshCw, Trash2, UserPlus, Users as UsersIcon } from 'lucide-react';
import { useState } from 'react';
import { errorMessage } from '../../api/client';
import { adminApi } from '../../api/endpoints';
import { Alert, EmptyState, Modal, Skeleton, Spinner } from '../../components/ui/Feedback';
import { useToast } from '../../components/ui/Toast';
import { useAuth } from '../../context/AuthContext';
import { fmt } from '../../utils/format';

// Karışan karakterler (0/O, 1/l/I) olmadan; sunucu kuralı: 10+ karakter, büyük + küçük harf + rakam
const CHARS = { lower: 'abcdefghjkmnpqrstuvwxyz', upper: 'ABCDEFGHJKMNPQRSTUVWXYZ', digit: '23456789' };
function generatePassword(len = 14) {
  const all = CHARS.lower + CHARS.upper + CHARS.digit;
  const rnd = (set) => set[crypto.getRandomValues(new Uint32Array(1))[0] % set.length];
  const out = [rnd(CHARS.lower), rnd(CHARS.upper), rnd(CHARS.digit), ...Array.from({ length: len - 3 }, () => rnd(all))];
  for (let i = out.length - 1; i > 0; i--) {
    const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out.join('');
}
const strong = (p) => p.length >= 10 && /[a-zçğıöşü]/.test(p) && /[A-ZÇĞİÖŞÜ]/.test(p) && /\d/.test(p);
const validUsername = (u) => /^[a-z0-9._-]{3,40}$/.test(u) || /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(u);
const loginText = (username, password) => `Panel: ${window.location.origin}/login\nKullanıcı adı: ${username}\nŞifre: ${password}`;

function UserForm({ initial, domains, onClose }) {
  const toast = useToast();
  const qc = useQueryClient();
  const editing = Boolean(initial);
  const [form, setForm] = useState({
    name: initial?.name || '',
    username: initial?.username || '',
    password: editing ? '' : generatePassword(),
    domainIds: initial?.domains.map((d) => d.id) || [],
  });
  const [created, setCreated] = useState(null);
  const set = (k) => (e) => setForm({ ...form, [k]: k === 'username' ? e.target.value.toLowerCase().trim() : e.target.value });
  const toggle = (domainId) => setForm({ ...form, domainIds: form.domainIds.includes(domainId) ? form.domainIds.filter((x) => x !== domainId) : [...form.domainIds, domainId] });
  const save = useMutation({
    mutationFn: () => {
      const body = { name: form.name.trim(), username: form.username, domainIds: form.domainIds, ...(form.password && { password: form.password }) };
      return editing ? adminApi.updateUser(initial.id, body) : adminApi.createUser(body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-users'] });
      if (form.password) setCreated({ username: form.username, password: form.password });
      else {
        toast.success('Kullanıcı güncellendi');
        onClose();
      }
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const copy = (text) => navigator.clipboard.writeText(text).then(() => toast.success('Kopyalandı'), () => toast.error('Kopyalanamadı'));
  const valid = form.name.trim().length >= 2 && validUsername(form.username) && (editing ? !form.password || strong(form.password) : strong(form.password));

  if (created) {
    return (
      <Modal title={editing ? 'Şifre güncellendi' : 'Kullanıcı oluşturuldu'} onClose={onClose} width={520}
        footer={<><button className="btn btn-secondary" onClick={() => copy(loginText(created.username, created.password))}><Copy size={15} /> Giriş bilgilerini kopyala</button><button className="btn btn-primary" onClick={onClose}>Tamam</button></>}>
        <div style={{ display: 'grid', gap: 12 }}>
          <Alert type="success">Giriş bilgilerini kullanıcıya iletin. Şifre güvenlik nedeniyle bir daha gösterilmez; unutulursa “Düzenle”den yeni şifre belirleyebilirsiniz.</Alert>
          <pre style={{ margin: 0, padding: 14, borderRadius: 10, background: 'var(--surface-2)', border: '1px solid var(--border)', fontSize: 13.5, whiteSpace: 'pre-wrap' }}>{loginText(created.username, created.password)}</pre>
          {editing && <p className="hint">Kullanıcının açık oturumları kapatıldı; yeni şifreyle tekrar giriş yapması gerekir.</p>}
        </div>
      </Modal>
    );
  }

  return (
    <Modal title={editing ? `Düzenle: ${initial.name}` : 'Yeni kullanıcı'} onClose={onClose} width={560}
      footer={<><button className="btn btn-ghost" onClick={onClose}>Vazgeç</button><button className="btn btn-primary" disabled={!valid || save.isPending} onClick={() => save.mutate()}>{save.isPending ? <Spinner size={15} /> : editing ? 'Kaydet' : <><UserPlus size={15} /> Oluştur</>}</button></>}>
      <form style={{ display: 'grid', gap: 14 }} onSubmit={(e) => { e.preventDefault(); if (valid) save.mutate(); }}>
        <div className="field">
          <label htmlFor="u-name">Ad soyad</label>
          <input id="u-name" className="input" value={form.name} onChange={set('name')} maxLength={100} placeholder="ör. Ayşe Yılmaz" autoFocus />
        </div>
        <div className="field">
          <label htmlFor="u-username">Kullanıcı adı</label>
          <input id="u-username" className="input" value={form.username} onChange={set('username')} maxLength={254} placeholder="ör. ayse.yilmaz veya ayse@firma.com" autoCapitalize="none" spellCheck={false} autoComplete="off" />
          {form.username && !validUsername(form.username) && <span className="field-error">3–40 karakter; harf, rakam, nokta, tire, alt çizgi (veya bir e-posta adresi)</span>}
        </div>
        <div className="field">
          <label htmlFor="u-pass">{editing ? 'Yeni şifre (boş bırakılırsa değişmez)' : 'Şifre'}</label>
          <div className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
            <input id="u-pass" className="input" value={form.password} onChange={set('password')} maxLength={128} autoComplete="new-password" spellCheck={false} style={{ fontFamily: 'ui-monospace, monospace' }} />
            <button type="button" className="btn btn-secondary" onClick={() => setForm({ ...form, password: generatePassword() })} title="Rastgele güçlü şifre üret"><RefreshCw size={15} /> Üret</button>
          </div>
          {form.password && !strong(form.password) && <span className="field-error">En az 10 karakter; büyük harf, küçük harf ve rakam içermeli</span>}
        </div>
        <div className="field">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <label>Erişebileceği alan adları ({form.domainIds.length}/{domains.length})</label>
            <div className="row" style={{ gap: 4 }}>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setForm({ ...form, domainIds: domains.map((d) => d.id) })}>Tümü</button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setForm({ ...form, domainIds: [] })}>Hiçbiri</button>
            </div>
          </div>
          <div style={{ display: 'grid', gap: 6, maxHeight: 240, overflowY: 'auto', padding: 10, border: '1px solid var(--border)', borderRadius: 10 }}>
            {domains.length ? domains.map((d) => (
              <label key={d.id} className="row" style={{ gap: 8, cursor: 'pointer', fontWeight: 500 }}>
                <input type="checkbox" checked={form.domainIds.includes(d.id)} onChange={() => toggle(d.id)} /> {d.hostname}
              </label>
            )) : <span className="muted">Henüz alan adınız yok.</span>}
          </div>
          <span className="hint">Kullanıcı yalnızca seçtiğiniz alan adlarını görür ve yönetir. Kendi eklediği alan adları da otomatik olarak ona atanır.</span>
        </div>
      </form>
    </Modal>
  );
}

/** Ekip yönetimi (yalnızca admin): kullanıcı açma, giriş bilgisi verme ve alan adı ataması. */
export default function Users() {
  const toast = useToast();
  const qc = useQueryClient();
  const { user } = useAuth();
  const [editing, setEditing] = useState(null); // null | 'new' | user
  const { data, isLoading, isError, error } = useQuery({ queryKey: ['admin-users'], queryFn: adminApi.users, enabled: user?.role === 'admin' });
  const remove = useMutation({
    mutationFn: (id) => adminApi.removeUser(id),
    onSuccess: () => {
      toast.success('Kullanıcı silindi');
      qc.invalidateQueries({ queryKey: ['admin-users'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (user?.role !== 'admin') return <Alert type="error">Bu sayfaya yalnızca yönetici erişebilir.</Alert>;
  return (
    <div className="stack">
      <div className="page-head">
        <div><h1>Kullanıcılar</h1><p>Panele erişecek kişileri oluşturun, giriş bilgilerini verin ve hangi alan adlarını göreceklerini seçin.</p></div>
        <button className="btn btn-primary" onClick={() => setEditing('new')} disabled={isLoading}><Plus size={16} /> Yeni kullanıcı</button>
      </div>
      {isLoading ? <Skeleton height={240} /> : isError ? <Alert type="error">{errorMessage(error)}</Alert> : (
        <div className="card">
          <div className="table-wrap">
            {data.users.length ? (
              <table className="table">
                <thead><tr><th>Kullanıcı</th><th>Erişebildiği alan adları</th><th>Son giriş</th><th className="r" /></tr></thead>
                <tbody>
                  {data.users.map((u) => (
                    <tr key={u.id}>
                      <td><div className="cell-main">{u.name}</div><div className="cell-sub">{u.username}{u.locked && <span className="badge badge-warning" style={{ marginLeft: 6 }}>Geçici kilitli</span>}</div></td>
                      <td>
                        <div className="row" style={{ gap: 4 }}>
                          {u.domains.length ? u.domains.map((d) => <span key={d.id} className="badge badge-neutral">{d.hostname}</span>) : <span className="badge badge-warning">Atama yok</span>}
                        </div>
                      </td>
                      <td className="muted" style={{ fontSize: 12.5, whiteSpace: 'nowrap' }}>{u.last_login_at ? fmt.dateTime(u.last_login_at) : 'Henüz giriş yapmadı'}</td>
                      <td className="r" style={{ whiteSpace: 'nowrap' }}>
                        <button className="btn btn-ghost btn-sm" onClick={() => setEditing(u)}><Pencil size={14} /> Düzenle</button>
                        <button className="btn btn-ghost btn-sm" aria-label="Sil" onClick={() => window.confirm(`${u.name} (${u.username}) silinsin mi? Kullanıcı panele erişemez; alan adları ve veriler silinmez.`) && remove.mutate(u.id)}><Trash2 size={14} /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <EmptyState icon={UsersIcon} title="Henüz kullanıcı yok" action={<button className="btn btn-primary" onClick={() => setEditing('new')}><UserPlus size={16} /> İlk kullanıcıyı oluştur</button>}>
                Oluşturduğunuz kullanıcılar kullanıcı adı ve şifreyle giriş yapar, yalnızca atadığınız alan adlarını görür.
              </EmptyState>
            )}
          </div>
        </div>
      )}
      <p className="hint row" style={{ gap: 6 }}><KeyRound size={14} /> Kullanıcılar Search Console verisine sizin Google bağlantınız üzerinden erişir; bağlantıyı yalnızca siz değiştirebilirsiniz.</p>
      {editing && <UserForm initial={editing === 'new' ? null : editing} domains={data?.domains || []} onClose={() => setEditing(null)} />}
    </div>
  );
}
