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
    // `focus:outline-none` is deliberately absent: the global `*:focus-visible`
    // rule in globals.css draws a 2px outline in --focus-ring, and removing the
    // outline here left keyboard users with a gold ring at 2.28:1 against a
    // light page. One focus treatment, applied everywhere.
    const baseStyles =
      "inline-flex items-center justify-center font-medium rounded-full transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed";

    // White on #D4A017 is 2.38:1 — a gold button's own label was unreadable.
    // #1d1d1f (via --color-primary-contrast) is 7.08:1.
    const variants = {
      primary:
        "bg-[#D4A017] text-[var(--color-primary-contrast)] hover:bg-[#B8860B] shadow-sm hover:shadow-md",
      secondary:
        "bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100 hover:bg-gray-200",
      outline:
        "border-2 border-[#D4A017] bg-transparent text-[var(--color-primary-text)] hover:bg-[#D4A017] hover:text-[var(--color-primary-contrast)]",
      ghost:
        "bg-transparent text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/10",
      danger: "bg-red-600 text-white hover:bg-red-700 shadow-sm",
      success:
        "bg-[#D4A017] text-[var(--color-primary-contrast)] hover:bg-[#B8860B] shadow-sm hover:shadow-md",
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
