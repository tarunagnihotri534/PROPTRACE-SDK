import React, { useState } from "react";
import { BranchA } from "./BranchA";
import { BranchB } from "./BranchB";
import { Middle } from "./Middle";

export function Root() {
  const [data, setData] = useState("shared");
  return (
    <Middle data={data} />
  );
}
