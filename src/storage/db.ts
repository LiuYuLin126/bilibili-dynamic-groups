import Dexie, { type Table } from "dexie";
import type {
  DynamicRecord,
  GroupRecord,
  QuadrantSnapshot,
  RunLogRecord,
  SyncMetaRecord,
  UpRecord,
  ViewLogRecord
} from "@/src/types/domain";

export class BiliGroupsDatabase extends Dexie {
  ups!: Table<UpRecord, number>;
  groups!: Table<GroupRecord, number>;
  dynamics!: Table<DynamicRecord, string>;
  viewLogs!: Table<ViewLogRecord, number>;
  quadrantSnapshots!: Table<QuadrantSnapshot, string>;
  syncMeta!: Table<SyncMetaRecord, string>;
  logs!: Table<RunLogRecord, number>;

  constructor() {
    super("bili-dynamic-groups");
    this.version(1).stores({
      ups: "mid, name, lastUpdateTs, lastViewedTs, unreadCount",
      groups: "tagid, manualOrder, name",
      dynamics: "dynamicId, mid, pubTs, [mid+seen]",
      viewLogs: "++id, mid, ts, source",
      quadrantSnapshots: "id, createdAt",
      syncMeta: "key, updatedAt"
    });
    this.version(2)
      .stores({
        ups: "mid, name, lastUpdateTs, lastViewedTs, updateCount24h",
        dynamics: "dynamicId, mid, pubTs"
      })
      .upgrade(async (tx) => {
        await tx.table("ups").toCollection().modify((up: Record<string, unknown>) => {
          up.updateCount24h = 0;
          delete up.unreadCount;
          delete up.lastSeenDynamicId;
        });
        await tx.table("dynamics").toCollection().modify((dynamic: Record<string, unknown>) => {
          delete dynamic.seen;
        });
        await tx.table("quadrantSnapshots").clear();
      });
    // v3 adds the run-log table (diagnostics time series); other tables carry over.
    this.version(3).stores({
      logs: "++id, ts, level, event"
    });
  }
}

export const db = new BiliGroupsDatabase();
