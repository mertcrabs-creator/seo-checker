/**
 * Ekip erişimi. Alan adlarının sahibi (domains.user_id) hesabı açan kişidir (admin); Google bağlantısı da onundur.
 * - Hesap sahibi (admin veya kendi kaydolmuş kullanıcı): kendi alan adlarının tümü.
 * - Ekip üyesi (users.created_by dolu): sahibin alan adlarından yalnızca kendisine atananlar (domain_members).
 * Sorgularda: `${domainAccess('d', 2)}` + params `[...önceki, ...accessParams(req.user)]`.
 */

/** requireAuth'tan gelen satıra göre kullanıcının hesap sahibi ve tam erişim bilgisi. */
export function withOwner(user) {
  const ownerId = user.role === 'admin' || !user.created_by ? user.id : user.created_by;
  return { id: user.id, email: user.email, name: user.name, role: user.role, ownerId, fullAccess: ownerId === user.id };
}

/** $i = sahip id, $i+1 = tam erişim, $i+2 = kullanıcı id */
export const domainAccess = (alias, i) =>
  `(${alias}.user_id = $${i} AND ($${i + 1}::boolean OR EXISTS (SELECT 1 FROM domain_members m WHERE m.domain_id = ${alias}.id AND m.user_id = $${i + 2})))`;

export const accessParams = (user) => [user.ownerId, user.fullAccess, user.id];
