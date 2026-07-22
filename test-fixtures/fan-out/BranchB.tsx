import React from "react";

interface BranchBProps {
  data: string;
}

export function BranchB({ data }: BranchBProps) {
  return <p>Branch B: {data}</p>;
}
