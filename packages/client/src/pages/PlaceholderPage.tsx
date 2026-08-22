export function PlaceholderPage({ title }: { title: string }) {
  return (
    <div className="flex items-center justify-center h-full">
      <h1 className="text-2xl text-gray-400">{title}</h1>
    </div>
  );
}