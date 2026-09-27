"use client";
/*
 * Documentation:
 * Button — https://app.subframe.com/2d1d809937f0/library?component=Button_50896a35-b39f-42b7-976a-e469a26f62a3
 */

import React from "react";
import * as SubframeUtils from "../../utils";

export interface ButtonRootProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  disabled?: boolean;
  selected?: boolean;
  variant?: "primary" | "tonal" | "on-color" | "ink" | "danger";
  size?: "large" | "small";
  text?: React.ReactNode;
  onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  className?: string;
}

const ButtonRoot = React.forwardRef<HTMLButtonElement, ButtonRootProps>(
  function ButtonRoot(
    {
      disabled = false,
      selected = false,
      variant = "primary",
      size = "large",
      text,
      className,
      type = "button",
      ...otherProps
    }: ButtonRootProps,
    ref
  ) {
    return (
      <button
        className={SubframeUtils.twClassNames(
          "group/50896a35 flex w-full cursor-pointer items-center justify-center rounded-btn border-none bg-red px-6 text-left h-13 transition-transform active:scale-96 active:bg-red-deep disabled:cursor-default disabled:bg-ink-faint disabled:pointer-events-none",
          {
            "h-11 rounded-btn-sm": size === "small",
            "bg-paper-sunk active:bg-paper-sunk":
              variant === "danger" || variant === "tonal",
            "bg-ink active:bg-ink": variant === "ink" || selected,
            "bg-[#fcf9f4] active:bg-[#fcf9f4]": variant === "on-color",
          },
          className
        )}
        ref={ref}
        type={type}
        disabled={disabled}
        {...otherProps}
      >
        {text ? (
          <span
            className={SubframeUtils.twClassNames(
              "whitespace-nowrap text-body-bold font-body-bold text-[#fcf9f4] group-disabled/50896a35:text-paper",
              {
                "text-red-deep": variant === "danger",
                "text-paper": variant === "ink",
                "text-[#12181f]": variant === "on-color",
                "text-ink": variant === "tonal",
                "group-enabled/50896a35:text-paper": selected,
              }
            )}
          >
            {text}
          </span>
        ) : null}
      </button>
    );
  }
);

export const Button = ButtonRoot;
