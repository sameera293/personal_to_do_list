import Dexie, { type Table } from "dexie";
import type { Task } from "../types/task";

class TodoDatabase extends Dexie {
  tasks!: Table<Task, number>;

  constructor() {
    super("FocusTodoDatabase");

    this.version(1).stores({
      tasks: "id, completed, priority, project, createdAt",
    });
  }
}

export const db = new TodoDatabase();