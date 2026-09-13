import { useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  Check,
  ChevronDown,
  Clock3,
  Inbox,
  LayoutDashboard,
  Menu,
  Plus,
  Search,
  Settings,
  Star,
  Tag,
  Trash2,
  X,
  Bell,
} from "lucide-react";

import { db } from "./db/database";
import type { Task, TaskPriority } from "./types/task";

type View =
  | "today"
  | "inbox"
  | "upcoming"
  | "important"
  | "tags"
  | "trash"
  | "settings"
  | `project:${string}`;

type ReminderOption = "none" | "0" | "5" | "10" | "30" | "60";

type ReminderMap = Record<number, ReminderOption>;

const projects = [
  { name: "College", color: "purple" },
  { name: "Coding", color: "blue" },
  { name: "Personal", color: "green" },
];

const demoTasks: Task[] = [
  {
    id: 1,
    title: "Complete AI assignment",
    completed: false,
    priority: "high",
    time: "10:00 AM",
    project: "College",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  {
    id: 2,
    title: "Practice DSA for 1 hour",
    completed: false,
    priority: "medium",
    time: "2:00 PM",
    project: "Coding",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  {
    id: 3,
    title: "Work on personal project",
    completed: false,
    priority: "medium",
    time: "5:00 PM",
    project: "Personal",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  {
    id: 4,
    title: "Read 20 pages",
    completed: true,
    priority: "low",
    project: "Personal",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    completedAt: Date.now(),
  },
];

const REMINDER_STORAGE_KEY = "focus-task-reminders";

function loadReminders(): ReminderMap {
  try {
    const saved = localStorage.getItem(REMINDER_STORAGE_KEY);

    if (!saved) {
      return {};
    }

    return JSON.parse(saved);
  } catch {
    return {};
  }
}

function saveReminders(reminders: ReminderMap) {
  localStorage.setItem(
    REMINDER_STORAGE_KEY,
    JSON.stringify(reminders),
  );
}

function parseTaskDateTime(task: Task): number | null {
  if (!task.dueDate) {
    return null;
  }

  const date = task.dueDate;

  if (!task.time) {
    return new Date(`${date}T09:00:00`).getTime();
  }

  const time = task.time.trim();

  let hours: number;
  let minutes: number;

  // 24-hour format: 14:30
  const twentyFourHour = time.match(
    /^(\d{1,2}):(\d{2})$/,
  );

  if (twentyFourHour) {
    hours = Number(twentyFourHour[1]);
    minutes = Number(twentyFourHour[2]);
  } else {
    // 12-hour format: 2:30 PM
    const twelveHour = time.match(
      /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i,
    );

    if (!twelveHour) {
      return null;
    }

    hours = Number(twelveHour[1]);
    minutes = Number(twelveHour[2]);

    const period = twelveHour[3].toUpperCase();

    if (period === "PM" && hours !== 12) {
      hours += 12;
    }

    if (period === "AM" && hours === 12) {
      hours = 0;
    }
  }

  const [year, month, day] = date
    .split("-")
    .map(Number);

  const result = new Date(
    year,
    month - 1,
    day,
    hours,
    minutes,
    0,
    0,
  );

  return result.getTime();
}

function reminderLabel(value: ReminderOption) {
  switch (value) {
    case "0":
      return "At due time";
    case "5":
      return "5 minutes before";
    case "10":
      return "10 minutes before";
    case "30":
      return "30 minutes before";
    case "60":
      return "1 hour before";
    default:
      return "No reminder";
  }
}

function App() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [newTask, setNewTask] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);

  const [reminderToast, setReminderToast] =
    useState<{
      title: string;
      body: string;
    } | null>(null);

  const [editingTask, setEditingTask] =
    useState<Task | null>(null);

  const [view, setView] = useState<View>("today");

  const [reminders, setReminders] =
    useState<ReminderMap>(loadReminders);

  const [notificationStatus, setNotificationStatus] =
    useState<"unknown" | "granted" | "denied" | "unsupported">(
      () => {
        if (!("Notification" in window)) {
          return "unsupported";
        }

        if (Notification.permission === "granted") {
          return "granted";
        }

        if (Notification.permission === "denied") {
          return "denied";
        }

        return "unknown";
      },
    );

  const completedCount = tasks.filter(
    (task) => task.completed,
  ).length;

  const remainingCount = tasks.filter(
    (task) => !task.completed,
  ).length;

  const progress =
    tasks.length === 0
      ? 0
      : Math.round(
          (completedCount / tasks.length) * 100,
        );

  const todayString = new Date()
    .toISOString()
    .split("T")[0];

  useEffect(() => {
    const loadTasks = async () => {
      try {
        let savedTasks = await db.tasks.toArray();

        if (savedTasks.length === 0) {
          await db.tasks.bulkAdd(demoTasks);
          savedTasks = demoTasks;
        }

        setTasks(savedTasks);
      } catch (error) {
        console.error(
          "Failed to load tasks:",
          error,
        );
      } finally {
        setLoading(false);
      }
    };

    loadTasks();
  }, []);

  /*
   * REMINDER ENGINE
   *
   * Checks every 10 seconds for reminders that are due.
   * This works while the web app is open.
   */
  useEffect(() => {
    const checkReminders = () => {
      const now = Date.now();
      const currentReminders = loadReminders();

      tasks.forEach((task) => {
        if (task.completed) {
          return;
        }

        const reminder =
          currentReminders[task.id];

        if (!reminder || reminder === "none") {
          return;
        }

        const dueTime =
          parseTaskDateTime(task);

        if (!dueTime) {
          return;
        }

        const minutesBefore =
          Number(reminder);

        const reminderTime =
          dueTime - minutesBefore * 60 * 1000;

        /*
         * Use a separate localStorage key to make sure
         * the same reminder isn't shown repeatedly.
         */
        const firedKey =
          `focus-reminder-fired-${task.id}-${reminder}-${dueTime}`;

        const alreadyFired =
          localStorage.getItem(firedKey);

        if (!alreadyFired && now >= reminderTime) {
          if (
            "Notification" in window &&
            Notification.permission === "granted"
          ) {
            try {
              const notificationTitle =
                reminder === "0"
                  ? `Task due: ${task.title}`
                  : `Upcoming task: ${task.title}`;

              const notificationBody =
                reminder === "0"
                  ? "Your task is due now."
                  : `${reminderLabel(
                      reminder,
                    )}.`;

              new Notification(
                notificationTitle,
                {
                  body: notificationBody,
                  icon: "/vite.svg",
                },
              );

              setReminderToast({
                title: notificationTitle,
                body: notificationBody,
              });

              // Mark as fired only after the notification was created.
              localStorage.setItem(
                firedKey,
                "true",
              );
            } catch (error) {
              console.error(
                "Failed to show notification:",
                error,
              );

              setReminderToast({
                title:
                  reminder === "0"
                    ? `Task due: ${task.title}`
                    : `Upcoming task: ${task.title}`,
                body:
                  "Browser notification could not be displayed.",
              });
            }
          } else if (
            "Notification" in window &&
            Notification.permission !== "granted"
          ) {
            setReminderToast({
              title:
                reminder === "0"
                  ? `Task due: ${task.title}`
                  : `Upcoming task: ${task.title}`,
              body:
                "Browser notifications are not enabled.",
            });
          }
        }
      });
    };

    checkReminders();

    const interval = window.setInterval(
      checkReminders,
      10000,
    );

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        checkReminders();
      }
    };

    const handleFocus = () => {
      checkReminders();
    };

    document.addEventListener(
      "visibilitychange",
      handleVisibilityChange,
    );
    window.addEventListener(
      "focus",
      handleFocus,
    );

    return () => {
      window.clearInterval(interval);
      document.removeEventListener(
        "visibilitychange",
        handleVisibilityChange,
      );
      window.removeEventListener(
        "focus",
        handleFocus,
      );
    };
  }, [tasks]);

  useEffect(() => {
    if (!reminderToast) {
      return;
    }

    const timeout = window.setTimeout(
      () => setReminderToast(null),
      10000,
    );

    return () => {
      window.clearTimeout(timeout);
    };
  }, [reminderToast]);

  const requestNotificationPermission =
    async () => {
      if (!("Notification" in window)) {
        setNotificationStatus("unsupported");
        return false;
      }

      if (
        Notification.permission === "granted"
      ) {
        setNotificationStatus("granted");
        return true;
      }

      if (
        Notification.permission === "denied"
      ) {
        setNotificationStatus("denied");
        return false;
      }

      try {
        // This is called directly from the button/change event.
        const permission =
          await Notification.requestPermission();

        if (permission === "granted") {
          setNotificationStatus("granted");
          return true;
        }

        setNotificationStatus(
          permission === "denied"
            ? "denied"
            : "unknown",
        );

        return false;
      } catch (error) {
        console.error(
          "Notification permission request failed:",
          error,
        );
        return false;
      }
    };

  const testNotification = () => {
    if (!("Notification" in window)) {
      setNotificationStatus("unsupported");
      return;
    }

    const showTest = () => {
      try {
        const notification =
          new Notification(
            "Focus reminders are working",
            {
              body: "You'll receive task reminders here.",
              icon: "/vite.svg",
            },
          );

        notification.onclick = () => {
          window.focus();
          notification.close();
        };

        setNotificationStatus("granted");
        setReminderToast({
          title: "Test notification",
          body: "The notification system is working.",
        });
      } catch (error) {
        console.error(
          "Test notification failed:",
          error,
        );
        setReminderToast({
          title: "Notification test failed",
          body:
            "Check Chrome and Windows notification settings.",
        });
      }
    };

    if (Notification.permission === "granted") {
      setNotificationStatus("granted");
      showTest();
      return;
    }

    if (Notification.permission === "denied") {
      setNotificationStatus("denied");
      alert(
        "Notifications are blocked for Focus. In Chrome, open the site settings from the icon beside the address bar and set Notifications to Allow.",
      );
      return;
    }

    // Request permission directly from this click handler.
    Notification.requestPermission()
      .then((permission) => {
        if (permission === "granted") {
          setNotificationStatus("granted");
          showTest();
        } else {
          setNotificationStatus(
            permission === "denied"
              ? "denied"
              : "unknown",
          );
          alert(
            "Notification permission was not granted. Please choose Allow when Chrome asks.",
          );
        }
      })
      .catch((error) => {
        console.error(
          "Notification permission request failed:",
          error,
        );
        alert(
          "Chrome could not request notification permission. Check the site's notification setting in Chrome.",
        );
      });
  };

  const updateReminder = async (
    taskId: number,
    value: ReminderOption,
  ) => {
    if (value !== "none") {
      const permission =
        await requestNotificationPermission();

      if (!permission) {
        return;
      }
    }

    const updatedReminders = {
      ...reminders,
      [taskId]: value,
    };

    setReminders(updatedReminders);
    saveReminders(updatedReminders);

    /*
     * Remove old fired markers for this task so that
     * changing the reminder creates a fresh reminder.
     */
    Object.keys(localStorage).forEach(
      (key) => {
        if (
          key.startsWith(
            `focus-reminder-fired-${taskId}-`,
          )
        ) {
          localStorage.removeItem(key);
        }
      },
    );
  };

  const visibleTasks = useMemo(() => {
    switch (view) {
      case "today":
        return tasks.filter(
          (task) =>
            !task.dueDate ||
            task.dueDate === todayString,
        );

      case "inbox":
        return tasks.filter(
          (task) => !task.project,
        );

      case "upcoming":
        return tasks.filter(
          (task) =>
            task.dueDate &&
            task.dueDate > todayString,
        );

      case "important":
        return tasks.filter(
          (task) =>
            task.priority === "high",
        );

      case "trash":
        return [];

      case "settings":
        return [];

      case "tags":
        return [];

      default:
        if (view.startsWith("project:")) {
          const projectName =
            view.replace("project:", "");

          return tasks.filter(
            (task) =>
              task.project === projectName,
          );
        }

        return tasks;
    }
  }, [tasks, view, todayString]);

  const searchResults = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    if (!query) {
      return tasks.slice(0, 8);
    }

    return tasks
      .filter((task) => {
        const haystack = [
          task.title,
          task.description ?? "",
          task.project ?? "",
          task.priority,
        ]
          .join(" ")
          .toLowerCase();

        return haystack.includes(query);
      })
      .slice(0, 12);
  }, [tasks, searchQuery]);

  const viewTitle = (() => {
    switch (view) {
      case "today":
        return "Today";
      case "inbox":
        return "Inbox";
      case "upcoming":
        return "Upcoming";
      case "important":
        return "Important";
      case "tags":
        return "Tags";
      case "trash":
        return "Trash";
      case "settings":
        return "Settings";
      default:
        return view.replace(
          "project:",
          "",
        );
    }
  })();

  const viewSubtitle = (() => {
    switch (view) {
      case "today":
        return "Keep your focus on what matters today.";
      case "inbox":
        return "Tasks waiting to be organized.";
      case "upcoming":
        return "See what's coming next.";
      case "important":
        return "Your highest-priority tasks.";
      case "tags":
        return "Organize tasks with tags.";
      case "trash":
        return "Deleted tasks will appear here.";
      case "settings":
        return "Customize your workspace.";
      default:
        return `Tasks in ${view.replace(
          "project:",
          "",
        )}.`;
    }
  })();

  const selectView = (nextView: View) => {
    setView(nextView);
    setSidebarOpen(false);
  };

  const toggleTask = async (id: number) => {
    const task = tasks.find(
      (item) => item.id === id,
    );

    if (!task) return;

    const completed = !task.completed;

    const updatedTask: Task = {
      ...task,
      completed,
      completedAt: completed
        ? Date.now()
        : undefined,
      updatedAt: Date.now(),
    };

    try {
      await db.tasks.put(updatedTask);

      setTasks((current) =>
        current.map((item) =>
          item.id === id
            ? updatedTask
            : item,
        ),
      );

      if (editingTask?.id === id) {
        setEditingTask((current) =>
          current
            ? {
                ...current,
                completed,
                completedAt:
                  completed
                    ? Date.now()
                    : undefined,
              }
            : null,
        );
      }
    } catch (error) {
      console.error(
        "Failed to update task:",
        error,
      );
    }
  };

  const addTask = async () => {
    const title = newTask.trim();

    if (!title) return;

    const now = Date.now();

    const task: Task = {
      id: now,
      title,
      completed: false,
      priority: "none",
      createdAt: now,
      updatedAt: now,
    };

    try {
      await db.tasks.add(task);

      setTasks((current) => [
        ...current,
        task,
      ]);

      setNewTask("");
    } catch (error) {
      console.error(
        "Failed to add task:",
        error,
      );
    }
  };

  const deleteTask = async (id: number) => {
    try {
      await db.tasks.delete(id);

      setTasks((current) =>
        current.filter(
          (task) => task.id !== id,
        ),
      );

      const updatedReminders = {
        ...reminders,
      };

      delete updatedReminders[id];

      setReminders(updatedReminders);
      saveReminders(updatedReminders);

      Object.keys(localStorage).forEach(
        (key) => {
          if (
            key.startsWith(
              `focus-reminder-fired-${id}-`,
            )
          ) {
            localStorage.removeItem(key);
          }
        },
      );

      if (editingTask?.id === id) {
        setEditingTask(null);
      }
    } catch (error) {
      console.error(
        "Failed to delete task:",
        error,
      );
    }
  };

  const saveTask = async (
    updatedTask: Task,
  ) => {
    const taskToSave = {
      ...updatedTask,
      updatedAt: Date.now(),
    };

    try {
      await db.tasks.put(taskToSave);

      setTasks((current) =>
        current.map((task) =>
          task.id === taskToSave.id
            ? taskToSave
            : task,
        ),
      );

      Object.keys(localStorage).forEach(
        (key) => {
          if (
            key.startsWith(
              `focus-reminder-fired-${taskToSave.id}-`,
            )
          ) {
            localStorage.removeItem(key);
          }
        },
      );

      setEditingTask(taskToSave);
    } catch (error) {
      console.error(
        "Failed to save task:",
        error,
      );
    }
  };

  return (
    <div className="app">
      {sidebarOpen && (
        <button
          className="sidebar-overlay"
          onClick={() =>
            setSidebarOpen(false)
          }
          aria-label="Close sidebar"
        />
      )}

      {/* SIDEBAR */}

      <aside
        className={`sidebar ${
          sidebarOpen ? "open" : ""
        }`}
      >
        <div className="sidebar-header">
          <div className="brand">
            <div className="brand-icon">
              <Check
                size={17}
                strokeWidth={3}
              />
            </div>

            <span>Focus</span>
          </div>

          <button
            className="icon-btn mobile-close"
            onClick={() =>
              setSidebarOpen(false)
            }
          >
            <X size={18} />
          </button>
        </div>

        <div className="workspace">
          <div className="avatar">S</div>

          <div className="workspace-info">
            <strong>
              My Workspace
            </strong>

            <span>Personal</span>
          </div>

          <ChevronDown size={15} />
        </div>

        <nav className="navigation">
          <button
            className={`nav-item ${
              view === "today"
                ? "active"
                : ""
            }`}
            onClick={() =>
              selectView("today")
            }
          >
            <LayoutDashboard size={18} />
            <span>Today</span>
            <small>
              {remainingCount}
            </small>
          </button>

          <button
            className={`nav-item ${
              view === "inbox"
                ? "active"
                : ""
            }`}
            onClick={() =>
              selectView("inbox")
            }
          >
            <Inbox size={18} />
            <span>Inbox</span>

            <small>
              {
                tasks.filter(
                  (task) =>
                    !task.project,
                ).length
              }
            </small>
          </button>

          <button
            className={`nav-item ${
              view === "upcoming"
                ? "active"
                : ""
            }`}
            onClick={() =>
              selectView("upcoming")
            }
          >
            <CalendarDays size={18} />
            <span>Upcoming</span>

            <small>
              {
                tasks.filter(
                  (task) =>
                    task.dueDate &&
                    task.dueDate >
                      todayString,
                ).length
              }
            </small>
          </button>
        </nav>

        <div className="sidebar-section">
          <div className="section-label">
            <span>Projects</span>

            <button className="mini-btn">
              <Plus size={14} />
            </button>
          </div>

          {projects.map(
            (project) => (
              <button
                className={`project-item ${
                  view ===
                  `project:${project.name}`
                    ? "selected"
                    : ""
                }`}
                key={project.name}
                onClick={() =>
                  selectView(
                    `project:${project.name}`,
                  )
                }
              >
                <span
                  className={`project-dot ${project.color}`}
                />

                {project.name}

                <small>
                  {
                    tasks.filter(
                      (task) =>
                        task.project ===
                        project.name,
                    ).length
                  }
                </small>
              </button>
            ),
          )}
        </div>

        <div className="sidebar-spacer" />

        <div className="sidebar-bottom">
          <button
            className={`nav-item ${
              view === "important"
                ? "active"
                : ""
            }`}
            onClick={() =>
              selectView("important")
            }
          >
            <Star size={18} />
            <span>Important</span>
          </button>

          <button
            className={`nav-item ${
              view === "tags"
                ? "active"
                : ""
            }`}
            onClick={() =>
              selectView("tags")
            }
          >
            <Tag size={18} />
            <span>Tags</span>
          </button>

          <button
            className={`nav-item ${
              view === "trash"
                ? "active"
                : ""
            }`}
            onClick={() =>
              selectView("trash")
            }
          >
            <Trash2 size={18} />
            <span>Trash</span>
          </button>

          <button
            className={`nav-item ${
              view === "settings"
                ? "active"
                : ""
            }`}
            onClick={() =>
              selectView("settings")
            }
          >
            <Settings size={18} />
            <span>Settings</span>
          </button>
        </div>
      </aside>

      {/* MAIN */}

      <main className="main">
        <header className="topbar">
          <button
            className="icon-btn menu-btn"
            onClick={() =>
              setSidebarOpen(true)
            }
          >
            <Menu size={20} />
          </button>

          <span className="page-name">
            {viewTitle}
          </span>

          <div className="topbar-right">
            <button
              className="icon-btn"
              onClick={() =>
                setSearchOpen(true)
              }
            >
              <Search size={19} />
            </button>

            <div className="top-avatar">
              S
            </div>
          </div>
        </header>

        <div className="content">
          {view === "today" ? (
            <section className="hero">
              <div>
                <p className="date">
                  {new Date().toLocaleDateString(
                    "en-US",
                    {
                      weekday:
                        "long",
                      month: "long",
                      day: "numeric",
                    },
                  )}
                </p>

                <h1>
                  Good afternoon, Sam.
                </h1>

                <p className="subtitle">
                  {viewSubtitle}
                </p>
              </div>

              <div className="progress">
                <div
                  className="progress-circle"
                  style={{
                    background: `conic-gradient(#8b5cf6 ${
                      progress * 3.6
                    }deg, #27232f 0deg)`,
                  }}
                >
                  <div>
                    {progress}%
                  </div>
                </div>

                <div className="progress-text">
                  <strong>
                    {completedCount} of{" "}
                    {tasks.length}
                  </strong>

                  <span>
                    completed
                  </span>
                </div>
              </div>
            </section>
          ) : (
            <section className="page-heading">
              <p className="date">
                Workspace
              </p>

              <h1>{viewTitle}</h1>

              <p className="subtitle">
                {viewSubtitle}
              </p>
            </section>
          )}

          {/* QUICK ADD */}

          <div className="quick-add">
            <button
              className="add-btn"
              onClick={addTask}
            >
              <Plus size={19} />
            </button>

            <input
              value={newTask}
              onChange={(event) =>
                setNewTask(
                  event.target.value,
                )
              }
              onKeyDown={(event) => {
                if (
                  event.key ===
                  "Enter"
                ) {
                  addTask();
                }
              }}
              placeholder="Add a task..."
              disabled={loading}
            />

            <div className="quick-actions">
              <button>
                <CalendarDays size={17} />
              </button>

              <button>
                <Star size={17} />
              </button>
            </div>
          </div>

          {/* TASKS */}

          {view !== "settings" &&
            view !== "tags" &&
            view !== "trash" && (
              <section className="tasks-section">
                <div className="section-title">
                  <div>
                    <h2>
                      {viewTitle}
                    </h2>

                    <span>
                      {
                        visibleTasks.filter(
                          (task) =>
                            !task.completed,
                        ).length
                      }{" "}
                      remaining
                    </span>
                  </div>

                  <button className="sort-btn">
                    Sort
                    <ChevronDown
                      size={14}
                    />
                  </button>
                </div>

                <div className="task-list">
                  {loading ? (
                    <div className="empty">
                      <div className="empty-icon">
                        <Clock3
                          size={20}
                        />
                      </div>

                      <h3>
                        Loading your
                        tasks...
                      </h3>
                    </div>
                  ) : (
                    <>
                      {visibleTasks.map(
                        (task) => (
                          <div
                            className={`task ${
                              task.completed
                                ? "completed"
                                : ""
                            }`}
                            key={task.id}
                          >
                            <button
                              className={`checkbox priority-${task.priority}`}
                              onClick={() =>
                                toggleTask(
                                  task.id,
                                )
                              }
                              aria-label={
                                task.completed
                                  ? "Mark task incomplete"
                                  : "Complete task"
                              }
                            >
                              {task.completed && (
                                <Check
                                  size={
                                    13
                                  }
                                  strokeWidth={
                                    3
                                  }
                                />
                              )}
                            </button>

                            <button
                              className="task-content"
                              onClick={() =>
                                setEditingTask(
                                  task,
                                )
                              }
                            >
                              <span className="task-title">
                                {task.title}
                              </span>

                              {(task.time ||
                                task.project ||
                                task.dueDate ||
                                reminders[
                                  task.id
                                ]) && (
                                <div className="task-meta">
                                  {task.time && (
                                    <span>
                                      <Clock3
                                        size={
                                          12
                                        }
                                      />
                                      {
                                        task.time
                                      }
                                    </span>
                                  )}

                                  {task.dueDate && (
                                    <span>
                                      <CalendarDays
                                        size={
                                          12
                                        }
                                      />

                                      {new Date(
                                        `${task.dueDate}T00:00:00`,
                                      ).toLocaleDateString(
                                        "en-US",
                                        {
                                          month:
                                            "short",
                                          day: "numeric",
                                        },
                                      )}
                                    </span>
                                  )}

                                  {task.project && (
                                    <span>
                                      <span className="tiny-dot" />
                                      {
                                        task.project
                                      }
                                    </span>
                                  )}

                                  {reminders[
                                    task.id
                                  ] &&
                                    reminders[
                                      task.id
                                    ] !==
                                      "none" && (
                                      <span>
                                        <Bell
                                          size={
                                            12
                                          }
                                        />
                                        Reminder
                                      </span>
                                    )}
                                </div>
                              )}
                            </button>

                            {task.priority !==
                              "none" && (
                              <span
                                className={`priority ${task.priority}`}
                              >
                                {
                                  task.priority
                                }
                              </span>
                            )}

                            <button
                              className="delete-btn"
                              onClick={() =>
                                deleteTask(
                                  task.id,
                                )
                              }
                              aria-label={`Delete ${task.title}`}
                            >
                              <Trash2
                                size={15}
                              />
                            </button>
                          </div>
                        ),
                      )}

                      {visibleTasks.length ===
                        0 && (
                        <div className="empty">
                          <div className="empty-icon">
                            <Check
                              size={21}
                            />
                          </div>

                          <h3>
                            Nothing here
                          </h3>

                          <p>
                            There are no
                            tasks in this
                            view.
                          </p>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </section>
            )}

          {view === "tags" && (
            <div className="feature-placeholder">
              <div className="empty-icon">
                <Tag size={21} />
              </div>

              <h3>
                Tags are coming next
              </h3>

              <p>
                We'll build a proper
                tag system if you
                actually need it.
              </p>
            </div>
          )}

          {view === "trash" && (
            <div className="feature-placeholder">
              <div className="empty-icon">
                <Trash2 size={21} />
              </div>

              <h3>
                Trash is coming next
              </h3>

              <p>
                Deleted tasks will
                eventually be
                recoverable from here.
              </p>
            </div>
          )}

          {view === "settings" && (
            <div className="feature-placeholder">
              <div className="empty-icon">
                <Bell size={21} />
              </div>

              <h3>
                Reminder notifications
              </h3>

              <p>
                Test your browser
                notification permission
                before relying on task
                reminders.
              </p>

              <button
                type="button"
                className="save-button"
                onClick={testNotification}
              >
                Test notification
              </button>

              <p
                style={{
                  marginTop: 12,
                  fontSize: 12,
                }}
              >
                Status:{" "}
                {notificationStatus ===
                "granted"
                  ? "Notifications enabled ✓"
                  : notificationStatus ===
                      "denied"
                    ? "Notifications blocked"
                    : notificationStatus ===
                        "unsupported"
                      ? "Notifications not supported"
                      : "Permission not requested"}
              </p>
            </div>
          )}

          {view === "today" && (
            <div className="stats">
              <div className="stat">
                <div className="stat-icon purple">
                  <Check size={17} />
                </div>

                <div>
                  <span>
                    Completed
                  </span>

                  <strong>
                    {completedCount}
                  </strong>
                </div>
              </div>

              <div className="stat">
                <div className="stat-icon blue">
                  <Clock3 size={17} />
                </div>

                <div>
                  <span>
                    Focus time
                  </span>

                  <strong>
                    45m
                  </strong>
                </div>
              </div>

              <div className="stat">
                <div className="stat-icon amber">
                  <Star size={17} />
                </div>

                <div>
                  <span>
                    High priority
                  </span>

                  <strong>
                    {
                      tasks.filter(
                        (task) =>
                          task.priority ===
                          "high",
                      ).length
                    }
                  </strong>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* TASK EDITOR */}

      {editingTask && (
        <TaskEditor
          task={editingTask}
          reminder={
            reminders[
              editingTask.id
            ] ?? "none"
          }
          onClose={() =>
            setEditingTask(null)
          }
          onSave={saveTask}
          onDelete={deleteTask}
          onToggle={toggleTask}
          onReminderChange={
            updateReminder
          }
        />
      )}

      {/* SEARCH */}

      {searchOpen && (
        <div
          className="modal"
          onClick={() =>
            setSearchOpen(false)
          }
        >
          <div
            className="search-modal"
            onClick={(event) =>
              event.stopPropagation()
            }
          >
            <div className="search-box">
              <Search size={18} />

              <input
                autoFocus
                value={searchQuery}
                onChange={(event) =>
                  setSearchQuery(
                    event.target.value,
                  )
                }
                placeholder="Search tasks..."
              />

              <button
                type="button"
                onClick={() => {
                  setSearchQuery("");
                  setSearchOpen(false);
                }}
                aria-label="Close search"
              >
                <X size={17} />
              </button>
            </div>

            <div className="search-results">
              {searchResults.length > 0 ? (
                searchResults.map((task) => (
                  <button
                    type="button"
                    className="search-result"
                    key={task.id}
                    onClick={() => {
                      setEditingTask(task);
                      setSearchOpen(false);
                      setSearchQuery("");
                    }}
                  >
                    <span
                      className={`checkbox priority-${task.priority}`}
                    >
                      {task.completed && (
                        <Check
                          size={12}
                          strokeWidth={3}
                        />
                      )}
                    </span>

                    <span className="search-result-content">
                      <strong>
                        {task.title}
                      </strong>

                      <span>
                        {[
                          task.project,
                          task.dueDate,
                          task.time,
                        ]
                          .filter(Boolean)
                          .join(" • ") ||
                          "No date or project"}
                      </span>
                    </span>
                  </button>
                ))
              ) : (
                <div className="search-empty">
                  <Search size={18} />
                  <span>
                    No tasks found
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {reminderToast && (
        <div className="reminder-toast">
          <div className="reminder-toast-icon">
            <Bell size={17} />
          </div>

          <div>
            <strong>
              {reminderToast.title}
            </strong>
            <span>
              {reminderToast.body}
            </span>
          </div>

          <button
            type="button"
            onClick={() =>
              setReminderToast(null)
            }
            aria-label="Dismiss reminder"
          >
            <X size={15} />
          </button>
        </div>
      )}
    </div>
  );
}

type TaskEditorProps = {
  task: Task;
  reminder: ReminderOption;
  onClose: () => void;
  onSave: (task: Task) => void;
  onDelete: (id: number) => void;
  onToggle: (id: number) => void;
  onReminderChange: (
    id: number,
    value: ReminderOption,
  ) => void;
};

function TaskEditor({
  task,
  reminder,
  onClose,
  onSave,
  onDelete,
  onToggle,
  onReminderChange,
}: TaskEditorProps) {
  const [draft, setDraft] =
    useState<Task>(task);

  const updateDraft = <
    K extends keyof Task,
  >(
    field: K,
    value: Task[K],
  ) => {
    setDraft((current) => ({
      ...current,
      [field]: value,
    }));
  };

  const handleToggle = () => {
    const completed =
      !draft.completed;

    const updated = {
      ...draft,
      completed,
      completedAt: completed
        ? Date.now()
        : undefined,
    };

    setDraft(updated);
    onToggle(draft.id);
  };

  const handleSave = () => {
    if (!draft.title.trim()) {
      return;
    }

    onSave({
      ...draft,
      title: draft.title.trim(),
    });
  };

  return (
    <div
      className="editor-backdrop"
      onClick={onClose}
    >
      <aside
        className="task-editor"
        onClick={(event) =>
          event.stopPropagation()
        }
      >
        <div className="editor-header">
          <span>Edit task</span>

          <button
            className="icon-btn"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>

        <div className="editor-body">
          <button
            className={`editor-complete ${
              draft.completed
                ? "done"
                : ""
            }`}
            onClick={handleToggle}
          >
            <span>
              {draft.completed && (
                <Check size={14} />
              )}
            </span>

            {draft.completed
              ? "Completed"
              : "Mark as complete"}
          </button>

          <div className="editor-field">
            <label>Task</label>

            <input
              className="editor-title"
              value={draft.title}
              onChange={(event) =>
                updateDraft(
                  "title",
                  event.target.value,
                )
              }
              autoFocus
            />
          </div>

          <div className="editor-field">
            <label>
              Description
            </label>

            <textarea
              value={
                draft.description ?? ""
              }
              onChange={(event) =>
                updateDraft(
                  "description",
                  event.target.value,
                )
              }
              placeholder="Add some details..."
              rows={4}
            />
          </div>

          <div className="editor-grid">
            <div className="editor-field">
              <label>Priority</label>

              <select
                value={draft.priority}
                onChange={(event) =>
                  updateDraft(
                    "priority",
                    event.target
                      .value as TaskPriority,
                  )
                }
              >
                <option value="none">
                  No priority
                </option>

                <option value="low">
                  Low
                </option>

                <option value="medium">
                  Medium
                </option>

                <option value="high">
                  High
                </option>
              </select>
            </div>

            <div className="editor-field">
              <label>Project</label>

              <select
                value={
                  draft.project ?? ""
                }
                onChange={(event) =>
                  updateDraft(
                    "project",
                    event.target.value ||
                      undefined,
                  )
                }
              >
                <option value="">
                  No project
                </option>

                {projects.map(
                  (project) => (
                    <option
                      value={
                        project.name
                      }
                      key={
                        project.name
                      }
                    >
                      {project.name}
                    </option>
                  ),
                )}
              </select>
            </div>
          </div>

          <div className="editor-grid">
            <div className="editor-field">
              <label>Due date</label>

              <div className="input-with-icon">
                <CalendarDays
                  size={16}
                />

                <input
                  type="date"
                  value={
                    draft.dueDate ?? ""
                  }
                  onChange={(event) =>
                    updateDraft(
                      "dueDate",
                      event.target
                        .value ||
                        undefined,
                    )
                  }
                />
              </div>
            </div>

            <div className="editor-field">
              <label>Time</label>

              <div className="input-with-icon">
                <Clock3 size={16} />

                <input
                  type="time"
                  value={
                    draft.time ?? ""
                  }
                  onChange={(event) =>
                    updateDraft(
                      "time",
                      event.target
                        .value ||
                        undefined,
                    )
                  }
                />
              </div>
            </div>
          </div>

          {/* REMINDER */}

          <div className="editor-field reminder-field">
            <label>
              <span className="label-with-icon">
                <Bell size={13} />
                Reminder
              </span>
            </label>

            <select
              value={reminder}
              onChange={(event) =>
                onReminderChange(
                  draft.id,
                  event.target
                    .value as ReminderOption,
                )
              }
            >
              <option value="none">
                No reminder
              </option>

              <option value="0">
                At due time
              </option>

              <option value="5">
                5 minutes before
              </option>

              <option value="10">
                10 minutes before
              </option>

              <option value="30">
                30 minutes before
              </option>

              <option value="60">
                1 hour before
              </option>
            </select>

            {!draft.dueDate && (
              <span className="field-hint">
                Set a due date to use
                reminders.
              </span>
            )}
          </div>
        </div>

        <div className="editor-footer">
          <button
            className="danger-button"
            onClick={() =>
              onDelete(draft.id)
            }
          >
            <Trash2 size={15} />
            Delete
          </button>

          <div className="editor-footer-right">
            <button
              className="cancel-button"
              onClick={onClose}
            >
              Cancel
            </button>

            <button
              className="save-button"
              onClick={handleSave}
            >
              Save changes
            </button>
          </div>
        </div>
      </aside>
    </div>
  );
}

export default App;