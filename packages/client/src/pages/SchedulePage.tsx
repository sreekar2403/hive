import { useState } from "react";
import {
  Calendar,
  List,
  Plus,
  Play,
  Pause,
  Trash2,
  ChevronLeft,
  ChevronRight,
  X,
  Check,
  Loader2,
  AlertTriangle,
} from "lucide-react";

type ViewMode = "calendar" | "list";
type ScheduleStatus = "active" | "paused" | "error";

interface Schedule {
  id: string;
  name: string;
  cron: string;
  workflow: string;
  status: ScheduleStatus;
}

const mockSchedules: Schedule[] = [
  {
    id: "1",
    name: "Daily Build",
    cron: "0 9 * * 1-5",
    workflow: "ci-build",
    status: "active",
  },
  {
    id: "2",
    name: "Nightly Tests",
    cron: "0 2 * * *",
    workflow: "test-suite",
    status: "active",
  },
  {
    id: "3",
    name: "Weekly Deploy",
    cron: "0 10 * * 1",
    workflow: "deploy-staging",
    status: "paused",
  },
  {
    id: "4",
    name: "Monthly Report",
    cron: "0 8 1 * *",
    workflow: "generate-report",
    status: "error",
  },
  {
    id: "5",
    name: "Hourly Sync",
    cron: "0 * * * *",
    workflow: "data-sync",
    status: "active",
  },
];

const mockWorkflows = [
  "ci-build",
  "test-suite",
  "deploy-staging",
  "generate-report",
  "data-sync",
  "lint-check",
  "security-scan",
];

const statusConfig: Record<
  ScheduleStatus,
  {
    label: string;
    color: string;
    bg: string;
    icon: typeof Play | typeof Pause | typeof AlertTriangle;
  }
> = {
  active: {
    label: "Active",
    color: "text-green-400",
    bg: "bg-green-400/10",
    icon: Play,
  },
  paused: {
    label: "Paused",
    color: "text-yellow-400",
    bg: "bg-yellow-400/10",
    icon: Pause,
  },
  error: {
    label: "Error",
    color: "text-red-400",
    bg: "bg-red-400/10",
    icon: AlertTriangle,
  },
};

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfMonth(year: number, month: number): number {
  return new Date(year, month, 1).getDay();
}

function getSchedulesForDay(day: number, schedules: Schedule[]): Schedule[] {
  return schedules.filter((schedule) => {
    if (schedule.status !== "active") return false;
    const cronParts = schedule.cron.split(" ");
    if (cronParts.length !== 5) return false;
    const dayOfMonth = cronParts[3];
    const dayOfWeek = cronParts[4];

    if (dayOfMonth !== "*" && dayOfMonth !== "?" && !dayOfMonth.includes("/")) {
      const days = dayOfMonth.split(",").map((d) => parseInt(d.trim(), 10));
      if (days.includes(day)) return true;
    }

    if (dayOfWeek !== "*" && dayOfWeek !== "?") {
      const today = new Date();
      today.setDate(day);
      const dow = today.getDay();
      const dowStr = dow.toString();
      if (
        dayOfWeek.includes(dowStr) ||
        dayOfWeek.includes(`${dowStr}-${dowStr}`)
      )
        return true;
      if (dayOfWeek === "1-5" && dow >= 1 && dow <= 5) return true;
      if (dayOfWeek === "0,6" && (dow === 0 || dow === 6)) return true;
    }

    return dayOfMonth === "*" && dayOfWeek === "*";
  });
}

