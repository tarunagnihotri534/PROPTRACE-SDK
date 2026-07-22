import React from "react";

interface BranchAProps {
  data: string;
}

export function BranchA({ data }: BranchAProps) {
  return <p>Branch A: {data}</p>;
}
