"use client";
/*
 * Documentation:
 * Icon Button — https://app.subframe.com/2d1d809937f0/library?component=Icon+Button_16b6aff3-4408-4381-8c9d-aa396f002235
 */

import React from "react";
import * as SubframeCore from "@subframe/core";
import * as SubframeUtils from "../../utils";

export interface IconButtonRootProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  disabled?: boolean;
  icon?: React.ReactNode;
  variant?: "default" | "on-paper" | "on-color" | "on-color-ink";
  copied?: boolean;
  onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  className?: string;
}

const IconButtonRoot = React.forwardRef<HTMLButtonElement, IconButtonRootProps>(
  function IconButtonRoot(
    {
      disabled = false,
      icon = (
        <svg width="1em" height="1em" viewBox="0 0 24 24">
          <path
            d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeOpacity="1"
          />
          <path
            d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeOpacity="1"
          />
        </svg>
      ),
      variant = "default",
      copied = false,
      className,
      type = "button",
      ...otherProps
    }: IconButtonRootProps,
    ref
  ) {
    return (
      <button
        className={SubframeUtils.twClassNames(
          "group/16b6aff3 flex h-11 w-11 cursor-pointer items-center justify-center rounded-full border-none bg-paper-sunk text-left transition-transform active:scale-[0.96] disabled:cursor-default disabled:opacity-50 disabled:pointer-events-none",
          {
            "bg-[#12181f1f]": variant === "on-color-ink",
            "bg-[#fcf9f438]": variant === "on-color",
            "bg-paper": variant === "on-paper",
          },
          className
        )}
        ref={ref}
        type={type}
        disabled={disabled}
        {...otherProps}
      >
        {icon ? (
          <SubframeCore.IconWrapper
            className={SubframeUtils.twClassNames(
              "font-['Archivo'] text-[20px] font-[400] leading-[30px] text-ink",
              {
                hidden: copied,
                "text-[#12181f]": variant === "on-color-ink",
                "text-[#fcf9f4]": variant === "on-color",
              }
            )}
          >
            {icon}
          </SubframeCore.IconWrapper>
        ) : null}
        <svg
          className={SubframeUtils.twClassNames(
            "hidden font-['Archivo'] text-[20px] font-[400] leading-[30px] text-ink",
            {
              "inline-flex": copied,
              "text-[#12181f]": variant === "on-color-ink",
              "text-[#fcf9f4]": variant === "on-color",
            }
          )}
          width="1em"
          height="1em"
          viewBox="0 0 24 24"
        >
          <path
            d="M20 6 9 17l-5-5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeOpacity="1"
          />
        </svg>
      </button>
    );
  }
);

export const IconButton = IconButtonRoot;