function parseCronDescription(cron: string): string {
  const parts = cron.split(" ");
  if (parts.length !== 5) return "Invalid cron expression";

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

  let desc = "";

  if (minute === "0" && hour !== "*") {
    desc += `At ${parseInt(hour, 10)}:${minute.padStart(2, "0")}`;
  } else if (minute !== "*") {
    desc += `At minute ${minute}`;
  }

  if (dayOfMonth !== "*") {
    if (dayOfMonth.includes("-")) {
      desc += ` on days ${dayOfMonth}`;
    } else if (dayOfMonth.includes("/")) {
      desc += ` every ${dayOfMonth.split("/")[1]} days`;
    } else {
      desc += ` on day ${dayOfMonth}`;
    }
  }

  if (month !== "*") {
    const months = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ];
    const monthNum = parseInt(month, 10);
    if (!isNaN(monthNum) && monthNum >= 1 && monthNum <= 12) {
      desc += ` in ${months[monthNum - 1]}`;
    }
  }

  if (dayOfWeek !== "*") {
    const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    if (dayOfWeek === "1-5") {
      desc += " on weekdays";
    } else if (dayOfWeek === "0,6" || dayOfWeek === "6,0") {
      desc += " on weekends";
    } else if (dayOfWeek.includes("-")) {
      const [start, end] = dayOfWeek.split("-").map((d) => parseInt(d, 10));
      if (!isNaN(start) && !isNaN(end)) {
        desc += ` on ${days[start]}-${days[end]}`;
      }
    } else {
      const dayNum = parseInt(dayOfWeek, 10);
      if (!isNaN(dayNum) && dayNum >= 0 && dayNum <= 6) {
        desc += ` on ${days[dayNum]}`;
      }
    }
  }

  return desc || "Every minute";
}

