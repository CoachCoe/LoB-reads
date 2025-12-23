interface ProgressBarProps {
  value: number;
  max: number;
  showLabel?: boolean;
  className?: string;
}

export default function ProgressBar({
  value,
  max,
  showLabel = true,
  className = "",
}: ProgressBarProps) {
  const percentage = max > 0 ? Math.round((value / max) * 100) : 0;

  return (
    <div className={`w-full ${className}`}>
      <div className="flex justify-between items-center mb-1">
        {showLabel && (
          <>
            <span className="text-sm text-gray-600">
              {value} / {max} pages
            </span>
            <span className="text-sm font-medium text-[#D4A017]">
              {percentage}%
            </span>
          </>
        )}
      </div>
      <div className="w-full bg-gray-200 rounded-full h-2.5 overflow-hidden">
        <div
          className="bg-gradient-to-r from-[#D4A017] to-[#D4A017] h-2.5 rounded-full transition-all duration-500"
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}
