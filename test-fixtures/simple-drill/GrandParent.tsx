import React, { useState } from "react";
import { Parent } from "./Parent";

export function GrandParent() {
  const [title, setTitle] = useState("Hello World");
  return <Parent title={title} />;
}
