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
            <span className="text-sm font-medium text-[#7047EB]">
              {percentage}%
            </span>
          </>
        )}
      </div>
      <div className="w-full bg-gray-200 rounded-full h-2.5 overflow-hidden">
        <div
          className="bg-gradient-to-r from-[#7047EB] to-[#5fbd74] h-2.5 rounded-full transition-all duration-500"
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}
