import React from "react";
import { BranchA } from "./BranchA";
import { BranchB } from "./BranchB";

interface MiddleProps {
  data: string;
}

export function Middle({ data }: MiddleProps) {
  // data fans out to two sibling branches — pure passthrough in both directions
  return (
    <div>
      <BranchA data={data} />
      <BranchB data={data} />
    </div>
  );
}
