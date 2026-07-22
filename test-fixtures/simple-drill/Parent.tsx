import React from "react";
import { Child } from "./Child";

interface ParentProps {
  title: string;
}

export function Parent({ title }: ParentProps) {
  // Pure passthrough — title is not used here, just forwarded
  return <Child title={title} />;
}
