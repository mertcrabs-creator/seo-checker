import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, ChevronsUpDown } from 'lucide-react';
import { fmt } from '../../utils/format';
import { Skeleton } from './Feedback';

/**
 * columns: [{ key, label, align, sortable, render(row), width }]
 * Sıralama ve sayfalama sunucu tarafında yapılır; tablo sadece durumu yansıtır.
 */
export function DataTable({ columns, rows, loading, sort, order, onSort, onRowClick, rowKey, empty }) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            {columns.map((c) => {
              const active = sort === c.key;
              const Icon = !active ? ChevronsUpDown : order === 'asc' ? ChevronUp : ChevronDown;
              return (
                <th
                  key={c.key}
                  className={`${c.align === 'right' ? 'r' : ''} ${c.sortable ? 'sortable' : ''}`}
                  style={c.width ? { width: c.width } : undefined}
                  onClick={c.sortable ? () => onSort(c.key) : undefined}
                  aria-sort={active ? (order === 'asc' ? 'ascending' : 'descending') : undefined}
                >
                  {c.label}
                  {c.sortable && <span className="sort-ind"><Icon size={13} /></span>}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {loading
            ? Array.from({ length: 8 }, (_, i) => (
                <tr key={i}>
                  {columns.map((c) => (
                    <td key={c.key}><Skeleton height={14} width={c.align === 'right' ? 50 : '70%'} style={c.align === 'right' ? { marginLeft: 'auto' } : undefined} /></td>
                  ))}
                </tr>
              ))
            : rows.map((row, i) => (
                <tr key={rowKey ? rowKey(row) : i} className={onRowClick ? 'clickable' : ''} onClick={onRowClick ? () => onRowClick(row) : undefined}>
                  {columns.map((c) => (
                    <td key={c.key} className={c.align === 'right' ? 'r' : ''}>{c.render ? c.render(row) : row[c.key]}</td>
                  ))}
                </tr>
              ))}
          {!loading && rows.length === 0 && (
            <tr>
              <td colSpan={columns.length}>{empty}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export function Pagination({ page, pageSize, total, onPage }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total ? (page - 1) * pageSize + 1 : 0;
  const to = Math.min(total, page * pageSize);
  return (
    <div className="pagination">
      <span>
        <span className="num">{fmt.num(from)}–{fmt.num(to)}</span> / <span className="num">{fmt.num(total)}</span> kayıt
      </span>
      <div className="row">
        <button className="btn btn-secondary btn-sm btn-icon" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Önceki sayfa">
          <ChevronLeft size={16} />
        </button>
        <span className="num">{page} / {pages}</span>
        <button className="btn btn-secondary btn-sm btn-icon" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Sonraki sayfa">
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
}

export function PositionPill({ value }) {
  if (value === null || value === undefined) return <span className="pos-pill">—</span>;
  const cls = value <= 3 ? 'pos-top3' : value <= 10 ? 'pos-top10' : '';
  return <span className={`pos-pill num ${cls}`}>{fmt.pos(value)}</span>;
}
