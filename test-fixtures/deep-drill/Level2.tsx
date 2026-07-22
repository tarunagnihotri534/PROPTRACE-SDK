import React from "react";
import { Level3 } from "./Level3";

interface Props { value: number; }

export function Level2({ value }: Props) {
  return <Level3 value={value} />;
}
