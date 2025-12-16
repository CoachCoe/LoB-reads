"use client";

import { forwardRef, ButtonHTMLAttributes } from "react";
import { Loader2 } from "lucide-react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "outline" | "ghost" | "danger" | "success";
  size?: "sm" | "md" | "lg";
  isLoading?: boolean;
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      children,
      className = "",
      variant = "primary",
      size = "md",
      isLoading = false,
      disabled,
      ...props
    },
    ref
  ) => {
    const baseStyles =
      "inline-flex items-center justify-center font-medium rounded-full transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed";

    const variants = {
      primary: "bg-[#7047EB] text-white hover:bg-[#5a35d4] focus:ring-[#7047EB] shadow-sm hover:shadow-md",
      secondary: "bg-gray-100 text-gray-900 hover:bg-gray-200 focus:ring-gray-400",
      outline:
        "border-2 border-[#7047EB] bg-transparent text-[#7047EB] hover:bg-[#7047EB] hover:text-white focus:ring-[#7047EB]",
      ghost: "bg-transparent text-gray-700 hover:bg-gray-100 focus:ring-gray-400",
      danger: "bg-red-600 text-white hover:bg-red-700 focus:ring-red-500 shadow-sm",
      success: "bg-[#5fbd74] text-white hover:bg-[#4da760] focus:ring-[#5fbd74] shadow-sm hover:shadow-md",
    };

    const sizes = {
      sm: "px-4 py-2 text-sm",
      md: "px-6 py-2.5 text-sm",
      lg: "px-8 py-3 text-base",
    };

    return (
      <button
        ref={ref}
        className={`${baseStyles} ${variants[variant]} ${sizes[size]} ${className}`}
        disabled={disabled || isLoading}
        {...props}
      >
        {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        {children}
      </button>
    );
  }
);

Button.displayName = "Button";

export default Button;
