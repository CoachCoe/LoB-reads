interface BadgeProps {
  children: React.ReactNode;
  variant?: "default" | "primary" | "success" | "warning" | "danger";
  className?: string;
}

export default function Badge({
  children,
  variant = "default",
  className = "",
}: BadgeProps) {
  const variants = {
    default: "bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300",
    primary: "bg-[#D4A017]/10 text-[#D4A017]",
    success: "bg-[#D4A017]/10 text-[#D4A017]",
    warning: "bg-yellow-100 text-yellow-700",
    danger: "bg-red-100 dark:bg-red-950 text-red-700 dark:text-red-300",
  };

  return (
    <span
      className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium ${variants[variant]} ${className}`}
    >
      {children}
    </span>
  );
}
