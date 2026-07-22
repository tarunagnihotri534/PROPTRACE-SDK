import React from "react";
import { Inner } from "./Inner";

interface ContainerProps {
  label: string;
  extra: string;
}

export function Container({ label, extra }: ContainerProps) {
  // label is spread into Inner — static trace cannot continue past this
  const rest = { label, extra };
  return <Inner {...rest} />;
}
