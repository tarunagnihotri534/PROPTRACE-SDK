import React from "react";
import { Level4 } from "./Level4";

interface Props { value: number; }

export function Level3({ value }: Props) {
  return <Level4 value={value} />;
}
