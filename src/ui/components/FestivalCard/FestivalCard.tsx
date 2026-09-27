"use client";
/*
 * Documentation:
 * Festival Card — https://app.subframe.com/2d1d809937f0/library?component=Festival+Card_c2d0c57c-2e3e-4b8a-b532-a016462c9d76
 */

import React from "react";
import * as SubframeUtils from "../../utils";

export interface FestivalCardRootProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  eyebrow?: React.ReactNode;
  title?: React.ReactNode;
  lead?: React.ReactNode;
  meta?: React.ReactNode;
  art?: React.ReactNode;
  className?: string;
}

const FestivalCardRoot = React.forwardRef<
  HTMLDivElement,
  FestivalCardRootProps
>(function FestivalCardRoot(
  {
    eyebrow,
    title,
    lead,
    meta,
    art,
    className,
    ...otherProps
  }: FestivalCardRootProps,
  ref
) {
  return (
    <div
      className={SubframeUtils.twClassNames(
        "group/c2d0c57c flex h-[450px] cursor-pointer flex-col items-start overflow-hidden rounded-card bg-paper-sunk w-90 transition-transform duration-[120ms] ease-in-out hover:shadow-[0px_12px_32px_-4px_#00000014,0px_4px_8px_-2px_#00000014] hover:scale-[1.01] active:scale-[0.96] mobile:w-full",
        className
      )}
      ref={ref}
      {...otherProps}
    >
      <div className="flex w-full flex-col items-start px-7 pt-7 pb-6">
        {eyebrow ? (
          <span className="text-micro font-micro text-ink-soft uppercase mb-2">
            {eyebrow}
          </span>
        ) : null}
        {title ? (
          <span className="line-clamp-2 font-['Archivo'] text-[28px] font-[600] leading-[31px] tracking-[-0.01em] text-ink [font-stretch:125%] mobile:text-[24px] mobile:leading-[26px]">
            {title}
          </span>
        ) : null}
        {lead ? (
          <span className="text-body-bold font-body-bold text-ink mt-2.5">
            {lead}
          </span>
        ) : null}
        {meta ? (
          <span className="text-small font-small text-ink-soft mt-1.5">
            {meta}
          </span>
        ) : null}
      </div>
      {art ? (
        <div className="flex min-h-[0px] w-full grow shrink-0 basis-0 flex-col items-start overflow-hidden relative">
          {art}
        </div>
      ) : null}
    </div>
  );
});

export const FestivalCard = FestivalCardRoot;
