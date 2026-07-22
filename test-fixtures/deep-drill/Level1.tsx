import React from "react";
import { Level2 } from "./Level2";

interface Props { value: number; }

export function Level1({ value }: Props) {
  return <Level2 value={value} />;
}
