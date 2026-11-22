/**
 * MUXARO Media Processing Platform - In-Memory Mock Database for Tests & Isolated Builds
 */

export function createMockDb(): any {
  const store: Record<string, any[]> = {
    users: [
      {
        id: '00000000-0000-4000-8000-000000000001',
        email: 'pro@muxaro.io',
        tier: 'pro',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ],
    mediaJobs: [],
    uploadSessions: [],
    dailyUsageLedger: [],
  };

  function getTableName(table: any): string {
    if (!table) return 'mediaJobs';
    if (typeof table === 'string') return table;
    const name =
      table[Symbol.for('drizzle:Name')] ||
      table._?.name ||
      table.name ||
      '';
    if (name.includes('job') || name.includes('media_jobs')) return 'mediaJobs';
    if (name.includes('upload') || name.includes('upload_sessions')) return 'uploadSessions';
    if (name.includes('usage') || name.includes('daily_usage_ledger')) return 'dailyUsageLedger';
    if (name.includes('user') || name.includes('users')) return 'users';
    return 'mediaJobs';
  }

  function extractValues(node: any, out: Set<string>): void {
    if (node === null || node === undefined) return;
    if (typeof node === 'string' || typeof node === 'number' || typeof node === 'boolean') {
      out.add(String(node));
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) extractValues(item, out);
      return;
    }
    if (typeof node === 'object') {
      if (node.value !== undefined) extractValues(node.value, out);
      if (node.queryChunks) extractValues(node.queryChunks, out);
      if (node.left) extractValues(node.left, out);
      if (node.right) extractValues(node.right, out);
    }
  }

  function matchesWhere(item: any, whereClause: any): boolean {
    if (!whereClause) return true;
    const values = new Set<string>();
    extractValues(whereClause, values);

    if (values.size === 0) return true;

    // Check key fields against extracted values
    if (item.id && values.has(String(item.id))) return true;
    if (item.idempotencyKey && values.has(String(item.idempotencyKey))) return true;
    if (item.userId && values.has(String(item.userId))) return true;
    if (item.guestIpHash && values.has(String(item.guestIpHash))) return true;

    // Fallback search across any matching property
    for (const val of Object.values(item)) {
      if (val !== undefined && val !== null && values.has(String(val))) {
        return true;
      }
    }

    return false;
  }

  const mockDb = {
    select(selectFields?: any) {
      let targetTable = 'mediaJobs';
      let whereFilter: any = null;
      let limitCount: number | null = null;
      let offsetCount = 0;

      const queryBuilder: any = {
        from(tbl: any) {
          targetTable = getTableName(tbl);
          return queryBuilder;
        },
        where(clause: any) {
          whereFilter = clause;
          return queryBuilder;
        },
        orderBy(..._args: any[]) {
          return queryBuilder;
        },
        limit(num: number) {
          limitCount = num;
          return queryBuilder;
        },
        offset(num: number) {
          offsetCount = num;
          return queryBuilder;
        },
        then(resolve: any, reject: any) {
          const list = store[targetTable] || [];
          let filtered = whereFilter ? list.filter((item) => matchesWhere(item, whereFilter)) : [...list];

          if (selectFields && (selectFields.count || selectFields.total)) {
            const countVal = filtered.length;
            return Promise.resolve([{ count: countVal, total: countVal }]).then(resolve, reject);
          }

          if (offsetCount > 0) {
            filtered = filtered.slice(offsetCount);
          }
          if (limitCount !== null) {
            filtered = filtered.slice(0, limitCount);
          }
          return Promise.resolve(filtered).then(resolve, reject);
        },
      };

      return queryBuilder;
    },

    insert(tbl: any) {
      const targetTable = getTableName(tbl);
      return {
        values(rowOrRows: any) {
          const rows = Array.isArray(rowOrRows) ? rowOrRows : [rowOrRows];
          if (!store[targetTable]) store[targetTable] = [];
          const inserted: any[] = [];
          for (const r of rows) {
            const rowWithDefaults = {
              id: r.id || crypto.randomUUID(),
              createdAt: r.createdAt || new Date(),
              updatedAt: r.updatedAt || new Date(),
              ...r,
            };
            store[targetTable].push(rowWithDefaults);
            inserted.push(rowWithDefaults);
          }

          const insertChain: any = {
            returning() {
              return insertChain;
            },
            onConflictDoUpdate() {
              return insertChain;
            },
            onConflictDoNothing() {
              return insertChain;
            },
            then(resolve: any, reject: any) {
              return Promise.resolve(inserted).then(resolve, reject);
            },
          };

          return insertChain;
        },
      };
    },

    update(tbl: any) {
      const targetTable = getTableName(tbl);
      let setValues: any = {};
      let whereFilter: any = null;

      const updateBuilder: any = {
        set(values: any) {
          setValues = values;
          return updateBuilder;
        },
        where(clause: any) {
          whereFilter = clause;
          return updateBuilder;
        },
        returning() {
          return updateBuilder;
        },
        then(resolve: any, reject: any) {
          const list = store[targetTable] || [];
          const updated: any[] = [];
          for (const item of list) {
            if (matchesWhere(item, whereFilter)) {
              Object.assign(item, setValues, { updatedAt: new Date() });
              updated.push(item);
            }
          }
          return Promise.resolve(updated).then(resolve, reject);
        },
      };

      return updateBuilder;
    },

    delete(tbl: any) {
      const targetTable = getTableName(tbl);
      let whereFilter: any = null;
      return {
        where(clause: any) {
          whereFilter = clause;
          return {
            then(resolve: any, reject: any) {
              if (store[targetTable]) {
                store[targetTable] = store[targetTable].filter(
                  (item) => !matchesWhere(item, whereFilter)
                );
              }
              return Promise.resolve([]).then(resolve, reject);
            },
          };
        },
      };
    },
  };

  return mockDb;
}
