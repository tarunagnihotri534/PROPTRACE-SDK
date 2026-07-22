import React from "react";

interface ChildProps {
  title: string;
}

export function Child({ title }: ChildProps) {
  // Consumption — title is rendered in JSX
  return <h1>{title}</h1>;
}
