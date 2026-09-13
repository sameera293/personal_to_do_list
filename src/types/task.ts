export type TaskPriority = "none" | "low" | "medium" | "high";

export type Task = {
  id: number;
  title: string;
  description?: string;
  completed: boolean;
  priority: TaskPriority;
  dueDate?: string;
  time?: string;
  project?: string;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
};