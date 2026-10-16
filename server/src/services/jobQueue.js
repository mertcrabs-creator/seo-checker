/**
 * Süreç içi, eşzamanlılık sınırlı iş kuyruğu. Aynı anahtarlı iş zaten
 * bekliyor/çalışıyorsa tekrar eklenmez. Çoklu instance'a geçildiğinde
 * aynı arayüzle BullMQ/pg-boss'a taşınabilir.
 */
export class JobQueue {
  constructor(name, concurrency = 2) {
    this.name = name;
    this.concurrency = concurrency;
    this.running = 0;
    this.pending = [];
    this.keys = new Set();
  }

  has(key) {
    return this.keys.has(key);
  }

  add(key, fn) {
    if (this.keys.has(key)) return false;
    this.keys.add(key);
    this.pending.push({ key, fn });
    this.#drain();
    return true;
  }

  #drain() {
    while (this.running < this.concurrency && this.pending.length) {
      const { key, fn } = this.pending.shift();
      this.running++;
      Promise.resolve()
        .then(fn)
        .catch((err) => console.error(`[queue:${this.name}] ${key}`, err.message))
        .finally(() => {
          this.running--;
          this.keys.delete(key);
          this.#drain();
        });
    }
  }
}

export const syncQueue = new JobQueue('gsc-sync', 2);
export const auditQueue = new JobQueue('audit', 2);
export const pagespeedQueue = new JobQueue('pagespeed', 3);
export const rankQueue = new JobQueue('rankings', 3);
export const backlinkQueue = new JobQueue('backlinks', 1);
export const indexQueue = new JobQueue('index', 1);
