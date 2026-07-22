import React, { useState } from "react";
import { Level1 } from "./Level1";

export function Level0() {
  const [value, setValue] = useState(42);
  return <Level1 value={value} />;
}
