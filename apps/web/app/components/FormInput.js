"use client";

import { useState } from "react";

/**
 * Labeled text input with a leading Material Symbol icon.
 *
 * Props:
 *  - id, name, label, type, placeholder, value, onChange, autoComplete,
 *    required, minLength, disabled, icon (material symbol name)
 *  - labelRightSlot: ReactNode — optional right-side slot in the label row (e.g. "Forgot password?")
 */
export function FormInput({
    id,
    name,
    label,
    type = "text",
    placeholder,
    value,
    onChange,
    autoComplete,
    required = false,
    minLength,
    disabled = false,
    icon,
    labelRightSlot,
}) {
    return (
        <div className="flex flex-col gap-2">
            <div className="flex justify-between items-center">
                <label className="text-sm font-medium text-slate-700 dark:text-slate-300" htmlFor={id}>
                    {label}
                </label>
                {labelRightSlot}
            </div>
            <div className="relative group">
                {icon && (
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400 group-focus-within:text-primary transition-colors">
                        <span className="material-symbols-outlined text-[20px]">{icon}</span>
                    </div>
                )}
                <input
                    className={`form-input w-full rounded-lg border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#151b23] text-slate-900 dark:text-white ${icon ? "pl-10" : "pl-4"} pr-4 py-3 text-sm focus:border-primary focus:ring-1 focus:ring-primary placeholder:text-slate-400 dark:placeholder:text-slate-600 transition-all duration-200`}
                    id={id}
                    name={name}
                    placeholder={placeholder}
                    type={type}
                    value={value}
                    onChange={onChange}
                    autoComplete={autoComplete}
                    required={required}
                    minLength={minLength}
                    disabled={disabled}
                />
            </div>
        </div>
    );
}

/**
 * Password input with show/hide toggle button, extending FormInput.
 */
export function PasswordInput({ id, name, label, placeholder, value, onChange, autoComplete, required, minLength, labelRightSlot }) {
    const [showPassword, setShowPassword] = useState(false);

    return (
        <div className="flex flex-col gap-2">
            <div className="flex justify-between items-center">
                <label className="text-sm font-medium text-slate-700 dark:text-slate-300" htmlFor={id}>
                    {label}
                </label>
                {labelRightSlot}
            </div>
            <div className="relative group">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400 group-focus-within:text-primary transition-colors">
                    <span className="material-symbols-outlined text-[20px]">lock</span>
                </div>
                <input
                    className="form-input w-full rounded-lg border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#151b23] text-slate-900 dark:text-white pl-10 pr-10 py-3 text-sm focus:border-primary focus:ring-1 focus:ring-primary placeholder:text-slate-400 dark:placeholder:text-slate-600 transition-all duration-200"
                    id={id}
                    name={name}
                    placeholder={placeholder}
                    type={showPassword ? "text" : "password"}
                    value={value}
                    onChange={onChange}
                    autoComplete={autoComplete}
                    required={required}
                    minLength={minLength}
                />
                <button
                    className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-300 focus:outline-none"
                    type="button"
                    onClick={() => setShowPassword((c) => !c)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                >
                    <span className="material-symbols-outlined text-[20px]">{showPassword ? "visibility_off" : "visibility"}</span>
                </button>
            </div>
        </div>
    );
}
