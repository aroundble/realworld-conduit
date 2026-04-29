import type { CSSProperties, HTMLAttributes } from "react";

// Shared shimmer placeholder (#114). Renders a grey-on-grey pulsing
// block at the caller-provided width/height. The shimmer is powered
// by a CSS `@keyframes conduit-shimmer` rule in globals.css; keeping
// the animation in plain CSS (no JS) means it paints during the
// server-streamed Suspense fallback without hydration.

type Props = HTMLAttributes<HTMLSpanElement> & {
  width?: string | number;
  height?: string | number;
};

export const Shimmer = ({
  width = "100%",
  height = "1rem",
  style,
  className,
  ...rest
}: Props) => {
  const merged: CSSProperties = {
    display: "inline-block",
    width,
    height,
    ...style,
  };
  return (
    <span
      {...rest}
      aria-hidden="true"
      className={`skeleton-shimmer${className ? ` ${className}` : ""}`}
      style={merged}
    />
  );
};
