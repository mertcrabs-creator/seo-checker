import { useCallback, useState } from 'react';
import { useDebounce } from './useDebounce';

/** Sunucu taraflı tablo durumu: arama, sıralama, sayfa, kova filtresi. */
export function useTableState(initial = {}) {
  const [search, setSearchRaw] = useState('');
  const [sort, setSortKey] = useState(initial.sort || 'clicks');
  const [order, setOrder] = useState(initial.order || 'desc');
  const [page, setPage] = useState(1);
  const [bucket, setBucketRaw] = useState(initial.bucket || '');
  const debouncedSearch = useDebounce(search.trim(), 350);

  const setSearch = useCallback((v) => {
    setSearchRaw(v);
    setPage(1);
  }, []);
  const setBucket = useCallback((v) => {
    setBucketRaw(v);
    setPage(1);
  }, []);
  const onSort = useCallback(
    (key) => {
      if (key === sort) setOrder((o) => (o === 'asc' ? 'desc' : 'asc'));
      else {
        setSortKey(key);
        // Pozisyon ve metin için doğal yön artan, metrikler için azalan
        setOrder(['position', 'query', 'page', 'keyword', 'url', 'onpage_score', 'depth'].includes(key) ? 'asc' : 'desc');
      }
      setPage(1);
    },
    [sort],
  );

  const params = {
    sort,
    order,
    page,
    pageSize: initial.pageSize || 50,
    ...(debouncedSearch && { search: debouncedSearch }),
    ...(bucket && { bucket }),
  };

  return { search, setSearch, sort, order, onSort, page, setPage, bucket, setBucket, params };
}
