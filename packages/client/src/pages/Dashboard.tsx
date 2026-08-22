import { Users, CheckCircle, Clock } from 'lucide-react';

interface StatCardProps {
  title: string;
  value: number | string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
}

function StatCard({ title, value, icon: Icon, color }: StatCardProps) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-400">{title}</p>
          <p className="text-3xl font-bold text-white mt-1">{value}</p>
        </div>
        <div className={`p-3 rounded-lg ${color}`}>
          <Icon className="w-6 h-6 text-white" aria-hidden="true" />
        </div>
      </div>
    </div>
  );
}

export function Dashboard() {
  return (
    <div className="p-8 space-y-8">
      <h1 className="text-3xl font-bold text-white">Dashboard</h1>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <StatCard
          title="Active Agents"
          value={0}
          icon={Users}
          color="bg-blue-500"
        />
        <StatCard
          title="Tasks Completed"
          value={0}
          icon={CheckCircle}
          color="bg-green-500"
        />
        <StatCard
          title="Queue Depth"
          value={0}
          icon={Clock}
          color="bg-amber-500"
        />
      </div>
    </div>
  );
}