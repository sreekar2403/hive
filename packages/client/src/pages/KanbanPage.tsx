import { useState, DragEvent } from 'react';
import { Plus, MoreHorizontal } from 'lucide-react';

interface Task {
  id: string;
  title: string;
  priority: 'low' | 'medium' | 'high';
}

interface Column {
  id: string;
  title: string;
  tasks: Task[];
}

const initialColumns: Column[] = [
  { id: 'backlog', title: 'Backlog', tasks: [
    { id: '1', title: 'Set up CI/CD pipeline', priority: 'medium' },
    { id: '2', title: 'Write API documentation', priority: 'low' },
  ]},
  { id: 'in-progress', title: 'In Progress', tasks: [
    { id: '3', title: 'Build chat interface', priority: 'high' },
  ]},
  { id: 'review', title: 'Review', tasks: [
    { id: '4', title: 'Database schema design', priority: 'medium' },
  ]},
  { id: 'done', title: 'Done', tasks: [
    { id: '5', title: 'Project scaffolding', priority: 'low' },
  ]},
];

const priorityColors = { low: 'bg-gray-500', medium: 'bg-yellow-500', high: 'bg-red-500' };

export function KanbanPage() {
  const [columns, setColumns] = useState<Column[]>(initialColumns);
  const [draggedTask, setDraggedTask] = useState<{ taskId: string; fromColumn: string } | null>(null);

  const handleDragStart = (e: DragEvent, taskId: string, columnId: string) => {
    setDraggedTask({ taskId, fromColumn: columnId });
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (e: DragEvent, targetColumnId: string) => {
    e.preventDefault();
    if (!draggedTask) return;
    setColumns((prev) => {
      const newCols = prev.map((c) => ({ ...c, tasks: [...c.tasks] }));
      const fromCol = newCols.find((c) => c.id === draggedTask.fromColumn);
      const toCol = newCols.find((c) => c.id === targetColumnId);
      if (!fromCol || !toCol) return prev;
      const taskIndex = fromCol.tasks.findIndex((t) => t.id === draggedTask.taskId);
      if (taskIndex === -1) return prev;
      const [task] = fromCol.tasks.splice(taskIndex, 1);
      toCol.tasks.push(task);
      return newCols;
    });
    setDraggedTask(null);
  };

  const addTask = (columnId: string) => {
    const title = prompt('Task title:');
    if (!title) return;
    setColumns((prev) =>
      prev.map((c) =>
        c.id === columnId ? { ...c, tasks: [...c.tasks, { id: Date.now().toString(), title, priority: 'medium' }] } : c
      )
    );
  };

  return (
    <div className="p-6 h-full">
      <h1 className="text-2xl font-bold mb-6">Kanban Board</h1>
      <div className="flex gap-4 h-[calc(100%-3rem)] overflow-x-auto">
        {columns.map((col) => (
          <div
            key={col.id}
            className="w-72 bg-gray-900 rounded-xl border border-gray-800 flex flex-col flex-shrink-0"
            onDragOver={handleDragOver}
            onDrop={(e) => handleDrop(e, col.id)}
          >
            <div className="p-3 border-b border-gray-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h2 className="font-semibold text-sm">{col.title}</h2>
                <span className="bg-gray-700 text-xs px-2 py-0.5 rounded-full">{col.tasks.length}</span>
              </div>
              <button onClick={() => addTask(col.id)} className="text-gray-400 hover:text-white">
                <Plus className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-2">
              {col.tasks.map((task) => (
                <div
                  key={task.id}
                  draggable
                  onDragStart={(e) => handleDragStart(e, task.id, col.id)}
                  className="bg-gray-800 border border-gray-700 rounded-lg p-3 cursor-grab active:cursor-grabbing hover:border-gray-600"
                >
                  <p className="text-sm text-gray-100">{task.title}</p>
                  <div className="flex items-center justify-between mt-2">
                    <div className={w-2 h-2 rounded-full } />
                    <MoreHorizontal className="w-4 h-4 text-gray-500" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
