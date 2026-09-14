"use client";

import { forwardRef, TextareaHTMLAttributes } from "react";

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
}

/**
 * UX-28. This set no background and no text colour, so it fell through to the
 * UA's Field/FieldText system colours — which stay LIGHT without a
 * `color-scheme` declaration. Every textarea in the product (the review
 * composer, the bio field) rendered as a white slab on a near-black page.
 * Input.tsx already used the tokens; this was never updated to match, down to
 * focusing amber-500 while every other control in the product focuses gold.
 */
const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ label, error, className = "", id, ...props }, ref) => {
    const textareaId = id || label?.toLowerCase().replace(/\s+/g, "-");

    return (
      <div className="w-full">
        {label && (
          <label
            htmlFor={textareaId}
            className="block text-sm font-medium text-[var(--foreground)] mb-1"
          >
            {label}
          </label>
        )}
        <textarea
          ref={ref}
          id={textareaId}
          className={`w-full px-3 py-2 border rounded-lg shadow-sm bg-[var(--input-bg)] text-[var(--foreground)] placeholder-[var(--foreground-secondary)] focus:outline-none focus:ring-2 focus:ring-[#D4A017] focus:border-[#D4A017] disabled:opacity-50 disabled:cursor-not-allowed resize-y min-h-[100px] ${error ? "border-red-500" : "border-[var(--input-border)]"} ${className}`}
          {...props}
        />
        {error && <p className="mt-1 text-sm text-red-600 dark:text-red-400">{error}</p>}
      </div>
    );
  }
);

Textarea.displayName = "Textarea";

export default Textarea;
