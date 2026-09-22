// Mock @supabase/supabase-js for testing olt-scanner.js without a real project.
// Records every upsert() call onto module.exports.__calls so the test
// harness can assert on exactly what would have been sent.

const calls = { upserts: [], selects: [] };

function createClient(url, key) {
  return {
    from(table) {
      return {
        select(cols) {
          calls.selects.push({ table, cols });
          // simulate "first ever scan" - no existing rows yet
          return { in: () => Promise.resolve({ data: [], error: null }) };
        },
        upsert(rows, opts) {
          calls.upserts.push({ table, rows, opts });
          return Promise.resolve({ data: rows, error: null });
        },
      };
    },
  };
}

module.exports = { createClient, __calls: calls };
