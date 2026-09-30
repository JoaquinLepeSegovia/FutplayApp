import { vi } from "vitest";

// ── Shared mutable state (reset between tests) ──────────────

type MockResponse = { data: any; error: any };

const state: {
    authUser: any;
    tables: Record<string, MockResponse>;
} = {
    authUser: null,
    tables: {},
};

// ── Test helpers ────────────────────────────────────────────

export function __resetMocks() {
    state.authUser = null;
    state.tables = {};
}

export function __setAuthUser(user: any) {
    state.authUser = user;
}

export function __setTableData(table: string, data: any, error: any = null) {
    state.tables[table] = { data, error };
}

// ── Query engine helpers ────────────────────────────────────

type Filter = { method: string; args: any[] };

function getNestedValue(obj: any, path: string): any {
    if (!path.includes(".")) return obj[path];
    return path.split(".").reduce((current, key) => {
        if (current == null || typeof current !== "object") return undefined;
        return current[key];
    }, obj);
}

function cmp(a: any, b: any): number {
    if (a == null && b == null) return 0;
    if (a == null) return -1;
    if (b == null) return 1;
    if (typeof a === "number" && typeof b === "number") return a - b;
    if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
    return String(a).localeCompare(String(b));
}

function applyFilters(data: any[], filters: Filter[]): any[] {
    let result = [...data];
    for (const f of filters) {
        switch (f.method) {
            case "eq": {
                const [col, val] = f.args;
                result = result.filter((item) => getNestedValue(item, col) === val);
                break;
            }
            case "neq": {
                const [col, val] = f.args;
                result = result.filter((item) => getNestedValue(item, col) !== val);
                break;
            }
            case "in": {
                const [col, vals] = f.args;
                const arr = Array.isArray(vals) ? vals : [];
                result = result.filter((item) => arr.includes(getNestedValue(item, col)));
                break;
            }
            case "gt": {
                const [col, val] = f.args;
                result = result.filter((item) => cmp(getNestedValue(item, col), val) > 0);
                break;
            }
            case "gte": {
                const [col, val] = f.args;
                result = result.filter((item) => cmp(getNestedValue(item, col), val) >= 0);
                break;
            }
            case "lt": {
                const [col, val] = f.args;
                result = result.filter((item) => cmp(getNestedValue(item, col), val) < 0);
                break;
            }
            case "lte": {
                const [col, val] = f.args;
                result = result.filter((item) => cmp(getNestedValue(item, col), val) <= 0);
                break;
            }
            case "not": {
                const [col, op, val] = f.args;
                if (op === "in") {
                    const vals = val
                        .replace(/^\(/, "")
                        .replace(/\)$/, "")
                        .split(",")
                        .map((s: string) => s.replace(/'/g, "").trim());
                    result = result.filter((item) => !vals.includes(String(getNestedValue(item, col))));
                }
                break;
            }
            case "or": {
                const [orStr] = f.args;
                const conditions = orStr.split(",").map((c: string) => {
                    const parts = c.split(".");
                    return { col: parts[0], op: parts[1], val: parts.slice(2).join(".") };
                });
                result = result.filter((item) =>
                    conditions.some((cond: any) => {
                        const v = getNestedValue(item, cond.col);
                        if (cond.op === "eq") return v === cond.val;
                        return false;
                    })
                );
                break;
            }
        }
    }
    return result;
}

function applyOrder(data: any[], column: string, ascending: boolean): any[] {
    return [...data].sort((a, b) => {
        const va = getNestedValue(a, column);
        const vb = getNestedValue(b, column);
        const c = cmp(va, vb);
        return ascending ? c : -c;
    });
}

// ── Chain builder ───────────────────────────────────────────

export function makeChain(table: string) {
    const filters: Filter[] = [];
    let orderBy: { column: string; ascending: boolean } | undefined;
    let limitCount: number | undefined;
    let countExact = false;
    let headOnly = false;
    let noMatchError: { message: string; code: string } | null = null;

    function execute(opts?: { single?: boolean; maybeSingle?: boolean }): Promise<any> {
        const r = state.tables[table];
        if (!r) return Promise.resolve({ data: null, error: null, count: 0 });

        let data = r.data;
        let error = r.error;
        noMatchError = null;

        if (Array.isArray(data)) {
            if (filters.length > 0) {
                data = applyFilters(data, filters);
            }
            if (orderBy) {
                data = applyOrder(data, orderBy.column, orderBy.ascending);
            }
            if (limitCount != null && data.length > limitCount) {
                data = data.slice(0, limitCount);
            }
        } else if (!Array.isArray(data) && data != null && filters.length > 0) {
            const asArray = [data];
            const filtered = applyFilters(asArray, filters);
            data = filtered.length > 0 ? filtered[0] : null;
            if (!data) {
                // PostgREST sólo reporta PGRST116 en .single(); .maybeSingle()
                // devuelve { data: null, error: null } cuando no hay coincidencia.
                noMatchError = { message: "No rows match filter", code: "PGRST116" };
            }
        }

        const count = countExact
            ? (Array.isArray(data) ? data.length : (data != null ? 1 : 0))
            : undefined;

        if (headOnly) {
            return Promise.resolve({ data: null, error, count });
        }

        if (opts?.single) {
            if (Array.isArray(data)) {
                if (data.length === 0) {
                    return Promise.resolve({ data: null, error: { message: "No rows found", code: "PGRST116" }, count });
                }
                return Promise.resolve({ data: data[0], error, count });
            }
            return Promise.resolve({ data, error: error ?? noMatchError, count });
        }

        if (opts?.maybeSingle) {
            // maybeSingle nunca falla por no encontrar filas: { data: null, error: null }.
            const maybeError = data == null ? null : error;
            if (Array.isArray(data)) {
                return Promise.resolve({ data: data[0] ?? null, error: maybeError });
            }
            return Promise.resolve({ data: data ?? null, error: maybeError });
        }

        return Promise.resolve({ data, error, count });
    }

    const terminal: any = {
        // Thenable: makes `await chain` resolve
        then(resolve: (v: any) => void, reject?: (e: Error) => void) {
            return execute().then(resolve, reject);
        },

        // Chainable methods
        select: vi.fn((_columns?: string, opts?: { count?: string; head?: boolean }) => {
            if (opts?.count === "exact") countExact = true;
            if (opts?.head) headOnly = true;
            return terminal;
        }),
        insert: vi.fn(() => terminal),
        upsert: vi.fn(() => terminal),
        update: vi.fn(() => terminal),
        delete: vi.fn(() => terminal),
        eq: vi.fn((col: string, val: any) => { filters.push({ method: "eq", args: [col, val] }); return terminal; }),
        neq: vi.fn((col: string, val: any) => { filters.push({ method: "neq", args: [col, val] }); return terminal; }),
        in: vi.fn((col: string, vals: any[]) => { filters.push({ method: "in", args: [col, vals] }); return terminal; }),
        gt: vi.fn((col: string, val: any) => { filters.push({ method: "gt", args: [col, val] }); return terminal; }),
        gte: vi.fn((col: string, val: any) => { filters.push({ method: "gte", args: [col, val] }); return terminal; }),
        lt: vi.fn((col: string, val: any) => { filters.push({ method: "lt", args: [col, val] }); return terminal; }),
        lte: vi.fn((col: string, val: any) => { filters.push({ method: "lte", args: [col, val] }); return terminal; }),
        not: vi.fn((col: string, op: string, val: string) => { filters.push({ method: "not", args: [col, op, val] }); return terminal; }),
        or: vi.fn(() => terminal),
        order: vi.fn((col: string, opts?: { ascending?: boolean }) => {
            orderBy = { column: col, ascending: opts?.ascending ?? true };
            return terminal;
        }),
        limit: vi.fn((n: number) => { limitCount = n; return terminal; }),

        // Terminal methods
        single: vi.fn(() => execute({ single: true })),
        maybeSingle: vi.fn(() => execute({ maybeSingle: true })),
    };

    return terminal;
}

// ── Factory ─────────────────────────────────────────────────

export function createMockServerClient() {
    return {
        auth: {
            getUser: vi.fn(() =>
                Promise.resolve({ data: { user: state.authUser } }),
            ),
            admin: {
                createUser: vi.fn(() => Promise.resolve({ data: { user: { id: "new-auth-id" } }, error: null })),
                deleteUser: vi.fn(() => Promise.resolve({ error: null })),
                listUsers: vi.fn(() => Promise.resolve({ data: { users: [] }, error: null })),
            },
        },
        from: vi.fn((table: string) => makeChain(table)),
        rpc: vi.fn(() => Promise.resolve({ data: true, error: null })),
        storage: {
            getBucket: vi.fn(() => Promise.resolve({ error: null })),
            createBucket: vi.fn(() => Promise.resolve({ error: null })),
            from: vi.fn(() => ({
                upload: vi.fn(() => Promise.resolve({ error: null })),
                getPublicUrl: vi.fn(() => ({ data: { publicUrl: "https://test.supabase.co/storage/v1/object/public/test/file.jpg" } })),
            })),
        },
    };
}
