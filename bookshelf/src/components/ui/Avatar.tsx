import Image from "next/image";

interface AvatarProps {
  src?: string | null;
  name: string;
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
}

export default function Avatar({
  src,
  name,
  size = "md",
  className = "",
}: AvatarProps) {
  const sizes = {
    sm: "h-8 w-8 text-xs",
    md: "h-10 w-10 text-sm",
    lg: "h-14 w-14 text-lg",
    xl: "h-20 w-20 text-xl",
  };

  const getInitials = (name: string) => {
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  if (src) {
    return (
      <div
        className={`${sizes[size]} relative rounded-full overflow-hidden ring-2 ring-white shadow-sm ${className}`}
      >
        <Image
          src={src}
          alt={name}
          fill
          className="object-cover"
          unoptimized
        />
      </div>
    );
  }

  return (
    <div
      className={`${sizes[size]} rounded-full bg-gradient-to-br from-[#7047EB] to-[#5fbd74] text-white flex items-center justify-center font-semibold shadow-sm ${className}`}
    >
      {getInitials(name)}
    </div>
  );
}
