"use client";
/*
 * Documentation:
 * Button — https://app.subframe.com/2d1d809937f0/library?component=Button_50896a35-b39f-42b7-976a-e469a26f62a3
 * Icon Button — https://app.subframe.com/2d1d809937f0/library?component=Icon+Button_16b6aff3-4408-4381-8c9d-aa396f002235
 * Stage Card — https://app.subframe.com/2d1d809937f0/library?component=Stage+Card_ca471802-bc25-4ca0-803b-2b420fa38527
 */

import React from "react";
import * as SubframeUtils from "../../utils";
import { Button } from "../Button";
import { IconButton } from "../IconButton";

export interface StageCardRootProps
  extends React.HTMLAttributes<HTMLDivElement> {
  tone?: "cream" | "ink";
  name?: React.ReactNode;
  meta?: React.ReactNode;
  description?: React.ReactNode;
  className?: string;
}

const StageCardRoot = React.forwardRef<HTMLDivElement, StageCardRootProps>(
  function StageCardRoot(
    {
      tone = "cream",
      name,
      meta,
      description,
      className,
      ...otherProps
    }: StageCardRootProps,
    ref
  ) {
    return (
      <div
        className={SubframeUtils.twClassNames(
          "group/ca471802 flex flex-col items-start overflow-hidden rounded-card bg-blue w-100 mobile:w-full",
          { "bg-yellow": tone === "ink" },
          className
        )}
        ref={ref}
        {...otherProps}
      >
        <div
          className={SubframeUtils.twClassNames(
            "flex w-full items-center justify-center bg-[#74a3cc] aspect-[400/240]",
            { "bg-[#f3e074]": tone === "ink" }
          )}
        >
          <div
            className={SubframeUtils.twClassNames(
              "flex h-40 w-40 flex-none items-center justify-center rounded-full border border-solid border-[#fcf9f4]",
              { "border border-solid border-[#12181f]": tone === "ink" }
            )}
          >
            <div
              className={SubframeUtils.twClassNames(
                "flex h-28 w-28 flex-none items-center justify-center rounded-full border border-solid border-[#fcf9f4]",
                { "border border-solid border-[#12181f]": tone === "ink" }
              )}
            >
              <div
                className={SubframeUtils.twClassNames(
                  "flex h-16 w-16 flex-none items-center justify-center rounded-full border border-solid border-[#fcf9f4]",
                  { "border border-solid border-[#12181f]": tone === "ink" }
                )}
              >
                <div
                  className={SubframeUtils.twClassNames(
                    "flex h-3 w-3 flex-none items-start rounded-full bg-[#fcf9f4]",
                    { "bg-[#12181f]": tone === "ink" }
                  )}
                />
              </div>
            </div>
          </div>
        </div>
        <div className="flex w-full flex-col items-start px-4 pt-2 pb-4">
          {name ? (
            <span
              className={SubframeUtils.twClassNames(
                "w-full text-card text-[#fcf9f4] font-stretch-expanded",
                { "text-[#12181f]": tone === "ink" }
              )}
            >
              {name}
            </span>
          ) : null}
          {meta ? (
            <span
              className={SubframeUtils.twClassNames(
                "w-full text-mono font-mono text-[#fcf9f4d9] mt-1.5 uppercase",
                { "text-[#12181f]": tone === "ink" }
              )}
            >
              {meta}
            </span>
          ) : null}
          {description ? (
            <span
              className={SubframeUtils.twClassNames(
                "w-full text-small font-small text-[#fcf9f4d9] mt-3",
                { "text-[#12181f]": tone === "ink" }
              )}
            >
              {description}
            </span>
          ) : null}
          <div className="flex w-full items-center gap-2 mt-4">
            <Button
              variant={tone === "ink" ? "ink" : "on-color"}
              size="large"
              text="Add calendar"
            />
            <IconButton
              variant={tone === "ink" ? "on-color-ink" : "on-color"}
            />
          </div>
        </div>
      </div>
    );
  }
);

export const StageCard = StageCardRoot;
