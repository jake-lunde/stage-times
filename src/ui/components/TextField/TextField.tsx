"use client";
/*
 * Documentation:
 * Text Field — https://app.subframe.com/2d1d809937f0/library?component=Text+Field_2f58a3a8-07ff-4b9c-9f19-e1c5e5be6b83
 */

import React from "react";
import * as SubframeCore from "@subframe/core";
import * as SubframeUtils from "../../utils";

export interface InputProps
  extends Omit<
    React.InputHTMLAttributes<HTMLInputElement>,
    "type" | "placeholder" | "value"
  > {
  type?: "text" | "password" | "email" | "number" | "tel" | "url" | "search";
  placeholder?: React.ReactNode;
  value?: React.ReactNode;
  onChange?: (event: React.ChangeEvent<HTMLInputElement>) => void;
  className?: string;
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input(
  { type = "text", placeholder, value, className, ...otherProps }: InputProps,
  ref
) {
  return (
    <input
      className={SubframeUtils.twClassNames(
        "group/245ba2c8 h-full w-full border-none bg-transparent px-0 py-0 text-body font-body text-ink outline-none placeholder:text-ink-faint [.field-disabled_&]:text-ink-faint [.field-disabled_&]:cursor-not-allowed",
        className
      )}
      placeholder={placeholder as string}
      value={value as string}
      ref={ref}
      type={
        type === "search"
          ? "search"
          : type === "url"
          ? "url"
          : type === "tel"
          ? "tel"
          : type === "number"
          ? "number"
          : type === "email"
          ? "email"
          : type === "password"
          ? "password"
          : "text"
      }
      {...otherProps}
    />
  );
});

export interface TextFieldRootProps
  extends React.LabelHTMLAttributes<HTMLLabelElement> {
  label?: React.ReactNode;
  hint?: React.ReactNode;
  state?: "default" | "focus" | "disabled" | "error";
  children?: React.ReactNode;
  className?: string;
}

const TextFieldRoot = React.forwardRef<HTMLLabelElement, TextFieldRootProps>(
  function TextFieldRoot(
    {
      label,
      hint,
      state = "default",
      children,
      className,
      ...otherProps
    }: TextFieldRootProps,
    ref
  ) {
    return (
      <label
        className={SubframeUtils.twClassNames(
          "group/2f58a3a8 flex w-full flex-col items-start gap-1.5",
          { "field-disabled": state === "disabled" },
          className
        )}
        ref={ref}
        {...otherProps}
      >
        {label ? (
          <span className="font-['Archivo'] text-[14px] font-[600] leading-[18px] text-ink">
            {label}
          </span>
        ) : null}
        {children ? (
          <div
            className={SubframeUtils.twClassNames(
              "flex w-full flex-col items-start justify-center rounded-sm border border-solid border-paper-line bg-paper-sunk px-3.5 h-13 group-focus-within/2f58a3a8:outline-solid group-focus-within/2f58a3a8:outline-2 group-focus-within/2f58a3a8:outline-offset-2 group-focus-within/2f58a3a8:outline-red-deep",
              {
                "border border-solid border-red-deep": state === "error",
                "outline-2 outline-offset-2 outline-solid outline-red-deep":
                  state === "focus",
              }
            )}
          >
            {children}
          </div>
        ) : null}
        {hint ? (
          <span
            className={SubframeUtils.twClassNames(
              "text-mono font-mono text-ink-soft",
              { "text-red-deep": state === "error" }
            )}
          >
            {hint}
          </span>
        ) : null}
      </label>
    );
  }
);

export const TextField = Object.assign(TextFieldRoot, {
  Input,
});
