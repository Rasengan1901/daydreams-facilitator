export class InMemoryUptoSessionStore {
    map = new Map();
    get(id) {
        return this.map.get(id);
    }
    set(id, session) {
        this.map.set(id, session);
    }
    delete(id) {
        this.map.delete(id);
    }
    entries() {
        return this.map.entries();
    }
}
//# sourceMappingURL=store.js.map