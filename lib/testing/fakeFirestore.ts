// Memorijski Firestore za testove serverskog koda (Admin SDK oblik).
// Pokriva samo ono što koristi asistent: doc/collection, where (==, <=, in),
// limit, add, create (ALREADY_EXISTS), runTransaction, db.doc(path).
//
// Upotreba u testu:
//   jest.mock('@/lib/server/firebaseAdmin', () => require('@/lib/testing/fakeFirestore').firebaseAdminMock);
//   import { fakeStore } from '@/lib/testing/fakeFirestore';

type Data = Record<string, any>;

export const fakeStore = new Map<string, Data>();
let seq = 0;
const clone = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

class FakeDoc {
    constructor(public col: string, public id: string) {}
    get path() { return `${this.col}/${this.id}`; }
    async get() {
        const d = fakeStore.get(this.path);
        return { exists: d !== undefined, id: this.id, ref: this, data: () => clone(d) };
    }
    async set(data: Data) { fakeStore.set(this.path, clone(data)); }
    async update(patch: Data) {
        if (!fakeStore.has(this.path)) throw new Error(`nema dokumenta ${this.path}`);
        fakeStore.set(this.path, { ...fakeStore.get(this.path), ...clone(patch) });
    }
    async delete() { fakeStore.delete(this.path); }
    async create(data: Data) {
        if (fakeStore.has(this.path)) throw Object.assign(new Error('already exists'), { code: 6 });
        await this.set(data);
    }
}

type Filter = [string, string, any];

class FakeQuery {
    constructor(public col: string, public filters: Filter[] = [], public lim = Infinity) {}
    where(f: string, op: string, v: any) { return new FakeQuery(this.col, [...this.filters, [f, op, v]], this.lim); }
    limit(n: number) { return new FakeQuery(this.col, this.filters, n); }
    async get() {
        const docs = Array.from(fakeStore.entries())
            .filter(([k]) => k.startsWith(`${this.col}/`) && k.split('/').length === 2)
            .filter(([, d]) => this.filters.every(([f, op, v]) =>
                op === '==' ? d[f] === v : op === '<=' ? d[f] <= v : op === 'in' ? v.includes(d[f]) : false))
            .slice(0, this.lim)
            .map(([k, d]) => {
                const id = k.split('/')[1];
                return { id, ref: new FakeDoc(this.col, id), data: () => clone(d) };
            });
        return { empty: !docs.length, size: docs.length, docs };
    }
}

class FakeCollection extends FakeQuery {
    doc(id = `auto${++seq}`) { return new FakeDoc(this.col, id); }
    async add(data: Data) { const ref = this.doc(); await ref.set(data); return ref; }
}

export const fakeDb = {
    collection: (name: string) => new FakeCollection(name),
    doc: (path: string) => { const [c, id] = path.split('/'); return new FakeDoc(c, id); },
    runTransaction: async <T>(fn: (tx: any) => Promise<T>) => fn({
        get: (x: FakeDoc | FakeQuery) => x.get(),
        set: (r: FakeDoc, d: Data) => r.set(d),
        delete: (r: FakeDoc) => r.delete(),
        update: (r: FakeDoc, p: Data) => r.update(p),
    }),
};

export const firebaseAdminMock = {
    adminDb: () => fakeDb,
    adminAuth: () => { throw new Error('adminAuth nije dostupan u testu'); },
};

/** Svi dokumenti kolekcije (vrijednosti, ne kopije). */
export function fakeDocs(col: string): Data[] {
    return Array.from(fakeStore.entries()).filter(([k]) => k.startsWith(`${col}/`)).map(([, v]) => v);
}
