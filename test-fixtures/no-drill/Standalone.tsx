import React from "react";

interface StandaloneProps {
  message: string;
}

export function Standalone({ message }: StandaloneProps) {
  // message is consumed immediately — no drilling at all
  return <div className="standalone">{message}</div>;
}
