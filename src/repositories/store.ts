import type { GlobalControls, SystemFlags } from "@/domain/types";
import type { Dataset } from "@/fixtures/dataset-types";
import { rebaseDataset, rebaseOffsetMinutes } from "@/fixtures/rebase";

/** Dataset keys whose values are entity arrays. */
export type CollectionName = {
  [K in keyof Dataset]: Dataset[K] extends Array<unknown> ? K : never;
}[keyof Dataset];

export type EntityOf<K extends CollectionName> = Dataset[K][number];

const KEY_FIELDS: Partial<Record<CollectionName, string>> = {
  actionPolicies: "action",
};

function keyOf(collection: CollectionName, entity: object): string {
  const field = KEY_FIELDS[collection] ?? "id";
  const key = (entity as Record<string, unknown>)[field];
  if (typeof key !== "string") throw new Error(`Entity in ${collection} has no ${field}`);
  return key;
}

/** What survives a browser refresh: the time offset plus every entity changed since seeding. */
export type PersistedState = {
  version: 2;
  offsetMinutes: number;
  sequence: number;
  overlay: Partial<Record<CollectionName, Record<string, unknown>>>;
  globalControls?: GlobalControls;
  systemFlags?: SystemFlags;
};

export type Persistence = {
  load(): PersistedState | null;
  save(state: PersistedState): void;
  clear(): void;
};

export const DEFAULT_SYSTEM_FLAGS: SystemFlags = {
  investigationAvailable: true,
  policyServiceAvailable: true,
  outcomeVerificationAvailable: true,
};

/**
 * In-memory data store seeded from fixtures. Fixture records are immutable
 * baselines; every write is recorded in an overlay so persistence stays small.
 */
export class DataStore {
  private data: Dataset;
  private overlay: PersistedState["overlay"];
  private anchorOffsetMinutes: number;
  private sequence: number;
  private systemFlags: SystemFlags;
  private listeners = new Set<() => void>();
  private indexes = new Map<CollectionName, Map<string, number>>();

  constructor(
    fixtures: Dataset,
    now: Date,
    private readonly persistence?: Persistence,
  ) {
    const saved = persistence?.load() ?? null;
    this.anchorOffsetMinutes = saved?.offsetMinutes ?? rebaseOffsetMinutes(fixtures, now);
    this.data = rebaseDataset(fixtures, this.anchorOffsetMinutes);
    this.overlay = {};
    this.sequence = saved?.sequence ?? 0;
    this.systemFlags = { ...DEFAULT_SYSTEM_FLAGS, ...saved?.systemFlags };
    if (saved) {
      for (const [collection, entities] of Object.entries(saved.overlay) as Array<[CollectionName, Record<string, unknown>]>) {
        for (const entity of Object.values(entities)) this.write(collection, entity as EntityOf<typeof collection>, false);
      }
      if (saved.globalControls) this.data.globalControls = saved.globalControls;
    } else {
      // Fix the anchor on first load so times do not move on the next visit.
      this.persist();
    }
  }

  get meta(): Dataset["meta"] {
    return this.data.meta;
  }

  get offsetMinutes(): number {
    return this.anchorOffsetMinutes;
  }

  list<K extends CollectionName>(collection: K): ReadonlyArray<EntityOf<K>> {
    return this.data[collection] as ReadonlyArray<EntityOf<K>>;
  }

  get<K extends CollectionName>(collection: K, key: string): EntityOf<K> | undefined {
    const position = this.index(collection).get(key);
    return position === undefined ? undefined : (this.data[collection][position] as EntityOf<K>);
  }

  /** Inserts or replaces an entity. Callers pass fresh objects; stored objects are never mutated in place. */
  put<K extends CollectionName>(collection: K, entity: EntityOf<K>): void {
    this.write(collection, entity, true);
  }

  get globalControls(): GlobalControls {
    return this.data.globalControls;
  }

  setGlobalControls(controls: GlobalControls): void {
    this.data.globalControls = controls;
    this.commit();
  }

  get flags(): SystemFlags {
    return this.systemFlags;
  }

  setFlags(flags: SystemFlags): void {
    this.systemFlags = flags;
    this.commit();
  }

  investigationResponse(id: string): unknown {
    return this.data.investigationResponses[id];
  }

  /** Deterministic ID for records created at runtime. */
  nextId(prefix: string): string {
    this.sequence += 1;
    return `${prefix}_rt${this.sequence.toString(36).padStart(8, "0")}`;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private index(collection: CollectionName): Map<string, number> {
    let index = this.indexes.get(collection);
    if (!index) {
      index = new Map();
      (this.data[collection] as object[]).forEach((entity, position) => index!.set(keyOf(collection, entity), position));
      this.indexes.set(collection, index);
    }
    return index;
  }

  private write<K extends CollectionName>(collection: K, entity: EntityOf<K>, commit: boolean): void {
    const key = keyOf(collection, entity as object);
    const items = [...(this.data[collection] as Array<EntityOf<K>>)];
    const index = this.index(collection);
    const position = index.get(key);
    if (position === undefined) {
      index.set(key, items.length);
      items.push(entity);
    } else {
      items[position] = entity;
    }
    (this.data as Record<CollectionName, unknown>)[collection] = items;
    this.overlay[collection] = { ...this.overlay[collection], [key]: entity };
    if (commit) this.commit();
  }

  private commit(): void {
    this.persist();
    for (const listener of this.listeners) listener();
  }

  private persist(): void {
    this.persistence?.save({
      version: 2,
      offsetMinutes: this.anchorOffsetMinutes,
      sequence: this.sequence,
      overlay: this.overlay,
      globalControls: this.data.globalControls,
      systemFlags: this.systemFlags,
    });
  }
}

export function memoryPersistence(): Persistence & { state: PersistedState | null } {
  const holder: Persistence & { state: PersistedState | null } = {
    state: null,
    load: () => (holder.state ? structuredClone(holder.state) : null),
    save: (state) => {
      holder.state = structuredClone(state);
    },
    clear: () => {
      holder.state = null;
    },
  };
  return holder;
}

/** localStorage persistence. Only construct this in the browser, after mount. */
export function localStoragePersistence(key = "payment-integrity:v2"): Persistence {
  return {
    load() {
      try {
        const raw = window.localStorage.getItem(key);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as PersistedState;
        return parsed.version === 2 ? parsed : null;
      } catch {
        return null;
      }
    },
    save(state) {
      try {
        window.localStorage.setItem(key, JSON.stringify(state));
      } catch {
        // Storage full or blocked: the session keeps working in memory.
      }
    },
    clear() {
      try {
        window.localStorage.removeItem(key);
      } catch {
        // Nothing to clear.
      }
    },
  };
}