export function SchedulePage() {
  const [viewMode, setViewMode] = useState<ViewMode>("calendar");
  const [currentDate, setCurrentDate] = useState(new Date());
  const [showForm, setShowForm] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<Schedule | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    cron: "",
    workflow: "",
    status: "active" as ScheduleStatus,
  });
  const [schedules, setSchedules] = useState<Schedule[]>(mockSchedules);

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const daysInMonth = getDaysInMonth(year, month);
  const firstDayOfWeek = getFirstDayOfMonth(year, month);
  const monthName = currentDate.toLocaleString("default", {
    month: "long",
    year: "numeric",
  });

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingSchedule) {
      setSchedules(
        schedules.map((s) =>
          s.id === editingSchedule.id
            ? { ...formData, id: editingSchedule.id }
            : s,
        ),
      );
    } else {
      const newSchedule: Schedule = {
        id: crypto.randomUUID(),
        ...formData,
      };
      setSchedules([...schedules, newSchedule]);
    }
    resetForm();
  };

  const resetForm = () => {
    setFormData({ name: "", cron: "", workflow: "", status: "active" });
    setEditingSchedule(null);
    setShowForm(false);
  };

  const handleEdit = (schedule: Schedule) => {
    setFormData({
      name: schedule.name,
      cron: schedule.cron,
      workflow: schedule.workflow,
      status: schedule.status,
    });
    setEditingSchedule(schedule);
    setShowForm(true);
  };

  const handleDelete = (id: string) => {
    if (confirm("Are you sure you want to delete this schedule?")) {
      setSchedules(schedules.filter((s) => s.id !== id));
    }
  };

  const handleStatusToggle = (schedule: Schedule) => {
    const newStatus: ScheduleStatus =
      schedule.status === "active" ? "paused" : "active";
    setSchedules(
      schedules.map((s) =>
        s.id === schedule.id ? { ...s, status: newStatus } : s,
      ),
    );
  };

  const prevMonth = () => setCurrentDate(new Date(year, month - 1, 1));
  const nextMonth = () => setCurrentDate(new Date(year, month + 1, 1));

  const cronDescription = formData.cron
    ? parseCronDescription(formData.cron)
    : "";

  return (
    <div className="p-6 h-full flex flex-col">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Schedule Jobs</h1>
        <button
          onClick={() => {
            resetForm();
            setShowForm(true);
          }}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-white text-sm"
        >
          <Plus className="w-4 h-4" /> New Schedule
        </button>
      </div>

      <div className="flex items-center gap-2 mb-4 bg-gray-900 border border-gray-800 rounded-lg p-1">
        <button
          onClick={() => setViewMode("calendar")}
          className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm transition-colors ${
            viewMode === "calendar"
              ? "bg-blue-600 text-white"
              : "text-gray-400 hover:text-white hover:bg-gray-800"
          }`}
        >
          <Calendar className="w-4 h-4" /> Calendar
        </button>
        <button
          onClick={() => setViewMode("list")}
          className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm transition-colors ${
            viewMode === "list"
              ? "bg-blue-600 text-white"
              : "text-gray-400 hover:text-white hover:bg-gray-800"
          }`}
        >
          <List className="w-4 h-4" /> List
        </button>
      </div>

      {viewMode === "calendar" ? (
        <div className="flex-1 overflow-auto bg-gray-900 border border-gray-800 rounded-xl">
          <div className="p-4 border-b border-gray-800 flex items-center justify-between">
            <button
              onClick={prevMonth}
              className="p-2 hover:bg-gray-800 rounded-lg transition-colors"
              aria-label="Previous month"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <h2 className="text-lg font-semibold">{monthName}</h2>
            <button
              onClick={nextMonth}
              className="p-2 hover:bg-gray-800 rounded-lg transition-colors"
              aria-label="Next month"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>

          <div className="grid grid-cols-7 gap-0 p-2">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
              <div
                key={day}
                className="text-center text-xs text-gray-500 py-2 font-medium"
              >
                {day}
              </div>
            ))}

            {/* Empty cells before first day */}
            {Array.from({ length: firstDayOfWeek }).map((_, i) => (
              <div key={`empty-${i}`} className="aspect-square" />
            ))}

            {/* Days of month */}
            {Array.from({ length: daysInMonth }).map((_, i) => {
              const day = i + 1;
              const daySchedules = getSchedulesForDay(day, schedules);
              const isToday =
                day === new Date().getDate() &&
                month === new Date().getMonth() &&
                year === new Date().getFullYear();

              return (
                <div
                  key={day}
                  className={`relative aspect-square p-1 flex flex-col ${
                    isToday ? "bg-blue-600/20" : "hover:bg-gray-800/50"
                  }`}
                >
                  <span
                    className={`text-sm ${isToday ? "text-blue-400 font-bold" : "text-gray-300"}`}
                  >
                    {day}
                  </span>
                  {daySchedules.length > 0 && (
                    <div className="flex flex-wrap gap-0.5 mt-1 flex-1 overflow-hidden">
                      {daySchedules.slice(0, 3).map((schedule) => (
                        <div
                          key={schedule.id}
                          className="w-1.5 h-1.5 rounded-full bg-blue-500 flex-shrink-0"
                          title={schedule.name}
                        />
                      ))}
                      {daySchedules.length > 3 && (
                        <span className="text-[10px] text-gray-500 flex-1 text-center">
                          +{daySchedules.length - 3}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-auto bg-gray-900 border border-gray-800 rounded-xl">
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-gray-800">
                  <th className="p-4 text-sm font-medium text-gray-400">
                    Name
                  </th>
                  <th className="p-4 text-sm font-medium text-gray-400">
                    Schedule
                  </th>
                  <th className="p-4 text-sm font-medium text-gray-400">
                    Workflow
                  </th>
                  <th className="p-4 text-sm font-medium text-gray-400">
                    Status
                  </th>
                  <th className="p-4 text-sm font-medium text-gray-400">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {schedules.map((schedule) => {
                  const {
                    label,
                    color,
                    bg,
                    icon: StatusIcon,
                  } = statusConfig[schedule.status];
                  return (
                    <tr
                      key={schedule.id}
                      className="border-b border-gray-800/50 hover:bg-gray-800/50 transition-colors"
                    >
                      <td className="p-4 font-medium text-white">
                        {schedule.name}
                      </td>
                      <td
                        className="p-4 font-mono text-sm text-gray-300 max-w-[200px] truncate"
                        title={schedule.cron}
                      >
                        {schedule.cron}
                      </td>
                      <td className="p-4 text-gray-300">
                        <span className="px-2 py-0.5 bg-gray-800 rounded text-sm">
                          {schedule.workflow}
                        </span>
                      </td>
                      <td className="p-4">
                        <span
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${bg} ${color}`}
                        >
                          <StatusIcon className="w-3 h-3" />
                          {label}
                        </span>
                      </td>
                      <td className="p-4">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleStatusToggle(schedule)}
                            className="p-1.5 hover:bg-gray-800 rounded-lg transition-colors text-gray-400 hover:text-white"
                            aria-label={
                              schedule.status === "active"
                                ? "Pause"
                                : "Activate"
                            }
                          >
                            {schedule.status === "active" ? (
                              <Pause className="w-4 h-4" />
                            ) : (
                              <Play className="w-4 h-4" />
                            )}
                          </button>
                          <button
                            onClick={() => handleEdit(schedule)}
                            className="p-1.5 hover:bg-gray-800 rounded-lg transition-colors text-gray-400 hover:text-white"
                            aria-label="Edit"
                          >
                            <Loader2 className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleDelete(schedule.id)}
                            className="p-1.5 hover:bg-gray-800 rounded-lg transition-colors text-gray-400 hover:text-red-400"
                            aria-label="Delete"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* New/Edit Schedule Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 border border-gray-800 rounded-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="p-4 border-b border-gray-800 flex items-center justify-between">
              <h2 className="text-lg font-semibold">
                {editingSchedule ? "Edit Schedule" : "New Schedule"}
              </h2>
              <button
                onClick={resetForm}
                className="p-1 hover:bg-gray-800 rounded-lg transition-colors text-gray-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleFormSubmit} className="p-4 space-y-4">
              <div>
                <label className="block text-sm text-gray-400 mb-1">Name</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) =>
                    setFormData({ ...formData, name: e.target.value })
                  }
                  placeholder="e.g., Daily Build"
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
                  required
                />
              </div>

              <div>
                <label className="block text-sm text-gray-400 mb-1">
                  Cron Expression
                </label>
                <input
                  type="text"
                  value={formData.cron}
                  onChange={(e) =>
                    setFormData({ ...formData, cron: e.target.value })
                  }
                  placeholder="0 9 * * 1-5"
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm font-mono focus:outline-none focus:border-blue-500"
                  required
                />
                {cronDescription && (
                  <p className="mt-1 text-xs text-green-400">
                    {cronDescription}
                  </p>
                )}
                <p className="mt-1 text-xs text-gray-500">
                  Example:{" "}
                  <code className="font-mono text-gray-400">0 9 * * 1-5</code> =
                  weekdays at 9am
                </p>
              </div>

              <div>
                <label className="block text-sm text-gray-400 mb-1">
                  Workflow
                </label>
                <select
                  value={formData.workflow}
                  onChange={(e) =>
                    setFormData({ ...formData, workflow: e.target.value })
                  }
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
                  required
                >
                  <option value="">Select a workflow</option>
                  {mockWorkflows.map((wf) => (
                    <option key={wf} value={wf}>
                      {wf}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm text-gray-400 mb-1">
                  Status
                </label>
                <div className="flex items-center gap-4">
                  {(["active", "paused"] as ScheduleStatus[]).map((status) => {
                    const { label, color, bg } = statusConfig[status];
                    return (
                      <label
                        key={status}
                        className="flex items-center gap-2 cursor-pointer"
                      >
                        <input
                          type="radio"
                          name="status"
                          value={status}
                          checked={formData.status === status}
                          onChange={() => setFormData({ ...formData, status })}
                          className="w-4 h-4 text-blue-600 border-gray-600 bg-gray-800 focus:ring-blue-500"
                        />
                        <span
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${bg} ${color}`}
                        >
                          {label}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-gray-800">
                <button
                  type="button"
                  onClick={resetForm}
                  className="px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-white text-sm"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-white text-sm"
                >
                  <Check className="w-4 h-4" />
                  {editingSchedule ? "Update" : "Create"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
