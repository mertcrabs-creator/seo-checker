/**
 * unnest ile toplu ekleme: tek sorguda binlerce satır, tamamen parametreli.
 * `table` ve `columns` sadece koddaki sabitlerden gelir, kullanıcı girdisinden asla.
 * Dizi kolonları ('text[]' gibi) unnest ile düzleşmesin diye JSON metni olarak taşınır.
 */
export async function bulkInsert(client, table, columns, types, rows, chunkSize = 5_000) {
  const isArray = types.map((t) => t.endsWith('[]'));
  const placeholders = columns.map((_, i) => `$${i + 1}::${isArray[i] ? 'text' : types[i]}[]`).join(', ');
  const aliases = columns.map((_, i) => `c${i}`);
  const exprs = aliases.map((a, i) => (isArray[i] ? `ARRAY(SELECT jsonb_array_elements_text(u.${a}::jsonb))::${types[i]}` : `u.${a}`));
  const sql = `INSERT INTO ${table} (${columns.join(', ')}) SELECT ${exprs.join(', ')} FROM unnest(${placeholders}) AS u(${aliases.join(', ')})`;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const slice = rows.slice(i, i + chunkSize);
    await client.query(sql, columns.map((_, c) => slice.map((r) => (isArray[c] ? JSON.stringify(r[c] ?? []) : r[c]))));
  }
}
